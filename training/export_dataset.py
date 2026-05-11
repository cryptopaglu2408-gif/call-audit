"""Export human-validated scored calls from Supabase as a fine-tuning dataset.

Each row becomes one chat-format training example:
  user:     <SYSTEM_PROMPT> + rubric + transcript
  assistant: {"scores": [...]}   (the gold-standard scores)

Partially-scored calls are included by default: only the scored parameters
appear in both the rubric prompt and the assistant response, so every
example is still a complete input→output pair. Use --min-scored to require
a minimum number of scored parameters per call (default 1 = include all).

Usage:
  python -m training.export_dataset \
      --rubric-id <uuid>         # optional; defaults to the active rubric
      --min-scored 1             # min scored parameters to include a call
      --min-calls 50             # warn if fewer than this
      --output training/data/calls.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from src import db
from src.score import SYSTEM_PROMPT, _build_user_prompt


def collect_examples(rubric_id: str | None, min_scored: int) -> tuple[list[dict], dict]:
    if rubric_id:
        res = db.client().table("rubrics").select("*").eq("id", rubric_id).limit(1).execute()
        rubric = (res.data or [None])[0]
    else:
        rubric = db.get_active_rubric()
    if not rubric:
        raise RuntimeError("No rubric found. Pass --rubric-id or activate one in the app.")

    rubric_params = rubric["parameters"]
    by_name = {p["name"]: p for p in rubric_params}

    res = (
        db.client()
        .table("calls")
        .select("id, transcript, scores!inner(parameter, score, max_score, reasoning, rubric_id)")
        .not_.is_("transcript", "null")
        .eq("scores.rubric_id", rubric["id"])
        .execute()
    )
    rows = res.data or []

    full_count = 0
    partial_count = 0
    examples: list[dict] = []

    for call in rows:
        transcript = (call.get("transcript") or "").strip()
        if not transcript:
            continue

        scores = call.get("scores") or []

        # Build ordered list of only the parameters that were actually scored.
        ordered = []
        for param in rubric_params:
            match = next((s for s in scores if s["parameter"] == param["name"]), None)
            if not match:
                continue
            ordered.append({
                "parameter": match["parameter"],
                "score": int(match["score"]),
                "reasoning": (match.get("reasoning") or "").strip(),
            })

        if len(ordered) < min_scored:
            continue

        is_partial = len(ordered) < len(rubric_params)
        if is_partial:
            partial_count += 1
            # For partial examples, narrow the rubric to only scored parameters
            # so the prompt and response are still a complete pair.
            scored_names = {s["parameter"] for s in ordered}
            active_params = [p for p in rubric_params if p["name"] in scored_names]
        else:
            full_count += 1
            active_params = rubric_params

        user_msg = (
            SYSTEM_PROMPT
            + "\n\n"
            + _build_user_prompt(active_params, transcript)
            + '\n\nReturn ONLY a JSON object: {"scores":[{"parameter":"...","score":N,"reasoning":"..."}, ...]}'
        )
        assistant_msg = json.dumps({"scores": ordered}, ensure_ascii=False)
        examples.append({
            "messages": [
                {"role": "user", "content": user_msg},
                {"role": "assistant", "content": assistant_msg},
            ]
        })

    return examples, rubric, full_count, partial_count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rubric-id", default=None)
    ap.add_argument("--min-scored", type=int, default=1,
                    help="Minimum number of scored parameters required to include a call. "
                         "Default 1 includes all partially-scored calls.")
    ap.add_argument("--min-calls", type=int, default=50)
    ap.add_argument("--output", type=Path, default=Path("training/data/calls.jsonl"))
    args = ap.parse_args()

    examples, rubric, full_count, partial_count = collect_examples(args.rubric_id, args.min_scored)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    total = full_count + partial_count
    print(f"Rubric : {rubric['name']} ({len(rubric['parameters'])} parameters)")
    print(f"Total  : {total} examples  ({full_count} fully scored, {partial_count} partially scored)")
    print(f"Output : {args.output}")
    if total < args.min_calls:
        print(
            f"Warning: only {total} examples — fine-tuning works better with "
            f">= {args.min_calls}. Score more calls before training."
        )


if __name__ == "__main__":
    main()
