import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer,
  Area, AreaChart, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  Phone, CheckCircle2, Star, AlertTriangle, ArrowUpRight,
} from "lucide-react";
import KpiCard from "../components/KpiCard";
import Panel from "../components/Panel";
import { supabase } from "../lib/supabase";
import type { Call, Score } from "../lib/types";

const STATUS_COLOR: Record<string, string> = {
  done: "#10b981", // Emerald
  pending: "#6366f1", // Indigo
  error: "#f43f5e", // Rose
  failed: "#ef4444", // Red
  downloaded: "#3b82f6", // Blue
  transcribed: "#f59e0b", // Amber
};
const PARAM_PALETTE = ["#10b981", "#6366f1", "#f43f5e", "#3b82f6", "#f59e0b", "#8b5cf6", "#0f3a2d"];
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

  if (err) return <div className="panel text-rose-700 font-medium">Failed to load: {err}</div>;
  if (loading) return (
    <div className="panel flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-brand-green rounded-full animate-spin" />
        <span className="text-sm text-slate-500 font-medium">Loading dashboard data…</span>
      </div>
    </div>
  );

  if (calls.length === 0) {
    return (
      <div className="panel py-12 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Phone className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">No calls yet</h2>
        <p className="text-slate-500 mb-6 max-w-sm mx-auto">
          Upload a spreadsheet with audio links to start auditing calls.
        </p>
        <a href="/process" className="btn-primary">
          Process calls <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
    );
  }

  const audited = stats.audited;
  const total = stats.total;
  const auditRate = total ? Math.round((audited / total) * 100) : 0;
  const errorRate = total ? Math.round((stats.errored / total) * 100) : 0;

  const maxDay = Math.max(...dailyScore.map(d => d.score), 1);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Panel title="Service Level" className="lg:col-span-2">
          <div className="flex items-center gap-6 py-2">
            <div className="flex-1 space-y-4">
              {statusData.map(s => {
                const pct = total ? Math.round((s.value / total) * 100) : 0;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shadow-sm"
                          style={{ background: STATUS_COLOR[s.name] ?? "#cbd5e1" }} />
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-slate-700 capitalize">{s.name}</span>
                        <span className="text-sm font-bold text-slate-900">{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                             style={{ width: `${pct}%`, background: STATUS_COLOR[s.name] ?? "#cbd5e1" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="w-40 h-40 relative flex-shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" innerRadius={50} outerRadius={70}
                       paddingAngle={4} stroke="transparent">
                    {statusData.map((s) => (
                      <Cell key={s.name} fill={STATUS_COLOR[s.name] ?? "#cbd5e1"} className="outline-none focus:outline-none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total</div>
                <div className="text-2xl font-bold text-slate-900">{total}</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Daily Score Trend"
          className="lg:col-span-3"
          right={<span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">Weekly</span>}
        >
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={dailyScore} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }} />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]}
                       axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }} />
                <Tooltip cursor={{ fill: "rgba(241, 245, 249, 0.6)" }}
                         contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)" }}
                         formatter={(v: number) => [`${v}%`, "Score"]} />
                <Bar dataKey="score" radius={[6, 6, 0, 0]} barSize={32}>
                  {dailyScore.map((d) => (
                    <Cell key={d.day} fill={d.score === maxDay && d.score > 0 ? "#10b981" : "#a7f3d0"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Duration trend + parameter breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Panel title="Call Duration (Recent Runs)" className="lg:col-span-3">
          <div className="h-60">
            <ResponsiveContainer>
              <AreaChart data={durationTrend} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="dur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="x" axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }} />
                <YAxis axisLine={false} tickLine={false}
                       tick={{ fontSize: 12, fill: "#94a3b8", fontWeight: 500 }}
                       tickFormatter={(v) => `${v}m`} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)" }}
                         formatter={(v: number) => [`${v} min`, "Duration"]} />
                <Area type="monotone" dataKey="minutes" stroke="#6366f1" strokeWidth={3}
                      fill="url(#dur)" dot={{ r: 4, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }}
                      activeDot={{ r: 6, fill: "#6366f1", strokeWidth: 2, stroke: "#fff" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Score by Parameter" className="lg:col-span-2">
          {paramBreakdown.length === 0 ? (
            <div className="flex items-center justify-center h-60 text-sm text-slate-400 font-medium">
              Score parameters appear here once calls are audited.
            </div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={paramBreakdown} dataKey="value" nameKey="name"
                       innerRadius={40} outerRadius={70} paddingAngle={3}
                       stroke="transparent" label={(d) => `${d.name}`}>
                    {paramBreakdown.map((p, i) => (
                      <Cell key={p.name} fill={PARAM_PALETTE[i % PARAM_PALETTE.length]} className="outline-none focus:outline-none" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)" }}
                           formatter={(v: number) => [`${v}%`, "Score"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* Recent calls */}
      <Panel title="Recent Calls" right={<span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{total} total</span>}>
        <div className="grid grid-cols-[80px_120px_1fr_120px_180px] gap-4 text-xs uppercase tracking-wider font-semibold text-slate-500 px-2 mb-2">
          <div>Row</div><div>Status</div><div>Language</div><div>Duration</div><div>Processed</div>
        </div>
        <div className="space-y-1">
          {calls.slice(0, 8).map(c => (
            <div key={c.id}
                 className="table-row grid-cols-[80px_120px_1fr_120px_180px] px-2 rounded-xl border-0 hover:bg-slate-50/80 transition-colors duration-150">
              <div className="font-medium text-slate-700">#{c.source_row ?? "—"}</div>
              <div>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold capitalize inline-flex items-center"
                      style={{ background: (STATUS_COLOR[c.status] ?? "#e2e8f0") + "20",
                               color: STATUS_COLOR[c.status] ?? "#475569" }}>
                  <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: STATUS_COLOR[c.status] ?? "#475569" }} />
                  {c.status}
                </span>
              </div>
              <div className="text-slate-600 font-medium">{c.language ?? "—"}</div>
              <div className="text-slate-600 font-medium">{c.duration_seconds ? `${c.duration_seconds.toFixed(1)} s` : "—"}</div>
              <div className="text-slate-500 text-xs font-medium">{new Date(c.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
