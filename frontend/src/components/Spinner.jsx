export default function Spinner({ text = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="w-8 h-8 border-2 border-slate-200 border-t-green-500 rounded-full animate-spin" />
      <span className="text-sm text-slate-400 font-medium">{text}</span>
    </div>
  )
}
