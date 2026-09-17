"""Sudachi tokenization microservice for lingoglass.

POST /  { "text": "..." }  ->  { "tokens": [ { "surface", "reading", "pos" }, ... ] }
Readings are returned in katakana (Sudachi convention).
Run:  uvicorn main:app --host 0.0.0.0 --port 8300
"""
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sudachipy import dictionary, tokenizer

app = FastAPI(title="lingoglass-sudachi")

_tokenizer = dictionary.Dictionary().create(tokenizer.Tokenizer.SplitMode.A)


class TokenizeRequest(BaseModel):
    text: str


class TokenOut(BaseModel):
    surface: str
    reading: Optional[str] = None
    pos: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/")
def tokenize(req: TokenizeRequest):
    text = req.text.strip()[:2000]
    if not text:
        return {"tokens": []}
    tokens: list[TokenOut] = []
    try:
        for m in _tokenizer.tokenize(text):
            surface = m.surface()
            reading = m.reading_form() or None
            pos = ",".join(m.part_of_speech()[:4]) or None
            tokens.append(TokenOut(surface=surface, reading=reading, pos=pos))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    return {"tokens": [t.model_dump() for t in tokens]}
