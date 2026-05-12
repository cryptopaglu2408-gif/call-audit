import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  ExternalLink, RefreshCw, Clock, Zap, CheckCircle2, XCircle,
  Send, Copy, Upload, FileAudio, AlertCircle, Trash2, Play, RotateCcw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { transcribeAudio, scoreTranscript, getFileDuration } from '../lib/gemini'
import Spinner from '../components/Spinner'

const DRIVE_URL    = 'https://drive.google.com/drive/folders/1qAA2I00k827z55_4P2LUNyijgG-1-PxZ'
const RAILWAY_URL  = 'https://railway.app/dashboard'
const SLACK_URL    = import.meta.env.VITE_SLACK_WEBHOOK || ''

const STAGES = [
  { icon: '🎙️', label: 'Bridge i2p',  sub: 'Records call' },
  { icon: '📁', label: 'Google Drive', sub: 'Auto-synced' },
  { icon: '🤖', label: 'Gemini 2.5',  sub: 'Transcribe + Score' },
  { icon: '🗄️', label: 'Supabase',    sub: 'Scores stored' },
  { icon: '💬', label: 'Slack',        sub: '> 3 min only' },
]

const FILE_STATUS_META = {
  pending:      { label: 'Pending',      color: 'text-slate-400',  bg: 'bg-slate-100' },
  transcribing: { label: 'Transcribing', color: 'text-violet-600', bg: 'bg-violet-50' },
  scoring:      { label: 'Scoring',      color: 'text-blue-600',   bg: 'bg-blue-50' },
  saving:       { label: 'Saving',       color: 'text-amber-600',  bg: 'bg-amber-50' },
  done:         { label: 'Done',         color: 'text-green-700',  bg: 'bg-green-50' },
  error:        { label: 'Error',        color: 'text-rose-600',   bg: 'bg-rose-50' },
}

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

function FileBadge({ status }) {
  const { label, color, bg } = FILE_STATUS_META[status] || FILE_STATUS_META.pending
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${color} ${bg}`}>{label}</span>
}

function buildDigestText({ thisWeek, lastWeek, bestParam, worstParam, flagged, processed }) {
  const weekLabel = (() => {
    const now   = new Date()
    const start = new Date(now); start.setDate(now.getDate() - 6)
    return `${start.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} – ${now.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`
  })()
  const avgStr   = processed?.avg  !== null ? `${processed.avg}%`     : '—'
  const prevStr  = processed?.prevAvg !== null ? `${processed.prevAvg}%` : null
  const delta    = processed?.avg !== null && processed?.prevAvg !== null ? processed.avg - processed.prevAvg : null
  const deltaStr = delta !== null ? ` (${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs last week)` : ''
  return `📊 *SuperSheldon Call Audit — Weekly Summary*
Week of ${weekLabel}

📞 *Calls Processed:* ${thisWeek}
⭐ *Avg Score:* ${avgStr}${deltaStr}

🏆 *Strongest Parameter:* ${bestParam ? `${bestParam.name} (${bestParam.score}%)` : '—'}
⚠️  *Weakest Parameter:* ${worstParam ? `${worstParam.name} (${worstParam.score}%)` : '—'}

🚨 *Flagged for Review (< 50%):* ${flagged} call${flagged !== 1 ? 's' : ''}

Pipeline: ✅ Active · Running every 30 min
_Sent from Call Audit Dashboard_`
}

// ─── Auto Pipeline Tab ──────────────────────────────────────────────────────
function AutoPipelineTab() {
  const [calls, setCalls]         = useState([])
  const [allScores, setAllScores] = useState([])
  const [loading, setLoading]     = useState(true)
  const [ts, setTs]               = useState(null)
  const [sending, setSending]     = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [copied, setCopied]       = useState(false)
  const [paused, setPaused]       = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: c }, { data: s }, { data: cfg }] = await Promise.all([
      supabase.from('calls').select('id, status, created_at, duration_seconds, metadata, drive_link').filter('metadata->>source', 'eq', 'auto-pipeline').order('created_at', { ascending: false }).limit(200),
      supabase.from('scores').select('call_id, parameter, score, max_score').limit(10000),
      supabase.from('settings').select('value').eq('key', 'pipeline').limit(1),
    ])
    setCalls(c || [])
    setAllScores(s || [])
    if (cfg?.[0]) setPaused(cfg[0].value?.paused ?? false)
    setTs(new Date())
    setLoading(false)
  }

  async function togglePause() {
    setPauseLoading(true)
    const next = !paused
    await supabase.from('settings').update({ value: { paused: next } }).eq('key', 'pipeline')
    setPaused(next)
    setPauseLoading(false)
  }

  useEffect(() => { load() }, [])

  const digest = useMemo(() => {
    const weekAgo     = new Date(Date.now() - 7  * 86400000)
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000)
    const scoreMap    = {}
    allScores.forEach(s => {
      if (!scoreMap[s.call_id]) scoreMap[s.call_id] = []
      scoreMap[s.call_id].push(s.score / s.max_score)
    })
    const thisWeekCalls = calls.filter(c => new Date(c.created_at) >= weekAgo)
    const lastWeekCalls = calls.filter(c => new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < weekAgo)
    const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100) : null
    const thisWeekPcts = thisWeekCalls.map(c => scoreMap[c.id]).filter(Boolean).map(a => a.reduce((x,y)=>x+y,0)/a.length)
    const lastWeekPcts = lastWeekCalls.map(c => scoreMap[c.id]).filter(Boolean).map(a => a.reduce((x,y)=>x+y,0)/a.length)
    const paramMap = {}
    allScores.filter(s => thisWeekCalls.some(c=>c.id===s.call_id)).forEach(s => {
      if (!paramMap[s.parameter]) paramMap[s.parameter] = []
      paramMap[s.parameter].push(s.score / s.max_score)
    })
    const params    = Object.entries(paramMap).map(([name, arr]) => ({ name, score: Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100) }))
    const bestParam  = params.length ? params.reduce((a,b) => a.score > b.score ? a : b) : null
    const worstParam = params.length ? params.reduce((a,b) => a.score < b.score ? a : b) : null
    const flagged    = thisWeekCalls.filter(c => {
      const pcts = scoreMap[c.id]
      return pcts && pcts.reduce((a,b)=>a+b,0)/pcts.length*100 < 50
    }).length
    return { thisWeek: thisWeekCalls.length, lastWeek: lastWeekCalls.length, bestParam, worstParam, flagged, processed: { avg: avg(thisWeekPcts), prevAvg: avg(lastWeekPcts) } }
  }, [calls, allScores])

  const digestText = useMemo(() => buildDigestText(digest), [digest])

  async function sendDigest() {
    if (!SLACK_URL) { setSendResult({ ok: false, msg: 'Slack webhook not configured. Add VITE_SLACK_WEBHOOK to .env.local.' }); return }
    setSending(true)
    try {
      const res = await fetch(SLACK_URL, { method: 'POST', body: JSON.stringify({ text: digestText }), headers: { 'Content-Type': 'application/json' } })
      setSendResult({ ok: res.ok, msg: res.ok ? 'Digest sent to Slack!' : `Failed: ${res.statusText}` })
    } catch (e) {
      setSendResult({ ok: false, msg: `Error: ${e.message}` })
    }
    setSending(false)
    setTimeout(() => setSendResult(null), 5000)
  }

  function copyDigest() {
    navigator.clipboard.writeText(digestText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const total     = calls.length
  const succeeded = calls.filter(c => c.status === 'done' || c.status === 'transcribed').length
  const failed    = calls.filter(c => c.status === 'error').length
  const lastRun   = calls[0]?.created_at

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={`bg-gradient-to-r ${paused ? 'from-slate-500 to-slate-700' : 'from-emerald-500 to-teal-600'} rounded-2xl p-6 text-white flex items-center justify-between shadow-lg transition-all duration-500`}>
        <div className="flex items-center gap-4">
          <div className={`w-3 h-3 rounded-full bg-white ${paused ? '' : 'animate-pulse'}`} />
          <div>
            <p className="font-black text-base tracking-tight">{paused ? 'Pipeline Paused' : 'Pipeline Active'}</p>
            <p className={`${paused ? 'text-slate-300' : 'text-emerald-50'} text-xs mt-0.5 font-medium`}>
              {paused ? 'No new calls will be processed until resumed' : lastRun ? `Last processed: ${new Date(lastRun).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'})}` : 'No calls processed yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2">
            <Clock size={14} className="text-white" />
            <span className="text-sm font-bold">Every 30 min</span>
          </div>
          <button
            onClick={togglePause}
            disabled={pauseLoading}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-50 ${
              paused
                ? 'bg-emerald-400 hover:bg-emerald-300 text-emerald-900'
                : 'bg-white/20 hover:bg-white/30 text-white border border-white/30'
            }`}
          >
            {pauseLoading ? '…' : paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label:'Auto-Processed', value:total,     sub:'via Bridge i2p',                                Icon:Zap,          color:'text-violet-600', bg:'bg-violet-50' },
          { label:'Succeeded',      value:succeeded, sub:total?`${Math.round(succeeded/total*100)}% success rate`:'—', Icon:CheckCircle2, color:'text-emerald-600', bg:'bg-emerald-50' },
          { label:'Failed',         value:failed,    sub:failed?'Check GCP logs':'No errors',             Icon:XCircle,      color:'text-rose-500',  bg:'bg-rose-50' },
        ].map(({ label, value, sub, Icon, color, bg }) => (
          <div key={label} className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6 hover:shadow-md transition-all duration-300">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4 shadow-sm`}><Icon size={18} className={color} /></div>
            <p className="text-3xl font-black text-slate-900 tabular tracking-tight">{value}</p>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">{label}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { href:DRIVE_URL,   emoji:'📁', label:'Drive Folder',   sub:'Bridge i2p uploads here automatically', hover:'hover:border-blue-200 hover:bg-blue-50/50',   icon:'text-blue-400 group-hover:text-blue-600' },
          { href:RAILWAY_URL, emoji:'🚄', label:'Railway Dashboard', sub:'pipeline cron · every 30 min',    hover:'hover:border-violet-200 hover:bg-violet-50/50', icon:'text-violet-400 group-hover:text-violet-600' },
        ].map(({ href, emoji, label, sub, hover, icon }) => (
          <a key={label} href={href} target="_blank" rel="noreferrer"
            className={`group bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-5 flex items-center gap-4 transition-all duration-300 ${hover}`}>
            <span className="text-3xl">{emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800">{label}</p>
              <p className="text-xs font-medium text-slate-500 truncate mt-0.5">{sub}</p>
            </div>
            <ExternalLink size={16} className={`shrink-0 ${icon} transition-colors`} />
          </a>
        ))}
      </div>

      {/* Weekly Digest */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Weekly Digest</h2>
            <p className="text-xs font-medium text-slate-500 mt-0.5">Summary of this week's call performance</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyDigest}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-xl transition-colors">
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={sendDigest} disabled={sending}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 px-4 py-2 rounded-xl shadow-sm transition-all">
              <Send size={14} /> {sending ? 'Sending…' : 'Send to Slack'}
            </button>
          </div>
        </div>
        {sendResult && (
          <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold ${sendResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
            {sendResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {sendResult.msg}
          </div>
        )}
        {!SLACK_URL && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 font-medium">
            <strong>Slack not connected.</strong> Add <code className="bg-amber-100 px-1 rounded mx-0.5">VITE_SLACK_WEBHOOK</code> to <code className="bg-amber-100 px-1 rounded mx-0.5">frontend/.env.local</code> and restart.
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label:'This week', value: digest.thisWeek, sub:'calls processed' },
            { label:'Avg score', value: digest.processed.avg !== null ? `${digest.processed.avg}%` : '—', sub: digest.processed.prevAvg !== null ? `was ${digest.processed.prevAvg}% last week` : 'last week: no data' },
            { label:'Strongest', value: digest.bestParam?.score !== undefined ? `${digest.bestParam.score}%` : '—', sub: digest.bestParam?.name || '—' },
            { label:'Weakest',   value: digest.worstParam?.score !== undefined ? `${digest.worstParam.score}%` : '—', sub: digest.worstParam?.name || '—' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-black text-slate-900 tabular mt-1">{value}</p>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">{sub}</p>
            </div>
          ))}
        </div>
        <div className="bg-slate-900 rounded-xl p-5 shadow-inner">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Preview</p>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{digestText}</pre>
        </div>
      </div>

      {/* Pipeline stages */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-6">Pipeline Flow</h2>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
          {STAGES.map((s, i) => (
            <div key={s.label} className="flex flex-col md:flex-row items-center gap-2 flex-1 min-w-0 w-full md:w-auto">
              <div className="flex flex-col items-center text-center flex-1 min-w-0 bg-slate-50/50 rounded-xl p-4 border border-slate-100 w-full md:w-auto">
                <div className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-2xl mb-2 shadow-sm">{s.icon}</div>
                <p className="text-xs font-bold text-slate-700">{s.label}</p>
                <p className="text-[10px] font-medium text-slate-500 mt-0.5">{s.sub}</p>
              </div>
              {i < STAGES.length - 1 && (
                <div className="text-slate-300 text-lg font-bold shrink-0 hidden md:block">→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent calls */}
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-sm border border-slate-200/60 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Auto-Processed Calls</h2>
            <p className="text-xs font-medium text-slate-500 mt-0.5">Latest calls handled by the background worker</p>
          </div>
          <div className="flex items-center gap-3">
            {ts && <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400"><Clock size={12}/> {ts.toLocaleTimeString('en-AU')}</span>}
            <button onClick={load} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-xl transition-colors">
              <RefreshCw size={12}/> Refresh
            </button>
          </div>
        </div>
        {loading ? <Spinner text="Loading pipeline calls…" /> : calls.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📭</div>
            <p className="text-sm font-bold text-slate-600">No pipeline calls yet</p>
            <p className="text-xs font-medium text-slate-500 mt-1">Once Bridge i2p uploads files to Drive, they'll appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 border-b border-slate-100">File</th>
                  <th className="pb-3 border-b border-slate-100">Status</th>
                  <th className="pb-3 border-b border-slate-100">Duration</th>
                  <th className="pb-3 border-b border-slate-100">Processed at</th>
                  <th className="pb-3 border-b border-slate-100">Drive</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(c=>(
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 pr-4 text-slate-700 font-bold max-w-[200px] truncate">{c.metadata?.filename||`call-${c.id.slice(0,8)}`}</td>
                    <td className="py-3.5 pr-4"><StatusBadge status={c.status}/></td>
                    <td className="py-3.5 pr-4 text-slate-500 font-medium tabular text-xs">{c.duration_seconds?`${(c.duration_seconds/60).toFixed(1)} min`:'—'}</td>
                    <td className="py-3.5 pr-4 text-slate-500 font-medium text-xs">{new Date(c.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
                    <td className="py-3.5">{c.drive_link?<a href={c.drive_link} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 transition-colors"><ExternalLink size={14}/></a>:<span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Slack call notification ─────────────────────────────────────────────────
const DEMO_LEVELS_SLACK = ['Not attempted', 'Mentioned, declined', 'Callback booked', 'Demo confirmed']

async function uploadAudioToSlack(file) {
  const botToken  = import.meta.env.VITE_SLACK_BOT_TOKEN
  const channelId = import.meta.env.VITE_SLACK_CHANNEL_ID
  if (!botToken || !channelId) return null
  try {
    // Step 1: get upload URL
    const r1 = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, length: file.size }),
    })
    const d1 = await r1.json()
    if (!d1.ok) { console.warn('Slack upload URL error:', d1.error); return null }

    // Step 2: upload raw bytes
    const r2 = await fetch(d1.upload_url, { method: 'POST', body: file })
    if (!r2.ok) { console.warn('Slack file PUT failed:', r2.status); return null }

    // Step 3: complete upload → posts to channel
    const r3 = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ id: d1.file_id, title: file.name }], channel_id: channelId }),
    })
    const d3 = await r3.json()
    if (!d3.ok) { console.warn('Slack complete error:', d3.error); return null }
    return d3.file?.permalink || null
  } catch (e) {
    console.warn('Slack audio upload failed:', e)
    return null
  }
}

async function sendCallToSlack(file, enrichedScores, rubricParams, agentName, durationSeconds, overallPct) {
  if (!SLACK_URL) return
  if (!durationSeconds || durationSeconds <= 180) return  // only for calls > 3 min

  const rubricOrder = Object.fromEntries(rubricParams.map((p, i) => [p.name, i]))
  const typeByName  = Object.fromEntries(rubricParams.map(p => [p.name, p.type || 'numeric']))
  const sorted      = [...enrichedScores].sort((a, b) => (rubricOrder[a.parameter] ?? 999) - (rubricOrder[b.parameter] ?? 999))

  const zoneEmoji = overallPct >= 81 ? '🟢' : overallPct >= 51 ? '🟡' : '🔴'
  const durStr    = `${(durationSeconds / 60).toFixed(1)} min`
  const total     = sorted.reduce((a, s) => a + s.score, 0)
  const maxTotal  = sorted.reduce((a, s) => a + s.max_score, 0)

  const header = [
    `${zoneEmoji} *Call Audit — ${file.name}*`,
    `:bust_in_silhouette:  Agent: *${agentName || 'Unknown'}*   :stopwatch:  Duration: *${durStr}*   :bar_chart:  Overall: *${overallPct}%*  (${total}/${maxTotal})`,
    '',
  ]

  const paramLines = sorted.flatMap(s => {
    const ptype = typeByName[s.parameter] || 'numeric'
    let val
    if (ptype === 'yes_no' || s.max_score === 2) {
      val = s.score === s.max_score ? 'Yes  :white_check_mark:' : 'No  :x:'
    } else if (ptype === 'categorical' || s.max_score === 3) {
      const label = DEMO_LEVELS_SLACK[Math.min(s.score, 3)]
      val = `${label}  \`${s.score}/${s.max_score}\``
    } else {
      const filled = '█'.repeat(s.score)
      const empty  = '░'.repeat(s.max_score - s.score)
      val = `${s.score}/${s.max_score}  ${filled}${empty}`
    }
    const lines = [`*${s.parameter}*: ${val}`]
    if (s.reasoning) lines.push(`  _${s.reasoning}_`)
    return lines
  })

  // Try uploading audio file to Slack, include link if successful
  const permalink = await uploadAudioToSlack(file)
  const footer    = permalink ? ['', `:paperclip: *Recording:* ${permalink}`] : []

  const text = [...header, ...paramLines, ...footer].join('\n')
  await fetch(SLACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(e => console.warn('Slack message failed:', e))
}

// ─── Manual Upload Tab ───────────────────────────────────────────────────────
const AUDIO_ACCEPT = '.mp3,.mp4,.m4a,.wav,.ogg,.webm,.aac,.flac,.mpeg'

const VERDICT_THRESHOLD = 60

function ManualUploadTab() {
  const [files, setFiles]       = useState([])   // { id, file, status, error, callId, scores, overallPct }
  const [processing, setProc]   = useState(false)
  const [rubric, setRubric]     = useState(null)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(new Set())
  const inputRef                = useRef()

  useEffect(() => {
    if (!import.meta.env.VITE_GEMINI_API_KEY) setApiKeyMissing(true)
    supabase.from('rubrics').select('id, name, parameters').eq('is_active', true).limit(1)
      .then(({ data }) => { if (data?.[0]) setRubric(data[0]) })
  }, [])

  function addFiles(newFiles) {
    const items = Array.from(newFiles).map(f => ({
      id: crypto.randomUUID(), file: f, status: 'pending',
      error: null, callId: null, scores: null, overallPct: null,
      // cached intermediate results — survive retries so we skip completed stages
      transcript: null, durationSeconds: null, agentName: null, enrichedScores: null,
    }))
    setFiles(prev => [...prev, ...items])
  }

  function retryFile(id) {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, status: 'pending', error: null } : f
    ))
  }

  function retryAll() {
    setFiles(prev => prev.map(f =>
      f.status === 'error' ? { ...f, status: 'pending', error: null } : f
    ))
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  function clearDone() {
    setFiles(prev => prev.filter(f => f.status !== 'done'))
    setExpanded(new Set())
  }

  function updateFile(id, patch) {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [])

  const onDragOver  = useCallback(e => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])

  async function processAll() {
    if (!rubric) return
    const pending = files.filter(f => f.status === 'pending')
    if (!pending.length) return
    setProc(true)

    for (const item of pending) {
      // ── Stage 1: duration (always cheap, re-run) ──────────────────────────
      const durationSeconds = item.durationSeconds ?? await getFileDuration(item.file)
      if (item.durationSeconds == null) updateFile(item.id, { durationSeconds })

      // ── Stage 2: transcription (skip if cached from a previous attempt) ───
      let transcript = item.transcript
      if (!transcript) {
        updateFile(item.id, { status: 'transcribing' })
        try {
          transcript = await transcribeAudio(item.file)
          updateFile(item.id, { transcript })   // cache so retries skip this stage
        } catch (err) {
          updateFile(item.id, { status: 'error', error: `Transcription failed: ${err.message}` })
          continue
        }
      } else {
        updateFile(item.id, { status: 'scoring' })   // show progress even when skipping
      }

      // ── Stage 3: scoring (skip if cached) ────────────────────────────────
      let enrichedScores = item.enrichedScores
      let agentName      = item.agentName
      if (!enrichedScores) {
        updateFile(item.id, { status: 'scoring' })
        let rawScores
        try {
          const result = await scoreTranscript(transcript, rubric.parameters, { durationSeconds })
          rawScores = result.scores
          agentName = result.agentName
        } catch (err) {
          updateFile(item.id, { status: 'error', error: `Scoring failed: ${err.message}` })
          continue
        }

        const scoredNames   = new Set(rawScores.map(s => s.parameter))
        const missingScores = rubric.parameters
          .filter(p => !scoredNames.has(p.name))
          .map(p => ({ parameter: p.name, score: 0, reasoning: '', max_score: p.max_score }))
        const rubricOrder   = Object.fromEntries(rubric.parameters.map((p, i) => [p.name, i]))
        enrichedScores = [...rawScores.map(s => ({
          ...s,
          max_score: rubric.parameters.find(p => p.name === s.parameter)?.max_score ?? 10,
        })), ...missingScores].sort((a, b) => (rubricOrder[a.parameter] ?? 999) - (rubricOrder[b.parameter] ?? 999))

        updateFile(item.id, { enrichedScores, agentName })  // cache so retries skip this stage
      } else {
        updateFile(item.id, { status: 'saving' })
      }

      const overallPct = enrichedScores.length
        ? Math.round(enrichedScores.reduce((a, s) => a + s.score / s.max_score, 0) / enrichedScores.length * 100)
        : null

      // ── Stage 4: save to Supabase ─────────────────────────────────────────
      updateFile(item.id, { status: 'saving' })
      try {
        const { data: callRow, error: callErr } = await supabase.from('calls').insert({
          transcript,
          status:   'transcribed',
          metadata: { filename: item.file.name, source: 'manual-upload', ...(agentName ? { agent_name: agentName } : {}) },
          source_row: 0,
          ...(durationSeconds != null ? { duration_seconds: Math.round(durationSeconds) } : {}),
        }).select('id').single()
        if (callErr) throw callErr
        const callId = callRow.id

        const scoreRows = enrichedScores.map(s => ({
          call_id:   callId,
          rubric_id: rubric.id,
          parameter: s.parameter,
          score:     s.score,
          max_score: s.max_score,
          reasoning: s.reasoning || '',
        }))
        const { error: scoresErr } = await supabase.from('scores').insert(scoreRows)
        if (scoresErr) throw scoresErr

        await supabase.from('calls').update({ status: 'done' }).eq('id', callId)
        updateFile(item.id, { status: 'done', callId, scores: enrichedScores, overallPct })
        setExpanded(prev => new Set(prev).add(item.id))

        sendCallToSlack(item.file, enrichedScores, rubric.parameters, agentName, durationSeconds, overallPct)
          .catch(e => console.warn('Slack notification failed:', e))
      } catch (err) {
        updateFile(item.id, { status: 'error', error: `Save failed: ${err.message}` })
      }
    }

    setProc(false)
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const doneCount    = files.filter(f => f.status === 'done').length
  const errorCount   = files.filter(f => f.status === 'error').length
  const activeCount  = files.filter(f => ['transcribing','scoring','saving'].includes(f.status)).length

  return (
    <div className="space-y-4">
      {apiKeyMissing && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <div>
            <p className="font-bold">Gemini API key not set</p>
            <p className="mt-1 text-xs">Add <code className="bg-amber-100 px-1 rounded">VITE_GEMINI_API_KEY=your_key</code> to <code className="bg-amber-100 px-1 rounded">frontend/.env.local</code> and restart. Get a free key at <strong>aistudio.google.com</strong>.</p>
          </div>
        </div>
      )}

      {rubric && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2 text-xs text-emerald-700 font-bold w-fit">
          <CheckCircle2 size={13} />
          <span>Active rubric: <strong>{rubric.name}</strong> · {rubric.parameters.length} parameters · Threshold: {VERDICT_THRESHOLD}%</span>
        </div>
      )}

      {/* Compact drop zone */}
      <div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`relative bg-white rounded-xl border-2 border-dashed transition-all cursor-pointer ${dragging ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'}`}
      >
        <input ref={inputRef} type="file" multiple accept={AUDIO_ACCEPT} className="hidden"
          onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        <div className="flex items-center gap-4 px-5 py-4 select-none">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${dragging ? 'bg-violet-100' : 'bg-slate-100'}`}>
            <Upload size={18} className={dragging ? 'text-violet-500' : 'text-slate-400'} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">{dragging ? 'Drop files here' : 'Drag & drop audio files'}</p>
            <p className="text-xs text-slate-400 mt-0.5">or click to browse · MP3, M4A, WAV, AAC, FLAC and more</p>
          </div>
          {files.length > 0 && pendingCount > 0 && (
            <button
              onClick={e => { e.stopPropagation(); processAll() }}
              disabled={processing || !rubric || apiKeyMissing}
              className="ml-auto flex items-center gap-1.5 text-xs font-bold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 px-4 py-2 rounded-xl shadow-sm transition-all shrink-0"
            >
              <Play size={12}/> {processing ? 'Processing…' : `Process ${pendingCount}`}
            </button>
          )}
        </div>
      </div>

      {/* File list with results */}
      {files.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{files.length} file{files.length !== 1 ? 's' : ''}</span>
              {doneCount  > 0 && <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold">{doneCount} done</span>}
              {errorCount > 0 && <span className="text-[11px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full font-bold">{errorCount} failed</span>}
              {activeCount > 0 && <span className="text-[11px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full font-bold animate-pulse">Processing…</span>}
            </div>
            <div className="flex items-center gap-2">
              {errorCount > 0 && !processing && (
                <button onClick={retryAll}
                  className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors">
                  <RotateCcw size={11}/> Retry all failed
                </button>
              )}
              {doneCount > 0 && (
                <button onClick={clearDone} className="text-xs font-medium text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
                  <Trash2 size={11}/> Clear done
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-50">
            {files.map(item => {
              const isApproved = item.overallPct !== null && item.overallPct >= VERDICT_THRESHOLD
              const isExpanded = expanded.has(item.id)

              return (
                <div key={item.id}>
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    {/* Icon */}
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.status === 'done' ? (isApproved ? 'bg-emerald-50' : 'bg-rose-50') : item.status === 'error' ? 'bg-rose-50' : 'bg-slate-100'}`}>
                      {item.status === 'done'
                        ? isApproved
                          ? <CheckCircle2 size={15} className="text-emerald-500" />
                          : <XCircle size={15} className="text-rose-400" />
                        : item.status === 'error'
                        ? <XCircle size={15} className="text-rose-400" />
                        : <FileAudio size={15} className="text-slate-400" />
                      }
                    </div>

                    {/* Name + size */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{item.file.name}</p>
                      {item.error
                        ? <p className="text-[11px] text-rose-500 mt-0.5 truncate">{item.error}</p>
                        : <p className="text-[11px] text-slate-400 mt-0.5">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
                      }
                    </div>

                    {/* Done: verdict + score + expand toggle */}
                    {item.status === 'done' && item.overallPct !== null ? (
                      <>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold animate-pop-in ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                          {isApproved ? '✓ Approved' : '✕ Rejected'}
                        </span>
                        <span className={`text-sm font-black tabular animate-pop-in ${isApproved ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {item.overallPct}%
                        </span>
                        <button
                          onClick={() => toggleExpand(item.id)}
                          className="text-xs font-medium text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
                        >
                          {isExpanded ? '▲ Hide' : '▼ Scores'}
                        </button>
                      </>
                    ) : item.status === 'error' ? (
                      <button
                        onClick={() => retryFile(item.id)}
                        className="flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-500 border border-rose-200 hover:border-rose-500 px-3 py-1.5 rounded-lg transition-all shrink-0"
                        title={item.transcript ? (item.enrichedScores ? 'Retry saving to Supabase' : 'Retry scoring (transcript cached)') : 'Retry from scratch'}
                      >
                        <RotateCcw size={11}/> Retry
                      </button>
                    ) : item.status === 'pending' ? (
                      <button onClick={() => removeFile(item.id)} className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-colors">
                        <Trash2 size={13} />
                      </button>
                    ) : (
                      <FileBadge status={item.status} />
                    )}
                  </div>

                  {/* Expanded scores */}
                  {item.status === 'done' && isExpanded && item.scores && (
                    <div className="px-5 pb-4 pt-1 space-y-2 bg-slate-50/50">
                      {item.scores.map(s => {
                        const pct     = Math.round(s.score / s.max_score * 100)
                        const isYesNo = s.max_score === 2
                        const isCat   = s.max_score === 3
                        const isYes   = s.score === s.max_score
                        const DEMO_LEVELS = [
                          { label: 'Not attempted',     color: 'bg-slate-100 text-slate-500' },
                          { label: 'Mentioned, declined', color: 'bg-rose-50 text-rose-500' },
                          { label: 'Callback booked',   color: 'bg-amber-50 text-amber-600' },
                          { label: 'Demo confirmed',    color: 'bg-emerald-50 text-emerald-700' },
                        ]
                        const catLevel = DEMO_LEVELS[Math.min(s.score, 3)]
                        return (
                          <div key={s.parameter} className="flex items-center gap-3">
                            <span className="text-[11px] font-medium text-slate-600 w-44 shrink-0 truncate">{s.parameter}</span>
                            {isYesNo ? (
                              <span className={`px-3 py-1 rounded-lg text-xs font-bold ${isYes ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-50 text-rose-500'}`}>
                                {isYes ? 'Yes' : 'No'}
                              </span>
                            ) : isCat ? (
                              <div className="flex items-center gap-2">
                                <span className={`px-3 py-1 rounded-lg text-xs font-bold ${catLevel.color}`}>
                                  {catLevel.label}
                                </span>
                                <span className="text-xs text-slate-300">{s.score}/{s.max_score}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[11px] font-bold text-slate-500 tabular w-10 text-right">{s.score}/{s.max_score}</span>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Process button when files exist but button not shown in drop zone */}
      {files.length > 0 && pendingCount > 0 && !processing && (
        <button
          onClick={processAll}
          disabled={!rubric || apiKeyMissing}
          className="w-full flex items-center justify-center gap-2 text-sm font-bold text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 py-3 rounded-xl shadow-sm transition-all"
        >
          <Play size={14}/> Process {pendingCount} file{pendingCount !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────
export default function Pipeline() {
  const [tab, setTab] = useState('auto')

  return (
    <div className="min-h-full bg-slate-50/50">
      <div className="bg-white/90 backdrop-blur-sm border-b border-slate-200/60 px-8 py-6 sticky top-0 z-10">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Pipeline</h1>
            <p className="text-sm font-medium text-slate-400 mt-0.5">Automated call processing · every 30 minutes</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl w-fit border border-slate-200/60">
          {[
            { id:'auto',   label:'Auto Pipeline' },
            { id:'manual', label:'Manual Upload'  },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8 max-w-5xl mx-auto">
        {tab === 'auto' ? <AutoPipelineTab /> : <ManualUploadTab />}
      </div>
    </div>
  )
}
