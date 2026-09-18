"""Native Sudachi tokenizer for lingoglass (no Docker, no HTTP service).

Reads one JSON document from stdin:  {"text": "..."}
Writes one JSON document to stdout:  {"tokens": [ { "surface", "lemma",
"reading", "pos" }, ... ]}

"lemma" is Sudachi's normalized_form (dictionary form: 飲みます -> 飲む),
"reading" is the katakana reading (Sudachi convention).

NOTE: this file must NOT be named `tokenize.py` — that would shadow the
Python stdlib `tokenize` module (part of sudachipy's import chain) and cause
a circular-import crash.

Setup on the host machine:
    pip install sudachipy sudachidict-core

Run standalone to smoke-test:
    echo '{"text": "私は毎朝コーヒーを飲みます。"}' | python sudachi_tokenize.py
"""

import io
import json
import sys

# The Node route pipes UTF-8 bytes over stdin/stdout; on Windows a piped
# stdin defaults to the legacy console codepage, which would mangle Japanese
# text into lone surrogates and crash json.dump below. Force UTF-8 both ways.
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

try:
    from sudachipy import dictionary, tokenizer
except ImportError as exc:  # pragma: no cover
    json.dump({"tokens": [], "error": f"sudachipy not installed: {exc}"}, sys.stdout)
    sys.exit(1)

_tokenizer = dictionary.Dictionary().create(tokenizer.Tokenizer.SplitMode.A)


def tokenize(text: str) -> list[dict]:
    tokens: list[dict] = []
    for m in _tokenizer.tokenize(text):
        reading = m.reading_form() or None
        pos_parts = m.part_of_speech()
        tokens.append(
            {
                "surface": m.surface(),
                "lemma": m.normalized_form() or m.surface(),
                "reading": reading,
                "pos": ",".join(pos_parts[:4]) if pos_parts else None,
            }
        )
    return tokens


def main() -> None:
    try:
        req = json.load(sys.stdin)
        text = str(req.get("text", "")).strip()[:2000]
    except Exception as exc:  # noqa: BLE001
        json.dump({"tokens": [], "error": f"bad request: {exc}"}, sys.stdout)
        sys.exit(1)

    if not text:
        json.dump({"tokens": []}, sys.stdout)
        return

    try:
        json.dump({"tokens": tokenize(text)}, sys.stdout)
    except Exception as exc:  # noqa: BLE001
        json.dump({"tokens": [], "error": str(exc)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
