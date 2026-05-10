from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = PROJECT_ROOT / "audio"
AUDIO_DIR.mkdir(exist_ok=True)


def _req(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


def _bool(key: str, default: bool = False) -> bool:
    return (os.getenv(key, str(default)).lower() in {"1", "true", "yes", "y"})


@dataclass(frozen=True)
class Settings:
    # Supabase
    supabase_url: str
    supabase_key: str
    audio_bucket: str

    # LLM judge — "ollama" (CPU, recommended) or "gemma" (HF transformers, GPU/fine-tune)
    llm_provider: str
    ollama_host: str
    ollama_model: str
    gemma_model: str
    gemma_adapter: str | None
    gemma_load_in_4bit: bool
    gemma_max_new_tokens: int

    # Transcription (faster-whisper)
    whisper_model: str   # tiny | base | small | medium | large-v3
    whisper_lang: str    # "" = auto-detect

    # Embeddings
    embed_model: str

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            supabase_url=_req("SUPABASE_URL"),
            supabase_key=_req("SUPABASE_KEY"),
            audio_bucket=os.getenv("SUPABASE_AUDIO_BUCKET", "call-audio"),
            llm_provider=os.getenv("LLM_PROVIDER", "ollama").lower(),
            ollama_host=os.getenv("OLLAMA_HOST", "http://localhost:11434"),
            ollama_model=os.getenv("OLLAMA_MODEL", "gemma3:4b"),
            gemma_model=os.getenv("GEMMA_MODEL", "google/gemma-4-E4B-it"),
            gemma_adapter=os.getenv("GEMMA_ADAPTER") or None,
            gemma_load_in_4bit=_bool("GEMMA_LOAD_IN_4BIT", True),
            gemma_max_new_tokens=int(os.getenv("GEMMA_MAX_NEW_TOKENS", "1024")),
            whisper_model=os.getenv("WHISPER_MODEL", "small"),
            whisper_lang=os.getenv("WHISPER_LANG", ""),
            embed_model=os.getenv(
                "EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
            ),
        )


_settings: Settings | None = None


def settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.load()
    return _settings
