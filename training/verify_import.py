"""Sanity-check: every xlsx row landed in Supabase with the right scores.

Compares:
  - row count (xlsx vs `calls`)
  - per-parameter score per row (xlsx value vs encoded value in `scores`)
  - reports any mismatches and prints 3 sample rows in full
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from src import db
from training.import_demo_dataset import COLUMN_TO_PARAM, encode_value
from training.seed_demo_rubric import RUBRIC_NAME

XLSX = Path("Demo Quality Check Form  (Responses).xlsx")


def main() -> None:
    if not XLSX.exists():
        sys.exit(f"xlsx not found: {XLSX}")

    df = pd.read_excel(XLSX)
    print(f"xlsx rows: {len(df)}")

    rubric = (db.client().table("rubrics").select("*")
              .eq("name", RUBRIC_NAME).limit(1).execute().data or [None])[0]
    if not rubric:
        sys.exit(f"Rubric '{RUBRIC_NAME}' missing — run seed_demo_rubric first.")
    params_by_name = {p["name"]: p for p in rubric["parameters"]}
    print(f"rubric: {rubric['name']} · {len(rubric['parameters'])} params")

    # Pull all calls (paginate to be safe)
    calls: list[dict] = []
    page, size = 0, 1000
    while True:
        res = (db.client().table("calls").select("id, drive_link, metadata")
               .range(page * size, (page + 1) * size - 1).execute())
        chunk = res.data or []
        calls.extend(chunk)
        if len(chunk) < size:
            break
        page += 1
    by_link = {c["drive_link"]: c for c in calls}
    print(f"calls in DB: {len(calls)}")

    # Pull all scores for this rubric
    scores: list[dict] = []
    page = 0
    while True:
        res = (db.client().table("scores")
               .select("call_id, parameter, score, max_score")
               .eq("rubric_id", rubric["id"])
               .range(page * size, (page + 1) * size - 1).execute())
        chunk = res.data or []
        scores.extend(chunk)
        if len(chunk) < size:
            break
        page += 1
    print(f"scores in DB (this rubric): {len(scores)}")

    by_call: dict[str, dict[str, int]] = {}
    for s in scores:
        by_call.setdefault(s["call_id"], {})[s["parameter"]] = int(s["score"])

    # --- diff ---
    missing_calls = 0
    missing_scores = 0
    mismatches: list[tuple] = []
    per_param_ok = {pname: 0 for pname in COLUMN_TO_PARAM.values()}
    per_param_miss = {pname: 0 for pname in COLUMN_TO_PARAM.values()}

    for sheet_row, (_, row) in enumerate(df.iterrows(), start=2):
        link = row.get("Audio Recording File")
        if not isinstance(link, str) or not link.strip():
            continue
        link = link.strip()
        call = by_link.get(link)
        if not call:
            missing_calls += 1
            continue
        db_scores = by_call.get(call["id"], {})
        for xlsx_col, param_name in COLUMN_TO_PARAM.items():
            param = params_by_name.get(param_name)
            if not param:
                continue
            kind = param.get("kind", "numeric")
            max_score = int(param.get("max_score", 5))
            expected = encode_value(row.get(xlsx_col), kind, max_score)
            actual = db_scores.get(param_name)
            if expected is None:
                continue
            if actual is None:
                per_param_miss[param_name] += 1
                missing_scores += 1
                continue
            if actual == expected:
                per_param_ok[param_name] += 1
            else:
                mismatches.append((sheet_row, param_name, expected, actual, str(row.get(xlsx_col))))

    # --- report ---
    print("\n--- per-parameter match ---")
    for pname in COLUMN_TO_PARAM.values():
        ok = per_param_ok[pname]
        miss = per_param_miss[pname]
        param = params_by_name.get(pname, {})
        kind = param.get("kind", "?")
        max_s = param.get("max_score", "?")
        print(f"  {pname:30s} kind={kind:14s} max={max_s} ok={ok:4d} missing={miss}")

    print(f"\nrows missing in DB: {missing_calls}")
    print(f"individual scores missing: {missing_scores}")
    print(f"value mismatches: {len(mismatches)}")
    for m in mismatches[:10]:
        print(f"  row {m[0]} · {m[1]} · expected={m[2]} actual={m[3]} (xlsx={m[4]!r})")
    if len(mismatches) > 10:
        print(f"  ... and {len(mismatches) - 10} more")

    # --- sample 3 rows in full ---
    print("\n--- 3 sample rows (xlsx -> DB) ---")
    sample = df.head(3)
    for sheet_row, (_, row) in enumerate(sample.iterrows(), start=2):
        link = row.get("Audio Recording File")
        call = by_link.get(link.strip() if isinstance(link, str) else "")
        print(f"\nrow {sheet_row} · agent={row.get('Agent Name ')!r} · audited_by={row.get('Audited By')!r}")
        print(f"  drive: {link[:60] if isinstance(link, str) else link}…")
        if not call:
            print("  NOT FOUND in DB"); continue
        db_scores = by_call.get(call["id"], {})
        for xlsx_col, param_name in COLUMN_TO_PARAM.items():
            xlsx_v = row.get(xlsx_col)
            db_v = db_scores.get(param_name)
            print(f"  {param_name:30s} xlsx={str(xlsx_v):20s} db={db_v}")


if __name__ == "__main__":
    main()
