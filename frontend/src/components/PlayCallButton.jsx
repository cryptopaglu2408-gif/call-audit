import { Play, Pause, Loader2 } from 'lucide-react'
import { useAudioPlayer } from '../contexts/AudioPlayerContext'

export default function PlayCallButton({ call, className = '' }) {
  const { playCall, pause, state } = useAudioPlayer()
  if (!call?.drive_link) return null

  const isThis   = state.callId === call.id
  const loading  = isThis && state.loading
  const playing  = isThis && state.playing

  function handleClick(e) {
    e.stopPropagation()
    if (playing) pause()
    else playCall(call)
  }

  return (
    <button
      onClick={handleClick}
      title={playing ? 'Pause' : 'Play recording'}
      className={`flex items-center justify-center w-7 h-7 rounded-full transition-all
        ${isThis ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}
        ${className}`}
    >
      {loading  ? <Loader2 size={12} className="animate-spin" />
       : playing ? <Pause  size={12} />
                 : <Play   size={12} className="ml-0.5" />}
    </button>
  )
}
