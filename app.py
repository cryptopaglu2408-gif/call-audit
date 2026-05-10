"""Call Audit — Streamlit entry point."""
from __future__ import annotations

import streamlit as st

st.set_page_config(page_title="Call Audit", page_icon="📞", layout="wide")

pages = [
    st.Page("src/pages/dashboard.py", title="Dashboard", icon="🏠", default=True),
    st.Page("src/pages/upload.py", title="Process calls", icon="🎧"),
    st.Page("src/pages/rubric.py", title="Rubric", icon="📋"),
    st.Page("src/pages/results.py", title="Results", icon="📊"),
]

nav = st.navigation(pages)
nav.run()
