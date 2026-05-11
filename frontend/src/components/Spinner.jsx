export default function Spinner({ text = 'Loading…', dark = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className={`w-8 h-8 border-2 rounded-full animate-spin ${dark ? 'border-white/10 border-t-emerald-400' : 'border-slate-200 border-t-green-500'}`} />
      <span className={`text-sm font-medium ${dark ? 'text-white/30' : 'text-slate-400'}`}>{text}</span>
    </div>
  )
}
