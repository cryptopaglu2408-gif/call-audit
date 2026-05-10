import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import Panel from "../components/Panel";
import { supabase } from "../lib/supabase";
import { semanticSearch } from "../lib/api";
import type { Call, Score } from "../lib/types";

const STATUS_COLOR: Record<string, string> = {
  done: "#22c55e", pending: "#7c3aed", error: "#f472b6",
  failed: "#ef4444", downloaded: "#60a5fa", transcribed: "#facc15",
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
    <div className="space-y-4">
      <Panel>
        <div className="flex gap-2">
          {(["calls", "search"] as const).map(t => (
            <button key={t}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                tab === t ? "bg-brand-green text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setTab(t)}>
              {t === "calls" ? "Calls" : "Semantic search"}
            </button>
          ))}
        </div>
      </Panel>

      {tab === "calls" && (
        <>
          <Panel title="All scored calls" right={<span className="text-xs text-slate-500">{rows.length}</span>}>
            <div className="grid grid-cols-[80px_120px_1fr_100px_100px_180px] gap-2 text-xs uppercase tracking-wide text-slate-500 px-1">
              <div>Row</div><div>Status</div><div>Language</div><div>Duration</div><div>Score</div><div>Created</div>
            </div>
            <div className="max-h-[420px] overflow-auto">
              {rows.map(({ call, pct }) => (
                <button key={call.id}
                  onClick={() => setSelected(call.id)}
                  className={`w-full text-left table-row grid-cols-[80px_120px_1fr_100px_100px_180px] hover:bg-slate-50 ${
                    selected === call.id ? "bg-slate-50" : ""}`}>
                  <div>{call.source_row ?? "—"}</div>
                  <div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={{ background: (STATUS_COLOR[call.status] ?? "#e2e8f0") + "33",
                                   color: STATUS_COLOR[call.status] ?? "#475569" }}>
                      {call.status}
                    </span>
                  </div>
                  <div className="text-slate-600">{call.language ?? "—"}</div>
                  <div>{call.duration_seconds ? `${call.duration_seconds.toFixed(1)} s` : "—"}</div>
                  <div className="font-semibold">{pct !== null ? `${pct}%` : "—"}</div>
                  <div className="text-slate-500">{new Date(call.created_at).toLocaleString()}</div>
                </button>
              ))}
            </div>
          </Panel>

          {current && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Panel title="Transcript" className="lg:col-span-2">
                {current.error && (
                  <div className="bg-rose-50 text-rose-800 rounded-xl p-3 text-sm mb-3">{current.error}</div>
                )}
                <div className="text-sm whitespace-pre-wrap text-slate-700">
                  {current.transcript || <span className="text-slate-400 italic">(no transcript)</span>}
                </div>
              </Panel>
              <Panel title="Scores">
                {currentScores.length === 0
                  ? <div className="text-sm text-slate-500">No scores recorded.</div>
                  : currentScores.map(s => (
                    <div key={s.id} className="border-t border-slate-100 first:border-0 py-3">
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium">{s.parameter}</span>
                        <span className="font-bold">{s.score} / {s.max_score}</span>
                      </div>
                      {s.reasoning && <p className="text-xs text-slate-500 mt-1">{s.reasoning}</p>}
                    </div>
                  ))}
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === "search" && (
        <Panel title="Semantic search">
          <p className="text-sm text-slate-500 mb-3">
            Find calls by what was said. Powered by pgvector via the FastAPI service.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-2 flex-1">
              <Search className="w-4 h-4 text-slate-400" />
              <input className="flex-1 outline-none text-sm bg-transparent"
                     placeholder="e.g. customer was frustrated about a refund"
                     value={q}
                     onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && runSearch()} />
            </div>
            <input type="number" className="input w-24" min={3} max={25} value={k}
                   onChange={(e) => setK(+e.target.value)} />
            <button className="btn-primary" disabled={!q.trim() || searching} onClick={runSearch}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {searchErr && <div className="mt-3 text-sm text-rose-700">{searchErr}</div>}
          <div className="mt-4 space-y-3">
            {matches.map((m, i) => (
              <div key={i} className="border border-slate-200 rounded-xl p-3">
                <div className="text-xs text-slate-500">similarity: {m.similarity.toFixed(3)}</div>
                <div className="text-sm text-slate-700 mt-1">
                  {m.transcript.slice(0, 600)}{m.transcript.length > 600 ? "…" : ""}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
