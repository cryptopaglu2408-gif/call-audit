"""Upload sheet, pick row range, run the pipeline."""
from __future__ import annotations

import io

import pandas as pd
import streamlit as st

from src import db, ingest, pipeline
from src.theme import apply_css

apply_css()
st.title("Process calls")
st.caption("Upload a sheet of Google Drive audio links. Pick which column has the links and which rows to process.")

active_rubric = db.get_active_rubric()
if not active_rubric:
    st.error("No active rubric. Go to the **Rubric** page and save one before processing.")
    st.stop()

st.success(f"Scoring against rubric: **{active_rubric['name']}** ({len(active_rubric['parameters'])} parameters)")

uploaded = st.file_uploader("Sheet (.xlsx or .csv)", type=["xlsx", "csv"])
if not uploaded:
    st.stop()

bytes_buf = io.BytesIO(uploaded.getvalue())
df = ingest.read_sheet(bytes_buf if uploaded.name.endswith(".xlsx") else uploaded)

st.write(f"Loaded **{len(df)}** rows · {len(df.columns)} columns")
with st.expander("Preview first 5 rows"):
    st.dataframe(df.head(), use_container_width=True)

col1, col2, col3 = st.columns([2, 1, 1])
link_col = col1.selectbox("Audio-link column", options=list(df.columns))
last_data_row = len(df) + 1  # +1 because row 1 is header
row_start = col2.number_input("From row", min_value=2, max_value=last_data_row, value=2, step=1)
row_end = col3.number_input("To row", min_value=2, max_value=last_data_row, value=min(last_data_row, 11), step=1)

if row_end < row_start:
    st.error("`To row` must be ≥ `From row`.")
    st.stop()

try:
    rows = ingest.select_rows(df, link_col, int(row_start), int(row_end))
except ValueError as e:
    st.error(str(e))
    st.stop()

st.caption(f"Selected **{len(rows)}** rows with non-empty links. (Rows with empty/non-link cells are skipped.)")

with st.expander("Preview selection (first 3)"):
    if rows:
        st.dataframe(
            pd.DataFrame(
                [{"sheet_row": r.sheet_row, "link": r.link[:80] + "..." if len(r.link) > 80 else r.link} for r in rows[:3]]
            ),
            use_container_width=True,
        )
    else:
        st.write("Nothing to preview.")

if st.button("Process selected range", type="primary", disabled=not rows):
    progress = st.progress(0.0, text="Starting…")
    log_area = st.container()

    for update in pipeline.run_pipeline(
        sheet_name=uploaded.name,
        link_column=link_col,
        row_start=int(row_start),
        row_end=int(row_end),
        rows=rows,
        rubric=active_rubric,
    ):
        ratio = update.index / max(update.total, 1)
        if update.stage == "done":
            progress.progress(ratio, text=f"[{update.index}/{update.total}] row {update.sheet_row} ✓")
            log_area.success(f"Row {update.sheet_row}: done")
        elif update.stage == "error":
            progress.progress(ratio, text=f"[{update.index}/{update.total}] row {update.sheet_row} ✗")
            log_area.error(f"Row {update.sheet_row}: {update.message}")
        else:
            progress.progress(
                ratio - (1 / max(update.total, 1)),
                text=f"[{update.index}/{update.total}] row {update.sheet_row}: {update.message}",
            )

    progress.progress(1.0, text="Done.")
    st.success("Pipeline finished. Open the **Results** page to inspect scores.")
