# Fine-tuning the Gemma judge

Goal: teach Gemma your specific rubric so it agrees with human auditors more often than the off-the-shelf model.

## Quick path: bootstrap from the Demo Quality Check xlsx

You already have 358 human-audited demo calls in `Demo Quality Check Form  (Responses).xlsx` — that's the gold set. Skip the "score, then correct" loop and import directly:

```bash
# 1. Create the rubric (one-off; matches the 10 columns in the xlsx)
python -m training.seed_demo_rubric

# 2. Import xlsx rows: download each Drive audio → Whisper → save gold scores
#    On a CPU laptop, transcribing 358 calls takes ~25h. Strategy:
python -m training.import_demo_dataset --limit 5            # smoke-test on 5 rows
python -m training.import_demo_dataset --skip-transcription # write scores fast (minutes)
# then on Colab GPU (faster Whisper):
python -m training.import_demo_dataset                      # fills in transcripts

# 3. Export to chat-format JSONL
python -m training.export_dataset --output training/data/calls.jsonl

# 4. Train (Colab T4 free tier works)
python -m training.finetune_gemma \
    --base-model unsloth/gemma-4-E4B-it \
    --dataset training/data/calls.jsonl \
    --output adapters/call-audit-v1 \
    --epochs 3
```

The xlsx has three parameter shapes — the rubric encodes them all as integer scores:
- numeric 1-10 (e.g. *Call Opening*) → `max_score=10`
- yes/no (e.g. *Problem Identified ?*) → `max_score=2`, No=1 / Yes=2
- 3-way (*Was Demo Scheduled ?*) → `max_score=3`, No=1 / Callback=2 / Yes=3

Each parameter's description in the rubric explains the encoding to the LLM, so even the un-fine-tuned model gets the convention right; fine-tuning calibrates the *level*.

## General workflow (without an xlsx)

## 0. Install training deps

```bash
pip install -r requirements-train.txt
```

## 1. Build a gold-standard set

Process at least 100-200 calls through the app. Open each call in the **Results** page and correct any score the model got wrong (UI for inline correction is on the roadmap; for now you can `update` the `scores` table directly in Supabase).

> Quality > quantity. 50 carefully corrected calls beats 500 unedited ones.

## 2. Export the dataset

```bash
python -m training.export_dataset \
    --rubric-id <uuid>                    # optional, defaults to active rubric
    --output training/data/calls.jsonl
```

Each line is a chat-format example: a prompt with the rubric + transcript, and the gold-standard JSON of scores as the assistant turn.

## 3. Train

```bash
python -m training.finetune_gemma \
    --base-model unsloth/gemma-4-E4B-it \
    --dataset training/data/calls.jsonl \
    --output adapters/call-audit-v1 \
    --epochs 3
```

Defaults are tuned for a single 12-16 GB consumer GPU (RTX 3060/4060). Tweak `--batch-size`, `--grad-accum`, `--max-seq-length` if you have more or less VRAM.

Note: Unsloth recommends 16-bit LoRA on the 26B-A4B MoE variant — do not use 4-bit there. E4B and E2B are fine in 4-bit.

## 4. Use the adapter

In `.env`:

```
LLM_PROVIDER=gemma
GEMMA_MODEL=google/gemma-4-E4B-it
GEMMA_ADAPTER=adapters/call-audit-v1
GEMMA_LOAD_IN_4BIT=true
```

The Gemma judge will load the base model in 4-bit and overlay your LoRA adapter at runtime. No code change needed.

## 5. Iterate

Each new batch of corrected calls is more training data. Re-export, re-train, bump the adapter version. Keep older adapters around so you can A/B them on a held-out validation set.
