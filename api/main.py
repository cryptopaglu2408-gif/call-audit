"""FastAPI service wrapping the existing pipeline.

Reads happen directly from the React frontend → Supabase. This service
exists for two things only:
  1. POST /api/process     — kick off pipeline.run_pipeline for an upload
  2. GET  /api/process/{token}/stream — SSE stream of StepUpdate events
  3. POST /api/search      — run sentence-transformers embed + pgvector search
                             (the JS frontend can't run the same model)
"""
from __future__ import annotations

import asyncio
import io
import json
import uuid
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src import db, embed, ingest, pipeline

app = FastAPI(title="Call Audit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only — tighten for prod
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# token -> pending job context (uploaded file already parsed into rows + rubric)
_pending: dict[str, dict[str, Any]] = {}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/process")
async def process(
    file: UploadFile = File(...),
    link_column: str = Form(...),
    row_start: int = Form(...),
    row_end: int = Form(...),
) -> dict[str, str]:
    rubric = db.get_active_rubric()
    if not rubric:
        raise HTTPException(400, "No active rubric. Save one on /rubric first.")

    raw = await file.read()
    suffix = (file.filename or "").lower()
    try:
        if suffix.endswith(".csv"):
            df = ingest.read_sheet(io.BytesIO(raw))
        else:
            df = ingest.read_sheet(io.BytesIO(raw))
        rows = ingest.select_rows(df, link_column, int(row_start), int(row_end))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Could not parse sheet: {exc}") from exc

    if not rows:
        raise HTTPException(400, "No rows selected (links empty in chosen range).")

    token = uuid.uuid4().hex
    _pending[token] = {
        "sheet_name": file.filename or "upload",
        "link_column": link_column,
        "row_start": int(row_start),
        "row_end": int(row_end),
        "rows": rows,
        "rubric": rubric,
    }
    return {"token": token}


def _sse(event: str, data: Any) -> bytes:
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


@app.get("/api/process/{token}/stream")
async def stream(token: str) -> StreamingResponse:
    ctx = _pending.pop(token, None)
    if ctx is None:
        raise HTTPException(404, "Unknown or already-consumed token.")

    async def gen():
        loop = asyncio.get_event_loop()
        # Run pipeline in a worker thread; collect updates in a queue.
        queue: asyncio.Queue = asyncio.Queue()

        def worker():
            try:
                for upd in pipeline.run_pipeline(
                    sheet_name=ctx["sheet_name"],
                    link_column=ctx["link_column"],
                    row_start=ctx["row_start"],
                    row_end=ctx["row_end"],
                    rows=ctx["rows"],
                    rubric=ctx["rubric"],
                ):
                    asyncio.run_coroutine_threadsafe(queue.put(("update", upd)), loop)
            except Exception as exc:  # noqa: BLE001
                asyncio.run_coroutine_threadsafe(
                    queue.put(("error", {"message": str(exc)})), loop
                )
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop)

        loop.run_in_executor(None, worker)

        while True:
            kind, payload = await queue.get()
            if kind == "done":
                yield _sse("done", "")
                return
            if kind == "error":
                yield _sse("error", payload)
                continue
            yield _sse("update", asdict(payload))

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


class SearchReq(BaseModel):
    query: str
    k: int = 10


@app.post("/api/search")
def search(req: SearchReq) -> dict[str, Any]:
    if not req.query.strip():
        return {"matches": []}
    vec = embed.embed(req.query)
    matches = db.semantic_search(vec, k=max(1, min(50, req.k)))
    return {"matches": [
        {
            "call_id": m["call_id"],
            "transcript": m.get("transcript") or "",
            "similarity": float(m.get("similarity") or 0),
        }
        for m in matches
    ]}
