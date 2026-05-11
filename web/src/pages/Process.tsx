import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Play, Upload as UploadIcon, FileText, AlertCircle } from "lucide-react";
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
    <div className="space-y-6">
      <Panel title="Process Calls">
        {!rubric && (
          <div className="bg-rose-50 text-rose-800 rounded-xl p-4 text-sm font-medium mb-4 flex items-center gap-2 border border-rose-200">
            <AlertCircle className="w-4 h-4" />
            <span>No active rubric found. Please configure a <a className="underline hover:text-rose-900" href="/rubric">Rubric</a> first.</span>
          </div>
        )}

        <div className="mb-6">
          <p className="text-sm text-slate-500 mb-4">
            Upload a spreadsheet containing Google Drive audio links to start the auditing process.
          </p>
          
          <label className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer ${file ? "border-brand-green bg-emerald-50/30" : "border-slate-200 hover:border-brand-green hover:bg-slate-50"}`}>
            <input type="file" accept=".xlsx,.csv" onChange={onFile} className="hidden" />
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${file ? "bg-brand-green text-white" : "bg-slate-100 text-slate-500"}`}>
              {file ? <FileText className="w-6 h-6" /> : <UploadIcon className="w-6 h-6" />}
            </div>
            <span className="text-sm font-semibold text-slate-700">
              {file ? file.name : "Drop your file here or click to browse"}
            </span>
            <span className="text-xs text-slate-500 mt-1">Supports .xlsx and .csv</span>
          </label>
        </div>

        {file && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Audio-link column
              <select className="input mt-1.5" value={linkCol} onChange={(e) => setLinkCol(e.target.value)}>
                <option value="">— pick column —</option>
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              From row
              <input type="number" min={2} max={rowCount + 1} value={rowStart}
                     onChange={(e) => setRowStart(+e.target.value)} className="input mt-1.5" />
            </label>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              To row
              <input type="number" min={2} max={rowCount + 1} value={rowEnd}
                     onChange={(e) => setRowEnd(+e.target.value)} className="input mt-1.5" />
            </label>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button className="btn-primary" disabled={!file || !linkCol || !rubric || running}
                  onClick={run}>
            <Play className="w-4 h-4" /> {running ? "Processing…" : "Process Selected Range"}
          </button>
          <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
            {rubric ? `Active Rubric: ${rubric.name}` : "No Active Rubric"}
          </span>
        </div>

        {(running || updates.length > 0) && (
          <div className="mt-6 p-4 bg-slate-50/50 rounded-xl border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">Overall Progress</span>
              <span className="text-sm font-bold text-brand-green">{progress}%</span>
            </div>
            <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-gradient-to-r from-brand-green to-emerald-500 transition-all duration-500 rounded-full shadow-lg shadow-emerald-200" style={{ width: `${progress}%` }} />
            </div>
            {last && (
              <div className="text-xs font-medium text-slate-500 mt-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-brand-green rounded-full inline-block" />
                {last.message}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 bg-rose-50 text-rose-800 rounded-xl p-4 text-sm font-medium flex items-center gap-2 border border-rose-200">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}
      </Panel>

      {updates.length > 0 && (
        <Panel title="Live Log" right={<span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{updates.length} events</span>}>
          <ul className="text-sm font-mono space-y-2 max-h-80 overflow-auto bg-slate-900 text-slate-300 p-4 rounded-xl">
            {updates.slice().reverse().map((u, i) => (
              <li key={i} className={`flex items-start gap-2 ${u.stage === "error" ? "text-rose-400" : u.stage === "done" ? "text-emerald-400" : "text-slate-300"}`}>
                <span className="text-slate-500">[{u.index}/{u.total}]</span>
                <span className="font-semibold text-slate-400">row {u.sheet_row}:</span>
                <span>{u.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
