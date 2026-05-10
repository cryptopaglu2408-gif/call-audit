import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Play, Upload as UploadIcon } from "lucide-react";
import Panel from "../components/Panel";
import { startProcess, streamProcess } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { ProcessUpdate, Rubric } from "../lib/types";

export default function Process() {
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [linkCol, setLinkCol] = useState("");
  const [rowStart, setRowStart] = useState(2);
  const [rowEnd, setRowEnd] = useState(11);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [running, setRunning] = useState(false);
  const [updates, setUpdates] = useState<ProcessUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    supabase.from("rubrics").select("*").eq("is_active", true).limit(1).single()
      .then(({ data }) => setRubric((data ?? null) as Rubric | null));
    return () => stopRef.current?.();
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    setColumns(json.length ? Object.keys(json[0]) : []);
    setRowCount(json.length);
    setRowEnd(Math.min(json.length + 1, 11));
  }

  async function run() {
    if (!file || !linkCol || !rubric) return;
    setRunning(true); setUpdates([]); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("link_column", linkCol);
    fd.append("row_start", String(rowStart));
    fd.append("row_end", String(rowEnd));
    try {
      const { token } = await startProcess(fd);
      stopRef.current = streamProcess(
        token,
        (u) => setUpdates(arr => [...arr, u]),
        () => setRunning(false),
        (msg) => { setError(msg); setRunning(false); },
      );
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }

  const last = updates[updates.length - 1];
  const progress = useMemo(() => {
    if (!last) return 0;
    return Math.round(((last.index - (last.stage === "done" || last.stage === "error" ? 0 : 1)) / Math.max(last.total, 1)) * 100);
  }, [last]);

  return (
    <div className="space-y-4">
      <Panel title="Process calls">
        {!rubric && (
          <div className="bg-rose-50 text-rose-800 rounded-xl p-3 text-sm">
            No active rubric. Open the <a className="underline" href="/rubric">Rubric</a> page first.
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer w-fit">
          <span className="btn-ghost"><UploadIcon className="w-4 h-4" /> {file ? file.name : "Choose .xlsx / .csv"}</span>
          <input type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" />
        </label>

        {file && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <label className="text-sm text-slate-600">
              Audio-link column
              <select className="input mt-1" value={linkCol} onChange={(e) => setLinkCol(e.target.value)}>
                <option value="">— pick —</option>
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              From row
              <input type="number" min={2} max={rowCount + 1} value={rowStart}
                     onChange={(e) => setRowStart(+e.target.value)} className="input mt-1" />
            </label>
            <label className="text-sm text-slate-600">
              To row
              <input type="number" min={2} max={rowCount + 1} value={rowEnd}
                     onChange={(e) => setRowEnd(+e.target.value)} className="input mt-1" />
            </label>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" disabled={!file || !linkCol || !rubric || running}
                  onClick={run}>
            <Play className="w-4 h-4" /> {running ? "Processing…" : "Process selected range"}
          </button>
          <span className="text-sm text-slate-500">
            {rubric ? `Active rubric: ${rubric.name}` : ""}
          </span>
        </div>

        {(running || updates.length > 0) && (
          <div className="mt-4">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-green transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-slate-500 mt-1">{progress}%{last ? ` · ${last.message}` : ""}</div>
          </div>
        )}

        {error && <div className="mt-3 bg-rose-50 text-rose-800 rounded-xl p-3 text-sm">{error}</div>}
      </Panel>

      {updates.length > 0 && (
        <Panel title="Live log">
          <ul className="text-sm font-mono space-y-1 max-h-80 overflow-auto">
            {updates.slice().reverse().map((u, i) => (
              <li key={i} className={u.stage === "error" ? "text-rose-700" : u.stage === "done" ? "text-emerald-700" : "text-slate-600"}>
                [{u.index}/{u.total}] row {u.sheet_row}: {u.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
