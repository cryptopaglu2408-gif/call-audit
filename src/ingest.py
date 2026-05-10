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


def download_audio(url: str, dest_name: str) -> Path:
    """Download a public Google Drive file via gdown. Raises on failure."""
    import gdown  # imported lazily so module import stays cheap

    file_id = extract_drive_id(url) or url
    out_path = AUDIO_DIR / dest_name
    result = gdown.download(
        url=f"https://drive.google.com/uc?id={file_id}",
        output=str(out_path),
        quiet=True,
        fuzzy=True,
    )
    if result is None or not out_path.exists():
        raise RuntimeError(f"gdown failed for {url} (is the link 'Anyone with the link'?)")
    return out_path


def iter_pending(rows: list[Row]) -> Iterator[Row]:
    yield from rows
