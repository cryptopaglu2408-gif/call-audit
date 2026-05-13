# SuperSheldon Call Audit 🎙️

An automated quality assurance pipeline for edtech sales calls. This system monitors recordings, transcribes them using Google Cloud Speech-to-Text (Chirp 2), scores them against a strict quality rubric using Gemini 2.5 Flash, and notifies the team via Slack.

## 🚀 Key Features

### 1. Automated Call Transcription
- **Multi-Accent Support**: Uses Google's **Chirp 2** model, specifically tuned for Indian-accented English (sales agents) and Australian/UK English (parents).
- **Direct Drive Integration**: Automatically pulls new recordings from Google Drive and pushes the final "clean" versions back for archival.
- **Brand-Aware Transcription**: Custom prompts ensure "SuperSheldon" is transcribed correctly, avoiding common hallucinations like "Super Children".

### 2. AI-Powered Quality Audit (The Judge)
- **Strict Scoring Logic**: Powered by a fine-tuned **Gemini 2.5 Flash** model. It doesn't just "summarize"; it looks for literal evidence (exact quotes) before awarding points.
- **10-Parameter Rubric**: Comprehensive evaluation covering Call Opening, Reason for Calling, Customer Need Assessment, Problem Identification, USP Discussion, Intent Checks, Demo Pitching, Pricing Disclosure, and Professional Closing.
- **Evidence-Based Feedback**: Every score entry includes a "Reasoning" field containing the exact transcript quote used as evidence for the verdict.

### 3. Pipeline Management Dashboard
- **Real-Time Monitoring**: Track calls through six stages: Audio Fetch, Metadata Extraction, Transcription, Drive Upload, AI Scoring, and Slack Notification.
- **One-Click Retries**: If a stage fails (e.g., a network error during upload), the dashboard allows for granular state-based retries without reprocessing the entire call.
- **Progressive Disclosure**: Detailed logs for every step are available directly in the UI for rapid debugging.

### 4. Results & Analytics
- **Agent Performance Metrics**: Scorecards for each sales agent, displaying average scores across different rubric parameters.
- **Interactive Audio Player**: Syncs the transcript with the audio playback, allowing auditors to click any part of the transcript to jump to that moment in the call.
- **Score Distribution**: Visual breakdown of metrics to identify systemic weaknesses in the sales pitch (e.g., "Why are we consistently failing USP Discussion?").

### 5. Seamless Integrations
- **Supabase Backend**: Leveraging Postgres with `pgvector` for potential future semantic search capabilities.
- **Edge Runtime**: High-concurrency processing using Supabase Edge Functions (Deno).
- **Slack Notifications**: Instant alerts sent to configured channels for every audited call, including the final score and a link to the full report.

## 🏗️ Architecture

1.  **Audio Ingestion**: Bridge i2p recordings sync to a specific Google Drive folder.
2.  **Edge Pipeline**: Supabase Edge Functions fetch audio, transcribe it, and store metadata.
3.  **LLM Audit**: A fine-tuned Gemini 2.5 Flash model evaluates the transcript based on a 10-parameter rubric.
4.  **Reporting**: Final scores are stored in Supabase and pushed to Slack for immediate feedback.

## 📁 Repository Structure

*   `frontend/`: React + Vite + Tailwind dashboard for viewing results and managing rubrics.
*   `supabase/`: Database schema and Edge Functions (`transcribe-audio`, `score-transcript`, `drive-upload-url`).
*   `pipeline/`: Python-based Cloud Run job for automated batch processing.
*   `training/`: Scripts and datasets for fine-tuning the auditor model.

## 🚀 Getting Started

### Prerequisites

*   Node.js 18+ & npm
*   Google Cloud Project (with Drive, STT, and Vertex AI enabled)
*   Supabase CLI

### Setup

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/your-org/call-audit.git
    cd call-audit
    ```

2.  **Supabase Auth (Required for Google Drive):**
    You must set these secrets in Supabase to allow the pipeline to upload to your personal Google Drive quota:
    ```bash
    supabase secrets set GOOGLE_CLIENT_ID="..."
    supabase secrets set GOOGLE_CLIENT_SECRET="..."
    supabase secrets set GOOGLE_REFRESH_TOKEN="..."
    ```

3.  **Install Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

## ⚖️ The Rubric

Calls are scored on a scale of 0-70 across these key areas:
*   **Opening (10 pts)**: Name & company introduction.
*   **Needs Assessment (10 pts)**: Grade level, subjects, and performance.
*   **USP Discussion (10 pts)**: Differentiation and 1-on-1 focus.
*   **Pitch & Close (20 pts)**: Demo scheduling and professional sign-off.
*   **Binary Checks**: Problem identified? Price discussed? Intent check done?

## 🛠️ Deployment

*   **Edge Functions**: `supabase functions deploy [function-name] --no-verify-jwt`
*   **Frontend**: Deployed on Netlify (see `netlify.toml`).
*   **Database**: Migrations are handled via `supabase/schema.sql`.

## 📄 License
Internal use only for SuperSheldon.

```

Defaults already point at:

```
LLM_PROVIDER=ollama
OLLAMA_MODEL=gemma3:4b           # or: hf.co/unsloth/gemma-4-E4B-it-GGUF:Q4_K_M
WHISPER_MODEL=small              # tiny | base | small | medium | large-v3
```

For GPU users who want to fine-tune the judge later:

```
LLM_PROVIDER=gemma
GEMMA_MODEL=google/gemma-4-E4B-it
GEMMA_LOAD_IN_4BIT=true
GEMMA_ADAPTER=                    # set to your LoRA adapter path after fine-tuning
```

### 5. Run

#### React UI + FastAPI (recommended)

```bash
# 1. API
pip install -r api/requirements.txt
uvicorn api.main:app --reload --port 8000

# 2. Web (in a second terminal)
cd web
npm install
cp .env.example .env       # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```

`/api/*` is proxied from Vite → FastAPI in dev. The dashboard reads
Supabase directly with the anon key.

#### Streamlit (legacy, single-process)

```bash
streamlit run app.py
```

## Workflow

1. **Rubric page** — define scoring parameters (Empathy, Compliance, Tone, etc.) with descriptions and `max_score`. Saved per-version, only one active at a time.
2. **Process page** — upload `.xlsx`, pick the audio-link column, set the row range. Pipeline downloads each call, transcribes with faster-whisper, scores with Gemma 4, and persists everything to Supabase.
3. **Results / Dashboard pages** — calls table with aggregate scores, per-call inspector with transcript + per-parameter reasoning, and **semantic search** across transcripts via pgvector.

## Fine-tuning the judge

This is what pushes the project from "another LLM-as-judge demo" to **measurably better than commercial tools** on your specific rubric. Needs a CUDA GPU.

```bash
pip install -r requirements-train.txt

# After scoring + human-correcting ~100+ calls:
python -m training.export_dataset --output training/data/calls.jsonl
python -m training.finetune_gemma \
    --base-model unsloth/gemma-4-E4B-it \
    --dataset training/data/calls.jsonl \
    --output adapters/call-audit-v1 --epochs 3

# Point the runtime at the adapter (HF transformers path):
echo "LLM_PROVIDER=gemma" >> .env
echo "GEMMA_ADAPTER=adapters/call-audit-v1" >> .env
```

Full instructions in [training/README.md](training/README.md).

## Project layout

```
call-audit/
├── app.py                      # Streamlit entry (legacy UI)
├── requirements.txt            # python runtime
├── requirements-train.txt      # Unsloth QLoRA (fine-tuning only)
├── supabase/schema.sql         # Postgres + pgvector schema
├── src/                        # python pipeline + Streamlit pages
│   ├── config.py               # env-loaded Settings
│   ├── db.py                   # Supabase wrapper
│   ├── ingest.py               # sheet parsing + gdown
│   ├── transcribe.py           # faster-whisper
│   ├── score.py                # Gemma judge (Ollama + HF transformers)
│   ├── embed.py                # sentence-transformers (384-d)
│   ├── pipeline.py             # orchestrator
│   ├── theme.py                # Streamlit CSS theme
│   └── pages/                  # Streamlit pages
├── api/                        # FastAPI service (wraps pipeline + search)
│   └── main.py
├── web/                        # React + Vite + Tailwind frontend
│   └── src/
│       ├── components/
│       └── pages/
└── training/
    ├── export_dataset.py       # Supabase -> JSONL
    ├── finetune_gemma.py       # Unsloth QLoRA
    └── README.md               # training workflow
```

## Notes

- Drive links must be "Anyone with the link" for `gdown` to fetch (no service-account flow yet).
- True speaker diarization (Speaker A vs B) isn't enabled — segments are time-aligned only. Add `pyannote-audio` if you need it.
- For dev, disable Supabase RLS on `calls` / `scores` / `rubrics` / `ingestion_jobs` so the React frontend (anon key) can read. For prod, write proper policies.
