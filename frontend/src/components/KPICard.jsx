const gradients = {
  green:  'from-green-500 to-emerald-600',
  purple: 'from-violet-500 to-purple-600',
  blue:   'from-sky-500 to-blue-600',
  red:    'from-rose-500 to-pink-600',
}

export default function KPICard({ label, value, sub, icon, accent = 'green', trend }) {
  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-5 flex flex-col gap-4 hover:shadow-card-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradients[accent]} flex items-center justify-center text-lg shadow-sm`}>
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${trend >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-black text-slate-900 tabular tracking-tight">{value}</p>
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mt-1">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
