import { useEffect, useState, useMemo } from 'react'
import { Plus, Trash2, CheckCircle2, Zap, GitCompare } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'

const EMPTY = { name: '', description: '', max_score: 10, type: 'numeric' }

const TYPES = [
  { value: 'numeric',     label: 'Numeric',   hint: '0–max',  autoMax: null },
  { value: 'yes_no',      label: 'Yes / No',  hint: '0 or 2', autoMax: 2 },
  { value: 'categorical', label: 'Levels',    hint: '0–3',    autoMax: 3 },
]

function inferType(p) {
  if (p.type) return p.type
  if (p.max_score === 2) return 'yes_no'
  if (p.max_score === 3) return 'categorical'
  return 'numeric'
}
const COMPARE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899']

const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900/90 backdrop-blur-md text-white text-xs px-4 py-2.5 rounded-xl shadow-xl border border-white/10">
      <p className="font-bold mb-1 text-slate-200">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color || '#fff' }} className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color || '#fff' }} />
          {p.name}: <span className="font-bold">{p.value}%</span>
        </p>
      ))}
    </div>
  )
}

export default function Rubric() {
  const [rubrics, setRubrics]     = useState([])
  const [allScores, setAllScores] = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)
  const [name, setName]           = useState('')
  const [params, setParams]       = useState([{ ...EMPTY }])
  const [compareIds, setCompareIds] = useState([])
  const [tab, setTab]             = useState('editor') // 'editor' | 'compare'

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('rubrics').select('*').order('created_at', { ascending: false }),
      supabase.from('scores').select('rubric_id, parameter, score, max_score'),
    ])
    setRubrics(r || [])
    setAllScores(s || [])
    const active = (r || []).find(x => x.is_active)
    if (active) { setName(active.name); setParams(active.parameters.map(p => ({ ...p, type: inferType(p) }))) }
    if ((r || []).length >= 2) setCompareIds([(r[0]).id, (r[1]).id])
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function updateParam(i, k, v) {
    setParams(p => p.map((x, idx) => {
      if (idx !== i) return x
      const updated = { ...x, [k]: v }
      if (k === 'type') {
        const t = TYPES.find(t => t.value === v)
        if (t?.autoMax) updated.max_score = t.autoMax
      }
      return updated
    }))
  }

  async function save() {
    if (!name.trim()) return showToast('Add a rubric name.', 'error')
    const valid = params.filter(p => p.name?.trim() && p.description?.trim())
    if (!valid.length) return showToast('Add at least one complete parameter.', 'error')
    setSaving(true)
    await supabase.from('rubrics').update({ is_active: false }).eq('is_active', true)
    const { error } = await supabase.from('rubrics').insert({ name: name.trim(), parameters: valid, is_active: true })
    setSaving(false)
    if (error) return showToast(`Failed: ${error.message}`, 'error')
    showToast('Saved and set as active.')
    load()
  }

  async function activate(id) {
    await supabase.from('rubrics').update({ is_active: false }).eq('is_active', true)
    await supabase.from('rubrics').update({ is_active: true }).eq('id', id)
    showToast('Rubric activated.')
    load()
  }

  // Comparison chart data
  const compareData = useMemo(() => {
    if (compareIds.length < 2) return []
    const selected = rubrics.filter(r => compareIds.includes(r.id))
    const allParams = [...new Set(selected.flatMap(r => r.parameters.map(p => p.name)))].sort()

    return allParams.map(param => {
      const row = { param: param.length > 14 ? param.slice(0, 12) + '…' : param }
      selected.forEach(r => {
        const scores = allScores.filter(s => s.rubric_id === r.id && s.parameter === param)
        row[r.name] = scores.length
          ? Math.round(scores.reduce((a, s) => a + s.score / s.max_score, 0) / scores.length * 100)
          : null
      })
      return row
    })
  }, [compareIds, rubrics, allScores])

  const selectedRubrics = rubrics.filter(r => compareIds.includes(r.id))
  const active = rubrics.find(r => r.is_active)

  if (loading) return <Spinner text="Loading rubric…" />

  return (
    <div className="min-h-full bg-slate-50/50">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold shadow-xl ${toast.type === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.type !== 'error' && <CheckCircle2 size={16} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}

      <div className="bg-white/90 backdrop-blur-sm border-b border-slate-200/60 px-8 py-6 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Rubric</h1>
            <p className="text-sm font-medium text-slate-400 mt-0.5">Define scoring parameters. One rubric is active at a time.</p>
          </div>
          <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl w-fit border border-slate-200/60">
            {[{ id: 'editor', label: 'Editor' }, { id: 'compare', label: 'Compare' }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-2 text-sm font-bold rounded-lg transition-all duration-200 ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {active && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-4 shadow-sm shadow-emerald-50">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-sm font-bold text-emerald-800">
              Active: <span className="font-black">{active.name}</span>
              <span className="font-medium text-emerald-600 ml-1.5">· {active.parameters.length} parameters</span>
            </p>
          </div>
        )}

        {tab === 'editor' ? (
          <>
            {/* Editor */}
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6 space-y-6">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Rubric Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Demo Quality Check v2"
                  className="mt-2 w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all font-bold text-slate-900 placeholder:text-slate-300" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Parameters</label>
                  <button onClick={() => setParams(p => [...p, { ...EMPTY }])}
                    className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 rounded-xl transition-colors">
                    <Plus size={14} /> Add Parameter
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_110px_2fr_70px_36px] gap-3 px-1">
                    {['Name','Type','Scoring Criteria (sent to AI)','Max',''].map(h => <span key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{h}</span>)}
                  </div>
                  {params.map((p, i) => {
                    const typeObj = TYPES.find(t => t.value === (p.type || 'numeric'))
                    const maxLocked = typeObj?.autoMax != null
                    return (
                    <div key={i} className="grid grid-cols-[1fr_110px_2fr_70px_36px] gap-3 items-center">
                      <input value={p.name} onChange={e => updateParam(i,'name',e.target.value)} placeholder="Call Opening"
                        className="px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all font-bold text-slate-700" />
                      <select value={p.type || 'numeric'} onChange={e => updateParam(i,'type',e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all font-semibold text-slate-700 cursor-pointer">
                        {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input value={p.description} onChange={e => updateParam(i,'description',e.target.value)} placeholder="e.g. Did the agent greet warmly and introduce SuperSheldon?"
                        className="px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all font-medium text-slate-600" />
                      <div className="relative">
                        <input type="number" min={1} max={10} value={p.max_score}
                          onChange={e => updateParam(i,'max_score',Number(e.target.value))}
                          disabled={maxLocked}
                          className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-xl text-center tabular transition-all font-bold text-slate-700 ${maxLocked ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400'}`} />
                        {maxLocked && <span className="absolute -bottom-4 left-0 right-0 text-center text-[10px] text-slate-400 font-medium">{typeObj.hint}</span>}
                      </div>
                      <button onClick={() => setParams(prev => prev.filter((_,idx)=>idx!==i))}
                        className="flex items-center justify-center w-9 h-9 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    )
                  })}
                </div>
              </div>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-sm transition-all">
                <Zap size={14} />
                {saving ? 'Saving…' : 'Save & Set Active'}
              </button>
            </div>

            {/* History */}
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-5">Rubric History</h2>
              {rubrics.length === 0 ? <p className="text-sm font-medium text-slate-400">No rubrics yet.</p> : (
                <div className="space-y-2">
                  {rubrics.map(r => (
                    <div key={r.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${r.is_active ? 'bg-emerald-50 border-emerald-100' : 'border-slate-100 hover:bg-slate-50'}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{r.name}</span>
                          {r.is_active && <span className="flex items-center gap-1 text-[11px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold shadow-sm"><CheckCircle2 size={11}/> active</span>}
                        </div>
                        <p className="text-xs font-medium text-slate-400 mt-1">{r.parameters.length} parameters · {new Date(r.created_at).toLocaleDateString('en-AU',{dateStyle:'medium'})}</p>
                      </div>
                      {!r.is_active && (
                        <button onClick={() => activate(r.id)} className="text-xs font-bold text-emerald-600 bg-white hover:bg-emerald-50 border border-emerald-200 px-3.5 py-1.5 rounded-lg transition-colors">Activate</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* Compare tab */
          <div className="space-y-6">
            {rubrics.length < 2 ? (
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-10 text-center text-slate-400">
                <GitCompare size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">Need at least 2 rubrics to compare</p>
                <p className="text-xs font-medium mt-1">Save another rubric from the Editor tab first.</p>
              </div>
            ) : (
              <>
                {/* Selector */}
                <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">Select rubrics to compare</h2>
                  <div className="flex flex-wrap gap-2">
                    {rubrics.map((r, i) => {
                      const selected = compareIds.includes(r.id)
                      return (
                        <button key={r.id}
                          onClick={() => {
                            if (selected) setCompareIds(prev => prev.filter(id => id !== r.id))
                            else if (compareIds.length < 4) setCompareIds(prev => [...prev, r.id])
                          }}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${selected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-100 text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                        >
                          {selected && <span className="w-2.5 h-2.5 rounded-full" style={{ background: COMPARE_COLORS[compareIds.indexOf(r.id)] }} />}
                          {r.name}
                          {r.is_active && <span className="text-[10px] text-emerald-600 font-bold">(active)</span>}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs font-medium text-slate-400 mt-3">Select up to 4 rubrics</p>
                </div>

                {/* Chart */}
                {compareIds.length >= 2 && compareData.length > 0 ? (
                  <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-5">Avg Score per Parameter</h2>
                    <ResponsiveContainer width="100%" height={Math.max(200, compareData.length * 40)}>
                      <BarChart data={compareData} layout="vertical" barSize={10} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" domain={[0,100]} tick={{ fontSize:10, fill:'#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
                        <YAxis type="category" dataKey="param" tick={{ fontSize:11, fill:'#475569', fontWeight: 600 }} axisLine={false} tickLine={false} width={120} />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill:'#f8fafc' }} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12, fontWeight: 600 }} />
                        {selectedRubrics.map((r, i) => (
                          <Bar key={r.id} dataKey={r.name} fill={COMPARE_COLORS[i]} radius={[0,4,4,0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>

                    {/* Summary table */}
                    <div className="mt-6 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            <th className="pb-3 border-b border-slate-100">Parameter</th>
                            {selectedRubrics.map((r,i) => (
                              <th key={r.id} className="pb-3 border-b border-slate-100" style={{ color: COMPARE_COLORS[i] }}>{r.name}</th>
                            ))}
                            <th className="pb-3 border-b border-slate-100">Δ Diff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compareData.map(row => {
                            const vals = selectedRubrics.map(r => row[r.name]).filter(v => v !== null && v !== undefined)
                            const diff = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null
                            return (
                              <tr key={row.param} className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-3 pr-4 text-slate-700 font-bold">{row.param}</td>
                                {selectedRubrics.map(r => (
                                  <td key={r.id} className="py-3 pr-4 tabular font-bold" style={{ color: row[r.name] >= 70 ? '#10b981' : row[r.name] >= 40 ? '#f59e0b' : '#ef4444' }}>
                                    {row[r.name] !== null && row[r.name] !== undefined ? `${row[r.name]}%` : '—'}
                                  </td>
                                ))}
                                <td className="py-3 tabular">
                                  {diff !== null ? (
                                    <span className={`font-bold ${diff > 10 ? 'text-rose-500' : diff > 5 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                      {diff === 0 ? '=' : `${diff}pp`}
                                    </span>
                                  ) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs font-medium text-slate-400 mt-4">Δ Diff = percentage point gap between highest and lowest scoring rubric for that parameter</p>
                  </div>
                ) : (
                  <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-8 text-center text-slate-400">
                    <p className="text-sm font-medium">Select at least 2 rubrics above to compare.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
