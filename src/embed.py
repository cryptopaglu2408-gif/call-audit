from __future__ import annotations

from .config import settings

_model = None


def _load():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(settings().embed_model)
    return _model


def embed(text: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        return [0.0] * 384
    vec = _load().encode(text, normalize_embeddings=True)
    return vec.tolist()
