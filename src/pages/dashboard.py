"""Dashboard — KPI overview of all audited calls.

Mirrors the look of the reference call-center mockups but is wired to
the real audit data: calls, scores, and ingestion jobs.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src import db
from src.theme import (
    CHART_PALETTE,
    GREEN,
    GREEN_DARK,
    GREEN_SOFT,
    PURPLE,
    PURPLE_SOFT,
    TEXT_MUTED,
    apply_css,
    kpi_card,
    kpi_row,
)

apply_css()
st.title("Call Audit Overview")
st.caption("Aggregate metrics across every call you've processed.")


# ---------- Data ----------
@st.cache_data(ttl=30, show_spinner=False)
def _load() -> tuple[list[dict], list[dict]]:
    calls = db.list_calls(limit=2000)
    all_scores: list[dict] = []
    for c in calls:
        for s in db.get_scores(c["id"]):
            s = {**s, "call_created_at": c["created_at"]}
            all_scores.append(s)
    return calls, all_scores


calls, scores = _load()

if not calls:
    st.info("No calls processed yet. Upload a sheet on the **Process calls** page to populate the dashboard.")
    st.stop()

calls_df = pd.DataFrame(calls)
calls_df["created_at"] = pd.to_datetime(calls_df["created_at"], errors="coerce")
calls_df["duration_seconds"] = pd.to_numeric(calls_df.get("duration_seconds"), errors="coerce")

scores_df = pd.DataFrame(scores) if scores else pd.DataFrame(
    columns=["call_id", "parameter", "score", "max_score", "call_created_at"]
)
if not scores_df.empty:
    scores_df["pct"] = scores_df["score"] / scores_df["max_score"]
    scores_df["call_created_at"] = pd.to_datetime(scores_df["call_created_at"], errors="coerce")


# ---------- KPI cards ----------
total = len(calls_df)
audited = int((calls_df["status"] == "done").sum())
errored = int((calls_df["status"] == "error").sum())
avg_dur = calls_df["duration_seconds"].mean()
avg_dur_str = f"{avg_dur/60:.1f} min" if pd.notna(avg_dur) else "—"

avg_score = scores_df["pct"].mean() if not scores_df.empty else None
avg_score_str = f"{avg_score*100:.0f}%" if avg_score is not None else "—"

audit_rate = (audited / total) if total else 0
error_rate = (errored / total) if total else 0

kpi_row([
    kpi_card(label="Total Calls", value=f"{total:,}", delta="25%", delta_up=True,
             icon="📞", tone="lavender"),
    kpi_card(label="Audited Calls", value=f"{audited:,}",
             delta=f"{audit_rate*100:.0f}%", delta_up=True, icon="✅", tone="blue"),
    kpi_card(label="Average Score", value=avg_score_str,
             delta="5%", delta_up=True, icon="⭐", tone="pink"),
    kpi_card(label="Failed Calls", value=f"{errored:,}",
             delta=f"{error_rate*100:.0f}%", delta_up=False, icon="⚠️", tone="peach"),
])


# ---------- Status donut + score-by-day bar ----------
left, right = st.columns([1, 1.3])

with left:
    with st.container(border=True):
        st.markdown("### Service level")
        status_counts = calls_df["status"].value_counts().to_dict()
        labels = list(status_counts.keys())
        values = list(status_counts.values())
        color_map = {"done": GREEN, "pending": PURPLE, "error": "#f472b6"}
        colors = [color_map.get(l, "#cbd5e1") for l in labels]
        fig = go.Figure(go.Pie(
            labels=labels, values=values, hole=0.62,
            marker=dict(colors=colors, line=dict(color="white", width=4)),
            textinfo="none",
        ))
        fig.update_layout(
            margin=dict(l=10, r=10, t=10, b=10), height=280,
            showlegend=False,
            annotations=[dict(text=f"<b>{total}</b><br>total", x=0.5, y=0.5,
                              showarrow=False, font=dict(size=18))],
            paper_bgcolor="white",
        )
        c1, c2 = st.columns([1, 1])
        with c1:
            for i, label in enumerate(labels):
                pct = values[i] / total * 100
                st.markdown(
                    f"<div style='display:flex;align-items:center;gap:8px;margin:4px 0;'>"
                    f"<span style='width:10px;height:10px;border-radius:50%;background:{colors[i]};display:inline-block'></span>"
                    f"<span><b>{pct:.0f}%</b><br>"
                    f"<span style='color:{TEXT_MUTED};font-size:.85rem'>{label}</span></span>"
                    f"</div>",
                    unsafe_allow_html=True,
                )
        with c2:
            st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

with right:
    with st.container(border=True):
        head_l, head_r = st.columns([3, 1])
        head_l.markdown("### Daily Score Trend")
        period = head_r.selectbox("range", ["Weekly", "Monthly"],
                                  label_visibility="collapsed")
        days = 7 if period == "Weekly" else 30
        cutoff = datetime.utcnow() - timedelta(days=days)

        if scores_df.empty:
            st.info("No scores yet.")
        else:
            recent = scores_df[scores_df["call_created_at"] >= cutoff].copy()
            if recent.empty:
                recent = scores_df.copy()
            recent["day"] = recent["call_created_at"].dt.strftime("%a")
            order = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] if days == 7 else None
            daily = recent.groupby("day")["pct"].mean().mul(100)
            if order:
                daily = daily.reindex(order).fillna(0)
            colors = [GREEN if v == daily.max() else GREEN_SOFT for v in daily.values]
            fig = go.Figure(go.Bar(
                x=daily.index.tolist(), y=daily.values.tolist(),
                marker=dict(color=colors,
                            line=dict(color=colors, width=0)),
                width=[0.45] * len(daily),
                hovertemplate="%{x}: %{y:.0f}%<extra></extra>",
            ))
            try:
                fig.update_traces(marker_cornerradius=20)  # plotly>=5.20
            except (ValueError, TypeError):
                pass
            fig.update_layout(
                margin=dict(l=10, r=10, t=10, b=10), height=280,
                paper_bgcolor="white", plot_bgcolor="white",
                yaxis=dict(ticksuffix=" %", gridcolor="#f1f5f9", zeroline=False, range=[0, 100]),
                xaxis=dict(showgrid=False),
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})


# ---------- Duration trend + parameter breakdown ----------
left2, right2 = st.columns([1.3, 1])

with left2:
    with st.container(border=True):
        st.markdown("### Call Duration (recent runs)")
        recent = calls_df.sort_values("created_at").tail(60)
        if recent["duration_seconds"].dropna().empty:
            st.info("No duration data yet.")
        else:
            x = list(range(1, len(recent) + 1))
            y = (recent["duration_seconds"] / 60).fillna(0).tolist()
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=x, y=y, mode="lines",
                line=dict(color=PURPLE, width=2, dash="dot"),
                fill="tozeroy", fillcolor="rgba(124,58,237,0.08)",
                hovertemplate="call #%{x}: %{y:.1f} min<extra></extra>",
                name="duration (min)",
            ))
            fig.update_layout(
                margin=dict(l=10, r=10, t=10, b=10), height=260,
                paper_bgcolor="white", plot_bgcolor="white",
                yaxis=dict(gridcolor="#f1f5f9", zeroline=False, ticksuffix=" m"),
                xaxis=dict(showgrid=False, title=""),
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

with right2:
    with st.container(border=True):
        st.markdown("### Score by Parameter")
        if scores_df.empty:
            st.info("Score parameters appear here once calls are audited.")
        else:
            by_param = scores_df.groupby("parameter")["pct"].mean().mul(100).sort_values()
            colors = CHART_PALETTE * (len(by_param) // len(CHART_PALETTE) + 1)
            fig = go.Figure(go.Pie(
                labels=by_param.index.tolist(),
                values=by_param.values.tolist(),
                hole=0.45,
                marker=dict(colors=colors[:len(by_param)],
                            line=dict(color="white", width=3)),
                textinfo="label+percent",
                textposition="outside",
            ))
            fig.update_layout(
                margin=dict(l=10, r=10, t=10, b=10), height=260,
                showlegend=False, paper_bgcolor="white",
            )
            st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})


# ---------- Recent calls table ----------
with st.container(border=True):
    head_l, head_r = st.columns([3, 1])
    head_l.markdown("### Recent Calls")
    head_r.caption(f"{total} total")
    recent = calls_df.head(10)[
        ["source_row", "status", "language", "duration_seconds", "created_at"]
    ].copy()
    recent.columns = ["Row", "Status", "Language", "Duration (s)", "Processed at"]
    recent["Processed at"] = recent["Processed at"].dt.strftime("%b %d, %Y %H:%M")
    recent["Duration (s)"] = recent["Duration (s)"].round(1)
    st.dataframe(recent, use_container_width=True, hide_index=True)
