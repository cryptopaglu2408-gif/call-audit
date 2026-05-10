from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any, Iterator

import pandas as pd

from .config import AUDIO_DIR

_DRIVE_ID_RE = re.compile(r"(?:/d/|id=|/file/d/)([A-Za-z0-9_-]{20,})")


def read_sheet(source: str | Path | IO[bytes]) -> pd.DataFrame:
    """Load an .xlsx (or .csv) into a DataFrame. Streamlit UploadedFile works directly."""
    if isinstance(source, (str, Path)) and str(source).lower().endswith(".csv"):
        return pd.read_csv(source)
    return pd.read_excel(source)


def extract_drive_id(url: str) -> str | None:
    if not isinstance(url, str):
        return None
    m = _DRIVE_ID_RE.search(url)
    return m.group(1) if m else None


@dataclass
class Row:
    sheet_row: int   # 1-indexed, matches what Excel shows (row 1 = header)
    link: str
    metadata: dict[str, Any]


def select_rows(
    df: pd.DataFrame, link_column: str, row_start: int, row_end: int
) -> list[Row]:
    """Slice the dataframe by 1-indexed sheet rows (row 1 = header).

    row_start=2 means the first data row. Rows where the link cell is empty are skipped.
    """
    if link_column not in df.columns:
        raise ValueError(f"Column {link_column!r} not in sheet (have: {list(df.columns)})")
    if row_start < 2:
        row_start = 2
    if row_end < row_start:
        raise ValueError("row_end must be >= row_start")

    df_slice = df.iloc[row_start - 2 : row_end - 1]
    out: list[Row] = []
    for offset, (_, row) in enumerate(df_slice.iterrows()):
        link = row.get(link_column)
        if not isinstance(link, str) or not link.strip():
            continue
        meta = {
            k: (v if pd.notna(v) else None)
            for k, v in row.to_dict().items()
            if k != link_column
        }
        out.append(Row(sheet_row=row_start + offset, link=link.strip(), metadata=meta))
    return out


def _download_via_drive_api(file_id: str, out_path: Path) -> Path:
    """Authenticated Drive download via google-api-python-client.

    Bypasses the per-IP anonymous quota that breaks `gdown` after ~30-50 calls.
    Requires Application Default Credentials — in Colab:
        from google.colab import auth; auth.authenticate_user()
    """
    from googleapiclient.discovery import build  # type: ignore
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore

    service = build("drive", "v3", cache_discovery=False)
    request = service.files().get_media(fileId=file_id)
    with open(out_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Drive API returned empty file for id={file_id}")
    return out_path


def download_audio(url: str, dest_name: str, max_retries: int = 4) -> Path:
    """Download a Google Drive file.

    If env var USE_DRIVE_API=1 is set, uses the authenticated Drive API
    (recommended on Colab — set up via `google.colab.auth.authenticate_user()`).
    Otherwise falls back to anonymous gdown with exponential-backoff retry.
    """
    import os
    import time
    import gdown  # imported lazily so module import stays cheap

    file_id = extract_drive_id(url) or url
    out_path = AUDIO_DIR / dest_name

    if os.getenv("USE_DRIVE_API", "").lower() in {"1", "true", "yes"}:
        return _download_via_drive_api(file_id, out_path)

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            result = gdown.download(
                url=f"https://drive.google.com/uc?id={file_id}",
                output=str(out_path),
                quiet=True,
                fuzzy=True,
            )
            if result is not None and out_path.exists():
                return out_path
            last_err = RuntimeError(f"gdown returned no file for {url}")
        except Exception as exc:  # noqa: BLE001
            last_err = exc

        if attempt < max_retries - 1:
            wait = 4 * (2 ** attempt)  # 4, 8, 16, 32s
            time.sleep(wait)

    raise RuntimeError(
        f"gdown failed for {url} after {max_retries} attempts (Drive anonymous quota "
        f"likely exhausted). Set USE_DRIVE_API=1 + auth.authenticate_user() to bypass. "
        f"Last error: {last_err}"
    )


def iter_pending(rows: list[Row]) -> Iterator[Row]:
    yield from rows
