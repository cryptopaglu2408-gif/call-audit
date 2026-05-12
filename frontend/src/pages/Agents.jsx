import { useEffect, useState, useMemo } from 'react'
import { Phone, Award, TrendingUp, TrendingDown, ChevronRight, ExternalLink, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'

const TIME_FILTERS = [
  { id: 'last5',      label: 'Last 5 calls'  },
  { id: 'last10',     label: 'Last 10 calls' },
  { id: 'this_month', label: 'This month'    },
  { id: 'last_month', label: 'Last month'    },
]

function scoreColor(pct) {
  if (pct <= 50) return '#ef4444'
  if (pct <= 80) return '#f59e0b'
  return '#10b981'
}

function scoreBadge(pct) {
  if (pct <= 50) return 'bg-rose-50 text-rose-600 border border-rose-100'
  if (pct <= 80) return 'bg-amber-50 text-amber-700 border border-amber-100'
  return 'bg-emerald-50 text-emerald-700 border border-emerald-100'
}

function avatarGradient(name) {
  const hues = [
    'from-violet-400 to-purple-600',
    'from-blue-400 to-indigo-600',
    'from-rose-400 to-pink-600',
    'from-amber-400 to-orange-500',
    'from-teal-400 to-emerald-600',
    'from-cyan-400 to-blue-500',
  ]
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length
  return hues[idx]
}

function applyFilter(calls, filterId) {
  const sorted = [...calls].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  if (filterId === 'last5')  return sorted.slice(0, 5)
  if (filterId === 'last10') return sorted.slice(0, 10)
  const now = new Date()
  if (filterId === 'this_month') {
    return sorted.filter(c => {
      const d = new Date(c.created_at)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
  }
  if (filterId === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end   = new Date(now.getFullYear(), now.getMonth(), 1)
    return sorted.filter(c => { const d = new Date(c.created_at); return d >= start && d < end })
  }
  return sorted
}

function callAvgPct(callId, scoreMap) {
  const scores = scoreMap[callId]
  if (!scores?.length) return null
  return scores.reduce((a, s) => a + s.score / s.max_score, 0) / scores.length * 100
}

export default function Agents() {
  const [calls, setCalls]         = useState([])
  const [allScores, setAllScores] = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('last10')
  const [selected, setSelected]   = useState(null)
  const [search, setSearch]       = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: c }, { data: s }] = await Promise.all([
        supabase.from('calls')
          .select('id, status, created_at, duration_seconds, metadata, drive_link')
          .order('created_at', { ascending: false }),
        supabase.from('scores').select('call_id, parameter, score, max_score').limit(10000),
      ])
      setCalls(c || [])
      setAllScores(s || [])
      setLoading(false)
    }
    load()
  }, [])

  const scoreMap = useMemo(() => {
    const map = {}
    allScores.forEach(s => {
      if (!map[s.call_id]) map[s.call_id] = []
      map[s.call_id].push(s)
    })
    return map
  }, [allScores])

  const agents = useMemo(() => {
    const groups = {}
    calls.forEach(c => {
      const name = c.metadata?.agent_name || null
      const key  = name || '__unknown__'
      if (!groups[key]) groups[key] = { name: name || 'Unknown', calls: [] }
      groups[key].calls.push(c)
    })

    return Object.values(groups).map(({ name, calls: agentCalls }) => {
      const filtered = applyFilter(agentCalls, filter)
      const pcts     = filtered.map(c => callAvgPct(c.id, scoreMap)).filter(x => x !== null)
      const avgScore = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null

      // trend: recent half vs older half
      const mid      = Math.ceil(pcts.length / 2)
      const recent   = pcts.slice(0, mid)
      const older    = pcts.slice(mid)
      const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null
      const olderAvg  = older.length  ? older.reduce((a, b) => a + b, 0)  / older.length  : null
      const trend     = recentAvg !== null && olderAvg !== null ? Math.round(recentAvg - olderAvg) : null

      return { name, totalCalls: agentCalls.length, filteredCalls: filtered, avgScore, trend }
    }).sort((a, b) => {
      if (a.name === 'Unknown') return 1
      if (b.name === 'Unknown') return -1
      return (b.avgScore ?? -1) - (a.avgScore ?? -1)
    })
  }, [calls, scoreMap, filter])

  const selectedAgent = useMemo(() => {
    if (selected) return agents.find(a => a.name === selected) || agents[0] || null
    return agents[0] || null
  }, [agents, selected])

  const paramPerf = useMemo(() => {
    if (!selectedAgent) return []
    const paramMap = {}
    selectedAgent.filteredCalls.forEach(c => {
      ;(scoreMap[c.id] || []).forEach(s => {
        if (!paramMap[s.parameter]) paramMap[s.parameter] = []
        paramMap[s.parameter].push(s.score / s.max_score * 100)
      })
    })
    return Object.entries(paramMap)
      .map(([name, vals]) => ({ name, score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
      .sort((a, b) => a.score - b.score)
  }, [selectedAgent, scoreMap])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner text="Loading agents…" />
      </div>
    )
  }

  const knownAgents = agents.filter(a => a.name !== 'Unknown')
  const unknownAgent = agents.find(a => a.name === 'Unknown')

  return (
    <div className="min-h-full bg-slate-50/50">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-slate-200/60 px-8 py-6 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Agents</h1>
            <p className="text-sm font-medium text-slate-400 mt-0.5">
              Performance analytics per sales agent · names detected from call introductions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl">
              {knownAgents.length} agent{knownAgents.length !== 1 ? 's' : ''} · {calls.length} total calls
            </span>
          </div>
        </div>
        {/* Time filter */}
        <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl w-fit border border-slate-200/60">
          {TIME_FILTERS.map(({ id, label }) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 whitespace-nowrap ${
                filter === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8 max-w-7xl mx-auto">
        {agents.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-5 text-4xl">👤</div>
            <p className="text-base font-bold text-slate-600">No agents detected yet</p>
            <p className="text-sm font-medium text-slate-400 mt-1 max-w-sm mx-auto">
              Agent names are extracted automatically from call introductions when you upload or process calls.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
            {/* ── Agent list ── */}
            <div className="space-y-2">
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" placeholder="Search agent…" value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                />
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 mb-3">
                {knownAgents.length} detected agent{knownAgents.length !== 1 ? 's' : ''}
              </p>
              {agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase())).map(agent => {
                const isSelected = selectedAgent?.name === agent.name
                const gradient   = avatarGradient(agent.name)
                return (
                  <button key={agent.name} onClick={() => setSelected(agent.name)}
                    className={`w-full text-left rounded-2xl p-4 border transition-all duration-200 ${
                      isSelected
                        ? 'bg-white border-violet-200 shadow-md'
                        : 'bg-white/70 border-slate-200/60 hover:bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                        <span className="text-white text-xs font-bold">
                          {agent.name === 'Unknown' ? '?' : agent.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{agent.name}</p>
                        <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                          {agent.filteredCalls.length} call{agent.filteredCalls.length !== 1 ? 's' : ''}
                          {agent.totalCalls !== agent.filteredCalls.length && ` · ${agent.totalCalls} total`}
                        </p>
                      </div>
                      {agent.avgScore !== null && (
                        <span className={`px-2.5 py-1 rounded-lg text-sm font-black ${scoreBadge(agent.avgScore)}`}>
                          {agent.avgScore}%
                        </span>
                      )}
                    </div>

                    {agent.avgScore !== null && (
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${agent.avgScore}%`, background: scoreColor(agent.avgScore) }}
                        />
                      </div>
                    )}

                    {agent.trend !== null && agent.trend !== 0 && agent.filteredCalls.length >= 3 && (
                      <div className={`flex items-center gap-1 mt-2 text-[11px] font-bold ${agent.trend > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {agent.trend > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {agent.trend > 0 ? '+' : ''}{agent.trend}% recent trend
                      </div>
                    )}

                    {isSelected && (
                      <div className="flex justify-end mt-1">
                        <ChevronRight size={13} className="text-violet-400" />
                      </div>
                    )}
                  </button>
                )
              })}

              {unknownAgent && knownAgents.length > 0 && (
                <p className="text-[10px] font-medium text-slate-400 px-2 pt-1">
                  {unknownAgent.totalCalls} call{unknownAgent.totalCalls !== 1 ? 's' : ''} with no detected agent name
                </p>
              )}
            </div>

            {/* ── Agent detail ── */}
            {selectedAgent && (
              <div className="space-y-5">
                {/* Agent header */}
                <div className={`bg-gradient-to-r ${
                  selectedAgent.avgScore === null ? 'from-slate-600 to-slate-800' :
                  selectedAgent.avgScore <= 50    ? 'from-rose-500 to-rose-700' :
                  selectedAgent.avgScore <= 80    ? 'from-amber-500 to-orange-600' :
                                                    'from-emerald-500 to-teal-600'
                } rounded-2xl p-6 text-white shadow-lg`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarGradient(selectedAgent.name)} flex items-center justify-center shadow-lg ring-2 ring-white/30`}>
                      <span className="text-white text-lg font-black">
                        {selectedAgent.name === 'Unknown' ? '?' : selectedAgent.name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-xl font-black tracking-tight">{selectedAgent.name}</h2>
                      <p className="text-white/70 text-sm mt-0.5 font-medium">
                        {selectedAgent.filteredCalls.length} calls in view · {selectedAgent.totalCalls} all-time
                      </p>
                    </div>
                    {selectedAgent.avgScore !== null && (
                      <div className="text-right">
                        <p className="text-4xl font-black tabular">{selectedAgent.avgScore}%</p>
                        <p className="text-white/60 text-xs font-bold uppercase tracking-wide mt-0.5">avg score</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-3 gap-4">
                  {[
                    {
                      label: 'Calls in view',
                      value: selectedAgent.filteredCalls.length,
                      Icon: Phone,
                      bg: 'bg-violet-50',
                      iconColor: 'text-violet-500',
                    },
                    {
                      label: 'Avg score',
                      value: selectedAgent.avgScore !== null ? `${selectedAgent.avgScore}%` : '—',
                      Icon: Award,
                      bg: selectedAgent.avgScore === null ? 'bg-slate-50' :
                          selectedAgent.avgScore <= 50    ? 'bg-rose-50' :
                          selectedAgent.avgScore <= 80    ? 'bg-amber-50' : 'bg-emerald-50',
                      iconColor: selectedAgent.avgScore === null ? 'text-slate-400' :
                                 selectedAgent.avgScore <= 50    ? 'text-rose-500' :
                                 selectedAgent.avgScore <= 80    ? 'text-amber-600' : 'text-emerald-600',
                    },
                    {
                      label: 'All-time calls',
                      value: selectedAgent.totalCalls,
                      Icon: TrendingUp,
                      bg: 'bg-blue-50',
                      iconColor: 'text-blue-500',
                    },
                  ].map(({ label, value, Icon, bg, iconColor }) => (
                    <div key={label} className="bg-white/90 rounded-2xl border border-slate-200/60 p-5 shadow-sm">
                      <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                        <Icon size={16} className={iconColor} />
                      </div>
                      <p className="text-2xl font-black text-slate-900 tabular">{value}</p>
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mt-1">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Parameter performance */}
                {paramPerf.length > 0 && (
                  <div className="bg-white/90 rounded-2xl border border-slate-200/60 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Performance by Parameter</h3>
                      <span className="text-[11px] font-medium text-slate-400">Worst → Best</span>
                    </div>
                    <div className="space-y-3">
                      {paramPerf.map(p => (
                        <div key={p.name} className="flex items-center gap-3">
                          <span className="text-xs font-medium text-slate-600 w-52 shrink-0 truncate">{p.name}</span>
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${p.score}%`, background: scoreColor(p.score) }}
                            />
                          </div>
                          <span
                            className="text-xs font-bold tabular w-9 text-right shrink-0"
                            style={{ color: scoreColor(p.score) }}
                          >
                            {p.score}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Calls table */}
                <div className="bg-white/90 rounded-2xl border border-slate-200/60 p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                      {selectedAgent.name}'s Calls
                    </h3>
                    <span className="text-[11px] font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                      {TIME_FILTERS.find(f => f.id === filter)?.label}
                    </span>
                  </div>

                  {selectedAgent.filteredCalls.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-sm font-medium text-slate-400">No calls in this period</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            <th className="pb-3 border-b border-slate-100 pr-4">File</th>
                            <th className="pb-3 border-b border-slate-100 pr-4">Score</th>
                            <th className="pb-3 border-b border-slate-100 pr-4">Duration</th>
                            <th className="pb-3 border-b border-slate-100 pr-4">Date</th>
                            <th className="pb-3 border-b border-slate-100">Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedAgent.filteredCalls.map(c => {
                            const pct = callAvgPct(c.id, scoreMap)
                            const pctRounded = pct !== null ? Math.round(pct) : null
                            return (
                              <tr key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                                <td className="py-3.5 pr-4 font-semibold text-slate-700 max-w-[180px] truncate">
                                  {c.metadata?.filename || `call-${c.id.slice(0, 8)}`}
                                </td>
                                <td className="py-3.5 pr-4">
                                  {pctRounded !== null ? (
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold ${scoreBadge(pctRounded)}`}>
                                      {pctRounded}%
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 text-xs">—</span>
                                  )}
                                </td>
                                <td className="py-3.5 pr-4 text-slate-500 text-xs font-medium tabular">
                                  {c.duration_seconds ? `${(c.duration_seconds / 60).toFixed(1)} min` : '—'}
                                </td>
                                <td className="py-3.5 pr-4 text-slate-500 text-xs font-medium">
                                  {new Date(c.created_at).toLocaleString('en-AU', {
                                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                  })}
                                </td>
                                <td className="py-3.5">
                                  {c.drive_link ? (
                                    <a href={c.drive_link} target="_blank" rel="noreferrer"
                                      className="text-blue-400 hover:text-blue-600 transition-colors">
                                      <ExternalLink size={13} />
                                    </a>
                                  ) : (
                                    <span className="text-slate-200">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
