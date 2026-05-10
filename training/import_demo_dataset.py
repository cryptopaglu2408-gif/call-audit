"""Import the 'Demo Quality Check Form (Responses).xlsx' as gold-standard
training data.

For each row:
  1. Look up (or create) a `calls` row keyed on the Drive link.
  2. Download the audio (gdown) and transcribe with faster-whisper.
  3. Save the gold scores from the xlsx (mapping yes/no/3-way to integers).

Rows whose `calls.transcript` is already populated are skipped, so the script
is safe to re-run / resume.

Usage:
  python -m training.seed_demo_rubric                       # one-off rubric setup
  python -m training.import_demo_dataset --xlsx "Demo Quality Check Form  (Responses).xlsx"

Flags:
  --limit N                  process only first N rows (for testing)
  --skip-transcription       just create call rows + scores, don't download/transcribe
                             (use this on a CPU laptop, then re-run on Colab GPU)
  --dry-run                  print what would happen, don't write
"""
from __future__ import annotations

import argparse
import sys
import traceback
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

import pandas as pd


def _json_safe(value):
    """Coerce pandas / numpy / datetime values to JSON-native types."""
    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and pd.isna(value):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):  # numpy scalars (int64, float64, bool_)
        try:
            return value.item()
        except Exception:
            return str(value)
    return value

from src import db, ingest, transcribe
from training.seed_demo_rubric import RUBRIC_NAME

# Maps xlsx column names → rubric parameter names (keep in lockstep with seed_demo_rubric.py)
COLUMN_TO_PARAM = {
    "Call Opening": "Call Opening",
    "Reason of Call": "Reason of Call",
    "Customer Need Assessment ": "Customer Need Assessment",
    "Problem Identified ?": "Problem Identified ?",
    "USP Discussion ?": "USP Discussion ?",
    "Intent Check Done ?": "Intent Check Done ?",
    "Demo Session Pitch": "Demo Session Pitch",
    "Price Discussed ?": "Price Discussed ?",
    "Closing ?": "Closing ?",
    "Was Demo Scheduled ?": "Was Demo Scheduled ?",
}

YES_NO_MAP = {"yes": 2, "no": 1}
THREE_WAY_MAP = {"no": 1, "call back for date & time": 2, "callback": 2, "yes": 3}


def encode_value(raw, kind: str, max_score: int) -> int | None:
    if pd.isna(raw):
        return None
    if kind == "numeric":
        try:
            return int(max(1, min(int(raw), max_score)))
        except (TypeError, ValueError):
            return None
    s = str(raw).strip().lower()
    if kind == "yes_no":
        return YES_NO_MAP.get(s)
    if kind == "categorical_3":
        return THREE_WAY_MAP.get(s)
    return None


def build_reasoning(row: pd.Series, kind: str, value: int | None, max_score: int) -> str:
    """Synthesize a non-empty reasoning so the trained model learns to produce one.
    Uses 'Audited By' + the free-text 'Area of Improvements' field."""
    if value is None:
        return ""
    auditor = str(row.get("Audited By") or "auditor").strip() or "auditor"
    if kind == "numeric":
        verdict = f"scored {value}/{max_score}"
    elif kind == "yes_no":
        verdict = "marked Yes" if value == 2 else "marked No"
    else:  # categorical_3
        verdict = {1: "marked No", 2: "noted Callback for Date & Time", 3: "marked Yes"}.get(value, "")
    notes = (row.get("Area of Improvements") or "").strip() if isinstance(row.get("Area of Improvements"), str) else ""
    if notes:
        return f"Auditor {auditor} {verdict}. Notes: {notes}"
    return f"Auditor {auditor} {verdict}."


def find_or_create_call(drive_link: str, source_row: int, metadata: dict) -> dict:
    """Idempotent: returns the existing call row if drive_link already imported."""
    res = db.client().table("calls").select("*").eq("drive_link", drive_link).limit(1).execute()
    if res.data:
        return res.data[0]
    return db.create_call(job_id=None, source_row=source_row, drive_link=drive_link, metadata=metadata)


def transcribe_call(call: dict) -> tuple[str, float, str]:
    """Download → upload to storage → transcribe. Returns (text, duration_s, language)."""
    local_name = f"{uuid4().hex}.mp3"
    local_audio = ingest.download_audio(call["drive_link"], dest_name=local_name)
    try:
        storage_path = db.upload_audio(local_audio, dest_name=f"{call['id']}/{local_audio.name}")
        db.update_call(call["id"], storage_path=storage_path, status="downloaded")
        tr = transcribe.transcribe(local_audio)
        return tr.text, tr.duration, tr.language
    finally:
        try:
            local_audio.unlink(missing_ok=True)
        except OSError:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default="Demo Quality Check Form  (Responses).xlsx",
                    type=Path, help="Path to the audited xlsx.")
    ap.add_argument("--limit", type=int, default=None,
                    help="Only process first N rows.")
    ap.add_argument("--skip-transcription", action="store_true",
                    help="Don't download / run Whisper. Just write gold scores. "
                         "Useful for fast metadata import on CPU; re-run on Colab GPU later.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.xlsx.exists():
        sys.exit(f"xlsx not found: {args.xlsx}")

    # 1. Look up the rubric
    rubrics = db.client().table("rubrics").select("*").eq("name", RUBRIC_NAME).execute().data or []
    if not rubrics:
        sys.exit(
            f"Rubric '{RUBRIC_NAME}' not found. Run `python -m training.seed_demo_rubric` first."
        )
    rubric = rubrics[0]
    rubric_id = rubric["id"]
    params_by_name = {p["name"]: p for p in rubric["parameters"]}

    # 2. Load xlsx
    df = pd.read_excel(args.xlsx)
    if args.limit:
        df = df.head(args.limit)
    total = len(df)
    print(f"Loaded {total} rows from {args.xlsx.name}", flush=True)

    stats = {"imported": 0, "skipped_no_link": 0, "skipped_existing_transcript": 0,
             "transcribed": 0, "scored": 0, "errors": 0}

    for i, (_, row) in enumerate(df.iterrows(), start=1):
        sheet_row = i + 1  # xlsx row 1 is header, so first data row is 2
        link = row.get("Audio Recording File")
        if not isinstance(link, str) or not link.strip():
            stats["skipped_no_link"] += 1
            continue
        link = link.strip()
        try:
            metadata = {
                k: _json_safe(v)
                for k, v in row.to_dict().items()
                if k != "Audio Recording File"
            }
            metadata["_audited_by"] = str(row.get("Audited By") or "").strip() or None
            metadata["_agent_name"] = str(row.get("Agent Name ") or "").strip() or None

            if args.dry_run:
                print(f"[DRY] row {sheet_row}: {link[:60]}…")
                continue

            call = find_or_create_call(link, source_row=sheet_row, metadata=metadata)
            call_id = call["id"]

            # Transcribe if not yet done
            if not call.get("transcript") and not args.skip_transcription:
                try:
                    text, duration, lang = transcribe_call(call)
                    db.update_call(call_id, transcript=text, duration_seconds=duration,
                                   language=lang, status="transcribed")
                    stats["transcribed"] += 1
                    print(f"  row {sheet_row}: transcribed ({duration:.0f}s, lang={lang})")
                except Exception as exc:
                    err = f"{exc.__class__.__name__}: {exc}"
                    db.update_call(call_id, status="error", error=err)
                    stats["errors"] += 1
                    print(f"  row {sheet_row}: TRANSCRIBE FAIL — {err}")
            elif call.get("transcript"):
                stats["skipped_existing_transcript"] += 1

            # Save gold scores from the xlsx
            score_items = []
            for xlsx_col, param_name in COLUMN_TO_PARAM.items():
                param = params_by_name.get(param_name)
                if not param:
                    continue
                kind = param.get("kind", "numeric")
                max_score = int(param.get("max_score", 5))
                value = encode_value(row.get(xlsx_col), kind, max_score)
                if value is None:
                    continue
                score_items.append({
                    "parameter": param_name,
                    "score": value,
                    "max_score": max_score,
                    "reasoning": build_reasoning(row, kind, value, max_score),
                })
            if score_items:
                db.save_scores(call_id, rubric_id, score_items)
                stats["scored"] += 1

            # Mark done if both transcribed and scored
            if call.get("transcript") and score_items:
                db.update_call(call_id, status="done")

            stats["imported"] += 1
            print(f"[{i}/{total}] row {sheet_row} ✓ scored={len(score_items)}", flush=True)
        except Exception:
            stats["errors"] += 1
            print(f"[{i}/{total}] row {sheet_row}: UNEXPECTED ERROR", flush=True)
            traceback.print_exc()

    print("\n--- Summary ---")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    if args.skip_transcription:
        print("\nNext: re-run without --skip-transcription on a faster machine "
              "(Colab GPU recommended) to fill in transcripts.")
    else:
        print("\nNext: python -m training.export_dataset "
              "--output training/data/calls.jsonl")


if __name__ == "__main__":
    main()
