import { useEffect, useState, useMemo, Fragment } from 'react'
import { Phone, Award, TrendingUp, TrendingDown, ChevronRight, ExternalLink, Search } from 'lucide-react'
import { supabase, fetchAllScores } from '../lib/supabase'
import Spinner from '../components/Spinner'
import PlayCallButton from '../components/PlayCallButton'

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
  const [search, setSearch]       = useState('')
  const [selectedAgentName, setSelectedAgentName] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: c }, s] = await Promise.all([
        supabase.from('calls')
          .select('id, status, created_at, duration_seconds, metadata, drive_link')
          .order('created_at', { ascending: false }),
        fetchAllScores(),
      ])
      setCalls(c || [])
      setAllScores(s)
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

      // Calculate parameter performance for this agent
      const paramMap = {}
      filtered.forEach(c => {
        ;(scoreMap[c.id] || []).forEach(s => {
          if (!paramMap[s.parameter]) paramMap[s.parameter] = []
          paramMap[s.parameter].push(s.score / s.max_score * 100)
        })
      })
      const paramPerf = Object.entries(paramMap)
        .map(([pName, vals]) => ({ name: pName, score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
        .sort((a, b) => b.score - a.score) // Best to worst for pills

      return { name, totalCalls: agentCalls.length, filteredCalls: filtered, avgScore, trend, paramPerf }
    }).sort((a, b) => {
      if (a.name === 'Unknown') return 1
      if (b.name === 'Unknown') return -1
      return (b.avgScore ?? -1) - (a.avgScore ?? -1)
    })
  }, [calls, scoreMap, filter])

  const selectedAgent = useMemo(() => {
    if (selectedAgentName) return agents.find(a => a.name === selectedAgentName) || agents[0] || null
    return agents[0] || null
  }, [agents, selectedAgentName])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner text="Loading agents…" />
      </div>
    )
  }

  const filteredAgents = agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="min-h-full bg-[#f8f9fa] p-8 pb-24">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-400 font-medium mt-0.5">Performance analytics per sales agent</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Search agent…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2.5 text-sm border border-gray-100 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#ff7b54]/20 focus:border-[#ff7b54] transition-all w-full sm:w-64"
            />
          </div>

          {/* Time filter */}
          <div className="flex gap-1 bg-white p-1 rounded-xl border border-gray-100">
            {TIME_FILTERS.map(({ id, label }) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  filter === id ? 'bg-[#ff7b54] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[450px_1fr] gap-6 items-start">
        
        {/* Left Column: Table of Agents */}
        <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                  <th className="py-3 px-4 border-b border-gray-100">Agent</th>
                  <th className="py-3 px-4 border-b border-gray-100">Calls</th>
                  <th className="py-3 px-4 border-b border-gray-100">Score</th>
                  <th className="py-3 px-4 border-b border-gray-100">Trend</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map(agent => {
                  const isSelected = selectedAgent?.name === agent.name
                  const gradient   = avatarGradient(agent.name)
                  
                  return (
                    <tr key={agent.name} onClick={() => setSelectedAgentName(agent.name)}
                      className={`hover:bg-gray-50/50 transition-all duration-200 border-b border-gray-50 last:border-0 cursor-pointer hover:translate-x-0.5 ${isSelected ? 'bg-gray-50' : ''}`}>
                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0 shadow-sm`}>
                            <span className="text-white text-[10px] font-bold">
                              {agent.name === 'Unknown' ? '?' : agent.name.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">{agent.name}</p>
                            <p className="text-[10px] font-medium text-gray-400 mt-0.5">@agent</p>
                          </div>
                        </div>
                      </td>

                      {/* Calls */}
                      <td className="py-3 px-4 text-xs font-bold text-gray-700">
                        {agent.filteredCalls.length}
                      </td>

                      {/* Score */}
                      <td className="py-3 px-4">
                        {agent.avgScore !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden w-16">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${agent.avgScore}%`, background: scoreColor(agent.avgScore) }}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 w-7 text-right">{agent.avgScore}%</span>
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Trend */}
                      <td className="py-3 px-4">
                        {agent.trend !== null && agent.trend !== 0 && agent.filteredCalls.length >= 3 ? (
                          <div className={`flex items-center gap-0.5 text-xs font-bold ${agent.trend > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {agent.trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {agent.trend > 0 ? '+' : ''}{agent.trend}%
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Detail View */}
        <div key={selectedAgent?.name} className="space-y-6 animate-fade-in">
          {!selectedAgent ? (
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-12 text-center text-gray-400">
              <p className="text-sm font-medium">Select an agent to view details</p>
            </div>
          ) : (
            <>
              {/* Agent Header Card */}
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarGradient(selectedAgent.name)} flex items-center justify-center shadow-sm`}>
                    <span className="text-white text-lg font-bold">
                      {selectedAgent.name === 'Unknown' ? '?' : selectedAgent.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900">{selectedAgent.name}</h2>
                    <p className="text-sm text-gray-400 font-medium mt-0.5">
                      {selectedAgent.filteredCalls.length} calls in view · {selectedAgent.totalCalls} all-time
                    </p>
                  </div>
                  {selectedAgent.avgScore !== null && (
                    <div className="text-right">
                      <p className="text-3xl font-bold text-gray-900">{selectedAgent.avgScore}%</p>
                      <p className="text-xs font-bold text-gray-400 uppercase mt-0.5">avg score</p>
                    </div>
                  )}
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: 'Calls in view',
                    value: selectedAgent.filteredCalls.length,
                    Icon: Phone,
                    bg: 'bg-orange-50',
                    iconColor: 'text-[#ff7b54]',
                  },
                  {
                    label: 'All-time calls',
                    value: selectedAgent.totalCalls,
                    Icon: TrendingUp,
                    bg: 'bg-gray-50',
                    iconColor: 'text-gray-500',
                  },
                ].map(({ label, value, Icon, bg, iconColor }) => (
                  <div key={label} className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-5">
                    <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                      <Icon size={16} className={iconColor} />
                    </div>
                    <p className="text-2xl font-bold text-gray-900 tabular">{value}</p>
                    <p className="text-[11px] font-bold text-gray-400 uppercase mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {/* Parameter Performance */}
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold text-gray-900 uppercase">Performance by Parameter</h3>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Worst → Best</span>
                </div>
                {selectedAgent.paramPerf.length === 0 ? (
                  <p className="text-xs font-medium text-gray-400">No scores recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {[...selectedAgent.paramPerf].sort((a,b)=>a.score-b.score).map(p => (
                      <div key={p.name} className="flex items-center gap-3">
                        <span className="text-xs font-medium text-gray-600 w-40 shrink-0 truncate">{p.name}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${p.score}%`, background: scoreColor(p.score) }}
                          />
                        </div>
                        <span className="text-xs font-bold tabular w-9 text-right shrink-0" style={{ color: scoreColor(p.score) }}>
                          {p.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Calls Table */}
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100/50 p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold text-gray-900 uppercase">Recent Calls</h3>
                  <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                    {TIME_FILTERS.find(f => f.id === filter)?.label}
                  </span>
                </div>
                {selectedAgent.filteredCalls.length === 0 ? (
                  <p className="text-xs font-medium text-gray-400">No calls in this period</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          <th className="pb-2 border-b border-gray-100 pr-4">File</th>
                          <th className="pb-2 border-b border-gray-100 pr-4">Score</th>
                          <th className="pb-2 border-b border-gray-100 pr-4">Duration</th>
                          <th className="pb-2 border-b border-gray-100">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAgent.filteredCalls.map(c => {
                          const pct = callAvgPct(c.id, scoreMap)
                          const pctRounded = pct !== null ? Math.round(pct) : null
                          return (
                            <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="py-2 pr-4 font-semibold text-gray-700 max-w-[150px] truncate">
                                {c.metadata?.filename || `call-${c.id.slice(0, 8)}`}
                              </td>
                              <td className="py-2 pr-4">
                                {pctRounded !== null ? (
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-lg text-[10px] font-bold ${scoreBadge(pctRounded)}`}>
                                    {pctRounded}%
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="py-2 pr-4 text-gray-500 font-medium tabular">
                                {c.duration_seconds ? `${(c.duration_seconds / 60).toFixed(1)}m` : '—'}
                              </td>
                              <td className="py-2">
                                <div className="flex items-center gap-1.5">
                                  <PlayCallButton call={c} />
                                  {c.drive_link ? (
                                    <a href={c.drive_link} target="_blank" rel="noreferrer"
                                      className="text-[#ff7b54] hover:text-[#e66a46] transition-colors">
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    <span className="text-gray-200">—</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
