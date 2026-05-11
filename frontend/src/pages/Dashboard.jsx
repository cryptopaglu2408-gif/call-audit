import { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend,
} from 'recharts'
import { AlertTriangle, SlidersHorizontal, ArrowDownRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import KPICard from '../components/KPICard'
import Spinner from '../components/Spinner'

const STATUS_COLORS = { done: '#10b981', transcribed: '#8b5cf6', pending: '#64748b', error: '#f43f5e' }
const RANGES = [{ label: '7 days', value: '7d' }, { label: '30 days', value: '30d' }, { label: '90 days', value: '90d' }, { label: 'All time', value: 'all' }]

// ≤50 red · 51–80 yellow · 81–100 green
function scoreColor(pct) {
  if (pct <= 50) return '#ef4444'
  if (pct <= 80) return '#f59e0b'
  return '#10b981'
}
function scoreTextClass(pct) {
  if (pct <= 50) return 'text-rose-500'
  if (pct <= 80) return 'text-amber-500'
  return 'text-emerald-500'
}
function scoreBgClass(pct) {
  if (pct <= 50) return 'bg-rose-50 text-rose-600 border-rose-100'
  if (pct <= 80) return 'bg-amber-50 text-amber-600 border-amber-100'
  return 'bg-emerald-50 text-emerald-700 border-emerald-100'
}

const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900/95 backdrop-blur text-white text-xs px-4 py-3 rounded-xl shadow-2xl border border-white/10">
      {label && <p className="font-bold mb-1.5 text-slate-200 text-[11px] uppercase tracking-wide">{label}</p>}
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-2 mt-0.5" style={{ color: p.color || '#fff' }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || '#fff' }} />
          {p.name}: <span className="font-bold ml-auto pl-4">{p.value}{typeof p.value === 'number' ? '%' : ''}</span>
        </p>
      ))}
    </div>
  )
}

// Custom label shown to the right of each horizontal bar
const BarScoreLabel = ({ x, y, width, height, value }) => (
  <text x={x + width + 8} y={y + height / 2 + 4} fontSize={11} fontWeight={700} fill={scoreColor(value)}>
    {value}%
  </text>
)

function Card({ title, sub, action, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card border border-slate-100 p-6 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            {title && <h2 className="text-sm font-bold text-slate-800">{title}</h2>}
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = { done: 'bg-emerald-50 text-emerald-700 border-emerald-100', transcribed: 'bg-violet-50 text-violet-700 border-violet-100', error: 'bg-rose-50 text-rose-600 border-rose-100', pending: 'bg-slate-50 text-slate-500 border-slate-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${map[status] || map.pending}`}>
      <span className="w-1 h-1 rounded-full mr-1.5" style={{ background: STATUS_COLORS[status] || '#94a3b8' }} />
      {status}
    </span>
  )
}

function RangePicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
      {RANGES.map(r => (
        <button key={r.value} onClick={() => onChange(r.value)}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${value === r.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {r.label}
        </button>
      ))}
    </div>
  )
}

// Zone legend pill
function ZonePill({ color, label, count, total }) {
  const pct = total ? Math.round(count / total * 100) : 0
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>
        <p className="text-[11px] text-slate-400">{count} calls · {pct}%</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [calls, setCalls]     = useState([])
  const [scores, setScores]   = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange]     = useState('30d')
  const [threshold, setThreshold] = useState(50)
  const [histParam, setHistParam] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('calls').select('id, status, created_at, duration_seconds, metadata').order('created_at', { ascending: false }),
      supabase.from('scores').select('call_id, parameter, score, max_score'),
    ]).then(([{ data: c }, { data: s }]) => {
      setCalls(c || [])
      setScores(s || [])
      if (s?.length) setHistParam([...new Set(s.map(x => x.parameter))][0] || null)
      setLoading(false)
    })
  }, [])

  const filteredCalls = useMemo(() => {
    if (range === 'all') return calls
    const cutoff = new Date(Date.now() - parseInt(range) * 86400000)
    return calls.filter(c => new Date(c.created_at) >= cutoff)
  }, [calls, range])

  const scoreMap = useMemo(() => {
    const map = {}
    scores.forEach(s => {
      if (!map[s.call_id]) map[s.call_id] = []
      map[s.call_id].push(s.score / s.max_score)
    })
    return map
  }, [scores])

  const computed = useMemo(() => {
    const total   = filteredCalls.length
    const audited = filteredCalls.filter(c => c.status === 'done' || c.status === 'transcribed').length
    const failed  = filteredCalls.filter(c => c.status === 'error').length

    const callPcts = filteredCalls.map(c => scoreMap[c.id]).filter(Boolean).map(arr => arr.reduce((a,b)=>a+b,0)/arr.length)
    const avgScore = callPcts.length ? Math.round(callPcts.reduce((a,b)=>a+b,0)/callPcts.length*100) : null

    // Performance zones (≤50 / 51-80 / 81-100)
    const zones = { red: 0, yellow: 0, green: 0 }
    filteredCalls.forEach(c => {
      const pcts = scoreMap[c.id]
      if (!pcts?.length) return
      const avg = pcts.reduce((a,b)=>a+b,0)/pcts.length*100
      if (avg <= 50) zones.red++
      else if (avg <= 80) zones.yellow++
      else zones.green++
    })
    const zonesData = [
      { name: '≤50% Critical', value: zones.red,    color: '#ef4444' },
      { name: '51–80% Average', value: zones.yellow, color: '#f59e0b' },
      { name: '81–100% Good',   value: zones.green,  color: '#10b981' },
    ]

    // Daily trend
    const dayMap = {}
    filteredCalls.forEach(c => {
      const pcts = scoreMap[c.id]
      if (!pcts) return
      const day = c.created_at.substring(0,10)
      if (!dayMap[day]) dayMap[day] = []
      dayMap[day].push(pcts.reduce((a,b)=>a+b,0)/pcts.length)
    })
    const trendData = Object.entries(dayMap).sort(([a],[b])=>a.localeCompare(b)).slice(-14).map(([day, arr]) => ({
      day: new Date(day).toLocaleDateString('en-AU', { day:'numeric', month:'short' }),
      Score: Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100),
    }))

    // Param averages (for bar + radar)
    const paramMap = {}
    scores.filter(s => filteredCalls.some(c=>c.id===s.call_id)).forEach(s => {
      if (!paramMap[s.parameter]) paramMap[s.parameter] = []
      paramMap[s.parameter].push(s.score / s.max_score)
    })
    const paramData = Object.entries(paramMap).map(([p, arr]) => ({
      param:    p.length > 18 ? p.slice(0,16)+'…' : p,
      fullName: p,
      Score:    Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100),
    })).sort((a,b) => a.Score - b.Score)   // ascending so worst at top

    // Flagged
    const flagged = filteredCalls.filter(c => {
      const pcts = scoreMap[c.id]
      return pcts?.length && (pcts.reduce((a,b)=>a+b,0)/pcts.length*100) < threshold
    })

    // Histogram
    const allParams = [...new Set(scores.map(s=>s.parameter))].sort()
    const histBuckets = {}
    scores.forEach(s => {
      if (!histBuckets[s.parameter]) histBuckets[s.parameter] = {}
      histBuckets[s.parameter][s.score] = (histBuckets[s.parameter][s.score]||0)+1
    })
    const maxScore = scores.find(s=>s.parameter===histParam)?.max_score || 10
    const histData = Array.from({length: maxScore}, (_,i) => ({
      score: i+1,
      pctLabel: `${Math.round((i+1)/maxScore*100)}%`,
      Calls: histBuckets[histParam]?.[i+1] || 0,
    }))

    // Duration data
    const durationData = filteredCalls.filter(c=>c.duration_seconds).slice(0,60).reverse().map((c,i)=>({call:i+1,min:+(c.duration_seconds/60).toFixed(1)}))

    return { total, audited, failed, avgScore, zones, zonesData, trendData, paramData, flagged, allParams, histData, durationData }
  }, [filteredCalls, scores, scoreMap, threshold, histParam])

  const { total, audited, failed, avgScore, zones, zonesData, trendData, paramData, flagged, allParams, histData, durationData } = computed

  if (loading) return <Spinner text="Loading dashboard…" />

  const scoredCount = zones.red + zones.yellow + zones.green

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between gap-4 sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Showing {filteredCalls.length} calls</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="p-8 max-w-7xl mx-auto space-y-6">
        {/* Flagged banner */}
        {flagged.length > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
            <p className="text-sm font-bold text-amber-800">
              {flagged.length} call{flagged.length > 1 ? 's' : ''} scored below {threshold}%
            </p>
            <a href="#flagged" className="ml-auto text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors">
              View →
            </a>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Total Calls"  value={total.toLocaleString()}                    icon="📞" accent="blue" />
          <KPICard label="Audited"      value={audited.toLocaleString()}                  icon="✅" accent="green" sub={total ? `${Math.round(audited/total*100)}% of total` : '—'} />
          <KPICard label="Avg Score"    value={avgScore !== null ? `${avgScore}%` : '—'}  icon="⭐" accent="purple" />
          <KPICard label="Failed"       value={failed.toLocaleString()}                   icon="⚠️" accent="red" sub={failed ? `${Math.round(failed/total*100)}% error rate` : 'No errors'} />
        </div>

        {/* Performance Zones + Daily Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Performance Zones donut */}
          <Card title="Performance Zones" sub="Calls grouped by overall score">
            {scoredCount === 0 ? <p className="text-sm text-slate-400">No scored calls in this range.</p> : (
              <div className="flex items-center gap-8">
                <div className="relative shrink-0">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={zonesData} cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                        dataKey="value" strokeWidth={3} stroke="#fff" paddingAngle={2}>
                        {zonesData.map(z => <Cell key={z.name} fill={z.color} />)}
                      </Pie>
                      <Tooltip content={<DarkTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {avgScore !== null && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className={`text-2xl font-black tabular ${scoreTextClass(avgScore)}`}>{avgScore}%</span>
                      <span className="text-[10px] text-slate-400 font-semibold">avg</span>
                    </div>
                  )}
                </div>
                <div className="space-y-4 flex-1">
                  {[
                    { color:'#10b981', label:'Good (81–100%)',    count: zones.green },
                    { color:'#f59e0b', label:'Average (51–80%)',  count: zones.yellow },
                    { color:'#ef4444', label:'Critical (≤50%)',   count: zones.red },
                  ].map(z => (
                    <div key={z.label}>
                      <ZonePill {...z} total={scoredCount} />
                      <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${scoredCount ? z.count/scoredCount*100 : 0}%`, background: z.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Daily avg score */}
          <Card title="Daily Avg Score" sub="Last 14 days with data · dashed line = 60% target">
            {trendData.length === 0 ? <p className="text-sm text-slate-400">No score data in this range.</p> : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={trendData} barSize={28} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    {trendData.map((d, i) => (
                      <linearGradient key={i} id={`bar${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={scoreColor(d.Score)} stopOpacity={1} />
                        <stop offset="100%" stopColor={scoreColor(d.Score)} stopOpacity={0.7} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize:10, fill:'#94a3b8', fontWeight:600 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0,100]} tick={{ fontSize:10, fill:'#94a3b8', fontWeight:600 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} width={36} />
                  <ReferenceLine y={60} stroke="#64748b" strokeDasharray="5 3" strokeWidth={1.5}
                    label={{ value:'60%', position:'insideTopRight', fontSize:10, fill:'#64748b', fontWeight:700 }} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill:'#f8fafc' }} />
                  <Bar dataKey="Score" radius={[6,6,0,0]}>
                    {trendData.map((d, i) => <Cell key={i} fill={`url(#bar${i})`} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Avg Score by Parameter — full width, tall, color-coded */}
        <Card
          title="Avg Score by Parameter"
          sub="Sorted worst → best · bars coloured by zone: red ≤50% · yellow 51–80% · green 81–100%"
        >
          {paramData.length === 0 ? <p className="text-sm text-slate-400">No data.</p> : (
            <>
              {/* Zone legend */}
              <div className="flex items-center gap-6 mb-5">
                {[['#ef4444','Critical ≤50%'],['#f59e0b','Average 51–80%'],['#10b981','Good 81–100%']].map(([c,l])=>(
                  <div key={l} className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: c }} />
                    {l}
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(280, paramData.length * 38)}>
                <BarChart data={paramData} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 8 }} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" domain={[0,100]} tick={{ fontSize:11, fill:'#94a3b8', fontWeight:600 }}
                    axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
                  <YAxis type="category" dataKey="param" tick={{ fontSize:12, fill:'#475569', fontWeight:600 }}
                    axisLine={false} tickLine={false} width={150} />
                  <ReferenceLine x={60} stroke="#64748b" strokeDasharray="5 3" strokeWidth={1.5}
                    label={{ value:'60%', position:'insideTopRight', fontSize:10, fill:'#64748b', fontWeight:700 }} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill:'#f8fafc' }} />
                  <Bar dataKey="Score" radius={[0,6,6,0]} label={<BarScoreLabel />}>
                    {paramData.map((d, i) => (
                      <Cell key={i} fill={scoreColor(d.Score)} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>

        {/* Radar + Score Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Radar chart */}
          <Card title="Parameter Radar" sub="Visual overview of all parameter averages">
            {paramData.length < 3 ? <p className="text-sm text-slate-400">Need at least 3 parameters for radar view.</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={paramData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="param" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} />
                  <PolarRadiusAxis angle={30} domain={[0,100]} tick={{ fontSize: 9, fill: '#94a3b8' }}
                    tickFormatter={v=>`${v}%`} tickCount={4} />
                  <Radar name="Avg Score" dataKey="Score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2.5} dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }} />
                  <Tooltip content={<DarkTooltip />} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Score distribution histogram */}
          <Card
            title="Score Distribution"
            sub="How many calls hit each score value"
            action={
              allParams.length > 0 && (
                <select value={histParam || ''} onChange={e => setHistParam(e.target.value)}
                  className="text-xs font-semibold border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 max-w-[140px] truncate">
                  {allParams.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )
            }
          >
            {!histParam || histData.every(d => d.Calls === 0) ? (
              <p className="text-sm text-slate-400">No score data for this parameter.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={histData} barSize={28} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="score" tick={{ fontSize:12, fill:'#475569', fontWeight:700 }} axisLine={false} tickLine={false}
                    label={{ value:'Score value', position:'insideBottom', offset:-2, fontSize:10, fill:'#94a3b8', fontWeight:600 }} />
                  <YAxis tick={{ fontSize:10, fill:'#94a3b8', fontWeight:600 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill:'#f8fafc' }} />
                  <Bar dataKey="Calls" radius={[6,6,0,0]}>
                    {histData.map((d, i) => {
                      const maxScore = histData.reduce((a,b) => a.score > b.score ? a : b, { score: 1 }).score
                      const pct = Math.round(d.score / maxScore * 100)
                      return <Cell key={i} fill={scoreColor(pct)} fillOpacity={d.Calls === 0 ? 0.15 : 0.85} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Call Duration sparkline */}
        {durationData.length > 0 && (
          <Card title="Call Duration" sub="Last 60 calls chronologically">
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={durationData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="durGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="call" tick={{ fontSize:10, fill:'#94a3b8', fontWeight:600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:10, fill:'#94a3b8', fontWeight:600 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}m`} width={30} />
                <Tooltip content={<DarkTooltip />} />
                <Area type="monotone" dataKey="min" name="Duration (min)" stroke="#8b5cf6" fill="url(#durGrad)" strokeWidth={2.5} dot={false} activeDot={{ r:4, fill:'#8b5cf6' }} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Flagged calls */}
        <div id="flagged">
          <Card
            title="Flagged for Review"
            action={
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400">Threshold:</span>
                <input type="range" min={20} max={80} step={5} value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="w-24 accent-rose-500" />
                <span className="text-xs font-bold text-rose-500 w-8 tabular">{threshold}%</span>
                <SlidersHorizontal size={13} className="text-slate-400" />
              </div>
            }
          >
            {flagged.length === 0 ? (
              <div className="flex items-center gap-3 py-8 justify-center text-slate-400">
                <span className="text-3xl">🎉</span>
                <p className="text-sm font-medium">No calls below {threshold}% in this range.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    {['File','Status','Score','Date'].map(h=><th key={h} className="pb-3 border-b border-slate-100">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {flagged.map(c => {
                    const pcts = scoreMap[c.id]
                    const sc = pcts ? Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length*100) : 0
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 pr-4 font-semibold text-slate-700 max-w-[220px] truncate">{c.metadata?.filename || `call-${c.id.slice(0,8)}`}</td>
                        <td className="py-3.5 pr-4"><StatusBadge status={c.status} /></td>
                        <td className="py-3.5 pr-4">
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg border ${scoreBgClass(sc)}`}>
                            <ArrowDownRight size={12} /> {sc}%
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Recent calls */}
        <Card>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold text-slate-800">Recent Calls</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-bold">{total} total</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {['File','Status','Score','Duration','Date'].map(h=><th key={h} className="pb-3 border-b border-slate-100">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredCalls.slice(0,10).map(c => {
                const pcts = scoreMap[c.id]
                const sc   = pcts ? Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length*100) : null
                const dur  = c.duration_seconds ? `${(c.duration_seconds/60).toFixed(1)}m` : '—'
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 pr-4 font-semibold text-slate-700 max-w-[200px] truncate">{c.metadata?.filename || `call-${c.id.slice(0,8)}`}</td>
                    <td className="py-3.5 pr-4"><StatusBadge status={c.status} /></td>
                    <td className="py-3.5 pr-4">
                      {sc !== null ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${scoreBgClass(sc)}`}>{sc}%</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3.5 pr-4 text-slate-400 text-xs tabular">{dur}</td>
                    <td className="py-3.5 text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short'})}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}
