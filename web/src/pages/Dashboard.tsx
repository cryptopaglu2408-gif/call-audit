import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer,
  Area, AreaChart, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Phone, CheckCircle2, Star, AlertTriangle,
} from "lucide-react";
import KpiCard from "../components/KpiCard";
import Panel from "../components/Panel";
import { supabase } from "../lib/supabase";
import type { Call, Score } from "../lib/types";

const STATUS_COLOR: Record<string, string> = {
  done: "#22c55e",
  pending: "#7c3aed",
  error: "#f472b6",
  failed: "#ef4444",
  downloaded: "#60a5fa",
  transcribed: "#facc15",
};
const PARAM_PALETTE = ["#22c55e", "#7c3aed", "#f472b6", "#60a5fa", "#fb923c", "#facc15", "#0f3a2d"];
const DAY_ORDER = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

export default function Dashboard() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from("calls").select("*").order("created_at", { ascending: false }).limit(2000),
        supabase.from("scores").select("id,call_id,rubric_id,parameter,score,max_score,reasoning"),
      ]);
      if (!live) return;
      if (c.error) setErr(c.error.message);
      else setCalls((c.data ?? []) as Call[]);
      if (!s.error) setScores((s.data ?? []) as Score[]);
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => {
    const total = calls.length;
    const audited = calls.filter(c => c.status === "done").length;
    const errored = calls.filter(c => c.status === "error" || c.status === "failed").length;
    const durSecs = calls
      .map(c => c.duration_seconds)
      .filter((x): x is number => typeof x === "number");
    const avgDur = durSecs.length ? durSecs.reduce((a, b) => a + b, 0) / durSecs.length : null;
    const pcts = scores.map(s => s.max_score ? s.score / s.max_score : 0);
    const avgScore = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return { total, audited, errored, avgDur, avgScore };
  }, [calls, scores]);

  const statusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    return Array.from(counts, ([name, value]) => ({ name, value }));
  }, [calls]);

  const dailyScore = useMemo(() => {
    const callDay = new Map<string, string>();
    for (const c of calls) {
      const d = new Date(c.created_at);
      const day = d.toLocaleDateString("en-US", { weekday: "short" });
      callDay.set(c.id, day);
    }
    const acc = new Map<string, { sum: number; n: number }>();
    for (const s of scores) {
      const day = callDay.get(s.call_id);
      if (!day || !s.max_score) continue;
      const cur = acc.get(day) ?? { sum: 0, n: 0 };
      cur.sum += (s.score / s.max_score) * 100;
      cur.n += 1;
      acc.set(day, cur);
    }
    return DAY_ORDER.map(d => ({
      day: d,
      score: Math.round((acc.get(d)?.sum ?? 0) / Math.max(acc.get(d)?.n ?? 0, 1)),
    }));
  }, [calls, scores]);

  const durationTrend = useMemo(() => {
    const sorted = [...calls]
      .filter(c => typeof c.duration_seconds === "number")
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
      .slice(-60);
    return sorted.map((c, i) => ({ x: i + 1, minutes: +(((c.duration_seconds ?? 0) / 60).toFixed(2)) }));
  }, [calls]);

  const paramBreakdown = useMemo(() => {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const s of scores) {
      if (!s.max_score) continue;
      const cur = acc.get(s.parameter) ?? { sum: 0, n: 0 };
      cur.sum += (s.score / s.max_score) * 100;
      cur.n += 1;
      acc.set(s.parameter, cur);
    }
    return Array.from(acc, ([name, v]) => ({
      name, value: Math.round(v.sum / Math.max(v.n, 1)),
    }));
  }, [scores]);

  if (err) return <div className="panel text-rose-700">Failed to load: {err}</div>;
  if (loading) return <div className="panel">Loading…</div>;
  if (calls.length === 0) {
    return (
      <div className="panel">
        <h2 className="text-lg font-semibold mb-2">No calls yet</h2>
        <p className="text-slate-600">
          Head to <a href="/process" className="text-brand-green font-medium">Process calls</a> to upload a sheet.
        </p>
      </div>
    );
  }

  const audited = stats.audited;
  const total = stats.total;
  const auditRate = total ? Math.round((audited / total) * 100) : 0;
  const errorRate = total ? Math.round((stats.errored / total) * 100) : 0;

  const maxDay = Math.max(...dailyScore.map(d => d.score), 1);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Calls" value={total.toLocaleString()}
                 delta="25%" deltaUp icon={Phone} tone="lavender" />
        <KpiCard label="Audited Calls" value={audited.toLocaleString()}
                 delta={`${auditRate}%`} deltaUp icon={CheckCircle2} tone="blue" />
        <KpiCard label="Average Score"
                 value={stats.avgScore != null ? `${Math.round(stats.avgScore * 100)}%` : "—"}
                 delta="5%" deltaUp icon={Star} tone="pink" />
        <KpiCard label="Failed Calls" value={stats.errored.toLocaleString()}
                 delta={`${errorRate}%`} deltaUp={false} icon={AlertTriangle} tone="peach" />
      </div>

      {/* Service level + Daily score */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel title="Service level" className="lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-3">
              {statusData.map(s => {
                const pct = total ? Math.round((s.value / total) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full"
                          style={{ background: STATUS_COLOR[s.name] ?? "#cbd5e1" }} />
                    <div>
                      <div className="font-bold text-slate-900">{pct}%</div>
                      <div className="text-xs text-slate-500 capitalize">{s.name}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="w-44 h-44 relative">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={56} outerRadius={80}
                       paddingAngle={3} stroke="white" strokeWidth={3}>
                    {statusData.map((s) => (
                      <Cell key={s.name} fill={STATUS_COLOR[s.name] ?? "#cbd5e1"} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-xs text-slate-500">Total calls</div>
                <div className="text-xl font-bold">{total}</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Daily Score Trend"
          className="lg:col-span-3"
          right={<span className="text-xs text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1">Weekly</span>}
        >
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={dailyScore} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]}
                       axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip cursor={{ fill: "transparent" }}
                         contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}
                         formatter={(v: number) => [`${v}%`, "score"]} />
                <Bar dataKey="score" radius={[20, 20, 20, 20]} barSize={24}>
                  {dailyScore.map((d) => (
                    <Cell key={d.day} fill={d.score === maxDay && d.score > 0 ? "#22c55e" : "#dcfce7"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Duration trend + parameter breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel title="Call Duration (recent runs)" className="lg:col-span-3">
          <div className="h-60">
            <ResponsiveContainer>
              <AreaChart data={durationTrend} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="dur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="x" axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#64748b" }}
                       tickFormatter={(v) => `${v}m`} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none" }}
                         formatter={(v: number) => [`${v} min`, "duration"]} />
                <Area type="monotone" dataKey="minutes" stroke="#7c3aed" strokeWidth={2}
                      strokeDasharray="6 6" fill="url(#dur)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Score by Parameter" className="lg:col-span-2">
          {paramBreakdown.length === 0 ? (
            <div className="text-sm text-slate-500">Score parameters appear here once calls are audited.</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={paramBreakdown} dataKey="value" nameKey="name"
                       innerRadius={50} outerRadius={90} paddingAngle={2}
                       stroke="white" strokeWidth={3} label={(d) => `${d.name}`}>
                    {paramBreakdown.map((p, i) => (
                      <Cell key={p.name} fill={PARAM_PALETTE[i % PARAM_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}%`, "score"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Recent calls */}
      <Panel title="Recent Calls" right={<span className="text-xs text-slate-500">{total} total</span>}>
        <div className="grid grid-cols-[80px_120px_1fr_120px_180px] gap-2 text-xs uppercase tracking-wide text-slate-500 px-1">
          <div>Row</div><div>Status</div><div>Language</div><div>Duration</div><div>Processed</div>
        </div>
        {calls.slice(0, 8).map(c => (
          <div key={c.id}
               className="table-row grid-cols-[80px_120px_1fr_120px_180px]">
            <div>{c.source_row ?? "—"}</div>
            <div>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                    style={{ background: (STATUS_COLOR[c.status] ?? "#e2e8f0") + "33",
                             color: STATUS_COLOR[c.status] ?? "#475569" }}>
                {c.status}
              </span>
            </div>
            <div className="text-slate-600">{c.language ?? "—"}</div>
            <div>{c.duration_seconds ? `${c.duration_seconds.toFixed(1)} s` : "—"}</div>
            <div className="text-slate-500">{new Date(c.created_at).toLocaleString()}</div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
