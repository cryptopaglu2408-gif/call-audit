from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any

from .config import settings

SYSTEM_PROMPT = """You are a senior call-quality auditor evaluating customer-support call transcripts.

You will receive:
1. A rubric: a list of parameters to score, each with a description and max_score.
2. A transcript of one call.

For every parameter in the rubric, output:
- score: an integer between 1 and max_score (use the full range; reserve max_score for clearly excellent execution).
- reasoning: 1-2 sentences citing concrete moments in the transcript that justify the score.

Be strict and specific. If something cannot be evaluated from the transcript, give a low-mid score and say so in reasoning. Do not invent details that are not in the transcript."""


def _build_user_prompt(rubric_parameters: list[dict[str, Any]], transcript: str) -> str:
    rubric_text = json.dumps(rubric_parameters, indent=2)
    return (
        f"## Rubric\n{rubric_text}\n\n"
        f"## Transcript\n{transcript}\n\n"
        "Score every parameter in the rubric."
    )


class LLMJudge(ABC):
    @abstractmethod
    def score(
        self, transcript: str, rubric_parameters: list[dict[str, Any]]
    ) -> list[dict[str, Any]]: ...


# ---------------------------------------------------------------- Gemma 4 (HF transformers)
class GemmaJudge(LLMJudge):
    """Runs Gemma 4 locally via transformers. The fine-tunable path —
    works with both the base instruct model (default `google/gemma-4-E4B-it`)
    and a LoRA-merged or PEFT-adapter checkpoint produced by the finetuning
    script in `training/`. Needs ~10GB RAM at fp16 / ~4GB at 4-bit (GPU only).

    For CPU-only laptops, prefer `LLM_PROVIDER=ollama` with a GGUF build of the
    same model — `OllamaJudge` below.
    """

    def __init__(self) -> None:
        import torch  # type: ignore
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

        s = settings()
        model_id = s.gemma_model
        adapter = s.gemma_adapter or None

        load_kwargs: dict[str, Any] = {"torch_dtype": torch.bfloat16}
        if s.gemma_load_in_4bit:
            from transformers import BitsAndBytesConfig  # type: ignore

            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
            )
        else:
            load_kwargs["device_map"] = "auto"

        self.tokenizer = AutoTokenizer.from_pretrained(model_id)
        self.model = AutoModelForCausalLM.from_pretrained(model_id, **load_kwargs)
        if adapter:
            from peft import PeftModel  # type: ignore

            self.model = PeftModel.from_pretrained(self.model, adapter)
        self.model.eval()
        self.max_new_tokens = s.gemma_max_new_tokens

    def score(self, transcript, rubric_parameters):
        prompt = _build_user_prompt(rubric_parameters, transcript) + (
            "\n\nReturn ONLY a JSON object of the form: "
            '{"scores":[{"parameter":"...","score":N,"reasoning":"..."}, ...]}'
        )
        messages = [
            {"role": "user", "content": SYSTEM_PROMPT + "\n\n" + prompt},
        ]
        inputs = self.tokenizer.apply_chat_template(
            messages, return_tensors="pt", add_generation_prompt=True
        ).to(self.model.device)

        import torch  # type: ignore

        with torch.inference_mode():
            out = self.model.generate(
                inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                temperature=0.0,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        generated = self.tokenizer.decode(out[0][inputs.shape[-1]:], skip_special_tokens=True)
        scores = _extract_json_scores(generated)
        return _attach_max_score(scores, rubric_parameters)


# ---------------------------------------------------------------- Ollama (optional)
class OllamaJudge(LLMJudge):
    def __init__(self) -> None:
        s = settings()
        self.model = s.ollama_model
        self.host = s.ollama_host

    def score(self, transcript, rubric_parameters):
        from ollama import Client  # type: ignore

        client = Client(host=self.host)
        prompt = _build_user_prompt(rubric_parameters, transcript) + (
            '\n\nReturn ONLY a JSON object: {"scores":[{"parameter":"...","score":N,"reasoning":"..."}, ...]}'
        )
        resp = client.chat(
            model=self.model,
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            format="json",
            options={"temperature": 0.2},
        )
        return _attach_max_score(_extract_json_scores(resp["message"]["content"]), rubric_parameters)


# ---------------------------------------------------------------- helpers
def _extract_json_scores(text: str) -> list[dict[str, Any]]:
    """Pull the `scores` list from a model response, tolerating chatty preambles."""
    text = text.strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "scores" in data:
            return data["scores"]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict) and "scores" in data:
                return data["scores"]
        except json.JSONDecodeError:
            pass
    raise RuntimeError(f"Could not parse JSON scores from model output:\n{text[:400]}")


def _attach_max_score(
    scores: list[dict[str, Any]], rubric_parameters: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_name = {p["name"]: p for p in rubric_parameters}
    enriched = []
    for s in scores:
        param = by_name.get(s["parameter"])
        if not param:
            continue
        max_score = int(param.get("max_score", 5))
        score_val = max(1, min(int(s["score"]), max_score))
        enriched.append(
            {
                "parameter": s["parameter"],
                "score": score_val,
                "max_score": max_score,
                "reasoning": s.get("reasoning", ""),
            }
        )
    return enriched


def get_judge() -> LLMJudge:
    provider = settings().llm_provider
    if provider == "ollama":
        return OllamaJudge()
    if provider == "gemma":
        return GemmaJudge()
    raise RuntimeError(
        f"Unknown LLM_PROVIDER: {provider!r}. Use 'ollama' (CPU-friendly) or 'gemma' (HF transformers, GPU)."
    )
