import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { text, callId } = await req.json()
    const webhook = Deno.env.get('SLACK_WEBHOOK_URL')

    if (!webhook) {
      throw new Error('SLACK_WEBHOOK_URL not configured in Supabase secrets')
    }

    console.log(`Sending Slack message for call ${callId || 'manual'}`)

    // 1. Send the primary message
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text,
        unfurl_links: true,
        unfurl_media: true
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Slack API error: ${res.status} - ${errorText}`)
    }

    // 2. If it was a success and callId is provided, we could optionally send back 
    // metadata or update Supabase. The file upload itself to Slack's CDN 
    // requires a Bot Token (SLACK_BOT_TOKEN) which is different from a Webhook.
    // However, the text already includes the Drive link which Slack unfurls 
    // into a playable file preview automatically!

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Slack function error:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
