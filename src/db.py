from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID

from supabase import Client, create_client

from .config import settings

_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        s = settings()
        _client = create_client(s.supabase_url, s.supabase_key)
    return _client


# ---------- Rubrics ----------

def list_rubrics() -> list[dict[str, Any]]:
    res = client().table("rubrics").select("*").order("created_at", desc=True).execute()
    return res.data or []


def get_active_rubric() -> dict[str, Any] | None:
    res = (
        client()
        .table("rubrics")
        .select("*")
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    return (res.data or [None])[0]


def save_rubric(name: str, parameters: list[dict[str, Any]], make_active: bool = True) -> dict[str, Any]:
    if make_active:
        client().table("rubrics").update({"is_active": False}).eq("is_active", True).execute()
    res = (
        client()
        .table("rubrics")
        .insert({"name": name, "parameters": parameters, "is_active": make_active})
        .execute()
    )
    return res.data[0]


def set_active_rubric(rubric_id: str) -> None:
    client().table("rubrics").update({"is_active": False}).eq("is_active", True).execute()
    client().table("rubrics").update({"is_active": True}).eq("id", rubric_id).execute()


# ---------- Ingestion jobs ----------

def create_ingestion_job(
    sheet_name: str, link_column: str, row_start: int, row_end: int, total_rows: int
) -> dict[str, Any]:
    res = (
        client()
        .table("ingestion_jobs")
        .insert(
            {
                "sheet_name": sheet_name,
                "link_column": link_column,
                "row_start": row_start,
                "row_end": row_end,
                "total_rows": total_rows,
                "status": "running",
            }
        )
        .execute()
    )
    return res.data[0]


def finish_ingestion_job(job_id: str, status: str, error: str | None = None) -> None:
    client().table("ingestion_jobs").update({"status": status, "error": error}).eq(
        "id", job_id
    ).execute()


# ---------- Calls ----------

def create_call(job_id: str, source_row: int, drive_link: str, metadata: dict[str, Any]) -> dict[str, Any]:
    res = (
        client()
        .table("calls")
        .insert(
            {
                "job_id": job_id,
                "source_row": source_row,
                "drive_link": drive_link,
                "metadata": metadata,
                "status": "pending",
            }
        )
        .execute()
    )
    return res.data[0]


def update_call(call_id: str, **fields: Any) -> None:
    client().table("calls").update(fields).eq("id", call_id).execute()


def list_calls(limit: int = 200) -> list[dict[str, Any]]:
    res = (
        client()
        .table("calls")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def get_call(call_id: str) -> dict[str, Any] | None:
    res = client().table("calls").select("*").eq("id", call_id).limit(1).execute()
    return (res.data or [None])[0]


# ---------- Storage ----------

def upload_audio(local_path: Path, dest_name: str) -> str:
    s = settings()
    bucket = client().storage.from_(s.audio_bucket)
    content_type = mimetypes.guess_type(local_path.name)[0] or "audio/mpeg"
    with open(local_path, "rb") as f:
        bucket.upload(
            path=dest_name,
            file=f,
            file_options={"content-type": content_type, "upsert": "true"},
        )
    return dest_name


# ---------- Scores ----------

def save_scores(
    call_id: str,
    rubric_id: str | None,
    items: Iterable[dict[str, Any]],
) -> None:
    payload = [
        {
            "call_id": call_id,
            "rubric_id": rubric_id,
            "parameter": item["parameter"],
            "score": item["score"],
            "max_score": item["max_score"],
            "reasoning": item.get("reasoning"),
        }
        for item in items
    ]
    if payload:
        client().table("scores").upsert(
            payload, on_conflict="call_id,rubric_id,parameter"
        ).execute()


def get_scores(call_id: str) -> list[dict[str, Any]]:
    res = client().table("scores").select("*").eq("call_id", call_id).execute()
    return res.data or []


# ---------- Embeddings / search ----------

def save_embedding(call_id: str, vector: list[float]) -> None:
    client().table("call_embeddings").upsert(
        {"call_id": call_id, "embedding": vector}
    ).execute()


def semantic_search(vector: list[float], k: int = 10) -> list[dict[str, Any]]:
    res = client().rpc(
        "match_calls", {"query_embedding": vector, "match_count": k}
    ).execute()
    return res.data or []
