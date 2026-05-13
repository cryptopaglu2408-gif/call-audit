import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const PROJECT_ID = 'supersheldon-callaudit'
const LOCATION   = 'us-central1'
const MODEL      = 'gemini-2.5-flash'
const VERTEX_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`

// ── Scoring system — mirrors frontend/src/lib/gemini.js exactly ───────────────

const SCORE_CONTEXT = `You are a strict call-quality auditor for SuperSheldon, an educational \
tutoring company operating in Australia and the UK. SuperSheldon sales agents (Indian accents) \
call parents to pitch tutoring services for their children. You score calls against a rubric.`

type NumericCriteria = Record<string, [string, number, string][]>
type BinaryCriteria  = Record<string, string>
type CatCriteria     = Record<string, Record<string, string>>

const NUMERIC_CRITERIA: NumericCriteria = {
  'call opening': [
    ['a', 2, 'Agent stated their own first name in their opening utterance or within the first 15 seconds (e.g. "Hi, I\'m Priya")'],
    ['b', 2, 'Agent stated "SuperSheldon" as the company name within the first 30 seconds'],
    ['c', 2, 'Agent addressed the parent by name within the first 30 seconds — e.g. said "Is this [parent name]?" or used the parent\'s name directly'],
    ['d', 2, 'Agent asked a social or wellness question such as "How are you today?", "Hope I\'m not catching you at a bad time", or equivalent'],
    ['e', 2, 'Agent did NOT confuse or stumble over their own name, the company name ("SuperSheldon"), or the parent\'s name during the introduction — check the transcript for corrections, restarts, or wrong names'],
  ],
  'reason of call': [
    ['a', 2, 'Agent used explicit words to state the reason for calling — e.g. "I\'m calling about", "I\'m reaching out regarding", "I wanted to speak with you about" — AND linked it to the child\'s education or tutoring'],
    ['b', 2, 'Agent mentioned the child specifically — by name, or as "your son/daughter", "your child" — BEFORE making any offer or pitch'],
    ['c', 2, 'The reason for the call was fully communicated within the first 90 seconds of the call'],
    ['d', 2, 'Agent did NOT open with a direct sales pitch or offer in the first statement; call was framed as informational or supportive first (e.g. "I wanted to share some information", "I\'m checking in about")'],
    ['e', 2, 'After stating the reason, agent explicitly confirmed the parent is the decision-maker for the child\'s education (e.g. "Are you the parent of [child]?", "Do you handle decisions about [child]\'s schooling?") — this is distinct from the name verification in Call Opening'],
  ],
  'customer need assessment': [
    ['a', 2, 'Agent asked what year level or grade the child is currently in'],
    ['b', 2, 'Agent asked which subject(s) the child is struggling with or needs help in'],
    ['c', 2, 'Agent asked about the child\'s academic performance (grades, test results, teacher feedback)'],
    ['d', 2, 'Agent asked whether the family already has any tutoring or academic support in place'],
    ['e', 2, 'Agent listened and acknowledged responses before moving on — no rushing or interrupting'],
  ],
  'usp discussion': [
    ['a', 2, 'Agent mentioned SuperSheldon\'s personalised or 1-on-1 teaching approach'],
    ['b', 2, 'Agent mentioned the quality or experience of SuperSheldon\'s tutors'],
    ['c', 2, 'Agent mentioned specific results or outcomes achieved by SuperSheldon students'],
    ['d', 2, 'Agent linked at least one USP directly to the specific problem the parent described'],
    ['e', 2, 'Agent differentiated SuperSheldon from generic tutoring alternatives'],
  ],
  'demo session pitch': [
    ['a', 2, 'Agent explained what the demo session involves (format, duration, what to expect)'],
    ['b', 2, 'Agent stated the demo is free or no-obligation'],
    ['c', 2, 'Agent communicated a clear benefit or value proposition for attending the demo'],
    ['d', 2, 'Agent made a direct, explicit ask to book a demo session'],
    ['e', 2, 'Pitch was confident and clear — not rushed, mumbled, or overly tentative'],
  ],
  'closing': [
    ['a', 2, 'Agent summarised agreed next steps clearly before ending the call'],
    ['b', 2, 'Agent confirmed any booking, callback, or follow-up details (date, time, platform)'],
    ['c', 2, 'Agent thanked the parent for their time'],
    ['d', 2, 'Agent invited the parent to call back or ask questions if needed'],
    ['e', 2, 'Call ended professionally — no abrupt hangup, trailing off, or unresolved confusion'],
  ],
}

const BINARY_CRITERIA: BinaryCriteria = {
  'call duration > 3 min': 'Use ONLY the duration from Call Metadata. Award YES if duration > 180 s. Award NO if ≤ 180 s or if no metadata was provided. Do NOT estimate from transcript length.',
  'problem identified':    'Award YES only if the agent explicitly named or summarised a specific academic problem (e.g. "So Jake is struggling with Year 8 maths"). A vague reference to "needing help" or "falling behind" does NOT qualify. Award NO if no specific problem was stated.',
  'intent check done':     'Award YES only if the agent explicitly checked the parent\'s openness or interest before proceeding (e.g. "Does that sound like something you\'d be interested in?", "Are you open to finding out more?"). Simply continuing to pitch without checking is NOT sufficient. Award NO if no explicit intent check occurred.',
  'price discussed':       'Award YES only if the agent mentioned a specific price, price range, or pricing model in dollar terms (e.g. "$X per session", "from $Y per week"). Vague references to "affordability", "investment", or "we can discuss pricing later" do NOT qualify. Award NO if no specific price was mentioned.',
}

const CATEGORICAL_CRITERIA: CatCriteria = {
  'was demo scheduled': {
    '0': 'Agent did not mention or attempt to schedule a demo session at all.',
    '1': 'Agent mentioned or pitched a demo session but the parent explicitly declined.',
    '2': 'Parent agreed to a callback or follow-up to schedule a demo — no specific time confirmed.',
    '3': 'Demo session confirmed with a specific date and time during this call.',
  },
}

interface RubricParam { name: string; max_score: number; description?: string }

function normKey(name: string): string {
  return name.toLowerCase().replace(/\s*\?\s*$/, '').replace(/\s+/g, ' ').trim()
}

function buildParamRubric(p: RubricParam): string {
  const key         = normKey(p.name)
  const binary      = BINARY_CRITERIA[key]
  const categorical = CATEGORICAL_CRITERIA[key]
  const numeric     = NUMERIC_CRITERIA[key]

  if (binary) {
    return (
      `PARAMETER: ${p.name} — BINARY YES/NO (YES = ${p.max_score} pts, NO = 0 pts)\n` +
      `CRITERION: ${binary}\n` +
      `REASONING FORMAT: "EVIDENCE: '[exact quote]' | VERDICT: YES/NO | SCORE: ${p.max_score} or 0"`
    )
  }
  if (categorical) {
    const levels = Object.entries(categorical).map(([k, v]) => `  ${k} — ${v}`).join('\n')
    return (
      `PARAMETER: ${p.name} — CATEGORICAL (0–${p.max_score})\n` +
      `LEVELS:\n${levels}\n` +
      `REASONING FORMAT: "EVIDENCE: '[exact quote or NO EVIDENCE]' | LEVEL CHOSEN: N — [level description] | SCORE: N"`
    )
  }
  if (numeric) {
    const lines = numeric.map(([id, pts, desc]) => `  [${id}] +${pts} pts — ${desc}`).join('\n')
    return (
      `PARAMETER: ${p.name} — NUMERIC (0–${p.max_score})\n` +
      `SUB-CRITERIA (sum points for each YES):\n${lines}\n` +
      `REASONING FORMAT: "EVIDENCE: '[exact quote or NO EVIDENCE]' | [a] YES/NO [b] YES/NO [c] YES/NO [d] YES/NO [e] YES/NO | SCORE: N"`
    )
  }
  const desc = p.description ? ` — ${p.description}` : ''
  return `PARAMETER: ${p.name} — NUMERIC (0–${p.max_score})${desc}`
}

function buildScoringPrompt(transcript: string, rubricParams: RubricParam[], durationSeconds: number | null): string {
  const metaSection = durationSeconds != null
    ? `\n## CALL METADATA\nDuration: ${Math.floor(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s (${Math.round(durationSeconds)}s total) — Longer than 3 minutes: ${durationSeconds > 180 ? 'YES' : 'NO'}`
    : '\n## CALL METADATA\nDuration: not available'

  const rubricSection = rubricParams.map(p => buildParamRubric(p)).join('\n\n')

  return `${SCORE_CONTEXT}

## MANDATORY SCORING PROCESS — follow for EVERY parameter
You MUST work through these steps in order for each parameter. Do not skip any step.

  STEP 1 — EXTRACT: Find and quote the exact words from the transcript relevant to this parameter.
            If nothing relevant was said, write "NO EVIDENCE FOUND".
  STEP 2 — CHECK: Evaluate each sub-criterion (or binary criterion) using ONLY the extracted quote.
            Answer YES or NO for each. Do not infer, assume, or give credit for implied behaviour.
  STEP 3 — SCORE: Derive the score mechanically from Step 2 (sum of YES points, or binary verdict).
            The score must follow directly from Step 2 — do not adjust it based on overall call feel.

Place the output of all three steps in the "reasoning" field of each score entry.

## ABSOLUTE RULES
1. Score ONLY what is LITERALLY SAID. Never award credit for likely, implied, or probable behaviour.
2. Ambiguous or unclear evidence → score the LOWER possibility (conservative scoring).
3. BINARY parameters: score is EITHER 0 OR the full max — NEVER anything in between.
4. Call Duration: use ONLY the provided Call Metadata — NEVER estimate from transcript length.
5. You MUST score all ${rubricParams.length} parameters. If something did not happen, score it 0.
6. Agent name: extract from the agent's self-introduction only. Use null if not heard.
${metaSection}

## PARAMETER RUBRICS
${rubricSection}

## CALL TRANSCRIPT
${transcript}

## RESPONSE FORMAT
Respond ONLY with valid JSON — no markdown fences, no extra text:
{"agent_name":"<first name or null>","scores":[{"parameter":"<exact parameter name>","score":<integer>,"reasoning":"<EVIDENCE: '...' | sub-criteria results | SCORE: N>"}]}
You must return exactly ${rubricParams.length} score objects — one per parameter above, using the exact parameter name shown.`
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function b64url(data: string | Uint8Array): string {
  const str = typeof data === 'string' ? data : String.fromCharCode(...data)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
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

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { transcript, rubricParams, durationSeconds } = await req.json()
    if (!transcript || !Array.isArray(rubricParams)) throw new Error('Missing transcript or rubricParams')

    const prompt = buildScoringPrompt(transcript, rubricParams, durationSeconds ?? null)

    const token = await getAccessToken()
    const res   = await fetch(VERTEX_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `Vertex AI error ${res.status}`)

    const text   = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text)   throw new Error('Vertex AI returned empty scoring response')

    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed?.scores)) throw new Error('Unexpected scoring response shape')

    return new Response(
      JSON.stringify({ scores: parsed.scores, agentName: parsed.agent_name ?? null }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
