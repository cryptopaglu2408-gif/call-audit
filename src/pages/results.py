"""Results dashboard — table of scored calls + semantic search."""
from __future__ import annotations

import pandas as pd
import streamlit as st

from src import db, embed
from src.theme import apply_css

apply_css()
st.title("Results")
st.caption("All scored calls. Click a row to see the transcript and per-parameter reasoning.")

tab_table, tab_search = st.tabs(["Calls", "Semantic search"])

# ---------- Table ----------
with tab_table:
    calls = db.list_calls(limit=500)
    if not calls:
        st.info("No calls processed yet. Upload a sheet on the **Process calls** page.")
    else:
        # Aggregate scores per call.
        rows = []
        for c in calls:
            scores = db.get_scores(c["id"])
            agg = ""
            if scores:
                normalized = sum((s["score"] / s["max_score"]) for s in scores) / len(scores)
                agg = f"{round(normalized * 100)}%"
            rows.append(
                {
                    "id": c["id"],
                    "row": c.get("source_row"),
                    "status": c["status"],
                    "language": c.get("language") or "—",
                    "duration_s": round(c.get("duration_seconds") or 0, 1),
                    "score": agg,
                    "created_at": c["created_at"][:19].replace("T", " "),
                }
            )
        df = pd.DataFrame(rows)
        st.dataframe(df, use_container_width=True, hide_index=True)

        st.subheader("Inspect a call")
        call_options = {f"row {r['row']} · {r['status']} · {r['score']}": r["id"] for r in rows}
        choice = st.selectbox("Pick a call", options=list(call_options.keys()))
        if choice:
            call_id = call_options[choice]
            call = db.get_call(call_id)
            scores = db.get_scores(call_id)

            mleft, mright = st.columns([2, 1])
            with mleft:
                st.markdown("**Transcript**")
                st.write(call.get("transcript") or "_(no transcript)_")
                if call.get("error"):
                    st.error(call["error"])
            with mright:
                st.markdown("**Scores**")
                if not scores:
                    st.caption("No scores recorded.")
                for s in scores:
                    st.metric(label=s["parameter"], value=f"{s['score']} / {s['max_score']}")
                    st.caption(s.get("reasoning") or "")
                if call.get("metadata"):
                    with st.expander("Sheet metadata"):
                        st.json(call["metadata"])

# ---------- Semantic search ----------
with tab_search:
    st.caption("Find calls by what was said, not just keywords. Powered by pgvector.")
    query = st.text_input("Search transcripts", placeholder="e.g. customer was frustrated about a refund")
    k = st.slider("How many matches", min_value=3, max_value=25, value=10)
    if query:
        with st.spinner("Searching…"):
            vec = embed.embed(query)
            matches = db.semantic_search(vec, k=k)
        if not matches:
            st.info("No matches yet — process some calls first.")
        else:
            for m in matches:
                with st.container(border=True):
                    st.caption(f"similarity: {round(m['similarity'], 3)}")
                    st.write((m.get("transcript") or "")[:600] + ("…" if len(m.get("transcript") or "") > 600 else ""))
