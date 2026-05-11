const gradients = {
  green:  'from-green-500 to-emerald-600',
  purple: 'from-violet-500 to-purple-600',
  blue:   'from-sky-500 to-blue-600',
  red:    'from-rose-500 to-pink-600',
}

export default function KPICard({ label, value, sub, icon, accent = 'green', trend }) {
  return (
    <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-lg shadow-slate-100/50 border border-slate-100/80 p-5 flex flex-col gap-4 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-0.5 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradients[accent]} flex items-center justify-center text-lg shadow-sm`}>
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${trend >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-black text-slate-900 tabular tracking-tight">{value}</p>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 font-medium">{sub}</p>}
      </div>
    </div>
  )
}
