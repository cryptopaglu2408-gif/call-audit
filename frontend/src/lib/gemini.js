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

const SCORE_SYSTEM_PROMPT = `You are a senior call-quality auditor for SuperSheldon, an educational \
tutoring company in Australia and the UK. SuperSheldon's sales agents (with Indian accents) call \
parents to pitch tutoring services for their children.

Evaluate the call transcript against the rubric parameters below. Be strict and fair — only award \
credit for things that actually happened in the call. Cite specific moments from the transcript in \
your reasoning (1-2 sentences per parameter).`

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

function getMimeType(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.split('.').pop().toLowerCase()
  return MIME_MAP[ext] || 'audio/mpeg'
}

async function callGemini(body) {
  const res = await fetch(
    `${BASE_URL}/models/${MODEL}:generateContent?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`)
  }
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function transcribeAudio(file) {
  const base64   = await fileToBase64(file)
  const mimeType = getMimeType(file)

  const text = await callGemini({
    contents: [{
      parts: [
        { text: TRANSCRIBE_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0.0 },
  })

  if (!text.trim()) throw new Error('Gemini returned an empty transcript.')
  return text.trim()
}

export async function scoreTranscript(transcript, rubricParams, { durationSeconds } = {}) {
  const paramLines = rubricParams.map(p => {
    const criteria = p.description ? ` — "${p.description}"` : ''
    if (p.type === 'yes_no') return `  - ${p.name}${criteria}: YES=${p.max_score} / NO=0  ← BINARY ONLY, no partial credit`
    if (p.type === 'categorical') return `  - ${p.name}${criteria}: integer 0–${p.max_score}  ← pick the closest level`
    return `  - ${p.name}${criteria}: integer 0–${p.max_score}`
  }).join('\n')

  const metaSection = durationSeconds != null
    ? `\n## Call Metadata\n- Duration: ${Math.floor(durationSeconds / 60)}m ${Math.round(durationSeconds % 60)}s (${Math.round(durationSeconds)}s total)\n- Longer than 3 minutes: ${durationSeconds > 180 ? 'YES' : 'NO'}`
    : ''

  const prompt = [
    SCORE_SYSTEM_PROMPT,
    '\n## SCORING RULES',
    '1. YES/NO parameters (marked BINARY): score must be EITHER 0 OR the full max — never 1 on a max-2 parameter.',
    '2. Only award YES if the thing clearly happened. If absent, uncertain, or cut short → 0.',
    '3. Numeric parameters: use the full range 0–max, be proportional to quality.',
    '4. Agent name: identify the sales agent\'s first name from their self-introduction at the start of the call (e.g. "Hi, I\'m Priya calling from SuperSheldon"). If unclear or absent, use null.',
    metaSection,
    `\n## Rubric Parameters\n${paramLines}`,
    `\nFull rubric (JSON):\n${JSON.stringify(rubricParams, null, 2)}`,
    `\n## Call Transcript\n${transcript}`,
    '\nRespond ONLY with a JSON object: {"agent_name":"<first name or null>","scores":[{"parameter":"<name>","score":<integer>,"reasoning":"<1-2 sentences>"},...]}',
  ].join('\n')

  const text = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  })

  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.scores)) throw new Error('Unexpected scoring response shape.')
  return { scores: parsed.scores, agentName: parsed.agent_name || null }
}
