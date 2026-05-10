"""Rubric editor — define which call-quality parameters get scored."""
from __future__ import annotations

import streamlit as st

from src import db
from src.theme import apply_css

apply_css()
st.title("Rubric")
st.caption("Define the parameters used to score every call. Only one rubric is active at a time.")

active = db.get_active_rubric()

if "rubric_draft" not in st.session_state:
    if active:
        st.session_state.rubric_draft = {
            "name": active["name"],
            "parameters": list(active["parameters"]),
        }
    else:
        st.session_state.rubric_draft = {
            "name": "",
            "parameters": [
                {"name": "Empathy", "description": "Did the agent acknowledge the customer's emotional state?", "max_score": 5},
                {"name": "Compliance", "description": "Did the agent follow required disclosures and procedures?", "max_score": 5},
                {"name": "Resolution", "description": "Was the customer's issue resolved or properly escalated?", "max_score": 5},
            ],
        }

draft = st.session_state.rubric_draft

draft["name"] = st.text_input("Rubric name", value=draft["name"], placeholder="e.g. Q2-2026 Support Rubric")

st.subheader("Parameters")
st.caption("Each parameter is scored 1-`max_score` with reasoning. Use plain English in the description; the model will follow it literally.")

edited = st.data_editor(
    draft["parameters"],
    num_rows="dynamic",
    use_container_width=True,
    column_config={
        "name": st.column_config.TextColumn("Parameter", required=True, width="medium"),
        "description": st.column_config.TextColumn("Description", required=True, width="large"),
        "max_score": st.column_config.NumberColumn("Max score", min_value=2, max_value=10, step=1, default=5, required=True),
    },
    key="rubric_editor",
)
draft["parameters"] = [p for p in edited if p.get("name") and p.get("description")]

col_save, col_status = st.columns([1, 3])
with col_save:
    if st.button("Save & set active", type="primary"):
        if not draft["name"].strip():
            st.error("Give the rubric a name.")
        elif not draft["parameters"]:
            st.error("Add at least one parameter.")
        else:
            db.save_rubric(draft["name"].strip(), draft["parameters"], make_active=True)
            st.success("Saved and set as active rubric.")
            st.rerun()

with col_status:
    if active:
        st.info(f"Currently active: **{active['name']}**  ·  {len(active['parameters'])} parameters")
    else:
        st.warning("No active rubric. Save one before processing calls.")

st.divider()
st.subheader("Past rubrics")
all_rubrics = db.list_rubrics()
if not all_rubrics:
    st.caption("No rubrics yet.")
else:
    for r in all_rubrics:
        cols = st.columns([3, 2, 2, 1])
        cols[0].write(f"**{r['name']}**  ·  {len(r['parameters'])} params")
        cols[1].caption(", ".join(p["name"] for p in r["parameters"][:4]) + ("..." if len(r["parameters"]) > 4 else ""))
        cols[2].caption(r["created_at"][:19].replace("T", " "))
        if r["is_active"]:
            cols[3].success("active")
        else:
            if cols[3].button("Activate", key=f"act-{r['id']}"):
                db.set_active_rubric(r["id"])
                st.rerun()
