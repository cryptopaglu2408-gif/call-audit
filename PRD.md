# Call Audit — Product Requirements Document

> An end-to-end, fine-tunable call-quality auditing pipeline. Upload a sheet of recorded sales/support calls, transcribe each one locally, score it against a configurable rubric using a self-hosted Gemma 4 judge that you can fine-tune on your own gold-standard data, and inspect results through a modern dashboard.

---

## 1. Executive Summary

Call Audit replaces the manual labor of auditing recorded sales calls — currently done by a human auditor scoring each call against a quality rubric in a Google Form — with an automated pipeline that produces calibrated, auditor-aligned scores at scale.

The system ingests a spreadsheet of Google Drive audio links, transcribes each call with `faster-whisper`, and scores it against a user-defined rubric using **Gemma 4 E4B** running self-hosted via Hugging Face transformers + a fine-tuned LoRA adapter. The adapter is trained on the customer's own historical human-audited data, making the model **measurably better than off-the-shelf LLM-as-judge approaches** on that customer's specific rubric and conversational style.

**MVP goal:** ship a deployed system where a non-technical auditor can upload a sheet of demo calls, walk away, and return to a dashboard of per-call scores — with the back-end model fine-tuned on the customer's own 358-row gold-standard dataset, achieving meaningful agreement with the human auditors who originally scored that data.

---

## 2. Mission

**Mission:** Automate call-quality audit at the calibration of a senior human auditor — not at the level of generic LLM scoring.

**Core principles:**
1. **Customer-specific, not one-size-fits-all.** The judge is fine-tuned on the customer's own rubric and historical scores, not a generic prompt.
2. **Self-hosted, not API-rented.** Trained adapter lives on the customer's HF Hub repo; inference runs on their HF Space. No per-call charges to Anthropic/OpenAI.
3. **CPU-friendly by default.** Local transcription (`faster-whisper`) and inference (Gemma 4 via transformers/Ollama) work on commodity hardware. GPU only required for fine-tuning.
4. **Idempotent + resumable.** Every long-running step (download, transcribe, score) can be safely re-run; already-processed work is skipped, errors are retryable.
5. **Two-tier UI.** A static React frontend talks directly to Supabase for reads (instant dashboards, no API hop); writes/processing/search go through a small FastAPI service.

---

## 3. Target Users

### Primary persona — Quality-Audit Lead at an EdTech sales org
- Currently has 1-3 auditors hand-scoring ~100 demo calls/week on a Google Form
- Needs throughput of 500+ calls/week without growing the audit team
- Cares more about **score agreement with their existing auditors** than about absolute "AI accuracy"
- Has a backlog of 358+ already-audited calls in a Google Sheet ready to use as training data

### Secondary persona — Sales / CX Operations Manager
- Browses the dashboard to spot agents scoring poorly on specific rubric parameters
- Uses semantic search to find calls matching specific situations ("customer asked about refund," "agent didn't pitch demo")
- Doesn't run pipelines; consumes the output

### Technical comfort
- The Quality-Audit Lead is comfortable with Google Sheets, not git/CLI
- A junior dev or technical PM owns the deployment (Netlify, Supabase, HF Spaces)
- Anyone in the org can use the React frontend without training

---

## 4. MVP Scope

### ✅ In Scope

**Core functionality**
- ✅ Configurable scoring rubric (numeric 1-10, yes/no, 3-way categorical)
- ✅ Spreadsheet upload (.xlsx / .csv) with Google Drive audio links
- ✅ Per-row pipeline: download → transcribe → score → embed → persist
- ✅ Real-time progress streaming (SSE) during pipeline execution
- ✅ Results dashboard: KPIs, status donut, daily score trend, score-by-parameter, recent calls
- ✅ Per-call inspector: full transcript + per-parameter score + reasoning
- ✅ Semantic search over transcripts (pgvector + sentence-transformers)
- ✅ Idempotent ingestion (rerunning skips already-processed rows)

**Technical**
- ✅ `faster-whisper` int8 CPU transcription (auto-promotes to fp16 on CUDA)
- ✅ Gemma 4 E4B judge via Ollama (CPU) or HF transformers (GPU)
- ✅ Authenticated Drive API download path (bypasses anonymous quota)
- ✅ Custom LoRA adapter loading via PEFT
- ✅ pgvector semantic search RPC

**Integration**
- ✅ Supabase Postgres + Storage + pgvector
- ✅ Hugging Face Hub for hosting trained adapters
- ✅ Hugging Face Spaces for FastAPI runtime
- ✅ Netlify for frontend deploy

**Training pipeline**
- ✅ Seed rubric from the existing "Demo Quality Check Form" (10 params)
- ✅ Bulk import of 358 historical audited rows + their gold scores
- ✅ Verification script comparing xlsx → Supabase row-by-row
- ✅ Drive-link diagnostic script (permission vs rate-limit classifier)
- ✅ JSONL export in chat-format for QLoRA training
- ✅ Unsloth-based fine-tuning script tuned for Gemma 4 E4B
- ✅ Colab playbook (`training/COLAB.md`) for end-to-end GPU run

### ❌ Out of Scope (MVP)

- ❌ True speaker diarization (Speaker A vs Speaker B) — segments are time-aligned only; add `pyannote-audio` later
- ❌ Inline score-correction UI in Results page (corrections currently require Supabase SQL editor)
- ❌ Active learning loop that prioritizes low-confidence calls for human review
- ❌ Multi-tenant / org-level isolation (single Supabase project per deployment)
- ❌ Cost-tracking / usage analytics
- ❌ Real-time call audit (live, mid-call) — batch only
- ❌ Drive service-account flow (assumes "Anyone with the link" sharing)
- ❌ Anthropic/OpenAI judge fallback (removed — Gemma 4 only)
- ❌ NVIDIA Canary-Qwen transcription (removed — `faster-whisper` only)
- ❌ Row-level Supabase RLS policies (dev: disabled; prod: customer's responsibility)

---

## 5. User Stories

**1. Audit Lead — bulk audit a week's calls**
> *As an Audit Lead, I want to upload last week's call recordings sheet and walk away, so that I return to a fully-scored dashboard without doing the auditing manually.*
>
> **Example:** Drag `weekly-calls-2026-W19.xlsx` (50 rows) into the Process page → pick the Drive link column → click *Process*. Pipeline runs unattended; she returns 30 min later and sees all 50 calls scored on the Dashboard.

**2. Audit Lead — keep using their existing rubric**
> *As an Audit Lead, I want the system to score against my existing 10-parameter rubric (Call Opening, Customer Need Assessment, Demo Session Pitch, etc.), so that I don't have to redesign or compromise the audit framework.*
>
> **Example:** She opens the Rubric page, sees her 10 parameters with descriptions and max_scores, and hits *Save & set active*. Future calls are scored on those exact fields — including the yes/no and 3-way fields.

**3. Operations Manager — spot weak agents**
> *As an Operations Manager, I want to see which agents score lowest on Demo Session Pitch this month, so I can target coaching.*
>
> **Example:** Dashboard's *Score by Parameter* donut shows Demo Session Pitch is the lowest-average parameter at 6.2/10. She filters by agent name (in metadata) and finds two reps consistently below 5.

**4. Operations Manager — find specific situations**
> *As an Operations Manager, I want to find all calls where the customer mentioned a refund, so that I can audit how reps handle them.*
>
> **Example:** Results → Semantic Search → "customer asking for refund or money back" → top 10 transcripts. She listens to a few and writes a coaching tip.

**5. ML Engineer — fine-tune on the company's own data**
> *As the ML Engineer, I want to train a custom adapter on our 358 historical audited calls, so that the model agrees with our auditors better than the base Gemma model.*
>
> **Example:** Runs `python -m training.seed_demo_rubric`, then `import_demo_dataset` to bulk-import. On Colab, runs `finetune_gemma --epochs 3` and pushes the resulting `~/call-audit-v1` adapter to her HF Hub.

**6. ML Engineer — deploy the adapter without touching code**
> *As the ML Engineer, I want to point the production system at a new adapter version by changing one env var, so that I can A/B test new fine-tunes safely.*
>
> **Example:** In the HF Space's Variables and Secrets, she changes `GEMMA_ADAPTER` from `me/call-audit-v1` to `me/call-audit-v2` and restarts the Space. The judge picks up the new adapter on next request.

**7. Auditor — sanity-check a call the model scored**
> *As an Auditor, I want to read the transcript and the model's reasoning side-by-side for any call, so that I can quickly verify or override its judgment.*
>
> **Example:** Results page → click a row → left panel shows the full transcript, right panel shows each parameter with the model's score and 1-2 sentences of justification.

**8. Audit Lead — process partial / resume after failures**
> *As an Audit Lead, I want the pipeline to resume cleanly after Colab disconnects or a download fails, so that I don't lose hours of progress.*
>
> **Example:** Cell 5 disconnects after row 200 of 358. She re-runs the same cell; rows 1-200 are skipped (transcripts already saved); processing continues from 201.

---

## 6. Core Architecture & Patterns

### High-level architecture

```
┌─────────────────────┐       reads (anon key)        ┌─────────────────┐
│  Netlify (React)    │ ───────────────────────────▶  │   Supabase      │
│  Vite + Tailwind    │                               │   Postgres      │
│  Recharts           │ ─── writes / processing ─┐    │   Storage       │
└──────────┬──────────┘                           │    │   pgvector      │
           │                                      ▼    └────────┬────────┘
           │                       ┌────────────────────┐       │
           │  /api/process (SSE)   │  HF Space (Docker) │  service-role
           └─────────────────────▶ │   FastAPI          │       │
                                   │   faster-whisper   │ ◀─────┘
                                   │   Gemma 4 E4B + ────┐
                                   │     LoRA adapter   ││
                                   │   sentence-trans   ││
                                   └────────────────────┘│
                                                         ▼
                                               ┌─────────────────┐
                                               │  HF Hub         │
                                               │  call-audit-v1  │
                                               │  (LoRA adapter) │
                                               └─────────────────┘
```

### Directory structure

```
call-audit/
├── app.py                      # Streamlit entry (legacy UI, still functional)
├── requirements.txt            # python runtime
├── requirements-train.txt      # Unsloth QLoRA (fine-tuning only)
├── supabase/schema.sql         # Postgres + pgvector schema
├── src/                        # python pipeline + Streamlit pages
│   ├── config.py               # env-loaded Settings
│   ├── db.py                   # Supabase wrapper
│   ├── ingest.py               # sheet parsing + gdown + Drive API
│   ├── transcribe.py           # faster-whisper
│   ├── score.py                # Gemma judge (Ollama + HF transformers)
│   ├── embed.py                # sentence-transformers (384-d)
│   ├── pipeline.py             # orchestrator
│   ├── theme.py                # Streamlit CSS theme
│   └── pages/                  # Streamlit pages
├── api/                        # FastAPI service (HF Space target)
│   └── main.py                 # /api/process (SSE), /api/search
├── web/                        # React frontend (Netlify target)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── components/         # Sidebar, Topbar, KpiCard, Panel
│       ├── pages/              # Dashboard, Process, Rubric, Results
│       └── lib/                # supabase.ts, api.ts, types.ts
└── training/
    ├── seed_demo_rubric.py     # one-shot rubric seed
    ├── import_demo_dataset.py  # xlsx → Supabase bulk importer
    ├── verify_import.py        # xlsx ↔ DB row-by-row diff
    ├── check_drive_links.py    # Drive permission/rate-limit classifier
    ├── export_dataset.py       # Supabase → JSONL chat format
    ├── finetune_gemma.py       # Unsloth QLoRA driver
    ├── COLAB.md                # end-to-end Colab playbook
    └── README.md
```

### Key design patterns

- **Reads from Supabase, writes through API.** The frontend uses the anon key for `select` queries on `calls`, `scores`, `rubrics` — that gives instant dashboards with no API roundtrip. Only writes (file upload, processing trigger, semantic search) go through FastAPI, which uses the service-role key.
- **SSE streaming for long-running ops.** `POST /api/process` returns a token immediately; the frontend opens an `EventSource` on `/api/process/{token}/stream` and renders per-row progress events as the pipeline executes.
- **Idempotent + resumable everywhere.** Every database write is keyed on a stable identifier (`drive_link` for calls, `call_id+rubric_id+parameter` for scores). Re-running any importer skips work that's already done.
- **Lazy backend selection.** `LLM_PROVIDER=ollama` (default, CPU-friendly) and `LLM_PROVIDER=gemma` (HF transformers, fine-tunable) selected at runtime via env var; same `LLMJudge` interface.
- **Adapter loading without code change.** Setting `GEMMA_ADAPTER=user/repo-name` in the Space's secrets makes the runtime overlay a fine-tuned LoRA on the base model — no rebuild needed.

---

## 7. Tools / Features

### Rubric editor (`/rubric`)
- Create or edit a scoring rubric with mixed parameter types
- Per-parameter: `name`, `description` (LLM-readable), `max_score`, `kind` (`numeric`, `yes_no`, `categorical_3`)
- Only one rubric is `is_active = true` at a time (enforced by partial unique index)
- Past rubrics are preserved; can re-activate any historical one

### Process page (`/process`)
- Upload `.xlsx` or `.csv` (parsed in-browser via SheetJS for instant column preview)
- Pick the audio-link column from a dropdown of detected columns
- Choose row range (`from`, `to` — 1-indexed matching Excel's display)
- Submit to FastAPI; receive a job token
- Open SSE stream and render live updates: `[12/50] row 13: transcribing` → `transcribed (245s, lang=en)` → `scored=10`
- Failed rows show inline with status `error` and the underlying exception

### Dashboard (`/dashboard`)
- 4 KPI cards: Total Calls, Audited Calls, Average Score, Failed Calls — pastel cards with green/red delta pills
- Service-level donut (status breakdown: done / pending / error)
- Daily Score Trend bar chart (Weekly / Monthly toggle)
- Call Duration trend (recent 60 calls, area chart)
- Score-by-Parameter pie (one slice per rubric param, average across all calls)
- Recent Calls table (last 8, with status pill + duration + processed time)

### Results page (`/results`)
- Two tabs: **Calls** and **Semantic search**
- Calls tab: full call list with aggregate score %, click a row → split view of transcript + per-parameter scores with reasoning
- Search tab: free-text query → vector search via `match_calls` RPC → ranked transcripts with similarity score

### Pipeline orchestrator (`pipeline.py`)
- One generator function yields `StepUpdate` events per row at each stage (`create` / `download` / `upload` / `transcribe` / `embed` / `score` / `done` / `error`)
- Wraps every row in `try/except` with proper status tracking — one bad row never kills the run
- Cleans up local audio files immediately after upload (controlled by `delete_local_audio`)

### Transcription (`faster-whisper`)
- Default `WHISPER_MODEL=small` (~250MB int8, ~1× real-time on CPU)
- VAD-filtered to skip silence
- Auto-detects language (English/Hindi/Tamil all observed in the gold dataset)
- Returns text + per-segment timing for future diarization

### Judge (Gemma 4)
- **Default path:** Ollama daemon, model `gemma3:4b` or `hf.co/unsloth/gemma-4-E4B-it-GGUF:Q4_K_M`
- **Fine-tunable path:** HF transformers, `google/gemma-4-E4B-it` + LoRA adapter via PEFT
- Prompted JSON output mode (Gemma 4 supports native tool calling but JSON-only is simpler/cheaper)
- Output validated and clamped per-parameter to `[1, max_score]`

### Drive ingestion
- Two paths: anonymous `gdown` (laptops, dev) and **authenticated Drive API via `google-api-python-client`** (Colab, prod)
- Authenticated path required for bulk processing — anonymous quota is ~50 downloads per IP per day
- 4-attempt exponential-backoff retry on every download
- Detects bare-filename rows (3/358 in the demo dataset) and skips cleanly with `status=skipped`

### Demo Quality Check rubric (10 parameters)

| Parameter | Type | Encoding |
|---|---|---|
| Call Opening | numeric | 1-10 |
| Reason of Call | numeric | 1-10 |
| Customer Need Assessment | numeric | 1-10 |
| Problem Identified ? | yes/no | No=1, Yes=2 |
| USP Discussion ? | numeric | 1-10 |
| Intent Check Done ? | yes/no | No=1, Yes=2 |
| Demo Session Pitch | numeric | 1-10 |
| Price Discussed ? | yes/no | No=1, Yes=2 |
| Closing ? | numeric | 1-10 |
| Was Demo Scheduled ? | 3-way | No=1, Callback=2, Yes=3 |

Encoded uniformly as integer scores against an integer `max_score`. Each parameter's `description` field tells the LLM the encoding ("Yes (=2), No (=1)").

### Training pipeline

| Script | Purpose |
|---|---|
| `seed_demo_rubric.py` | Inserts the 10-param rubric into Supabase (one-shot) |
| `import_demo_dataset.py` | For each xlsx row: download audio → Whisper transcribe → save call + gold scores. Idempotent. |
| `verify_import.py` | Diff xlsx ↔ Supabase to confirm every row + every parameter encoded correctly |
| `check_drive_links.py` | Classify Drive URLs: OK / PERMISSION / RATE_LIMIT / NOT_FOUND |
| `export_dataset.py` | Pull (transcript, gold-scores) pairs from Supabase → chat-format JSONL |
| `finetune_gemma.py` | Unsloth QLoRA training driver — produces `adapter_config.json` + `adapter_model.safetensors` |
| `COLAB.md` | Cell-by-cell playbook for the entire Colab GPU run |

---

## 8. Technology Stack

### Backend (Python 3.10+)
| Component | Library | Version |
|---|---|---|
| Web framework (legacy) | streamlit | ≥ 1.36 |
| Web framework (prod) | fastapi + uvicorn | ≥ 0.115, ≥ 0.30 |
| Multipart upload | python-multipart | ≥ 0.0.9 |
| Transcription | faster-whisper | ≥ 1.0 |
| Judge (CPU) | ollama | ≥ 0.3 |
| Judge (GPU/fine-tune) | transformers, peft, accelerate | ≥ 4.43, ≥ 0.12, ≥ 0.33 |
| Embeddings | sentence-transformers | ≥ 3.0 |
| DB client | supabase | ≥ 2.7 |
| Drive download (anon) | gdown | ≥ 5.2 |
| Drive download (auth) | google-api-python-client | (Colab default) |
| Sheet parsing | pandas + openpyxl | ≥ 2.2, ≥ 3.1 |
| Charts (Streamlit) | plotly | ≥ 5.20 |
| Settings | python-dotenv, pydantic | ≥ 1.0, ≥ 2.7 |

### Frontend (Node 18+)
| Component | Library | Version |
|---|---|---|
| Framework | react + react-dom | ^18.3 |
| Build | vite + @vitejs/plugin-react | ^5.4 |
| Routing | react-router-dom | ^6.26 |
| Styling | tailwindcss + autoprefixer | ^3.4 |
| Charts | recharts | ^2.13 |
| Icons | lucide-react | ^0.453 |
| Sheet parsing (browser) | xlsx (SheetJS) | 0.20.3 |
| DB client | @supabase/supabase-js | ^2.45 |
| Types | typescript | ^5.6 |

### Fine-tuning (Colab T4)
| Component | Library |
|---|---|
| QLoRA driver | Unsloth (`unsloth[colab-new]`) |
| Base model | `google/gemma-4-E4B-it` (Apache 2.0) |
| LoRA backend | PEFT |

### Third-party services
- **Supabase** (Postgres 15 + Storage + pgvector) — DB, file bucket `call-audio`, `match_calls` RPC
- **Hugging Face Hub** — hosts `<user>/call-audit-v1` LoRA adapter (private repo)
- **Hugging Face Spaces** — Docker runtime for the FastAPI service
- **Netlify** — static site host for the React build
- **Google Drive** — source of audio recordings (existing customer asset)

---

## 9. Security & Configuration

### Authentication / authorization
- **Supabase service-role key** — used only by the FastAPI backend; never exposed to the browser
- **Supabase anon key** — used by React frontend for read-only SELECT queries
- **HF token** — used only for adapter upload (Colab) and adapter pull (Space); write-scope token kept in HF Space secrets
- **Google account auth** — used in Colab for Drive API access; uses `google.colab.auth.authenticate_user()` (no creds stored in code)

### Configuration management

**Backend (`.env`, project root + HF Space secrets):**
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<service_role_key>
SUPABASE_AUDIO_BUCKET=call-audio

LLM_PROVIDER=gemma                              # or "ollama" for CPU
GEMMA_MODEL=google/gemma-4-E4B-it
GEMMA_ADAPTER=<user>/call-audit-v1              # HF Hub repo id
GEMMA_LOAD_IN_4BIT=true
GEMMA_MAX_NEW_TOKENS=1024

OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma3:4b

WHISPER_MODEL=small
WHISPER_LANG=                                   # empty = auto-detect

EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2

USE_DRIVE_API=1                                 # Colab/Space only
```

**Frontend (`web/.env.production`, Netlify env vars):**
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_API_BASE=https://<user>-call-audit.hf.space
```

### Security scope

**In scope (MVP):**
- ✅ Service-role key never reaches browser (lives in `.env` and HF Space secrets only)
- ✅ Anon key has SELECT-only effective access via documented dev posture (RLS off in dev)
- ✅ HF write token only used during adapter upload, not stored in repo
- ✅ `.env` and adapters/ in `.gitignore`
- ✅ CORS configured per-origin in `api/main.py` (currently `*`, tighten to Netlify domain in prod)

**Out of scope (customer's responsibility for prod):**
- ❌ Supabase Row-Level Security (RLS) policies — disabled in dev for simplicity; customer must enable + write policies before production
- ❌ Multi-tenant isolation — single Supabase project per deployment
- ❌ Audit log of who scored what
- ❌ PII redaction in transcripts

### Deployment

**Frontend (Netlify):**
- Build command: `npm run build`
- Publish dir: `web/dist`
- Env vars: set via Netlify dashboard, not committed

**Backend (HF Space):**
- Type: Docker
- Hardware: CPU Basic (16GB RAM, 2 vCPU) — fits Gemma 4 E4B int4 (~3GB) + Whisper-small (~250MB) + FastAPI
- Build prefetches model weights to avoid 5-min first-request hang
- Auto-sleep after 48h idle (free tier)

**Trained adapter (HF Hub):**
- Repo: `<user>/call-audit-v1` (private)
- Size: ~150-200MB (`adapter_config.json` + `adapter_model.safetensors` + tokenizer)
- Pulled by HF Space at runtime via `GEMMA_ADAPTER` env var
- Versioning: bump to `v2`, `v3` etc. for new fine-tunes; rollback by changing the env var

---

## 10. API Specification

### `GET /api/health`
Health check. Returns `{"status": "ok"}`.

### `POST /api/process`
Upload a sheet and kick off the pipeline.

**Request:** `multipart/form-data`
- `file` — `.xlsx` or `.csv`
- `link_column` — name of the column containing Drive URLs
- `row_start` — 1-indexed Excel row (≥ 2)
- `row_end` — 1-indexed Excel row (≥ row_start)

**Response:** `200 OK`
```json
{ "token": "abc123def..." }
```

The token is consumed once by the stream endpoint below.

### `GET /api/process/{token}/stream`
Server-Sent Events stream of pipeline progress.

**Response:** `text/event-stream`
```
event: update
data: {"index":1,"total":50,"sheet_row":2,"stage":"download","message":"Downloading audio","call_id":"..."}

event: update
data: {"index":1,"total":50,"sheet_row":2,"stage":"transcribe","message":"Transcribing","call_id":"..."}

event: update
data: {"index":1,"total":50,"sheet_row":2,"stage":"done","message":"Done","call_id":"..."}

event: done
data:
```

### `POST /api/search`
Semantic search over transcripts.

**Request:** `application/json`
```json
{ "query": "customer asked about refund", "k": 10 }
```

**Response:** `200 OK`
```json
{
  "matches": [
    { "call_id": "uuid", "transcript": "...", "similarity": 0.847 },
    ...
  ]
}
```

### Direct Supabase reads (no API)

The frontend reads `calls`, `scores`, `rubrics`, `ingestion_jobs` directly via the anon key — no backend roundtrip. Pagination via PostgREST's `Range` header.

---

## 11. Success Criteria

### MVP success — deployed and working

- ✅ A non-technical user uploads a sheet on Netlify → calls process → results appear in the dashboard, end-to-end, no manual intervention
- ✅ Trained Gemma 4 E4B adapter is loaded by the HF Space and produces valid JSON-formatted scores
- ✅ Dashboard renders correctly on first load with real data from a populated Supabase
- ✅ Semantic search returns relevant transcripts for English-language queries

### Functional requirements

- ✅ Rubric supports numeric, yes/no, and 3-way categorical parameters
- ✅ Pipeline survives Colab disconnects, Drive rate limits, individual row failures
- ✅ All 358 historical calls + their gold scores import without data loss (verified by `verify_import.py`)
- ✅ Trained adapter loads on a 16GB-RAM HF Space without OOM
- ✅ End-to-end latency: < 30 sec to score a 5-min call once transcription is cached

### Quality indicators

- **Score agreement** with the original 358-call gold dataset: target ≥ 70% exact-match per parameter on a held-out 10% slice (post-fine-tune)
- **Reasoning quality**: each output must cite a concrete moment from the transcript, not generic platitudes
- **Format compliance**: 100% of model outputs parse as valid JSON matching the rubric schema (currently enforced by clamping + fallback regex)

### User experience

- Process page progress is visible within 1 sec of clicking *Process* (SSE responsiveness)
- Dashboard loads in < 2 sec on a populated Supabase (anon-key reads, no API hop)
- Semantic search returns results in < 3 sec for k=10 over 1000+ calls

---

## 12. Implementation Phases

### Phase 1 — Foundation ✅ (DONE)

**Goal:** Stand up the data layer, pipeline, and a usable UI.

**Deliverables:**
- ✅ Supabase schema applied (rubrics, calls, scores, embeddings, ingestion_jobs)
- ✅ `audio` storage bucket created
- ✅ End-to-end pipeline: download → faster-whisper → Gemma judge → embed → persist
- ✅ Streamlit UI with rubric editor, process page, results page (legacy, kept as fallback)
- ✅ React + Vite + Tailwind frontend with Dashboard, Process, Rubric, Results pages
- ✅ FastAPI service wrapping the pipeline (with SSE)
- ✅ `.env`-based config; one-command local dev (`uvicorn` + `npm run dev`)

**Validation:** Process a 2-3-row test sheet locally; see scores appear in Supabase; see dashboard populate.

---

### Phase 2 — Gold-Data Ingestion ✅ (DONE)

**Goal:** Get the customer's 358 historical audited calls into Supabase as training-ready (transcript, gold-scores) pairs.

**Deliverables:**
- ✅ `seed_demo_rubric.py` creates the 10-param rubric matching the xlsx
- ✅ `import_demo_dataset.py` bulk-imports xlsx rows with Whisper transcription
- ✅ `verify_import.py` confirms 358/358 rows + 3580/3580 scores match xlsx exactly
- ✅ `check_drive_links.py` validates Drive permissions
- ✅ Authenticated Drive API path for bulk processing on Colab
- ✅ All 358 rows imported; 351 with transcripts (4 transient errors, 3 unrecoverable bare-filename rows)

**Validation:** `verify_import.py` reports zero mismatches; export produces ≥ 200 chat-format examples.

---

### Phase 3 — Fine-tune & Deploy (IN PROGRESS)

**Goal:** Train a Gemma 4 E4B LoRA adapter on the 351-example dataset and deploy it to production.

**Deliverables:**
- ✅ JSONL export of 351 (rubric + transcript → gold-scores JSON) examples
- ✅ Unsloth QLoRA training script (`finetune_gemma.py`) tuned for E4B
- ✅ Colab playbook (`training/COLAB.md`)
- ⏳ Fine-tuned adapter pushed to `<user>/call-audit-v1` on HF Hub
- ⏳ HF Space (Docker) running FastAPI + base Gemma + adapter
- ⏳ Netlify deploy of React frontend pointing at the HF Space
- ⏳ End-to-end smoke test from netlify.app → supabase + hf.space

**Validation:** A demo call uploaded via Netlify produces non-trivial scores within 30 sec, with reasoning that cites the transcript. Score agreement with the 36-call held-out validation slice ≥ 70% exact-match.

---

### Phase 4 — Iterate on Quality (POST-MVP)

**Goal:** Close the loop — make the model better over time using ongoing audits as fresh training data.

**Deliverables:**
- ⏳ Inline score-correction UI in Results page (fixes the SQL-editor workaround)
- ⏳ Weekly cron that re-exports the dataset including newly-corrected calls
- ⏳ A/B testing of adapter versions (`v1` vs `v2`) on a held-out validation set
- ⏳ Active-learning queue: surface low-confidence calls to the audit team first
- ⏳ Diarization (`pyannote-audio`) for Speaker A vs Speaker B attribution
- ⏳ Real Supabase RLS policies + multi-tenancy

**Validation:** Adapter v2 outperforms v1 on validation set by ≥ 3 percentage points; auditor team self-reports time saved per week.

---

## 13. Future Considerations

**Better data flywheel**
- Inline correction UI → automatic JSONL refresh → scheduled retraining → A/B testing — all without ML-team intervention
- Active learning: prioritize calls where the model has highest disagreement-with-itself across parameters

**Multilingual + diarization**
- 358-row gold set already contains English / Hindi / Tamil → fine-tune handles them; explicitly evaluate per-language quality
- Add `pyannote-audio` for Speaker A vs Speaker B; train a second adapter that scores agent vs customer turns separately

**Real-time audit**
- WebRTC stream → live transcription → in-call coaching cues
- Out of scope for MVP but the architecture supports it (swap batch SSE for WebSocket)

**Cost monitoring**
- HF Space → compute hours dashboard
- Supabase → row count, storage usage
- Auto-archive transcripts older than N months

**Enterprise**
- SAML/OIDC SSO via Supabase Auth
- Per-org isolation (one rubric per org, RLS by org_id)
- Audit log table that records who corrected what

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Drive anonymous quota throttles bulk ingestion (~50 downloads/IP/day)** | ✅ Built. Authenticated Drive API path via `google-api-python-client`; user OAuths in Colab once via `auth.authenticate_user()`. Per-user quota is much higher. |
| **Colab session disconnects during 1-hour transcription run** | ✅ Built. Importer is fully idempotent — re-running skips already-transcribed rows by `drive_link` lookup. |
| **HF Space free tier sleeps after 48h idle → 30-90 sec cold-start hits users** | Frontend shows a "Waking up the model..." state during the first request after idle. Upgrade to a paid Space for always-on. |
| **Trained adapter degrades over time as audit standards drift** | Monthly re-export → retrain on the latest data. Old adapters kept around for A/B comparison. Phase 4 deliverable. |
| **Customer's Drive files are not "Anyone with the link"** | `check_drive_links.py` diagnoses up-front. If broad failures, fall back to mounting Drive directly in Colab/Space and reading by file path. |
| **Gemma 4 E4B at int4 hits the 16GB Space RAM ceiling under concurrent load** | Single-user demo is fine. For production load, queue requests at the FastAPI layer or upgrade to HF Space CPU Upgraded (32GB) or T4 GPU. |
| **Rubric drift breaks already-trained adapter** | Each rubric is a versioned row in Supabase; training data is exported per-rubric-id. Changing rubric mid-flight forces a retrain — surfaced clearly in `export_dataset.py`. |
| **JSON output format compliance fails on edge-case transcripts** | Already mitigated: `_extract_json_scores` regex-falls-back to extract the first `{...}` block from chatty preambles; `_attach_max_score` clamps invalid scores to `[1, max_score]`. |

---

## 15. Appendix

### Related documents
- [README.md](README.md) — quickstart for local dev
- [training/README.md](training/README.md) — fine-tuning workflow
- [training/COLAB.md](training/COLAB.md) — cell-by-cell Colab playbook
- [web/README.md](web/README.md) — frontend dev guide
- [supabase/schema.sql](supabase/schema.sql) — full DB schema

### Key external dependencies
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — CPU transcription (CTranslate2)
- [google/gemma-4-E4B-it](https://huggingface.co/google/gemma-4-E4B-it) — base judge model (Apache 2.0)
- [unsloth/gemma-4-E4B-it](https://huggingface.co/unsloth/gemma-4-E4B-it) — Unsloth-prepped training fork
- [unsloth/gemma-4-E4B-it-GGUF](https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF) — Ollama-compatible quants
- [pgvector](https://github.com/pgvector/pgvector) — Postgres extension for vector search
- [supabase-js](https://github.com/supabase/supabase-js) — frontend DB client
- [Recharts](https://recharts.org/) — React charting library

### Source datasets
- `Demo Quality Check Form  (Responses).xlsx` — 358 historical audits, included in the repo (private)
  - 355 valid Drive-URL rows
  - 351 successfully transcribed (Phase 2 outcome)
  - Languages: en (majority), hi, ta

### Repository
- GitHub: `<user>/call-audit` (private)
- HF Hub adapter: `<user>/call-audit-v1` (private)
- HF Space: `<user>/call-audit` (Docker)
- Netlify site: `call-audit.netlify.app`
