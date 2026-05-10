"""Export human-validated scored calls from Supabase as a fine-tuning dataset.

Each row becomes one chat-format training example:
  user:     <SYSTEM_PROMPT> + rubric + transcript
  assistant: {"scores": [...]}   (the gold-standard scores)

Usage:
  python -m training.export_dataset \
      --rubric-id <uuid>         # optional; defaults to the active rubric
      --min-calls 50             # warn if fewer than this
      --output training/data/calls.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from src import db
from src.score import SYSTEM_PROMPT, _build_user_prompt


def collect_examples(rubric_id: str | None) -> tuple[list[dict], dict]:
    if rubric_id:
        res = db.client().table("rubrics").select("*").eq("id", rubric_id).limit(1).execute()
        rubric = (res.data or [None])[0]
    else:
        rubric = db.get_active_rubric()
    if not rubric:
        raise RuntimeError("No rubric found. Pass --rubric-id or activate one in the app.")

    rubric_params = rubric["parameters"]
    by_name = {p["name"]: p for p in rubric_params}

    # Pull calls that have transcripts AND scores against this rubric.
    res = (
        db.client()
        .table("calls")
        .select("id, transcript, scores!inner(parameter, score, max_score, reasoning, rubric_id)")
        .not_.is_("transcript", "null")
        .eq("scores.rubric_id", rubric["id"])
        .execute()
    )
    rows = res.data or []

    examples: list[dict] = []
    for call in rows:
        transcript = (call.get("transcript") or "").strip()
        if not transcript:
            continue
        scores = call.get("scores") or []
        # Only export calls scored against EVERY parameter in the rubric.
        scored_params = {s["parameter"] for s in scores}
        if not all(p["name"] in scored_params for p in rubric_params):
            continue

        ordered = []
        for param in rubric_params:
            match = next((s for s in scores if s["parameter"] == param["name"]), None)
            if not match:
                continue
            ordered.append(
                {
                    "parameter": match["parameter"],
                    "score": int(match["score"]),
                    "reasoning": (match.get("reasoning") or "").strip(),
                }
            )
        if not ordered:
            continue

        user_msg = SYSTEM_PROMPT + "\n\n" + _build_user_prompt(rubric_params, transcript) + (
            '\n\nReturn ONLY a JSON object: {"scores":[{"parameter":"...","score":N,"reasoning":"..."}, ...]}'
        )
        assistant_msg = json.dumps({"scores": ordered}, ensure_ascii=False)
        examples.append(
            {"messages": [
                {"role": "user", "content": user_msg},
                {"role": "assistant", "content": assistant_msg},
            ]}
        )
    return examples, rubric


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rubric-id", default=None)
    ap.add_argument("--min-calls", type=int, default=50)
    ap.add_argument("--output", type=Path, default=Path("training/data/calls.jsonl"))
    args = ap.parse_args()

    examples, rubric = collect_examples(args.rubric_id)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    print(f"Rubric: {rubric['name']} ({len(rubric['parameters'])} parameters)")
    print(f"Wrote {len(examples)} examples to {args.output}")
    if len(examples) < args.min_calls:
        print(
            f"Warning: only {len(examples)} examples — fine-tuning works better with "
            f">= {args.min_calls}. Score more calls (and human-correct them) before training."
        )


if __name__ == "__main__":
    main()
