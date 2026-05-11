import { useEffect, useMemo, useState } from "react";
import { Search, FileText, BarChart2, Calendar, Clock, AlertCircle } from "lucide-react";
import Panel from "../components/Panel";
import { supabase } from "../lib/supabase";
import { semanticSearch } from "../lib/api";
import type { Call, Score } from "../lib/types";

const STATUS_COLOR: Record<string, string> = {
  done: "#10b981",
  pending: "#6366f1",
  error: "#f43f5e",
  failed: "#ef4444",
  downloaded: "#3b82f6",
  transcribed: "#f59e0b",
};

export default function Results() {
  const [tab, setTab] = useState<"calls" | "search">("calls");
  const [calls, setCalls] = useState<Call[]>([]);
  const [scoresByCall, setScoresByCall] = useState<Record<string, Score[]>>({});
  const [selected, setSelected] = useState<string | null>(null);

  // Search
  const [q, setQ] = useState("");
  const [k, setK] = useState(10);
  const [matches, setMatches] = useState<{ call_id: string; transcript: string; similarity: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c = await supabase.from("calls").select("*").order("created_at", { ascending: false }).limit(500);
      const list = (c.data ?? []) as Call[];
      setCalls(list);
      if (list.length) {
        setSelected(list[0].id);
        const ids = list.map(x => x.id);
        const s = await supabase.from("scores").select("*").in("call_id", ids);
        const map: Record<string, Score[]> = {};
        for (const row of (s.data ?? []) as Score[]) {
          (map[row.call_id] ??= []).push(row);
        }
        setScoresByCall(map);
      }
    })();
  }, []);

  const rows = useMemo(() => calls.map(c => {
    const ss = scoresByCall[c.id] ?? [];
    const pct = ss.length
      ? Math.round((ss.reduce((a, s) => a + s.score / s.max_score, 0) / ss.length) * 100)
      : null;
    return { call: c, pct };
  }), [calls, scoresByCall]);

  const current = useMemo(() => calls.find(c => c.id === selected) ?? null, [calls, selected]);
  const currentScores = current ? scoresByCall[current.id] ?? [] : [];

  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true); setSearchErr(null);
    try {
      const r = await semanticSearch(q, k);
      setMatches(r.matches);
    } catch (e) {
      setSearchErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/60 rounded-2xl p-2 flex gap-1 w-fit shadow-sm">
        {(["calls", "search"] as const).map(t => (
          <button key={t}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300 ${
              tab === t 
                ? "bg-gradient-to-r from-brand-green to-emerald-600 text-white shadow-md shadow-emerald-200/50" 
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}
            onClick={() => setTab(t)}>
            {t === "calls" ? "All Calls" : "Semantic Search"}
          </button>
        ))}
      </div>

      {tab === "calls" && (
        <>
          <Panel title="All Scored Calls" right={<span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{rows.length} total</span>}>
            <div className="grid grid-cols-[80px_120px_1fr_100px_100px_180px] gap-4 text-xs uppercase tracking-wider font-semibold text-slate-500 px-2 mb-2">
              <div>Row</div><div>Status</div><div>Language</div><div>Duration</div><div>Score</div><div>Created</div>
            </div>
            <div className="max-h-[420px] overflow-auto space-y-1">
              {rows.map(({ call, pct }) => (
                <button key={call.id}
                  onClick={() => setSelected(call.id)}
                  className={`w-full text-left table-row grid-cols-[80px_120px_1fr_100px_100px_180px] px-2 rounded-xl border-0 transition-colors duration-150 ${
                    selected === call.id ? "bg-emerald-50/50 border border-emerald-100" : "hover:bg-slate-50/80"
                  }`}>
                  <div className="font-medium text-slate-700">#{call.source_row ?? "—"}</div>
                  <div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold capitalize inline-flex items-center"
                          style={{ background: (STATUS_COLOR[call.status] ?? "#e2e8f0") + "20",
                                   color: STATUS_COLOR[call.status] ?? "#475569" }}>
                      <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: STATUS_COLOR[call.status] ?? "#475569" }} />
                      {call.status}
                    </span>
                  </div>
                  <div className="text-slate-600 font-medium">{call.language ?? "—"}</div>
                  <div className="text-slate-600 font-medium">{call.duration_seconds ? `${call.duration_seconds.toFixed(1)} s` : "—"}</div>
                  <div>
                    {pct !== null ? (
                      <span className={`font-bold ${pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                        {pct}%
                      </span>
                    ) : "—"}
                  </div>
                  <div className="text-slate-500 text-xs font-medium">{new Date(call.created_at).toLocaleString()}</div>
                </button>
              ))}
            </div>
          </Panel>

          {current && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Panel title="Transcript" className="lg:col-span-2">
                {current.error && (
                  <div className="bg-rose-50 text-rose-800 rounded-xl p-4 text-sm font-medium mb-4 flex items-center gap-2 border border-rose-200">
                    <AlertCircle className="w-4 h-4" />
                    <span>{current.error}</span>
                  </div>
                )}
                <div className="bg-slate-50/50 p-6 rounded-xl border border-slate-100 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap max-h-[500px] overflow-auto">
                  {current.transcript || <span className="text-slate-400 italic">No transcript available for this call.</span>}
                </div>
              </Panel>
              
              <Panel title="Analysis & Scores">
                <div className="space-y-4">
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">{new Date(current.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="font-medium">{current.duration_seconds ? `${current.duration_seconds.toFixed(1)} seconds` : "—"}</span>
                    </div>
                  </div>

                  {currentScores.length === 0 ? (
                    <div className="text-center py-6">
                      <BarChart2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <div className="text-sm text-slate-400 font-medium">No scores recorded yet.</div>
                    </div>
                  ) : (
                    currentScores.map(s => {
                      const scorePct = (s.score / s.max_score) * 100;
                      return (
                        <div key={s.id} className="border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition-colors bg-white shadow-sm">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="font-semibold text-slate-800">{s.parameter}</span>
                            <span className="font-bold text-slate-900">{s.score} / {s.max_score}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${scorePct >= 80 ? "bg-emerald-500" : scorePct >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                                 style={{ width: `${scorePct}%` }} />
                          </div>
                          {s.reasoning && <p className="text-xs text-slate-500 leading-relaxed">{s.reasoning}</p>}
                        </div>
                      );
                    })
                  )}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === "search" && (
        <Panel title="Semantic Search">
          <p className="text-sm text-slate-500 mb-4">
            Find calls by searching for specific topics or emotions mentioned in the transcripts.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-full px-4 py-2.5 flex-1 focus-within:ring-4 focus-within:ring-brand-softGreen/50 focus-within:border-brand-green transition-all duration-300 shadow-sm">
              <Search className="w-4 h-4 text-slate-400" />
              <input className="flex-1 outline-none text-sm bg-transparent text-slate-700 placeholder-slate-400"
                     placeholder="e.g. customer was frustrated about a refund"
                     value={q}
                     onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && runSearch()} />
            </div>
            <div className="w-24">
              <input type="number" className="input" min={3} max={25} value={k}
                     onChange={(e) => setK(+e.target.value)} title="Max results" />
            </div>
            <button className="btn-primary" disabled={!q.trim() || searching} onClick={runSearch}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          
          {searchErr && <div className="mt-4 bg-rose-50 text-rose-800 rounded-xl p-4 text-sm font-medium border border-rose-200">{searchErr}</div>}
          
          <div className="mt-6 space-y-4">
            {matches.map((m, i) => (
              <div key={i} className="border border-slate-200/60 rounded-xl p-5 hover:bg-slate-50/50 transition-colors bg-white shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Call Match</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
                    {Math.round(m.similarity * 100)}% Match
                  </span>
                </div>
                <div className="text-sm text-slate-700 leading-relaxed">
                  {m.transcript.slice(0, 600)}{m.transcript.length > 600 ? "…" : ""}
                </div>
              </div>
            ))}
            {matches.length === 0 && !searching && q && (
              <div className="text-center py-12 text-slate-400 font-medium">
                No matching calls found. Try a different query.
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
