"""Diagnose whether the xlsx Drive links are actually accessible.

For each tested link, makes one HEAD/GET to Google Drive's public download
endpoint and classifies the response:

  OK            : file is downloadable
  PERMISSION    : link is private (403/Cannot retrieve public link)
  RATE_LIMIT    : Drive throttled us (429 / "too many requests")
  NOT_FOUND     : file_id doesn't exist
  OTHER         : anything else

Usage:
  # quick sample test — try 10 random rows
  python -m training.check_drive_links --sample 10

  # exhaustive — every row in the xlsx
  python -m training.check_drive_links --all
"""
from __future__ import annotations

import argparse
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

import pandas as pd
import requests

XLSX = Path("Demo Quality Check Form  (Responses).xlsx")
DRIVE_ID_RE = re.compile(r"(?:/d/|id=|/file/d/)([A-Za-z0-9_-]{20,})")


def classify(file_id: str, *, timeout: float = 15.0) -> tuple[str, str]:
    """Returns (verdict, detail). verdict ∈ {OK, PERMISSION, RATE_LIMIT, NOT_FOUND, OTHER}."""
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    try:
        resp = requests.get(url, timeout=timeout, allow_redirects=True, stream=True)
    except requests.RequestException as e:
        return "OTHER", f"network error: {e.__class__.__name__}"

    text_snippet = ""
    ctype = resp.headers.get("Content-Type", "").lower()

    # Drive serves the actual file with a non-text content-type.
    if resp.status_code == 200 and not ctype.startswith("text/html"):
        size = resp.headers.get("Content-Length", "?")
        resp.close()
        return "OK", f"{ctype} · {size} bytes"

    # Otherwise it's an HTML interstitial — read a chunk to classify.
    try:
        text_snippet = next(resp.iter_content(8192, decode_unicode=True), "") or ""
    except Exception:
        text_snippet = ""
    finally:
        resp.close()

    s = text_snippet.lower()
    if "quota" in s or "too many" in s or resp.status_code == 429:
        return "RATE_LIMIT", f"http {resp.status_code} · 'quota/too many'"
    if "permission" in s or "access denied" in s or "request access" in s:
        return "PERMISSION", f"http {resp.status_code} · 'permission/access denied'"
    if resp.status_code == 404 or "not found" in s:
        return "NOT_FOUND", f"http {resp.status_code}"
    if "virus" in s or "scan" in s or "confirm" in s:
        # Big files trigger a virus-scan interstitial — gdown handles this fine.
        return "OK", f"http {resp.status_code} · virus-scan interstitial (large file)"
    return "OTHER", f"http {resp.status_code} · {text_snippet[:120]!r}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=str(XLSX), type=Path)
    ap.add_argument("--sample", type=int, default=10, help="Number of random rows to test")
    ap.add_argument("--all", action="store_true", help="Test every row (slow)")
    ap.add_argument("--throttle", type=float, default=1.5, help="Sleep between requests (sec)")
    args = ap.parse_args()

    if not args.xlsx.exists():
        sys.exit(f"xlsx not found: {args.xlsx}")
    df = pd.read_excel(args.xlsx)
    links = [(i + 2, row.get("Audio Recording File"))
             for i, row in df.iterrows()
             if isinstance(row.get("Audio Recording File"), str) and row.get("Audio Recording File").strip()]
    print(f"xlsx has {len(links)} links")

    if not args.all:
        random.seed(42)
        links = random.sample(links, min(args.sample, len(links)))
    print(f"testing {len(links)} links (throttle={args.throttle}s)\n")

    counts: Counter = Counter()
    for sheet_row, link in links:
        m = DRIVE_ID_RE.search(link)
        if not m:
            counts["NO_FILE_ID"] += 1
            print(f"row {sheet_row}: NO_FILE_ID  {link[:60]}")
            continue
        file_id = m.group(1)
        verdict, detail = classify(file_id)
        counts[verdict] += 1
        print(f"row {sheet_row}: {verdict:11s} {file_id}  ·  {detail}")
        time.sleep(args.throttle)

    print("\n--- summary ---")
    for v, c in counts.most_common():
        pct = c / len(links) * 100 if links else 0
        print(f"  {v:11s} {c:4d}  ({pct:.0f}%)")

    if counts.get("PERMISSION", 0) > 0:
        print("\n-> Some links are NOT 'Anyone with the link can view'. Fix sharing in Drive.")
    if counts.get("RATE_LIMIT", 0) > 0:
        print("\n-> Hit Drive rate limit during this test. Real-run failures are likely throttling, not permissions.")
    if counts.get("OK", 0) == len(links) and links:
        print("\n-> All sampled links are accessible. Failures during bulk run = rate limiting.")


if __name__ == "__main__":
    main()
