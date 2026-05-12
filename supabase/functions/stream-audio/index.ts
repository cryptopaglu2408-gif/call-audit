import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function b64url(data: string | Uint8Array): string {
  const str = typeof data === 'string' ? data : String.fromCharCode(...data)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SA_KEY') ?? '{}')
  const now = Math.floor(Date.now() / 1000)

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
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
    false, ['sign']
  )
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`)
  return data.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { fileId } = await req.json()
    if (!fileId) throw new Error('fileId is required')

    const token    = await getAccessToken()
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!driveRes.ok) {
      const err = await driveRes.text()
      throw new Error(`Drive fetch failed: ${driveRes.status} — ${err}`)
    }

    const contentType = driveRes.headers.get('Content-Type') || 'audio/mpeg'
    return new Response(driveRes.body, {
      headers: { ...CORS, 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
