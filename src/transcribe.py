"""Transcription via faster-whisper (CTranslate2).

CPU-friendly, int8-quantized by default. Auto-promotes to CUDA fp16 if a GPU is
present, but works fine on Intel iGPUs / pure CPU laptops.

Public API: `transcribe(Path) -> TranscriptionResult`.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import settings


@dataclass
class TranscriptionResult:
    text: str
    language: str
    duration: float
    segments: list[dict[str, Any]]


def _audio_duration(path: Path) -> float:
    try:
        import soundfile as sf

        info = sf.info(str(path))
        return float(info.frames) / float(info.samplerate)
    except Exception:
        return 0.0


class _WhisperLocal:
    """faster-whisper / CTranslate2.

    Memory footprint at int8: tiny ~70MB, base ~150MB, small ~250MB,
    medium ~800MB. `small` is the sweet spot on a 16GB-RAM laptop.
    """

    def __init__(self) -> None:
        from faster_whisper import WhisperModel  # type: ignore

        s = settings()
        device = "cpu"
        compute_type = "int8"
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                device, compute_type = "cuda", "float16"
        except Exception:
            pass
        self.model = WhisperModel(s.whisper_model, device=device, compute_type=compute_type)
        self.lang = s.whisper_lang or None  # None = auto-detect

    def transcribe(self, audio_path: Path) -> TranscriptionResult:
        segments_iter, info = self.model.transcribe(
            str(audio_path),
            language=self.lang,
            beam_size=5,
            vad_filter=True,
        )
        segments: list[dict[str, Any]] = []
        parts: list[str] = []
        for seg in segments_iter:
            segments.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()})
            parts.append(seg.text)
        text = "".join(parts).strip()
        duration = float(getattr(info, "duration", 0.0) or _audio_duration(audio_path))
        return TranscriptionResult(
            text=text,
            language=getattr(info, "language", None) or (self.lang or "en"),
            duration=duration,
            segments=segments,
        )


_backend: _WhisperLocal | None = None


def _get_backend() -> _WhisperLocal:
    global _backend
    if _backend is None:
        _backend = _WhisperLocal()
    return _backend


def transcribe(audio_path: Path) -> TranscriptionResult:
    return _get_backend().transcribe(audio_path)
