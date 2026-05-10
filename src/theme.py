"""Central styling for the Call Audit dashboard.

Mirrors the look of the reference mockups:
  - dark-green sidebar, soft grey app background
  - rounded white cards with pastel headers
  - small "+%" delta pills (green up / red down)
  - rounded-corner Plotly bars and donuts
"""
from __future__ import annotations

import streamlit as st

# Palette — keep in sync with apply_css() and CHART_PALETTE below.
GREEN_DARK = "#0f3a2d"
GREEN = "#22c55e"
GREEN_SOFT = "#dcfce7"
PURPLE = "#7c3aed"
PURPLE_SOFT = "#ede9fe"
LAVENDER = "#e9e6ff"
BLUE_SOFT = "#e0eaff"
PINK_SOFT = "#fce7f3"
PEACH_SOFT = "#ffe4e1"
GREY_BG = "#f3f4f6"
TEXT = "#111827"
TEXT_MUTED = "#6b7280"

CHART_PALETTE = [GREEN, PURPLE, "#f472b6", "#60a5fa", "#fb923c", "#facc15", GREEN_DARK]


def apply_css() -> None:
    """Inject the dashboard CSS. Call once per page, near the top."""
    st.markdown(
        f"""
<style>
  /* ---------- App shell ---------- */
  .stApp {{
    background: {GREY_BG};
  }}
  .block-container {{
    padding-top: 1.6rem;
    padding-bottom: 3rem;
    max-width: 1400px;
  }}

  /* ---------- Sidebar (dark green) ---------- */
  [data-testid="stSidebar"] {{
    background: {GREEN_DARK};
  }}
  [data-testid="stSidebar"] * {{
    color: #ffffff !important;
  }}
  [data-testid="stSidebar"] [data-testid="stSidebarNav"] a {{
    border-radius: 12px;
    padding: 6px 10px;
    margin: 2px 6px;
  }}
  [data-testid="stSidebar"] [data-testid="stSidebarNav"] a[aria-current="page"] {{
    background: {GREEN};
  }}

  /* ---------- Headings ---------- */
  h1, h2, h3 {{
    color: {TEXT};
    letter-spacing: -0.01em;
  }}
  h1 {{ font-weight: 700; font-size: 1.6rem; }}
  h2 {{ font-weight: 600; font-size: 1.25rem; }}
  h3 {{ font-weight: 600; font-size: 1.05rem; }}

  /* ---------- KPI cards (custom HTML) ---------- */
  .kpi-row {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 18px;
  }}
  .kpi {{
    border-radius: 18px;
    padding: 18px 20px 22px 20px;
    position: relative;
    min-height: 130px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }}
  .kpi .icon {{
    width: 38px; height: 38px; border-radius: 50%;
    background: rgba(255,255,255,0.7);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }}
  .kpi .arrow {{
    position: absolute; top: 18px; right: 18px;
    width: 30px; height: 30px; border-radius: 50%;
    background: {GREEN}; color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700;
  }}
  .kpi .label {{
    margin-top: 14px; color: {TEXT_MUTED};
    font-size: 0.9rem; font-weight: 500;
  }}
  .kpi .value-row {{
    display: flex; align-items: baseline; justify-content: space-between;
    margin-top: 6px;
  }}
  .kpi .value {{
    font-size: 1.7rem; font-weight: 700; color: {TEXT};
    line-height: 1.1;
  }}
  .kpi .delta {{
    font-size: 0.78rem; font-weight: 600;
    padding: 3px 10px; border-radius: 999px;
  }}
  .kpi .delta.up   {{ background: {GREEN_SOFT}; color: #166534; }}
  .kpi .delta.down {{ background: #fee2e2; color: #991b1b; }}
  .kpi.lavender {{ background: {LAVENDER}; }}
  .kpi.blue     {{ background: {BLUE_SOFT}; }}
  .kpi.pink     {{ background: {PINK_SOFT}; }}
  .kpi.peach    {{ background: {PEACH_SOFT}; }}

  /* ---------- Chart panels ---------- */
  .panel {{
    background: white;
    border-radius: 18px;
    padding: 18px 22px 10px 22px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    margin-bottom: 16px;
  }}
  .panel h3 {{ margin: 0 0 8px 0; }}

  /* Make st.container(border=True) match panel styling */
  [data-testid="stVerticalBlockBorderWrapper"] {{
    border-radius: 18px !important;
    border: none !important;
    background: white;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }}

  /* ---------- Buttons ---------- */
  .stButton > button[kind="primary"] {{
    background: {GREEN};
    border: none;
    border-radius: 999px;
    padding: 0.45rem 1.2rem;
    font-weight: 600;
  }}
  .stButton > button[kind="primary"]:hover {{
    background: {GREEN_DARK};
  }}

  /* ---------- Metric (built-in) tweak ---------- */
  [data-testid="stMetricValue"] {{
    font-size: 1.4rem;
    font-weight: 700;
  }}
</style>
        """,
        unsafe_allow_html=True,
    )


def kpi_card(
    *, label: str, value: str, delta: str | None = None,
    delta_up: bool = True, icon: str = "📞", tone: str = "lavender",
) -> str:
    """Render one KPI card as an HTML string.

    Tones: lavender | blue | pink | peach (match the four mockup colors).
    """
    delta_html = ""
    if delta:
        cls = "up" if delta_up else "down"
        sign = "+" if delta_up and not delta.startswith(("+", "-")) else ""
        delta_html = f'<span class="delta {cls}">{sign}{delta}</span>'
    return (
        f'<div class="kpi {tone}">'
        f'<div class="icon">{icon}</div>'
        f'<div class="arrow">↗</div>'
        f'<div class="label">{label}</div>'
        f'<div class="value-row"><div class="value">{value}</div>{delta_html}</div>'
        f'</div>'
    )


def kpi_row(cards: list[str]) -> None:
    """Render a row of KPI cards (HTML strings from kpi_card)."""
    st.markdown('<div class="kpi-row">' + "".join(cards) + "</div>", unsafe_allow_html=True)
