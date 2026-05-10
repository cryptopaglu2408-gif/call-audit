"""Seed the Supabase `rubrics` table with the rubric used by the
'Demo Quality Check Form' xlsx.

10 parameters, three flavors:
  - numeric 1-10 (e.g. Call Opening)
  - yes/no encoded as max_score=2 (No=1, Yes=2)
  - 3-way (Was Demo Scheduled?): No=1, Callback=2, Yes=3, max_score=3

Run once:
  python -m training.seed_demo_rubric
"""
from __future__ import annotations

from src import db

RUBRIC_NAME = "Demo Quality Check"

PARAMETERS = [
    {
        "name": "Call Opening",
        "description": (
            "How well did the agent open the call? Score 1-10 considering: warm greeting, "
            "self-introduction (name + company), confirming the customer, building rapport, "
            "and stating purpose. 9-10 = textbook opening; 5-6 = adequate but flat; 1-2 = "
            "missing greeting or introduction."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Reason of Call",
        "description": (
            "How clearly did the agent state and confirm the reason for the call? Score "
            "1-10. 9-10 = explicit, customer-acknowledged reason in first 30 seconds; "
            "5-6 = stated but unclear; 1-2 = never explained why they're calling."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Customer Need Assessment",
        "description": (
            "How effectively did the agent ask probing questions to understand the "
            "customer's situation, goals, and pain points? Score 1-10. 9-10 = multiple "
            "open-ended discovery questions, active listening; 5-6 = surface-level "
            "questions only; 1-2 = jumped to pitching without discovery."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Problem Identified ?",
        "description": (
            "Did the agent successfully identify a concrete problem or pain point the "
            "customer is trying to solve? Yes (=2) if a specific problem was named and "
            "acknowledged by the customer; No (=1) if the call ended without identifying one."
        ),
        "max_score": 2,
        "kind": "yes_no",
    },
    {
        "name": "USP Discussion ?",
        "description": (
            "Quality of unique selling proposition discussion — how well did the agent "
            "articulate the product's differentiating features and benefits relative to "
            "the customer's identified need? Score 1-10. 9-10 = tailored, benefits-led "
            "USP tied directly to customer's problem; 5-6 = generic feature list; 1-2 = "
            "no USP discussed."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Intent Check Done ?",
        "description": (
            "Did the agent explicitly verify the customer's intent or readiness to "
            "proceed (e.g. 'Are you looking to enroll soon?', 'Is this for yourself or "
            "a child?')? Yes (=2) if an intent-qualifying question was asked and "
            "answered; No (=1) otherwise."
        ),
        "max_score": 2,
        "kind": "yes_no",
    },
    {
        "name": "Demo Session Pitch",
        "description": (
            "Quality of the pitch for booking a free demo session — clarity of value, "
            "what the customer will get, time commitment, and call-to-action. Score "
            "1-10. 9-10 = compelling, specific, customer agrees; 5-6 = mentioned but "
            "not sold; 1-2 = no demo pitched."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Price Discussed ?",
        "description": (
            "Was course/program pricing discussed during the call? Yes (=2) if any "
            "price point or fee structure was mentioned; No (=1) if pricing was deferred "
            "or never raised."
        ),
        "max_score": 2,
        "kind": "yes_no",
    },
    {
        "name": "Closing ?",
        "description": (
            "Quality of the call closing — clear next steps, summary of what was "
            "agreed, confirmation of follow-up, polite sign-off. Score 1-10. 9-10 = "
            "next steps explicit, time/date confirmed, professional close; 5-6 = "
            "vague follow-up; 1-2 = abrupt or no close."
        ),
        "max_score": 10,
        "kind": "numeric",
    },
    {
        "name": "Was Demo Scheduled ?",
        "description": (
            "Outcome: was a demo session actually scheduled with a specific date/time? "
            "No (=1) — customer declined or no demo offered. Callback (=2) — customer "
            "asked to be called back to confirm date/time. Yes (=3) — concrete date "
            "and time agreed with the customer."
        ),
        "max_score": 3,
        "kind": "categorical_3",
    },
]


def main() -> None:
    existing = db.client().table("rubrics").select("id, name").eq("name", RUBRIC_NAME).execute()
    rows = existing.data or []
    if rows:
        print(f"Rubric '{RUBRIC_NAME}' already exists (id={rows[0]['id']}).")
        ans = input("Overwrite parameters and re-activate? [y/N] ").strip().lower()
        if ans != "y":
            print("Skipped.")
            return
        db.client().table("rubrics").update({"is_active": False}).eq("is_active", True).execute()
        db.client().table("rubrics").update(
            {"parameters": PARAMETERS, "is_active": True}
        ).eq("id", rows[0]["id"]).execute()
        print(f"Updated rubric {rows[0]['id']} with {len(PARAMETERS)} parameters.")
        return

    saved = db.save_rubric(RUBRIC_NAME, PARAMETERS, make_active=True)
    print(f"Created rubric '{RUBRIC_NAME}' (id={saved['id']}) with {len(PARAMETERS)} parameters.")
    print(f"Numeric (1-10): {sum(1 for p in PARAMETERS if p['kind']=='numeric')}")
    print(f"Yes/No (1-2):   {sum(1 for p in PARAMETERS if p['kind']=='yes_no')}")
    print(f"3-way (1-3):    {sum(1 for p in PARAMETERS if p['kind']=='categorical_3')}")


if __name__ == "__main__":
    main()
