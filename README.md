# Call Audit

End-to-end call-quality auditing pipeline. Upload a spreadsheet of Google Drive audio links, transcribe each call locally with **faster-whisper**, and score it against a user-defined rubric using a **Gemma 4** judge that you can fine-tune on your own gold-standard scores.

## Stack

| Tier | Tool |
| --- | --- |
| UI | React + Vite + Tailwind (preferred) — Streamlit kept as legacy |
| Backend API | FastAPI (wraps the pipeline + semantic search) |
| Sheet parsing | pandas + openpyxl |
| Drive fetch | gdown |
| Transcription | faster-whisper (CTranslate2, CPU-friendly; auto-promotes to CUDA fp16) |
| LLM judge | **Gemma 4 E4B** — Ollama (CPU) or HuggingFace transformers (GPU / fine-tuning) |
| Fine-tuning | Unsloth QLoRA |
| Database | Supabase (Postgres + Storage + pgvector) |
| Semantic search | sentence-transformers + pgvector |

## Setup

### 1. Install runtime deps

```bash
pip install -r requirements.txt
```

### 2. Supabase

- Create a project at [supabase.com](https://supabase.com).
- In the SQL editor, run [supabase/schema.sql](supabase/schema.sql).
- Create a public storage bucket called `call-audio`.

### 3. Install Ollama + pull Gemma 4

The default judge runs through Ollama (CPU-friendly, ~250MB model file at int4).

```bash
# Install: https://ollama.com/download
ollama serve         # if not already running as a service

# Pull a Gemma model (pick one):
ollama pull gemma3:4b                                     # safe default
ollama pull hf.co/unsloth/gemma-4-E4B-it-GGUF:Q4_K_M      # Gemma 4 E4B (recommended)
```

### 4. Environment

```bash
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_KEY (service-role key)
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
