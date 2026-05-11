# SuperSheldon Call Audit — Project Context

## What This Is
An automated call quality audit system for SuperSheldon (edtech company, Australia/UK market).
Sales agents call parents to pitch tutoring. This system automatically scores those calls against a rubric.

## Company Context
- Company email / GCP account: curriculum@supersheldon.com
- Bridge i2p: the call recording provider — syncs recordings to Google Drive automatically
- Agents call parents (Australian/UK) with Indian accents

---

## Current Architecture

### Data Flow (target state)
```
Bridge i2p recordings
        ↓ (auto-sync)
Google Drive folder: https://drive.google.com/drive/folders/1qAA2I00k827z55_4P2LUNyijgG-1-PxZ
        ↓ (Cloud Run Job, every 30 min)
Google Cloud Speech-to-Text (Chirp 2, en-IN + en-AU)
        ↓
Supabase — calls table (transcript stored)
        ↓
Fine-tuned Gemini 2.5 Flash (Vertex AI)
        ↓
Supabase — scores table (parameter scores stored)
        ↓
Slack message (per call, with all parameter scores)
```

### What's Built
- [x] Streamlit app (`app.py`) — upload, transcribe, score, view results
- [x] Supabase schema — `calls`, `scores`, `rubrics`, `call_embeddings`, `ingestion_jobs`
- [x] Whisper transcription pipeline (`src/transcribe.py`)
- [x] LLM scoring (`src/score.py`) — supports Ollama (local) and Gemma (HF transformers)
- [x] Export dataset from Supabase (`training/export_dataset.py`)
- [x] Fine-tuned Gemini 2.5 Flash model (Vertex AI, company GCP account)
- [x] Cloud Run pipeline script (`pipeline/main.py`)
- [ ] Cloud Run deployment (in progress)
- [ ] Slack integration (webhook URL pending)
- [ ] Automated trigger working end-to-end

---

## GCP Setup

### OLD account (personal — do not use for new work)
- Project: `call-audit-495917`
- Fine-tuned model: `projects/1018441713221/locations/us-central1/models/4149504656424304640@1`
- GCS bucket: `call-audit-495917-data`
- Status: has the trained model but wrong account

### NEW account (company — use this)
- Google account: cryptopaglu2408@gmail.com
- GCP Project: `supersheldon-callaudit`
- GCS bucket: `supersheldon-callaudit-data` (to be created)
- Fine-tuned model: needs to be re-trained here (30 min, ~free on trial credits)
- Training data: `training/data/train_final.jsonl` (315 examples) + `training/data/val_final.jsonl` (36 examples)

### Steps remaining on new account
1. Enable billing (link billing account in console.cloud.google.com/billing)
2. Create GCS bucket `supersheldon-callaudit-data`
3. Upload `train_final.jsonl` + `val_final.jsonl` to `gs://supersheldon-callaudit-data/data/`
4. Re-run Gemini 2.5 Flash fine-tuning in Vertex AI Studio → Tuning
5. Deploy Cloud Run Job (`pipeline/main.py`)
6. Schedule Cloud Run Job every 30 min via Cloud Scheduler
7. Add Slack webhook URL to Cloud Run env vars

---

## Supabase
- URL: https://koynuupkfhpddcynemmb.supabase.co
- Project: koynuupkfhpddcynemmb
- Tables: `calls`, `scores`, `rubrics`, `call_embeddings`, `ingestion_jobs`
- Active rubric: "Demo Quality Check" (10 parameters)
- Total calls: 358 | Transcribed: 351 | Fully scored: 351

### Rubric Parameters (Demo Quality Check)
1. Call Opening (numeric, max 10)
2. Reason of Call (numeric, max 10)
3. Customer Need Assessment (numeric, max 10)
4. Problem Identified? (yes/no, max 2)
5. USP Discussion? (numeric, max 10)
6. Intent Check Done? (yes/no, max 2)
7. Demo Session Pitch (numeric, max 10)
8. Price Discussed? (yes/no, max 2)
9. Closing? (numeric, max 10)
10. Was Demo Scheduled? (categorical 3, max 3)

---

## Fine-tuned Model Details
- Base model: `gemini-2.5-flash`
- Tuning method: Supervised fine-tuning
- Training examples: 315 | Validation: 36
- Epochs: 18 (auto-determined by Vertex AI)
- Dataset format: GenerateContent (NOT ChatCompletions)
- Training data: scores only, no reasoning (reasoning in Supabase was low quality — just auditor names)
- Training took: ~30 min
- Cost: ~$0 (within free trial)

### Dataset format used (GenerateContent)
```json
{
  "contents": [
    {"role": "user",  "parts": [{"text": "SYSTEM_PROMPT + rubric + transcript"}]},
    {"role": "model", "parts": [{"text": "{\"scores\": [{\"parameter\": \"...\", \"score\": N}]}"}]}
  ]
}
```

---

## Cloud Run Pipeline (`pipeline/main.py`)
- Language: Python 3.11
- No GPU needed (Google STT for transcription)
- Trigger: Cloud Scheduler every 30 min
- Drive folder ID: `1qAA2I00k827z55_4P2LUNyijgG-1-PxZ`
- Service account needs: Drive folder shared with `PROJECT_NUMBER-compute@developer.gserviceaccount.com`

### Pipeline stages
1. List Drive folder → find files not in Supabase
2. Download audio → upload to GCS → transcribe via Google STT (Chirp 2, en-IN + en-AU)
3. Store transcript in Supabase `calls` table
4. Score with fine-tuned Gemini → store in Supabase `scores` table
5. Send Slack message with all parameter scores

### Env vars needed for Cloud Run
```
SUPABASE_URL=https://koynuupkfhpddcynemmb.supabase.co
SUPABASE_KEY=<service role key>
SLACK_WEBHOOK_URL=<to be added when Slack app is set up>
```

---

## Local Dev Setup
- Platform: Windows 11
- Python: 3.10 (local) / 3.12 (Colab/Kaggle)
- LLM_PROVIDER=ollama (local) — uses gemma3:4b via Ollama
- `.env` file has all credentials

## Key Files
- `app.py` — Streamlit frontend
- `src/score.py` — LLM scoring logic (GemmaJudge + OllamaJudge)
- `src/db.py` — Supabase client
- `src/transcribe.py` — Whisper transcription
- `src/ingest.py` — Google Drive ingestion
- `training/export_dataset.py` — exports Supabase data as fine-tuning JSONL
- `training/finetune_gemma.py` — Gemma QLoRA fine-tuning (Kaggle/Colab)
- `training/convert.py` — converts calls.jsonl to Vertex AI GenerateContent format
- `pipeline/main.py` — Cloud Run automated pipeline
- `pipeline/Dockerfile` — container for Cloud Run
- `training/data/calls.jsonl` — 351 raw training examples from Supabase
- `training/data/train_final.jsonl` — 315 converted training examples
- `training/data/val_final.jsonl` — 36 converted validation examples

---

## Known Issues / Decisions Made
- Whisper transcribes "SuperSheldon" as "Super Children", "Superstallion", etc. — brand name hallucination
  - Mitigation: use `initial_prompt` with brand names if switching back to Whisper
- Training data reasoning quality is poor (auditor name + generic note, not transcript-grounded)
  - Decision: train scores-only, no reasoning field
- Calls 3, 4, 6 in Supabase are exact duplicates — should be deduplicated
- Gemma fine-tuning on Kaggle had multiple issues (EOS token, attn_implementation, Gemma3Processor)
  - Decision: switched to Gemini 2.5 Flash SFT on Vertex AI instead

## Next Session Priorities
1. Enable billing on company GCP account
2. Upload training data + re-run fine-tuning on company account
3. Deploy Cloud Run pipeline
4. Set up Slack app + add webhook
5. End-to-end test: add audio to Drive → verify Slack message received
