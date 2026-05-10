import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
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
    <div className="space-y-4">
      <Panel title="Rubric">
        <p className="text-sm text-slate-500 mb-3">
          Define the parameters used to score every call. Only one rubric is active at a time.
        </p>
        <input className="input" placeholder="e.g. Q2-2026 Support Rubric"
               value={name} onChange={(e) => setName(e.target.value)} />

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Parameters</h3>
          <div className="grid grid-cols-[1fr_2fr_120px_40px] gap-2 text-xs uppercase tracking-wide text-slate-500 px-1">
            <div>Name</div><div>Description</div><div>Max</div><div></div>
          </div>
          {params.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_120px_40px] gap-2 items-center mt-2">
              <input className="input" value={p.name}
                     onChange={(e) => update(i, { name: e.target.value })} />
              <input className="input" value={p.description}
                     onChange={(e) => update(i, { description: e.target.value })} />
              <input className="input" type="number" min={2} max={10} value={p.max_score}
                     onChange={(e) => update(i, { max_score: +e.target.value })} />
              <button className="text-slate-400 hover:text-rose-600" onClick={() => remove(i)} title="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button className="mt-3 text-sm text-brand-green font-medium inline-flex items-center gap-1"
                  onClick={add}>
            <Plus className="w-4 h-4" /> Add parameter
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={saving} onClick={save}>
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save & set active"}
          </button>
          {active && (
            <span className="text-sm text-slate-500">
              Currently active: <b>{active.name}</b> · {active.parameters.length} parameters
            </span>
          )}
        </div>

        {msg && <div className="mt-3 text-sm text-slate-600">{msg}</div>}
      </Panel>

      <Panel title="Past rubrics">
        {all.length === 0 ? (
          <div className="text-sm text-slate-500">No rubrics yet.</div>
        ) : (
          all.map(r => (
            <div key={r.id} className="table-row grid-cols-[2fr_3fr_2fr_100px]">
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-slate-500">
                {r.parameters.slice(0, 4).map(p => p.name).join(", ")}
                {r.parameters.length > 4 ? "…" : ""}
              </div>
              <div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</div>
              <div>
                {r.is_active
                  ? <span className="delta-up">active</span>
                  : <button className="btn-ghost text-xs" onClick={() => activate(r.id)}>Activate</button>}
              </div>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
