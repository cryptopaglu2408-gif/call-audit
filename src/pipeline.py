from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from . import db, embed, ingest, score, transcribe


@dataclass
class StepUpdate:
    index: int
    total: int
    sheet_row: int
    stage: str
    message: str
    call_id: str | None = None
    error: str | None = None


def run_pipeline(
    sheet_name: str,
    link_column: str,
    row_start: int,
    row_end: int,
    rows: list[ingest.Row],
    rubric: dict,
    delete_local_audio: bool = True,
) -> Iterator[StepUpdate]:
    total = len(rows)
    if total == 0:
        return

    job = db.create_ingestion_job(
        sheet_name=sheet_name,
        link_column=link_column,
        row_start=row_start,
        row_end=row_end,
        total_rows=total,
    )
    job_id = job["id"]

    judge = score.get_judge()
    rubric_id = rubric["id"]
    rubric_params = rubric["parameters"]

    failed = 0
    try:
        for idx, row in enumerate(rows, start=1):
            call_id: str | None = None
            local_audio: Path | None = None
            try:
                yield StepUpdate(idx, total, row.sheet_row, "create", "Recording call")
                call = db.create_call(
                    job_id=job_id,
                    source_row=row.sheet_row,
                    drive_link=row.link,
                    metadata=row.metadata,
                )
                call_id = call["id"]

                yield StepUpdate(idx, total, row.sheet_row, "download", "Downloading audio", call_id)
                local_name = f"{uuid4().hex}.mp3"
                local_audio = ingest.download_audio(row.link, dest_name=local_name)

                yield StepUpdate(idx, total, row.sheet_row, "upload", "Uploading to Supabase", call_id)
                storage_path = db.upload_audio(local_audio, dest_name=f"{call_id}/{local_audio.name}")
                db.update_call(call_id, storage_path=storage_path, status="downloaded")

                yield StepUpdate(idx, total, row.sheet_row, "transcribe", "Transcribing", call_id)
                tr = transcribe.transcribe(local_audio)
                db.update_call(
                    call_id,
                    transcript=tr.text,
                    diarized={"segments": tr.segments},
                    duration_seconds=tr.duration,
                    language=tr.language,
                    status="transcribed",
                )

                yield StepUpdate(idx, total, row.sheet_row, "embed", "Embedding", call_id)
                vec = embed.embed(tr.text)
                db.save_embedding(call_id, vec)

                yield StepUpdate(idx, total, row.sheet_row, "score", "Scoring", call_id)
                items = judge.score(tr.text, rubric_params)
                db.save_scores(call_id, rubric_id, items)
                db.update_call(call_id, status="done")

                yield StepUpdate(idx, total, row.sheet_row, "done", "Done", call_id)
            except Exception as exc:  # noqa: BLE001
                failed += 1
                err = f"{exc.__class__.__name__}: {exc}"
                if call_id:
                    db.update_call(call_id, status="failed", error=err)
                yield StepUpdate(idx, total, row.sheet_row, "error", err, call_id, error=traceback.format_exc())
            finally:
                if delete_local_audio and local_audio and local_audio.exists():
                    try:
                        local_audio.unlink()
                    except OSError:
                        pass
        status = "completed" if failed == 0 else ("partial" if failed < total else "failed")
        db.finish_ingestion_job(job_id, status=status)
    except Exception as exc:  # noqa: BLE001
        db.finish_ingestion_job(job_id, status="failed", error=str(exc))
        raise
