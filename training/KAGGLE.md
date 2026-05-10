# Training on Kaggle

Faster, more stable alternative to Colab. **30 hrs/week of free T4/P100**, no daily quota surprises.

We skip Google Drive entirely — transcripts already live in Supabase, the trained adapter goes to Hugging Face Hub. Total: ~5 cells, ~30 min of GPU time.

## 0. Prep (5 min, one-time)

1. Sign in at [kaggle.com](https://kaggle.com)
2. New notebook: **Code → New Notebook**
3. Right sidebar → **Settings → Accelerator → GPU T4 x2** (or **GPU P100**) → save
4. Right sidebar → **Internet** → **On** (required to clone GitHub + pull from Supabase + push to HF)

If your GitHub repo is **private**, also add your PAT as a Kaggle Secret:
- Right sidebar → **Add-ons → Secrets** (kaggle.com/settings → Secrets)
- Add label `GITHUB_PAT` with your token

Same for HF write token: add `HF_TOKEN` as a secret.
Same for Supabase: add `SUPABASE_URL` and `SUPABASE_KEY`.

## 1. Cells

### Cell 1 — verify GPU

```python
!nvidia-smi
```
Should show Tesla T4 or P100, ~15GB free.

### Cell 2 — clone the repo

```python
from kaggle_secrets import UserSecretsClient
secrets = UserSecretsClient()
PAT = secrets.get_secret("GITHUB_PAT")  # remove this line if your repo is public

!git clone https://{PAT}@github.com/YOUR_USER/call-audit.git /kaggle/working/call-audit
%cd /kaggle/working/call-audit
```

(For a public repo, just `!git clone https://github.com/YOUR_USER/call-audit.git ...`)

### Cell 3 — install deps

```python
!pip install -q -r requirements.txt
!pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
```
~3-5 min.

### Cell 4 — set credentials + export the JSONL from Supabase

```python
import os
from kaggle_secrets import UserSecretsClient
secrets = UserSecretsClient()

os.environ["SUPABASE_URL"] = secrets.get_secret("SUPABASE_URL")
os.environ["SUPABASE_KEY"] = secrets.get_secret("SUPABASE_KEY")

# Re-generate the chat-format JSONL from Supabase (transcripts are already there).
!python -m training.export_dataset --output training/data/calls.jsonl --min-calls 200
!wc -l training/data/calls.jsonl
```
Should print `351` lines in <30 sec.

### Cell 5 — fine-tune Gemma 3 4B

```python
!python -m training.finetune_gemma \
    --base-model unsloth/gemma-3-4b-it \
    --dataset training/data/calls.jsonl \
    --output /kaggle/working/adapter-call-audit-v1 \
    --epochs 3 \
    --batch-size 2 \
    --grad-accum 4
```
~25-40 min on T4. Watch for the loss curve dropping from ~2.5 → ~0.4. Final adapter saved to `/kaggle/working/adapter-call-audit-v1/`.

### Cell 6 — push the adapter to Hugging Face Hub

```python
from kaggle_secrets import UserSecretsClient
from huggingface_hub import login, HfApi

secrets = UserSecretsClient()
login(token=secrets.get_secret("HF_TOKEN"))

api = HfApi()
repo_id = "YOUR_HF_USER/call-audit-v1"   # ← edit
api.create_repo(repo_id, private=True, exist_ok=True)
api.upload_folder(folder_path="/kaggle/working/adapter-call-audit-v1", repo_id=repo_id)
print(f"https://huggingface.co/{repo_id}")
```

The Kaggle session disk vanishes when you close the notebook, but the adapter is now safely on HF Hub.

### Cell 7 — sanity-check (optional)

```python
from unsloth import FastLanguageModel
import torch

model, tokenizer = FastLanguageModel.from_pretrained(
    "/kaggle/working/adapter-call-audit-v1",
    load_in_4bit=True, max_seq_length=4096,
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

You should see valid JSON with a numeric score and reasoning that cites the transcript.

## Why this is faster than Colab

- No Drive setup → no auth popup, no mount step
- No data upload → Supabase is the source of truth
- HF Hub upload = 30 sec vs zip/download/re-upload elsewhere
- Kaggle's GPU sessions don't disconnect every 90 min like Colab free
- Public repo? Skip the PAT secret. 4 cells total.

## Differences from the Colab playbook

| Step | Colab | Kaggle |
|---|---|---|
| Auth Drive | `auth.authenticate_user()` | not needed |
| Read secrets | `getpass.getpass(...)` interactively | `UserSecretsClient` (secure, persistent) |
| Working dir | `/content/...` | `/kaggle/working/...` |
| Re-running cells | session resets often | session is more stable |

## Troubleshooting

- **`UserSecretsClient` not found**: you forgot to enable Internet in the right sidebar.
- **`No GPU available`**: Settings → Accelerator → GPU. Quota is per-week, very generous (30hr).
- **Training OOM**: drop to `--batch-size 1 --grad-accum 8`.
- **Adapter upload 401**: HF token doesn't have `write` scope. Regenerate at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
