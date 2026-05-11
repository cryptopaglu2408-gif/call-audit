export default function ScoreBar({ parameter, score, maxScore }) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0
  const gradient = pct >= 70
    ? 'from-green-400 to-emerald-500'
    : pct >= 40
    ? 'from-amber-400 to-yellow-500'
    : 'from-rose-400 to-red-500'

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-medium text-slate-700">{parameter}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{score}/{maxScore}</span>
          <span className={`text-xs font-bold tabular ${pct >= 70 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-rose-500'}`}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
