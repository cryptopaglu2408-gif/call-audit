import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROJECT_ID     = 'supersheldon-callaudit'
const LOCATION       = 'us-central1'
const MODEL          = 'gemini-2.5-flash'
const VERTEX_URL     = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`
const STORAGE_BUCKET = 'call-audio'

const TRANSCRIBE_PROMPT = `You are transcribing a sales call recording from SuperSheldon, an \
educational tutoring company operating in Australia and the UK. The sales agent has an Indian accent \
and is calling parents to pitch tutoring services for their children.

Important: "SuperSheldon" is the company name — the audio may pronounce it as "Super Children", \
"Super Stallion", or similar variations. Always transcribe it as "SuperSheldon".

Transcribe the full conversation accurately. Preserve speaker turns naturally (e.g. start each \
turn on a new line). Return ONLY the transcript text — no headings, no commentary, no timestamps.`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function b64url(data: string | Uint8Array): string {
  const str = typeof data === 'string' ? data : String.fromCharCode(...data)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 32768
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function getAccessToken(): Promise<string> {
  const sa  = JSON.parse(Deno.env.get('GOOGLE_SA_KEY') ?? '{}')
  const now = Math.floor(Date.now() / 1000)

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }))

  const signingInput = `${header}.${payload}`
  const pem      = sa.private_key.replace(/\\n/g, '\n')
  const keyDer   = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, ''))
  const keyBytes = Uint8Array.from(keyDer, c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput),
  )
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`)
  return data.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { storagePath, mimeType } = await req.json()
    if (!storagePath || !mimeType) throw new Error('Missing storagePath or mimeType')

    // Download audio from Supabase Storage
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const { data: blob, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath)
    if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message}`)

    const audioBytes = new Uint8Array(await blob.arrayBuffer())
    const audioB64   = toBase64(audioBytes)

    // Call Vertex AI for transcription
    const token = await getAccessToken()
    const res   = await fetch(VERTEX_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: TRANSCRIBE_PROMPT },
            { inlineData: { mimeType, data: audioB64 } },
          ],
        }],
        generationConfig: { temperature: 0.0 },
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Vertex AI error ${res.status}`)

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!transcript.trim()) throw new Error('Vertex AI returned an empty transcript')

    return new Response(
      JSON.stringify({ transcript: transcript.trim() }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
