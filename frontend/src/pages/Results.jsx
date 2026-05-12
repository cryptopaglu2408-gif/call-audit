import { useEffect, useState } from 'react'
import { ExternalLink, Search, X, Phone, Pencil, Check, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'
import PlayCallButton from '../components/PlayCallButton'

function StatusBadge({ status }) {
  const map = { 
    done: 'bg-emerald-50 text-emerald-700 border-emerald-100', 
    transcribed: 'bg-violet-50 text-violet-700 border-violet-100', 
    error: 'bg-rose-50 text-rose-600 border-rose-100', 
    pending: 'bg-slate-50 text-slate-500 border-slate-200' 
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${map[status] || map.pending}`}>
      <span className="w-1 h-1 rounded-full mr-1.5" style={{ background: status === 'done' ? '#10b981' : status === 'transcribed' ? '#8b5cf6' : status === 'error' ? '#f43f5e' : '#94a3b8' }} />
      {status}
    </span>
  )
}

// Labels and hints for special parameter types
const DEMO_LEVELS = [
  { score: 0, label: 'Not attempted',    color: 'bg-slate-100 text-slate-500' },
  { score: 1, label: 'Mentioned, declined', color: 'bg-rose-50 text-rose-500' },
  { score: 2, label: 'Callback booked',  color: 'bg-amber-50 text-amber-600' },
  { score: 3, label: 'Demo confirmed',   color: 'bg-emerald-50 text-emerald-700' },
]

const PARAM_HINTS = {
  'Intent Check Done ?':  'Did the agent ask if the parent is open / ready to proceed?',
  'Problem Identified ?': 'Did the agent identify a specific academic problem with the child?',
  'Price Discussed ?':    'Were fees or pricing mentioned at any point in the call?',
  'Was Demo Scheduled ?': '0 = not attempted · 1 = mentioned but declined · 2 = callback booked · 3 = demo confirmed',
}

function ScoreRow({ s, callId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(s.score)
  const [saving, setSaving]   = useState(false)

  const isYesNo      = s.max_score === 2
  const isCategorical = s.max_score === 3
  const isNumeric    = !isYesNo && !isCategorical

  const pct      = Math.round(s.score / s.max_score * 100)
  const gradient = pct >= 70 ? 'from-emerald-400 to-teal-500' : pct >= 40 ? 'from-amber-400 to-yellow-500' : 'from-rose-400 to-red-500'
  const textColor = pct >= 70 ? 'text-emerald-600' : pct >= 40 ? 'text-amber-600' : 'text-rose-500'

  async function save() {
    if (val === s.score) { setEditing(false); return }
    setSaving(true)
    const { error } = await supabase.from('scores')
      .update({ score: val, reasoning: s.reasoning ? `[OVERRIDE] ${s.reasoning}` : '[OVERRIDE] Manually adjusted.' })
      .eq('call_id', callId)
      .eq('rubric_id', s.rubric_id)
      .eq('parameter', s.parameter)
    setSaving(false)
    if (!error) { setEditing(false); onSaved(s.parameter, val) }
  }

  const hint = PARAM_HINTS[s.parameter]

  // ── Yes / No ──────────────────────────────────────────────────────────────
  if (isYesNo) {
    const isYes = s.score === s.max_score
    return (
      <div className="mb-4 group flex items-start justify-between gap-4 bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-white/20 hover:border-white/50 hover:bg-white/80 transition-all shadow-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">{s.parameter}</span>
            {s.reasoning?.startsWith('[OVERRIDE]') && (
              <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full font-bold">overridden</span>
            )}
          </div>
          {hint && <p className="text-[11px] font-medium text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <button onClick={() => setVal(0)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${val === 0 ? 'bg-rose-500 text-white border-rose-500 shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:border-rose-300'}`}>
                No
              </button>
              <button onClick={() => setVal(s.max_score)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${val === s.max_score ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:border-emerald-300'}`}>
                Yes
              </button>
              <button onClick={save} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Check size={16} /></button>
              <button onClick={() => { setEditing(false); setVal(s.score) }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"><X size={16} /></button>
            </>
          ) : (
            <>
              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${isYes ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-50 text-rose-500'}`}>
                {isYes ? 'Yes' : 'No'}
              </span>
              <button onClick={() => setEditing(true)}
                className="p-1.5 text-gray-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="Override">
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Categorical (Was Demo Scheduled?) ─────────────────────────────────────
  if (isCategorical) {
    const level = DEMO_LEVELS[Math.min(s.score, 3)]
    return (
      <div className="mb-4 group flex items-start justify-between gap-4 bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-white/20 hover:border-white/50 hover:bg-white/80 transition-all shadow-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700">{s.parameter}</span>
            {s.reasoning?.startsWith('[OVERRIDE]') && (
              <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full font-bold">overridden</span>
            )}
          </div>
          {hint && <p className="text-[11px] font-medium text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <div className="flex gap-1">
                {DEMO_LEVELS.map(lv => (
                  <button key={lv.score} onClick={() => setVal(lv.score)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all whitespace-nowrap ${val === lv.score ? `${lv.color} border-current shadow-sm` : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}>
                    {lv.score} · {lv.label.split(',')[0]}
                  </button>
                ))}
              </div>
              <button onClick={save} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Check size={16} /></button>
              <button onClick={() => { setEditing(false); setVal(s.score) }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"><X size={16} /></button>
            </>
          ) : (
            <>
              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${level.color}`}>
                {level.label}
              </span>
              <span className="text-xs font-bold text-gray-400 tabular">{s.score}/{s.max_score}</span>
              <button onClick={() => setEditing(true)}
                className="p-1.5 text-gray-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="Override">
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Numeric ───────────────────────────────────────────────────────────────
  return (
    <div className="mb-4 group bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-white/20 hover:border-white/50 hover:bg-white/80 transition-all shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-700">{s.parameter}</span>
          {s.reasoning?.startsWith('[OVERRIDE]') && (
            <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full font-bold">overridden</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                type="number" min={0} max={s.max_score} value={val}
                onChange={e => setVal(Math.min(s.max_score, Math.max(0, Number(e.target.value))))}
                className="w-14 text-center text-sm border border-violet-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500/20 tabular font-bold"
                autoFocus
              />
              <span className="text-xs font-bold text-gray-400">/ {s.max_score}</span>
              <button onClick={save} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"><Check size={16} /></button>
              <button onClick={() => { setEditing(false); setVal(s.score) }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"><X size={16} /></button>
            </>
          ) : (
            <>
              <span className="text-xs font-bold text-gray-400 tabular">{s.score}/{s.max_score}</span>
              <span className={`text-xs font-bold tabular ${textColor}`}>{pct}%</span>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 text-gray-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="Override score"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="h-2 bg-gray-200/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Results() {
  const [calls, setCalls]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState(null)
  const [scores, setScores]             = useState([])
  const [scoresLoading, setScoresLoading] = useState(false)
  const [search, setSearch]             = useState('')
  const [rubricOrder, setRubricOrder]   = useState([])

  useEffect(() => {
    Promise.all([
      supabase.from('calls').select('id, status, created_at, duration_seconds, drive_link, metadata, transcript')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('rubrics').select('parameters').eq('is_active', true).limit(1),
    ]).then(([{ data: c }, { data: r }]) => {
      setCalls(c || [])
      if (r?.[0]?.parameters) setRubricOrder(r[0].parameters.map(p => p.name))
      setLoading(false)
    })
  }, [])

  async function selectCall(call) {
    setSelected(call)
    setScores([])
    setScoresLoading(true)
    const { data } = await supabase.from('scores')
      .select('parameter, score, max_score, reasoning, rubric_id')
      .eq('call_id', call.id)
    const sorted = rubricOrder.length
      ? [...(data || [])].sort((a, b) => {
          const ai = rubricOrder.indexOf(a.parameter)
          const bi = rubricOrder.indexOf(b.parameter)
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        })
      : (data || [])
    setScores(sorted)
    setScoresLoading(false)
  }

  function handleSaved(parameter, newScore) {
    setScores(prev => prev.map(s => s.parameter === parameter ? { ...s, score: newScore, reasoning: s.reasoning ? `[OVERRIDE] ${s.reasoning}` : '[OVERRIDE] Manually adjusted.' } : s))
  }

  const filtered = calls.filter(c =>
    (c.metadata?.filename || '').toLowerCase().includes(search.toLowerCase()) ||
    c.status.includes(search.toLowerCase())
  )

  const totalScore = scores.length
    ? Math.round(scores.reduce((a,s) => a + s.score / s.max_score, 0) / scores.length * 100)
    : null

  if (loading) return <Spinner text="Loading calls…" />

  return (
    <div className="flex h-full bg-gradient-to-br from-[#f8f9fa] to-[#fff5f2]">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
        }
        .glow-orange {
          box-shadow: 0 20px 50px -12px rgba(255, 123, 84, 0.25);
        }
      `}</style>
      {/* Left: call list */}
      <div className="w-80 border-r border-gray-100 bg-white/90 backdrop-blur-md flex flex-col shrink-0">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Results</h1>
            <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-bold">{calls.length}</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Search filename…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-100 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff7b54]/20 focus:border-[#ff7b54] transition-all"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-1">
          {filtered.map(c => {
            const filename = c.metadata?.filename || `call-${c.id.slice(0,8)}`
            const dur      = c.duration_seconds ? `${(c.duration_seconds/60).toFixed(1)}m` : null
            const isActive = selected?.id === c.id
            const callIdShort = c.id.slice(0, 8).toUpperCase()
            // Deterministic mock score for design (0-100)
            const mockScore = (parseInt(c.id.slice(0, 2), 16) || 0) % 100
            const progressColor = mockScore >= 70 ? 'bg-emerald-500' : mockScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'
            
            return (
              <button key={c.id} onClick={() => selectCall(c)}
                className={`w-full text-left px-4 py-2.5 rounded-xl transition-all duration-200 border-b border-gray-50 last:border-0 hover:translate-x-0.5 ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}>
                <div className="flex items-center gap-2.5">
                  {/* Avatar/Icon */}
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shrink-0 border border-gray-200">
                    <Phone size={12} className="text-gray-500" />
                  </div>
                  
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate">{filename}</p>
                        <p className="text-[10px] font-semibold text-gray-400">ID: {callIdShort}</p>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
                        c.status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                        c.status === 'transcribed' ? 'bg-violet-50 text-violet-700 border-violet-100' :
                        c.status === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                        'bg-gray-50 text-gray-600 border-gray-100'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                    
                    {/* Progress Bar (Complain style) */}
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${progressColor} rounded-full`} style={{ width: `${mockScore}%` }} />
                      </div>
                      <span className="text-[9px] font-bold text-gray-500 w-6 text-right">{mockScore}%</span>
                    </div>
                    
                    <div className="flex items-center justify-between mt-1 text-[9px] font-semibold text-gray-400">
                      <span>{dur || '—'}</span>
                      <span>{new Date(c.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm font-medium">No results match</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto p-8">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="w-16 h-16 bg-white rounded-[24px] shadow-sm border border-gray-100 flex items-center justify-center mb-4">
              <Phone size={24} className="text-gray-400" />
            </div>
            <p className="text-sm font-bold text-gray-700">Select a call to inspect</p>
            <p className="text-xs font-medium text-gray-400 mt-1">Click any call in the list</p>
          </div>
        ) : (
          <div key={selected?.id} className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Header card */}
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 truncate tracking-tight">{selected.metadata?.filename || 'Call detail'}</h2>
                  {selected.metadata?.agent_name && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                        <span className="text-gray-600 text-[9px] font-bold">{selected.metadata.agent_name.slice(0,2).toUpperCase()}</span>
                      </div>
                      <span className="text-sm font-bold text-gray-700">{selected.metadata.agent_name}</span>
                    </div>
                  )}
                  <p className="text-xs font-medium text-gray-400 mt-1">
                    {new Date(selected.created_at).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'})}
                    {selected.duration_seconds && ` · ${(selected.duration_seconds/60).toFixed(1)} min`}
                  </p>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <StatusBadge status={selected.status} />
                    {totalScore !== null && (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${totalScore >= 70 ? 'bg-emerald-50 text-emerald-700' : totalScore >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-600'}`}>
                        {totalScore}% overall
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <PlayCallButton call={selected} />
                  {selected.drive_link && (
                    <a href={selected.drive_link} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-bold text-white bg-black hover:bg-gray-800 px-4 py-2 rounded-full transition-colors">
                      <ExternalLink size={14} /> Drive
                    </a>
                  )}
                  <button onClick={() => setSelected(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                    <X size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Scores with override */}
            <div className="bg-white/80 backdrop-blur-md rounded-[32px] shadow-sm border border-white/20 p-6 glow-orange">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 tracking-tight">Parameter Scores</h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Hover a score to override</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                  <Pencil size={12} />
                  <span>Editable</span>
                </div>
              </div>
              {scoresLoading ? <Spinner text="Loading scores…" /> : scores.length === 0 ? (
                <p className="text-sm font-medium text-gray-400">No scores recorded.</p>
              ) : (
                <div className="space-y-1">
                  {scores.map(s => <ScoreRow key={s.parameter} s={s} callId={selected.id} onSaved={handleSaved} />)}
                </div>
              )}
            </div>

            {/* Transcript */}
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-6">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-4">Transcript</h3>
              {selected.transcript
                ? <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-medium">{selected.transcript}</p>
                  </div>
                : <p className="text-sm font-medium text-gray-400">No transcript available.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
