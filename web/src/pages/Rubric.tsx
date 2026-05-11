import { useEffect, useState } from "react";
import { Plus, Save, Trash2, ClipboardList, CheckCircle } from "lucide-react";
import Panel from "../components/Panel";
import { supabase } from "../lib/supabase";
import type { Rubric, RubricParameter } from "../lib/types";

const DEFAULT_PARAMS: RubricParameter[] = [
  { name: "Empathy", description: "Did the agent acknowledge the customer's emotional state?", max_score: 5 },
  { name: "Compliance", description: "Did the agent follow required disclosures and procedures?", max_score: 5 },
  { name: "Resolution", description: "Was the customer's issue resolved or properly escalated?", max_score: 5 },
];

export default function RubricPage() {
  const [active, setActive] = useState<Rubric | null>(null);
  const [all, setAll] = useState<Rubric[]>([]);
  const [name, setName] = useState("");
  const [params, setParams] = useState<RubricParameter[]>(DEFAULT_PARAMS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const { data } = await supabase.from("rubrics").select("*").order("created_at", { ascending: false });
    const rows = (data ?? []) as Rubric[];
    setAll(rows);
    const a = rows.find(r => r.is_active) ?? null;
    setActive(a);
    if (a) { setName(a.name); setParams(a.parameters); }
  }

  useEffect(() => { refresh(); }, []);

  function update(i: number, patch: Partial<RubricParameter>) {
    setParams(p => p.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }
  function remove(i: number) {
    setParams(p => p.filter((_, idx) => idx !== i));
  }
  function add() {
    setParams(p => [...p, { name: "", description: "", max_score: 5 }]);
  }

  async function save() {
    if (!name.trim()) { setMsg("Give the rubric a name."); return; }
    const valid = params.filter(p => p.name.trim() && p.description.trim());
    if (!valid.length) { setMsg("Add at least one parameter."); return; }
    setSaving(true); setMsg(null);
    await supabase.from("rubrics").update({ is_active: false }).eq("is_active", true);
    const { error } = await supabase.from("rubrics")
      .insert({ name: name.trim(), parameters: valid, is_active: true });
    setSaving(false);
    if (error) setMsg(error.message);
    else { setMsg("Saved & set as active."); refresh(); }
  }

  async function activate(id: string) {
    await supabase.from("rubrics").update({ is_active: false }).eq("is_active", true);
    await supabase.from("rubrics").update({ is_active: true }).eq("id", id);
    refresh();
  }

  return (
    <div className="space-y-6">
      <Panel title="Rubric Configuration">
        <p className="text-sm text-slate-500 mb-4">
          Define the parameters used to score every call. Only one rubric can be active at a time.
        </p>
        
        <div className="mb-6">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
            Rubric Name
          </label>
          <input className="input" placeholder="e.g. Q2-2026 Support Rubric"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800">Scoring Parameters</h3>
            <button className="text-sm text-brand-green font-semibold inline-flex items-center gap-1 hover:text-emerald-700 transition-colors"
                    onClick={add}>
              <Plus className="w-4 h-4" /> Add Parameter
            </button>
          </div>
          
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_2fr_100px_40px] gap-4 text-xs uppercase tracking-wider font-semibold text-slate-500 px-2">
              <div>Name</div><div>Description</div><div>Max Score</div><div></div>
            </div>
            
            {params.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_100px_40px] gap-4 items-center bg-slate-50/50 p-2 rounded-xl border border-slate-100 focus-within:border-brand-green/30 transition-colors">
                <input className="input !bg-white" placeholder="Parameter name" value={p.name}
                       onChange={(e) => update(i, { name: e.target.value })} />
                <input className="input !bg-white" placeholder="What should the AI look for?" value={p.description}
                       onChange={(e) => update(i, { description: e.target.value })} />
                <input className="input !bg-white" type="number" min={2} max={10} value={p.max_score}
                       onChange={(e) => update(i, { max_score: +e.target.value })} />
                <div className="flex justify-center">
                  <button className="text-slate-400 hover:text-rose-600 transition-colors p-2 hover:bg-rose-50 rounded-full" onClick={() => remove(i)} title="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={saving} onClick={save}>
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save & Set Active"}
            </button>
            {active && (
              <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-brand-green" />
                Active: <b>{active.name}</b>
              </span>
            )}
          </div>
          
          {msg && (
            <div className={`text-sm font-medium ${msg.includes("Saved") ? "text-emerald-600" : "text-slate-600"}`}>
              {msg}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Past Rubrics" right={<span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{all.length} total</span>}>
        {all.length === 0 ? (
          <div className="text-center py-8 text-slate-400 font-medium">
            <ClipboardList className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            No rubrics created yet.
          </div>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[2fr_3fr_2fr_100px] gap-4 text-xs uppercase tracking-wider font-semibold text-slate-500 px-2 mb-2">
              <div>Name</div><div>Parameters</div><div>Created</div><div>Status</div>
            </div>
            {all.map(r => (
              <div key={r.id} className={`table-row grid-cols-[2fr_3fr_2fr_100px] px-2 rounded-xl border-0 transition-colors duration-150 ${r.is_active ? "bg-emerald-50/50 border border-emerald-100" : "hover:bg-slate-50/80"}`}>
                <div className="font-semibold text-slate-800">{r.name}</div>
                <div className="text-xs text-slate-500 font-medium truncate">
                  {r.parameters.slice(0, 4).map(p => p.name).join(", ")}
                  {r.parameters.length > 4 ? "…" : ""}
                </div>
                <div className="text-xs text-slate-500 font-medium">{new Date(r.created_at).toLocaleString()}</div>
                <div>
                  {r.is_active
                    ? <span className="delta-up">Active</span>
                    : <button className="btn-ghost !py-1 !px-3 text-xs font-semibold" onClick={() => activate(r.id)}>Activate</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
