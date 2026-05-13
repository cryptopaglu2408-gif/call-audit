import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  ExternalLink, RefreshCw, Clock, Zap, CheckCircle2, XCircle,
  Send, Copy, Upload, FileAudio, Trash2, Play, RotateCcw,
} from 'lucide-react'
import { supabase, fetchAllScores } from '../lib/supabase'
import { getFileDuration, getMimeType } from '../lib/gemini'
import Spinner from '../components/Spinner'
import PlayCallButton from '../components/PlayCallButton'

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
    const [{ data: c }, s, { data: cfg }] = await Promise.all([
      supabase.from('calls').select('id, status, created_at, duration_seconds, metadata, drive_link').filter('metadata->>source', 'eq', 'auto-pipeline').order('created_at', { ascending: false }).limit(200),
      fetchAllScores(),
      supabase.from('settings').select('value').eq('key', 'pipeline').limit(1),
    ])
    setCalls(c || [])
    setAllScores(s)
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

  const successRate = total ? Math.round(succeeded / total * 100) : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
      <style>{`
        .bg-card {
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          border-radius: 32px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
        }
        .text-accent {
          color: #ff7b54;
        }
        .bg-accent {
          background-color: #ff7b54;
        }
      `}</style>

      {/* Top Left: Pipeline Control (Visa Card style) */}
      <div className="bg-card p-6 col-span-1 md:col-span-2 flex flex-col justify-between h-[200px]">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-gray-400 text-xs uppercase tracking-wider">Pipeline Status</h3>
            <p className="text-sm font-medium text-gray-500 mt-1">Background worker active</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${paused ? 'bg-gray-100 text-gray-500' : 'bg-orange-50 text-[#ff7b54]'}`}>
            {paused ? 'Paused' : 'Running'}
          </span>
        </div>
        
        <div className="flex items-center justify-between mt-auto">
          <div>
            <p className="text-3xl font-black text-gray-900">
              {paused ? 'Hold' : 'Active'}
            </p>
            <p className="text-xs font-medium text-gray-400 mt-0.5">
              {lastRun ? `Last run: ${new Date(lastRun).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit'})}` : 'No runs yet'}
            </p>
          </div>
          <button
            onClick={togglePause}
            disabled={pauseLoading}
            className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all ${
              paused
                ? 'bg-black text-white hover:bg-gray-800'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {pauseLoading ? '…' : paused ? 'Enable' : 'Pause'}
          </button>
        </div>
      </div>

      {/* Top Right: Success Rate (36% Circle style) */}
      <div className="bg-card p-6 col-span-1 flex flex-col items-center justify-center h-[200px]">
        <div className="relative w-28 h-28">
          {/* Black background circle */}
          <div className="absolute inset-0 rounded-full bg-[#111] border-4 border-[#222]" />
          {/* SVG for progress */}
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              className="text-[#ff7b54] stroke-current"
              strokeWidth="6"
              strokeLinecap="round"
              fill="transparent"
              r="40"
              cx="50"
              cy="50"
              style={{
                strokeDasharray: 251.2,
                strokeDashoffset: 251.2 - (251.2 * successRate) / 100,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <span className="text-2xl font-black">{successRate}%</span>
            <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Success</span>
          </div>
        </div>
      </div>

      {/* Middle Left: Auto-Processed (Total Income style) */}
      <div className="bg-card p-6 flex flex-col justify-between h-[160px]">
        <div className="flex justify-between items-start">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <Zap size={14} className="text-gray-600" />
          </div>
          <span className="text-xs font-bold text-gray-400">Total</span>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-400">Calls Processed</p>
          <p className="text-3xl font-black text-gray-900 mt-1">
            {total}
          </p>
          <div className="flex gap-3 mt-2 text-xs font-bold">
            <span className="text-emerald-600">{succeeded} Succeeded</span>
            <span className="text-rose-500">{failed} Failed</span>
          </div>
        </div>
      </div>

      {/* Middle Center: Weekly Digest (Main Stocks style) */}
      <div className="bg-card p-6 col-span-1 md:col-span-2 flex flex-col space-y-6 min-h-[200px]">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-gray-400 text-xs uppercase tracking-wider">Weekly Digest</h3>
            <p className="text-xs font-medium text-gray-500 mt-0.5">Average Score & Trend</p>
          </div>
          <div className="flex gap-2">
            <button onClick={copyDigest} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <Copy size={14} />
            </button>
            <button onClick={sendDigest} disabled={sending} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <Send size={14} />
            </button>
          </div>
        </div>
        
        <div className="flex items-end justify-between">
          <div>
            <p className="text-4xl font-black text-gray-900">
              {digest.processed.avg !== null ? `${digest.processed.avg}%` : '—'}
            </p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">
              vs {digest.processed.prevAvg !== null ? `${digest.processed.prevAvg}%` : 'no data'} last week
            </p>
          </div>
          {digest.processed.avg !== null && digest.processed.prevAvg !== null && (
            <div className={`px-2.5 py-1 rounded-full text-xs font-bold ${digest.processed.avg >= digest.processed.prevAvg ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
              {digest.processed.avg >= digest.processed.prevAvg ? '+' : ''}
              {digest.processed.avg - digest.processed.prevAvg}%
            </div>
          )}
        </div>

        {/* Added back missing details */}
        <div className="grid grid-cols-3 gap-2 mt-auto pt-4 border-t border-gray-100">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase">This Week</p>
            <p className="text-sm font-black text-gray-900">{digest.thisWeek}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase">Strongest</p>
            <p className="text-xs font-bold text-gray-700 truncate">{digest.bestParam?.name || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase">Weakest</p>
            <p className="text-xs font-bold text-gray-700 truncate">{digest.worstParam?.name || '—'}</p>
          </div>
        </div>
      </div>

      {/* Pipeline Flow (Annual Profits style but horizontal) */}
      <div className="bg-card p-6 col-span-1 md:col-span-3">
        <h3 className="font-bold text-gray-400 text-xs uppercase tracking-wider mb-4">Pipeline Flow</h3>
        <div className="flex items-center justify-between gap-4">
          {STAGES.map((s, i) => (
            <div key={s.label} className="flex-1 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-2xl mb-2 shadow-sm border border-white">
                {s.icon}
              </div>
              <p className="text-xs font-bold text-gray-700">{s.label}</p>
              <p className="text-[10px] font-medium text-gray-400 mt-0.5">{s.sub}</p>
              {i < STAGES.length - 1 && (
                <div className="text-gray-300 text-sm font-bold mt-2 hidden md:block">→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Calls (Activity Manager style) */}
      <div className="bg-card p-6 col-span-1 md:col-span-3">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase">Processed Calls</h2>
            <p className="text-xs font-medium text-gray-400 mt-0.5">Latest results</p>
          </div>
          <div className="flex items-center gap-3">
            {ts && <span className="text-xs font-medium text-gray-400">{ts.toLocaleTimeString('en-AU')}</span>}
            <button onClick={load} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <RefreshCw size={14}/>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-8"><Spinner text="Loading calls…" /></div>
        ) : calls.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No calls processed yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <th className="pb-3 border-b border-gray-100">File</th>
                  <th className="pb-3 border-b border-gray-100">Status</th>
                  <th className="pb-3 border-b border-gray-100">Duration</th>
                  <th className="pb-3 border-b border-gray-100">Processed at</th>
                  <th className="pb-3 border-b border-gray-100">Drive</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 pr-4 text-gray-700 font-bold max-w-[200px] truncate">
                      {c.metadata?.filename || `call-${c.id.slice(0, 8)}`}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-3 pr-4 text-gray-500 font-medium tabular text-xs">
                      {c.duration_seconds ? `${(c.duration_seconds / 60).toFixed(1)}m` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-gray-500 font-medium text-xs">
                      {new Date(c.created_at).toLocaleString('en-AU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                    </td>
                    <td className="py-3">
                      {c.drive_link ? (
                        <a href={c.drive_link} target="_blank" rel="noreferrer" className="text-[#ff7b54] hover:text-[#e66a46] transition-colors">
                          <ExternalLink size={14} />
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
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
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(new Set())
  const inputRef                = useRef()

  useEffect(() => {
    supabase.from('rubrics').select('id, name, parameters').eq('is_active', true).limit(1)
      .then(({ data }) => { if (data?.[0]) setRubric(data[0]) })
  }, [])

  function addFiles(newFiles) {
    const items = Array.from(newFiles).map(f => ({
      id: crypto.randomUUID(), file: f, status: 'pending',
      error: null, callId: null, scores: null, overallPct: null,
      // cached intermediate results — survive retries so we skip completed stages
      transcript: null, durationSeconds: null, agentName: null, enrichedScores: null,
      storagePath: null,  // set on first upload, reused on retry
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
      const mimeType = getMimeType(item.file)

      // ── Stage 0: upload to Supabase Storage (skip if already done) ────────
      let storagePath = item.storagePath
      if (!storagePath) {
        storagePath = `${crypto.randomUUID()}/${item.file.name}`
        updateFile(item.id, { storagePath, status: 'transcribing' })
        const { error: upErr } = await supabase.storage
          .from('call-audio')
          .upload(storagePath, item.file, { contentType: mimeType, upsert: true })
        if (upErr) {
          updateFile(item.id, { status: 'error', error: `Upload failed: ${upErr.message}` })
          continue
        }
      }

      // ── Stage 1: duration (always cheap, re-run) ──────────────────────────
      const durationSeconds = item.durationSeconds ?? await getFileDuration(item.file)
      if (item.durationSeconds == null) updateFile(item.id, { durationSeconds })

      // ── Stage 2: transcription via Vertex AI edge function ─────────────────
      let transcript = item.transcript
      if (!transcript) {
        updateFile(item.id, { status: 'transcribing' })
        try {
          const { data: txData, error: txErr } = await supabase.functions.invoke('transcribe-audio', {
            body: { storagePath, mimeType },
          })
          if (txErr) throw new Error(txData?.error || txErr.message)
          if (!txData?.transcript) throw new Error(txData?.error || 'Empty transcript returned')
          transcript = txData.transcript
          updateFile(item.id, { transcript })
        } catch (err) {
          updateFile(item.id, { status: 'error', error: `Transcription failed: ${err.message}` })
          continue
        }
      } else {
        updateFile(item.id, { status: 'scoring' })
      }

      // ── Stage 3: scoring via Vertex AI edge function ───────────────────────
      let enrichedScores = item.enrichedScores
      let agentName      = item.agentName
      if (!enrichedScores) {
        updateFile(item.id, { status: 'scoring' })
        try {
          const { data: scData, error: scErr } = await supabase.functions.invoke('score-transcript', {
            body: { transcript, rubricParams: rubric.parameters, durationSeconds: durationSeconds ?? null },
          })
          if (scErr) throw new Error(scErr.message)
          if (!scData?.scores) throw new Error(scData?.error || 'Empty scoring response')
          const rawScores = scData.scores
          agentName = scData.agentName || null

          const scoredNames   = new Set(rawScores.map(s => s.parameter))
          const missingScores = rubric.parameters
            .filter(p => !scoredNames.has(p.name))
            .map(p => ({ parameter: p.name, score: 0, reasoning: '', max_score: p.max_score }))
          const rubricOrder   = Object.fromEntries(rubric.parameters.map((p, i) => [p.name, i]))
          enrichedScores = [...rawScores.map(s => ({
            ...s,
            max_score: rubric.parameters.find(p => p.name === s.parameter)?.max_score ?? 10,
          })), ...missingScores].sort((a, b) => (rubricOrder[a.parameter] ?? 999) - (rubricOrder[b.parameter] ?? 999))

          updateFile(item.id, { enrichedScores, agentName })
        } catch (err) {
          updateFile(item.id, { status: 'error', error: `Scoring failed: ${err.message}` })
          continue
        }
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

        // Move to Drive — file already in Storage, edge function pulls + deletes (best-effort)
        updateFile(item.id, { driveStatus: 'uploading' })
        ;(async () => {
          try {
            const { data, error } = await supabase.functions.invoke('drive-upload-url', {
              body: { storagePath, filename: item.file.name, mimeType },
            })
            if (error || !data?.id) throw new Error(error?.message || data?.error || 'Drive upload failed')
            const driveLink = `https://drive.google.com/file/d/${data.id}/view`
            await supabase.from('calls').update({ drive_link: driveLink }).eq('id', callId)
            updateFile(item.id, { driveStatus: 'done', driveLink })
          } catch (e) {
            console.error('[Drive upload] failed:', e)
            updateFile(item.id, { driveStatus: 'error', driveError: e.message })
          }
        })()

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
              disabled={processing || !rubric}
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
                        : <p className="text-[11px] text-slate-400 mt-0.5">
                            {(item.file.size / 1024 / 1024).toFixed(1)} MB
                            {item.driveStatus === 'uploading' && <span className="ml-2 text-violet-400 animate-pulse">· Saving to Drive…</span>}
                            {item.driveStatus === 'done'     && <span className="ml-2 text-emerald-500">· Saved to Drive</span>}
                            {item.driveStatus === 'error'    && <span className="ml-2 text-rose-400" title={item.driveError}>· Drive failed: {item.driveError}</span>}
                          </p>
                      }
                    </div>

                    {/* Done: verdict + score + expand toggle */}
                    {item.status === 'done' && item.overallPct !== null ? (
                      <>
                        {item.driveLink && <PlayCallButton call={{ id: item.callId, drive_link: item.driveLink, metadata: { filename: item.file.name } }} />}
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
          disabled={!rubric}
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
    <div className="min-h-full bg-slate-50/50 pb-24">
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
