# Training on Google Colab

Two phases: **transcribe** the 358 calls (~1h on T4) and **fine-tune** Gemma 4 E4B on them (~30-60 min on T4).

## 0. One-time prep on your laptop

Push this repo to GitHub (private is fine):

```powershell
# from project root, if not already a remote
git init -b main
gh repo create call-audit --private --source=. --remote=origin
git add -A
git commit -m "initial commit"
git push -u origin main
```

(Or use GitHub Desktop / web UI — same result.)

Also: in your local `.env`, the **service-role** Supabase key is fine for Colab. You'll paste it via `getpass` in cell 4 (won't be saved to the notebook).

## 1. Open a Colab notebook

[colab.research.google.com](https://colab.research.google.com) → New notebook → **Runtime → Change runtime type → T4 GPU** → Save. Then paste the cells below in order.

---

### Cell 1 — verify GPU

```python
!nvidia-smi
```
Should show a Tesla T4 with ~15GB free. If "command not found", you didn't set GPU runtime.

### Cell 2 — clone the repo

```python
import getpass, os
REPO_URL = "https://github.com/cryptopaglu2408-gif/call-audit"  # ← edit
TOKEN = getpass.getpass("GitHub PAT (only if private repo, else just press Enter): ").strip()
if TOKEN:
    REPO_URL = REPO_URL.replace("https://", f"https://{TOKEN}@")
!git clone {REPO_URL}
%cd call-audit
```

### Cell 3 — install dependencies

```python
!pip install -q -r requirements.txt
!pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
```
~3-5 min. Unsloth pulls in the GPU-optimized Gemma kernels.

### Cell 4 — paste credentials + authenticate Google Drive

```python
import getpass, os
os.environ["SUPABASE_URL"] = input("SUPABASE_URL: ").strip()
os.environ["SUPABASE_KEY"] = getpass.getpass("SUPABASE_KEY (service role): ")
os.environ["WHISPER_MODEL"] = "small"   # or "medium" — T4 handles it fine

# Authenticate so we can download from Drive without hitting the anonymous quota.
# A popup will ask you to sign in with the Google account that has access to the audio files.
os.environ["USE_DRIVE_API"] = "1"
from google.colab import auth
auth.authenticate_user()
```

### Cell 5 — Phase 1: transcribe the 358 calls

```python
!python -m training.import_demo_dataset
```
~1 hour for all 358. Already-transcribed rows are skipped if you re-run. If Colab disconnects mid-run, just re-execute this cell. The Drive API path bypasses gdown's anonymous quota, so failures should be near-zero.

### Cell 6 — Phase 2: export to JSONL

```python
!python -m training.export_dataset \
    --output training/data/calls.jsonl \
    --min-calls 200
!wc -l training/data/calls.jsonl
```
Should print ~350 lines. If far fewer, some transcriptions failed — check Supabase `calls` table for `status='error'`.

### Cell 7 — Phase 3: fine-tune Gemma 4 E4B

```python
!python -m training.finetune_gemma \
    --base-model unsloth/gemma-4-E4B-it \
    --dataset training/data/calls.jsonl \
    --output adapters/call-audit-v1 \
    --epochs 3 \
    --batch-size 2 \
    --grad-accum 4
```
~30-60 min on T4. Output: `adapters/call-audit-v1/` containing `adapter_config.json`, `adapter_model.safetensors` (~150-200MB), tokenizer files.

### Cell 8 — Save the adapter

**Option A — download as zip:**
```python
!zip -r adapter.zip adapters/call-audit-v1
from google.colab import files
files.download("adapter.zip")
```

**Option B — push to Hugging Face Hub (recommended; HF Spaces can pull from there):**
```python
from huggingface_hub import login, HfApi
login(token=getpass.getpass("HF token (write scope): "))
api = HfApi()
repo_id = "YOUR_HF_USER/call-audit-v1"  # ← edit
api.create_repo(repo_id, private=True, exist_ok=True)
api.upload_folder(folder_path="adapters/call-audit-v1", repo_id=repo_id)
print(f"https://huggingface.co/{repo_id}")
```

### Cell 9 — Sanity-check the trained model

```python
from unsloth import FastLanguageModel
import torch
model, tokenizer = FastLanguageModel.from_pretrained(
    "adapters/call-audit-v1", load_in_4bit=True, max_seq_length=4096,
)
FastLanguageModel.for_inference(model)

prompt = """You are a senior call-quality auditor. Given a rubric and a transcript, score every parameter.

## Rubric
[{"name": "Call Opening", "max_score": 10, "description": "Greeting, intro, rapport"}]

## Transcript
Hello, this is Rahul calling from BYJU'S. Am I speaking with Mr. Kumar?

Return ONLY JSON: {"scores":[{"parameter":"...","score":N,"reasoning":"..."}]}
"""
inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
out = model.generate(**inputs, max_new_tokens=512, do_sample=False)
print(tokenizer.decode(out[0][inputs.input_ids.shape[-1]:], skip_special_tokens=True))
```

You should get back valid JSON with a numeric score and reasoning citing the transcript.

---

## After Colab

Pull the adapter into your HF Space:
1. In your Space's repo, add the adapter folder (or reference the HF Hub repo from Cell 8).
2. In Space **Settings → Variables and secrets**:
   ```
   LLM_PROVIDER=gemma
   GEMMA_MODEL=google/gemma-4-E4B-it
   GEMMA_ADAPTER=adapters/call-audit-v1   # local folder, or HF Hub repo id
   ```
3. Restart the Space. The runtime loads base + adapter automatically — no code change.

## Troubleshooting

- **"CUDA out of memory" during training** → drop `--batch-size 1` and bump `--grad-accum 8`.
- **Whisper hangs on a particular Drive link** → that file probably isn't "Anyone with the link". The script marks it `status=error` and moves on; safe to ignore unless many fail.
- **`export_dataset` reports < 200 examples** → check `calls.transcript IS NULL` count in Supabase. Likely some Drive downloads failed; either re-run Cell 5 or accept the smaller set (will still train, just less robust).
