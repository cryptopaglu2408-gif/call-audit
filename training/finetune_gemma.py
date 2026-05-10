"""QLoRA fine-tune Gemma 4 E4B (or any Gemma) on exported call-scoring data.

Usage:
  # 1. Export your gold-standard data
  python -m training.export_dataset --output training/data/calls.jsonl

  # 2. Train (single 12-16GB GPU is enough for E4B in 4-bit)
  python -m training.finetune_gemma \
      --base-model unsloth/gemma-4-E4B-it \
      --dataset training/data/calls.jsonl \
      --output adapters/call-audit-v1 \
      --epochs 3

After training, point the runtime at the new adapter:
  LLM_PROVIDER=gemma
  GEMMA_ADAPTER=adapters/call-audit-v1   in .env
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-model", default="unsloth/gemma-3-4b-it",
                    help="Unsloth-prepared checkpoint, or any HF Gemma id. "
                         "Gemma 3 4B is the recommended default — text-only, stable with "
                         "Unsloth+Transformers. Gemma 4 E4B is multimodal and currently "
                         "has known incompatibilities with TRL/Unsloth.")
    ap.add_argument("--dataset", type=Path, required=True,
                    help="JSONL with chat-format messages (from export_dataset.py).")
    ap.add_argument("--output", type=Path, required=True,
                    help="Where to save the LoRA adapter.")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--max-seq-length", type=int, default=4096)
    ap.add_argument("--batch-size", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=16)
    args = ap.parse_args()

    import torch  # type: ignore
    from datasets import load_dataset  # type: ignore
    from trl import SFTTrainer, SFTConfig  # type: ignore
    from unsloth import FastLanguageModel  # type: ignore
    from unsloth.chat_templates import get_chat_template  # type: ignore

    # T4 (Turing, sm_75) supports fp16 only. A100/H100 (Ampere+) support bf16.
    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    use_fp16 = torch.cuda.is_available() and not use_bf16

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="gemma")

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.0,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
    )

    ds = load_dataset("json", data_files=str(args.dataset), split="train")

    def tokenize_example(example):
        # Gemma 4 is multimodal: content must be a list of typed dicts, not a raw string.
        # Convert each {"role": "...", "content": "string"} to multimodal format on the fly.
        messages = []
        for m in example["messages"]:
            c = m["content"]
            if isinstance(c, str):
                c = [{"type": "text", "text": c}]
            messages.append({"role": m["role"], "content": c})
        return tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=False,
            truncation=True,
            max_length=args.max_seq_length,
            return_dict=True,
        )

    # Pre-tokenize so TRL skips its own multi-process map (which fails to pickle
    # Unsloth-patched tokenizers).
    ds = ds.map(tokenize_example, remove_columns=ds.column_names, num_proc=1)

    args.output.mkdir(parents=True, exist_ok=True)

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=ds,
        args=SFTConfig(
            output_dir=str(args.output / "checkpoints"),
            max_length=args.max_seq_length,
            dataset_num_proc=1,  # avoid pickle errors with Unsloth-patched tokenizers
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            learning_rate=args.lr,
            warmup_ratio=0.03,
            lr_scheduler_type="cosine",
            logging_steps=10,
            save_strategy="epoch",
            bf16=use_bf16,
            fp16=use_fp16,
            optim="adamw_8bit",
            report_to="none",
        ),
    )
    trainer.train()

    model.save_pretrained(str(args.output))
    tokenizer.save_pretrained(str(args.output))
    print(f"Saved LoRA adapter to {args.output}")
    print(f"Set GEMMA_ADAPTER={args.output} in .env to use it at inference time.")


if __name__ == "__main__":
    main()
