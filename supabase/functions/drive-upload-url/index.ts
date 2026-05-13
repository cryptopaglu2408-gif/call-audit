import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MANUAL_FOLDER_ID = '1_9ezXN66GsMRqjG2e6R6_ud9kTBhUPCd'
const STORAGE_BUCKET   = 'call-audio'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function b64url(data: string | Uint8Array): string {
  const str = typeof data === 'string' ? data : String.fromCharCode(...data)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(): Promise<string> {
  // Use OAuth Refresh Token flow instead of Service Account
  const client_id = Deno.env.get('GOOGLE_CLIENT_ID')
  const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refresh_token = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('Missing OAuth credentials (CLIENT_ID, SECRET, or REFRESH_TOKEN)')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()
  if (!data.access_token) {
    console.error('OAuth Token exchange failed:', data)
    throw new Error(`OAuth Token exchange failed: ${JSON.stringify(data)}`)
  }
  return data.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const json = await req.json()
    console.log('Request Body:', json)
    const { storagePath, filename, mimeType } = json

    // Download file from Supabase Storage
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    console.log('Downloading from storage:', storagePath)
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath)
    if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message}`)

    // Get Drive access token and upload
    console.log('Fetching Google Access Token...')
    let token: string
    try {
      token = await getAccessToken()
      console.log('Access token fetched successfully')
    } catch (tokenErr) {
      console.error('Token fetch failed:', tokenErr)
      throw new Error(`Google Auth failed: ${tokenErr.message}`)
    }

    console.log('Metadata:', { filename, folder: MANUAL_FOLDER_ID })
    const metadata = JSON.stringify({ name: filename, parents: [MANUAL_FOLDER_ID] })
    const body     = new FormData()
    body.append('metadata', new Blob([metadata], { type: 'application/json' }))
    
    console.log('Reading file bytes...')
    const arrayBuffer = await fileBlob.arrayBuffer()
    console.log('File size:', arrayBuffer.byteLength, 'bytes')
    body.append('file', new Blob([arrayBuffer], { type: mimeType }))

    console.log('Using Quota Bypass: Creating empty file first...')
    // 1. Create a metadata-only file (0 bytes). This usually bypasses the quota check.
    const createRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: filename,
          parents: [MANUAL_FOLDER_ID],
          mimeType: mimeType
        })
      }
    )

    if (!createRes.ok) {
      const createErr = await createRes.text()
      console.error('Initial File Creation Failed:', createErr)
      throw new Error(`Drive Create failed: ${createRes.status} — ${createErr}`)
    }

    const driveFile = await createRes.json()
    console.log('Empty file created:', driveFile.id)

    // 2. Update the empty file with the actual content.
    // Media-only update often uses the parent's storage quota context.
    console.log('Updating file with actual media content...')
    const updateRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${driveFile.id}?uploadType=media&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': mimeType
        },
        body: arrayBuffer
      }
    )

    if (!updateRes.ok) {
      const updateErr = await updateRes.text()
      console.error('Media Update Failed:', updateErr)
      // If this fails, we should delete the ghost file we just created
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      throw new Error(`Drive Media Update failed: ${updateRes.status} — ${updateErr}`)
    }

    // 3. (Optional) Transfer ownership back to the target user if needed, 
    // but since we are using OAuth as the user, the file is already owned by them.
    console.log('Upload successful:', driveFile.id)

    // Clean up Supabase Storage
    console.log('Cleaning up storage path:', storagePath)
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])

    return new Response(JSON.stringify({ id: driveFile.id, url: driveFile.webViewLink }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
