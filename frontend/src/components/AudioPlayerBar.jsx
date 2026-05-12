import { Play, Pause, X, Loader2, Music } from 'lucide-react'
import { useAudioPlayer } from '../contexts/AudioPlayerContext'

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export default function AudioPlayerBar() {
  const { state, pause, resume, seek, stop } = useAudioPlayer()
  const { callId, filename, agentName, loading, playing, currentTime, duration, error } = state

  if (!callId) return null

  const pct = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0d1117]/95 backdrop-blur-md border-t border-white/8 px-6 py-3 flex items-center gap-6 shadow-2xl">

      {/* Track info */}
      <div className="flex items-center gap-3 w-56 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <Music size={15} className="text-emerald-400" />
        </div>
        <div className="min-w-0">
          <p className="text-white text-xs font-bold truncate leading-tight">{filename}</p>
          <p className="text-white/35 text-[10px] font-medium truncate mt-0.5">
            {agentName || 'Unknown agent'}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
        <button
          onClick={playing ? pause : resume}
          disabled={loading}
          className="w-8 h-8 rounded-full bg-white hover:scale-105 active:scale-95 transition-transform flex items-center justify-center disabled:opacity-50 shadow-lg"
        >
          {loading
            ? <Loader2 size={13} className="text-black animate-spin" />
            : playing
            ? <Pause  size={13} className="text-black" />
            : <Play   size={13} className="text-black ml-0.5" />
          }
        </button>

        <div className="flex items-center gap-2.5 w-full max-w-md">
          <span className="text-white/30 text-[10px] font-mono tabular-nums w-8 text-right shrink-0">
            {fmt(currentTime)}
          </span>
          <div
            className="flex-1 h-1 bg-white/10 rounded-full cursor-pointer relative group"
            onClick={e => {
              if (!duration) return
              const rect = e.currentTarget.getBoundingClientRect()
              seek(((e.clientX - rect.left) / rect.width) * duration)
            }}
          >
            <div
              className="h-full bg-emerald-400 rounded-full"
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>
          <span className="text-white/30 text-[10px] font-mono tabular-nums w-8 shrink-0">
            {fmt(duration)}
          </span>
        </div>

        {error && <p className="text-rose-400 text-[10px] font-medium">{error}</p>}
      </div>

      {/* Close */}
      <div className="w-56 flex justify-end shrink-0">
        <button
          onClick={stop}
          className="p-2 text-white/25 hover:text-white hover:bg-white/8 rounded-xl transition-colors"
          title="Close player"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
