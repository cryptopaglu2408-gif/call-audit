const API_KEY  = import.meta.env.VITE_GEMINI_API_KEY
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL    = 'gemini-2.5-flash'

const MIME_MAP = {
  mp3:  'audio/mpeg',
  mp4:  'audio/mp4',
  m4a:  'audio/mp4',
  wav:  'audio/wav',
  ogg:  'audio/ogg',
  webm: 'audio/webm',
  aac:  'audio/aac',
  flac: 'audio/flac',
  mpeg: 'audio/mpeg',
}

const TRANSCRIBE_PROMPT = `You are transcribing a sales call recording from SuperSheldon, an \
educational tutoring company operating in Australia and the UK. The sales agent has an Indian accent \
and is calling parents to pitch tutoring services for their children.

Important: "SuperSheldon" is the company name — the audio may pronounce it as "Super Children", \
"Super Stallion", or similar variations. Always transcribe it as "SuperSheldon".

Transcribe the full conversation accurately. Preserve speaker turns naturally (e.g. start each \
turn on a new line). Return ONLY the transcript text — no headings, no commentary, no timestamps.`

// ── Scoring system ────────────────────────────────────────────────────────────
//
// Design principles (G-Eval / RULERS research):
//   1. evidence extraction before scoring eliminates post-hoc rationalisation
//   2. analytic sub-criteria (checklist) eliminate holistic judgement variance
//   3. temperature=0 eliminates sampling noise
//   4. binary params need explicit "no partial credit" wording
//
// Parameter name lookup is normalized so minor spacing/? differences still match.

const SCORE_CONTEXT = `You are a strict call-quality auditor for SuperSheldon, an educational \
tutoring company operating in Australia and the UK. SuperSheldon sales agents (Indian accents) \
call parents to pitch tutoring services for their children. You score calls against a rubric.`

// Sub-criteria per numeric parameter (key = normalized lowercase name without trailing ?)
// Each tuple: [id, points, observable behaviour to check]
const NUMERIC_CRITERIA = {
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

// Binary (YES/NO) parameter definitions — what exactly qualifies as YES
const BINARY_CRITERIA = {
  'call duration > 3 min': 'Use ONLY the duration from Call Metadata. Award YES if duration > 180 s. Award NO if ≤ 180 s or if no metadata was provided. Do NOT estimate from transcript length.',
  'problem identified': 'Award YES only if the agent explicitly named or summarised a specific academic problem (e.g. "So Jake is struggling with Year 8 maths"). A vague reference to "needing help" or "falling behind" does NOT qualify. Award NO if no specific problem was stated.',
  'intent check done': 'Award YES only if the agent explicitly checked the parent\'s openness or interest before proceeding (e.g. "Does that sound like something you\'d be interested in?", "Are you open to finding out more?"). Simply continuing to pitch without checking is NOT sufficient. Award NO if no explicit intent check occurred.',
  'price discussed': 'Award YES only if the agent mentioned a specific price, price range, or pricing model in dollar terms (e.g. "$X per session", "from $Y per week"). Vague references to "affordability", "investment", or "we can discuss pricing later" do NOT qualify. Award NO if no specific price was mentioned.',
}

// Categorical parameter level definitions
const CATEGORICAL_CRITERIA = {
  'was demo scheduled': {
    0: 'Agent did not mention or attempt to schedule a demo session at all.',
    1: 'Agent mentioned or pitched a demo session but the parent explicitly declined.',
    2: 'Parent agreed to a callback or follow-up to schedule a demo — no specific time confirmed.',
    3: 'Demo session confirmed with a specific date and time during this call.',
  },
}

function normKey(name) {
  return name.toLowerCase().replace(/\s*\?\s*$/, '').replace(/\s+/g, ' ').trim()
}

function buildParamRubric(p) {
  const key = normKey(p.name)
  const binary = BINARY_CRITERIA[key]
  const categorical = CATEGORICAL_CRITERIA[key]
  const numeric = NUMERIC_CRITERIA[key]

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
  // Fallback for unknown parameters
  const desc = p.description ? ` — ${p.description}` : ''
  return `PARAMETER: ${p.name} — NUMERIC (0–${p.max_score})${desc}`
}

export function getFileDuration(file) {
  return new Promise(resolve => {
    const audio = new Audio()
    audio.onloadedmetadata = () => { URL.revokeObjectURL(audio.src); resolve(isFinite(audio.duration) ? audio.duration : null) }
    audio.onerror = () => resolve(null)
    audio.src = URL.createObjectURL(file)
  })
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function getMimeType(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.split('.').pop().toLowerCase()
  return MIME_MAP[ext] || 'audio/mpeg'
}

// Files above this size go through the File API (resumable upload) instead of
// base64 inline_data, which has a ~20 MB total request limit.
const MAX_INLINE_BYTES = 15 * 1024 * 1024   // 15 MB (leaves headroom for base64 overhead)
const UPLOAD_BASE_URL  = 'https://generativelanguage.googleapis.com/upload/v1beta'

async function callGemini(body) {
  const res = await fetch(
    `${BASE_URL}/${MODEL}:generateContent?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`)
  }
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

async function uploadToFileApi(file, mimeType) {
  // Step 1: initiate resumable upload session
  const initRes = await fetch(
    `${UPLOAD_BASE_URL}/files?key=${API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    }
  )
  if (!initRes.ok) throw new Error(`File API init failed: ${initRes.status}`)
  const uploadUrl = initRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('File API did not return an upload URL')

  // Step 2: upload all bytes and finalize in one shot
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mimeType,
    },
    body: file,
  })
  if (!uploadRes.ok) throw new Error(`File API upload failed: ${uploadRes.status}`)
  const uploadData = await uploadRes.json()
  const fileUri    = uploadData.file?.uri
  if (!fileUri) throw new Error('File API upload returned no URI')

  // Step 3: poll until the file is ACTIVE (Gemini processes audio async)
  for (let i = 0; i < 20; i++) {
    const checkRes  = await fetch(`${fileUri}?key=${API_KEY}`)
    const checkData = await checkRes.json()
    const state     = checkData.state ?? checkData.file?.state
    if (state === 'ACTIVE') return fileUri
    if (state === 'FAILED') throw new Error('Gemini File API processing failed')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Gemini File API: file did not become active in time')
}

export async function transcribeAudio(file) {
  const mimeType = getMimeType(file)
  let audioPart

  if (file.size <= MAX_INLINE_BYTES) {
    const base64 = await fileToBase64(file)
    audioPart = { inline_data: { mime_type: mimeType, data: base64 } }
  } else {
    // Large file — upload via File API, use URI reference
    const fileUri = await uploadToFileApi(file, mimeType)
    audioPart = { file_data: { mime_type: mimeType, file_uri: fileUri } }
  }

  const text = await callGemini({
    contents: [{ role: 'user', parts: [{ text: TRANSCRIBE_PROMPT }, audioPart] }],
    generationConfig: { temperature: 0.0 },
  })

  if (!text.trim()) throw new Error('Gemini returned an empty transcript.')
  return text.trim()
}

export function buildScoringPrompt(transcript, rubricParams, { durationSeconds } = {}) {
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

export async function scoreTranscript(transcript, rubricParams, options = {}) {
  const prompt = buildScoringPrompt(transcript, rubricParams, options)
  const text = await callGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
    },
  })

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.scores)) throw new Error('Unexpected scoring response shape.')
  return { scores: parsed.scores, agentName: parsed.agent_name || null }
}
