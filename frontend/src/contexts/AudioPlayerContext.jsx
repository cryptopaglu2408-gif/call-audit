import { createContext, useContext, useRef, useState, useCallback } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

const Ctx = createContext(null)
export const useAudioPlayer = () => useContext(Ctx)

function getDriveFileId(link) {
  return link?.match(/\/file\/d\/([^/]+)/)?.[1] || null
}

export function AudioPlayerProvider({ children }) {
  const audioRef  = useRef(null)
  const blobCache = useRef({})   // callId → blobUrl

  const [state, setState] = useState({
    callId: null, filename: null, agentName: null,
    loading: false, playing: false,
    currentTime: 0, duration: 0, error: null,
  })

  function getAudio() {
    if (!audioRef.current) {
      const a = new Audio()
      a.addEventListener('timeupdate',     () => setState(s => ({ ...s, currentTime: a.currentTime })))
      a.addEventListener('durationchange', () => setState(s => ({ ...s, duration: isFinite(a.duration) ? a.duration : 0 })))
      a.addEventListener('playing',        () => setState(s => ({ ...s, playing: true,  loading: false })))
      a.addEventListener('pause',          () => setState(s => ({ ...s, playing: false })))
      a.addEventListener('ended',          () => setState(s => ({ ...s, playing: false })))
      audioRef.current = a
    }
    return audioRef.current
  }

  const playCall = useCallback(async (call) => {
    const fileId = getDriveFileId(call.drive_link)
    if (!fileId) return

    const filename  = call.metadata?.filename || `call-${call.id.slice(0, 8)}`
    const agentName = call.metadata?.agent_name || null
    setState(s => ({ ...s, callId: call.id, filename, agentName, loading: true, error: null, currentTime: 0, duration: 0 }))

    try {
      let blobUrl = blobCache.current[call.id]
      if (!blobUrl) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/stream-audio`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId }),
        })
        if (!res.ok) throw new Error(`Stream failed: ${res.status}`)
        const blob = await res.blob()
        blobUrl = URL.createObjectURL(blob)
        blobCache.current[call.id] = blobUrl
      }
      const audio = getAudio()
      audio.src = blobUrl
      audio.currentTime = 0
      await audio.play()
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }))
    }
  }, [])

  const pause  = useCallback(() => audioRef.current?.pause(), [])
  const resume = useCallback(() => audioRef.current?.play(), [])
  const seek   = useCallback((t) => { if (audioRef.current) audioRef.current.currentTime = t }, [])
  const stop   = useCallback(() => {
    audioRef.current?.pause()
    setState(s => ({ ...s, callId: null, playing: false, currentTime: 0, duration: 0 }))
  }, [])

  return (
    <Ctx.Provider value={{ state, playCall, pause, resume, seek, stop }}>
      {children}
    </Ctx.Provider>
  )
}
