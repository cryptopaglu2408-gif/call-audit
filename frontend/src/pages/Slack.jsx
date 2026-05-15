import { useEffect, useState, useMemo } from 'react'
import { MessageSquare, Send, Filter, Eye, Settings2, Copy, Check, RefreshCw } from 'lucide-react'
import { supabase, fetchAllScores } from '../lib/supabase'
import Spinner from '../components/Spinner'

const WEBHOOK = import.meta.env.VITE_SLACK_WEBHOOK || ''

function callPct(scores) {
  if (!scores?.length) return null
  const earned = scores.reduce((a, s) => a + s.score, 0)
  const max    = scores.reduce((a, s) => a + s.max_score, 0)
  return max ? Math.round(earned / max * 100) : null
}

function pctBadge(pct) {
  if (pct === null) return 'bg-slate-100 text-slate-400'
  if (pct >= 70)   return 'bg-emerald-50 text-emerald-700 border border-emerald-100'
  if (pct >= 50)   return 'bg-amber-50 text-amber-700 border border-amber-100'
  return 'bg-rose-50 text-rose-600 border border-rose-100'
}

function buildMessage(call, scores, rubric, config) {
  const { format, includeLink, includeDuration, headerText } = config
  const agent    = call.metadata?.agent_name || 'Unknown'
  const filename = call.metadata?.filename   || `call-${call.id.slice(0, 8)}`
  const date     = new Date(call.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const duration = call.duration_seconds ? `${(call.duration_seconds / 60).toFixed(1)} min` : null
  const earned   = scores.reduce((a, s) => a + s.score, 0)
  const max      = scores.reduce((a, s) => a + s.max_score, 0)
  const pct      = max ? Math.round(earned / max * 100) : null
  const icon     = pct === null ? '⚪' : pct >= 70 ? '🟢' : pct >= 50 ? '🟡' : '🔴'

  if (format === 'compact') {
    const parts = [`${icon} *${agent}*`, pct !== null ? `${pct}%` : '—', date]
    if (includeDuration && duration) parts.push(duration)
    if (includeLink && call.drive_link) parts.push(`<${call.drive_link}|Listen>`)
    return (headerText ? headerText + '\n' : '') + parts.join(' · ')
  }

  const ordered = rubric?.parameters?.length
    ? rubric.parameters.map(p => scores.find(s => s.parameter === p.name)).filter(Boolean)
    : scores
  const scoreLines = ordered.flatMap(s => {
    const p = Math.round(s.score / s.max_score * 100)
    const e = p >= 70 ? '✅' : p >= 50 ? '⚠️' : '❌'
    const lines = [`  ${e} *${s.parameter}:* ${s.score}/${s.max_score} _(${p}%)_`]
    
    if (s.reasoning) {
      const impIdx = s.reasoning.indexOf('| IMPROVEMENT:')
      let improvement = null
      let mainPart = s.reasoning
      if (impIdx !== -1) {
        improvement = s.reasoning.substring(impIdx + 14).trim()
        mainPart = s.reasoning.substring(0, impIdx).trim()
      }
      
      let evidence = null
      const cleanedMainPart = mainPart.replace(/^\[OVERRIDE\]\s*/, '')
      if (cleanedMainPart.startsWith('EVIDENCE:')) {
        const pipeIdx = cleanedMainPart.indexOf('|')
        evidence = pipeIdx !== -1 ? cleanedMainPart.substring(9, pipeIdx).trim() : cleanedMainPart.substring(9).trim()
      }
      
      if (improvement) lines.push(`    💡 _${improvement}_`)
      if (evidence && evidence !== "'NO EVIDENCE FOUND'") lines.push(`    📝 _${evidence}_`)
      if (!improvement && !evidence) lines.push(`    _${s.reasoning}_`)
    }
    
    lines.push('')
    return lines
  }).join('\n')

  const lines = [
    ...(headerText ? [headerText, ''] : []),
    `${icon} *Call Summary — ${agent}*`,
    `📅 ${date}${includeDuration && duration ? `  ·  ⏱️ ${duration}` : ''}`,
    `📂 *${filename}*`,
    '',
    '*Scores:*',
    scoreLines,
    '',
    `*Overall: ${pct !== null ? pct + '%' : '—'} (${earned}/${max})*`,
    ...(includeLink && call.drive_link ? [
      '',
      '*Listen to recording:*',
      call.drive_link.replace(/\/view$/, '')
    ] : []),
  ]
  return lines.join('\n')
}

function PreviewLine({ text }) {
  // Simple Slack-to-HTML formatter for the preview box
  const formatted = text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded">$1</code>')
    .replace(/\\_/g, '_') // Unescape underscores for display
  
  return <div dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }} className="min-h-[1.2em]" />
}

export default function Slack() {
  const [calls, setCalls]       = useState([])
  const [allScores, setAllScores] = useState([])
  const [rubric, setRubric]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [sending, setSending]   = useState(false)
  const [preview, setPreview]   = useState(null)
  const [copied, setCopied]     = useState(false)
  const [sendResult, setSendResult] = useState(null)

  // Filters
  const [search, setSearch]         = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [scoreFilter, setScoreFilter] = useState('all')
  const [sentFilter, setSentFilter]   = useState('all')
  const [dateFilter, setDateFilter]   = useState('all')

  // Config
  const [format, setFormat]               = useState('detailed')
  const [includeLink, setIncludeLink]     = useState(true)
  const [includeDuration, setIncludeDuration] = useState(true)
  const [headerText, setHeaderText]       = useState('')

  async function load() {
    setLoading(true)
    const [{ data: c }, s, { data: r }] = await Promise.all([
      supabase.from('calls').select('id, status, created_at, duration_seconds, drive_link, metadata').order('created_at', { ascending: false }),
      fetchAllScores(),
      supabase.from('rubrics').select('parameters').eq('is_active', true).limit(1),
    ])
    setCalls(c || [])
    setAllScores(s)
    if (r?.[0]) setRubric(r[0])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const scoreMap = useMemo(() => {
    const map = {}
    allScores.forEach(s => {
      if (!map[s.call_id]) map[s.call_id] = []
      map[s.call_id].push(s)
    })
    return map
  }, [allScores])

  const agents = useMemo(() =>
    [...new Set(calls.map(c => c.metadata?.agent_name).filter(Boolean))].sort()
  , [calls])

  function isSent(call) { return !!call.metadata?.slack_sent_at }

  const filtered = useMemo(() => {
    const now = new Date()
    return calls.filter(c => {
      if (search) {
        const q = search.toLowerCase()
        if (!( (c.metadata?.agent_name || '').toLowerCase().includes(q) ||
               (c.metadata?.filename   || '').toLowerCase().includes(q) )) return false
      }
      if (agentFilter !== 'all' && c.metadata?.agent_name !== agentFilter) return false
      if (scoreFilter !== 'all') {
        const pct = callPct(scoreMap[c.id])
        if (pct === null) return false
        if (scoreFilter === 'good'   && pct < 70)              return false
        if (scoreFilter === 'medium' && (pct < 50 || pct >= 70)) return false
        if (scoreFilter === 'poor'   && pct >= 50)             return false
      }
      if (sentFilter === 'sent'   && !isSent(c)) return false
      if (sentFilter === 'unsent' &&  isSent(c)) return false
      if (dateFilter !== 'all') {
        const d = new Date(c.created_at)
        if (dateFilter === 'today'      && d.toDateString() !== now.toDateString()) return false
        if (dateFilter === 'this_week'  && now - d > 7 * 86400000)                 return false
        if (dateFilter === 'this_month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false
      }
      return true
    })
  }, [calls, search, agentFilter, scoreFilter, sentFilter, dateFilter, scoreMap])

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll()  { setSelected(new Set(filtered.map(c => c.id))) }
  function clearAll()   { setSelected(new Set()) }

  const config = { format, includeLink, includeDuration, headerText }

  async function sendSelected() {
    const webhook = WEBHOOK
    if (!webhook) {
      setSendResult({ ok: false, msg: 'No webhook URL configured. Set VITE_SLACK_WEBHOOK in .env.local (local) or Netlify environment variables (production).' })
      return
    }
    const toSend = filtered.filter(c => selected.has(c.id))
    if (!toSend.length) return
    setSending(true)
    const now = new Date().toISOString()
    let ok = 0
    const errors = []
    for (const call of toSend) {
      const scores = scoreMap[call.id] || []
      const msg = buildMessage(call, scores, rubric, config)
      try {
        // Use Supabase Edge Function to bypass CORS
        const { data, error } = await supabase.functions.invoke('send-slack', {
          body: { text: msg, callId: call.id }
        })
        
        if (!error && data?.ok) {
          ok++
          const newMeta = { ...call.metadata, slack_sent_at: now }
          await supabase.from('calls').update({ metadata: newMeta }).eq('id', call.id)
          setCalls(prev => prev.map(c => c.id === call.id ? { ...c, metadata: newMeta } : c))
        } else {
          const detail = error?.message || data?.error || 'Unknown error'
          errors.push(detail)
          console.error('[Slack send] failed for call', call.id, detail)
        }
      } catch (e) {
        const detail = e?.message || String(e)
        errors.push(detail)
        console.error('[Slack send] fetch threw for call', call.id, e)
      }
    }
    setSending(false)
    setSelected(new Set())
    if (errors.length === 0) {
      setSendResult({ ok: true, msg: `✓ Sent ${ok} message${ok !== 1 ? 's' : ''} to Slack` })
      setTimeout(() => setSendResult(null), 5000)
    } else {
      setSendResult({ ok: false, msg: `Sent ${ok}, failed ${errors.length} — ${[...new Set(errors)].join(' · ')}` })
    }
  }

  const previewCall = preview
    ? calls.find(c => c.id === preview)
    : selected.size === 1
      ? calls.find(c => c.id === [...selected][0])
      : filtered[0] || null

  const previewMsg = previewCall
    ? buildMessage(previewCall, scoreMap[previewCall.id] || [], rubric, config)
    : null

  function copyPreview() {
    if (!previewMsg) return
    navigator.clipboard.writeText(previewMsg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Spinner text="Loading Slack…" />
    </div>
  )

  const sentCount   = calls.filter(isSent).length
  const scoredCount = calls.filter(c => (scoreMap[c.id] || []).length > 0).length

  return (
    <div className="min-h-full bg-slate-50/50 pb-24">
      {/* Toast */}
      {sendResult && (
        <div className={`fixed top-5 right-5 z-50 flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-bold shadow-xl max-w-sm
          ${sendResult.ok ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>
          {sendResult.ok && <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />}
          <span className="flex-1 leading-snug">{sendResult.msg}</span>
          <button onClick={() => setSendResult(null)} className="text-white/50 hover:text-white shrink-0 ml-1">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-slate-200/60 px-8 py-6 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Slack</h1>
            <p className="text-sm font-medium text-slate-400 mt-0.5">
              Send call summaries · {sentCount} sent · {scoredCount} scored · {calls.length} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
              <RefreshCw size={15} />
            </button>
            {selected.size > 0 && (
              <span className="text-xs font-bold text-violet-700 bg-violet-100 px-3 py-1.5 rounded-xl">
                {selected.size} selected
              </span>
            )}
            <button
              onClick={sendSelected}
              disabled={sending || selected.size === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-all"
            >
              <Send size={14} />
              {sending ? 'Sending…' : `Send${selected.size > 0 ? ` ${selected.size}` : ''} to Slack`}
            </button>
          </div>
        </div>
      </div>

      <div className="p-8 flex gap-6 max-w-7xl mx-auto items-start">

        {/* ── Left: filters + call list ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Filters */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/60 p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search agent or filename…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all"
                />
              </div>
              <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium text-slate-600 cursor-pointer">
                <option value="all">All agents</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium text-slate-600 cursor-pointer">
                <option value="all">All scores</option>
                <option value="good">Good (≥70%)</option>
                <option value="medium">Medium (50–69%)</option>
                <option value="poor">Poor (&lt;50%)</option>
              </select>
              <select value={sentFilter} onChange={e => setSentFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium text-slate-600 cursor-pointer">
                <option value="all">All</option>
                <option value="unsent">Not sent yet</option>
                <option value="sent">Already sent</option>
              </select>
              <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium text-slate-600 cursor-pointer">
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="this_week">This week</option>
                <option value="this_month">This month</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-400">{filtered.length} call{filtered.length !== 1 ? 's' : ''} visible</p>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors">Select all</button>
                <span className="text-slate-300">·</span>
                <button onClick={clearAll} className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Clear</button>
              </div>
            </div>
          </div>

          {/* Call list */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <div className="py-16 text-center">
                <MessageSquare size={28} className="mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-medium text-slate-400">No calls match your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filtered.map(call => {
                  const scores     = scoreMap[call.id] || []
                  const pct        = callPct(scores)
                  const isSelected = selected.has(call.id)
                  const sent       = isSent(call)
                  const agent      = call.metadata?.agent_name || 'Unknown'
                  const filename   = call.metadata?.filename   || `call-${call.id.slice(0, 8)}`

                  return (
                    <div
                      key={call.id}
                      onClick={() => toggleSelect(call.id)}
                      onMouseEnter={() => setPreview(call.id)}
                      className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-all group
                        ${isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50/70'}`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all
                        ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 group-hover:border-emerald-400'}`}>
                        {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-800">{agent}</span>
                          {sent && (
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                              ✓ sent {new Date(call.metadata.slack_sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-slate-400 truncate mt-0.5">{filename}</p>
                      </div>

                      {/* Right side */}
                      <div className="flex items-center gap-3 shrink-0">
                        {scores.length > 0 ? (
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-black ${pctBadge(pct)}`}>
                            {pct !== null ? `${pct}%` : '—'}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-300">no score</span>
                        )}
                        <span className="text-xs font-medium text-slate-400 tabular">
                          {new Date(call.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setPreview(call.id) }}
                          className="p-1.5 text-slate-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          title="Preview message"
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: config + preview ── */}
        <div className="w-[380px] shrink-0 space-y-4">

          {/* Config */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/60 p-5 shadow-sm space-y-5">
            <div className="flex items-center gap-2">
              <Settings2 size={14} className="text-slate-400" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Message Config</h3>
            </div>

            {/* Format toggle */}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Format</label>
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                {[{ id: 'detailed', label: 'Detailed' }, { id: 'compact', label: 'Compact' }].map(f => (
                  <button key={f.id} onClick={() => setFormat(f.id)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${format === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-medium text-slate-400 mt-1.5">
                {format === 'detailed' ? 'Full score breakdown per parameter' : 'Single-line summary with overall score'}
              </p>
            </div>

            {/* Toggles */}
            <div className="space-y-1">
              {[
                { label: 'Include drive link', value: includeLink,     set: setIncludeLink },
                { label: 'Include call duration', value: includeDuration, set: setIncludeDuration },
              ].map(({ label, value, set }) => (
                <button key={label} onClick={() => set(v => !v)}
                  className="flex items-center justify-between w-full py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <span className="text-sm font-medium text-slate-600">{label}</span>
                  <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${value ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${value ? 'left-4' : 'left-0.5'}`} />
                  </div>
                </button>
              ))}
            </div>

            {/* Custom header */}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Custom header <span className="normal-case font-medium">(optional)</span></label>
              <input
                type="text" value={headerText} onChange={e => setHeaderText(e.target.value)}
                placeholder="e.g. 📋 Weekly review batch"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all"
              />
            </div>

            {/* Webhook status */}
            {WEBHOOK
              ? <p className="text-[11px] font-medium text-emerald-600">✓ Webhook configured via environment</p>
              : <p className="text-[11px] font-medium text-amber-600">⚠ No webhook — set VITE_SLACK_WEBHOOK in environment</p>
            }
          </div>

          {/* Preview */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-slate-400" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Message Preview</h3>
              </div>
              {previewMsg && (
                <button onClick={copyPreview}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors">
                  {copied ? <><Check size={12} className="text-emerald-500" />Copied</> : <><Copy size={12} />Copy</>}
                </button>
              )}
            </div>
            {previewMsg ? (
              <>
                <div className="text-[12px] text-slate-600 bg-slate-50 rounded-xl p-4 border border-slate-100 overflow-auto max-h-[500px] shadow-inner space-y-0.5 font-sans leading-relaxed">
                  {previewMsg.split('\n').map((line, i) => (
                    <PreviewLine key={i} text={line} />
                  ))}
                </div>
                {previewCall && (
                  <p className="text-[11px] font-medium text-slate-400 mt-2 text-center">
                    {previewCall.metadata?.agent_name || 'Unknown'} ·{' '}
                    {new Date(previewCall.created_at).toLocaleDateString('en-AU', { dateStyle: 'medium' })}
                  </p>
                )}
              </>
            ) : (
              <div className="py-10 text-center">
                <MessageSquare size={24} className="mx-auto text-slate-200 mb-2" />
                <p className="text-xs font-medium text-slate-400">Hover a call to preview its message</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
