#!/usr/bin/env python3
"""Synthesize story sentences with edge-tts, for scripts/generate-audio.mjs.

One invocation = one batch of sentences (a batch is one story, so a crash
costs at most that story). Node writes the job as JSON on stdin, this reads it,
streams each sentence through the Microsoft Edge read-aloud endpoint and writes
two files per sentence:

  <mp3>   the MP3 the service returned (audio-24khz-48kbitrate-mono-mp3)
  <json>  {"version":1,"voice":…,"rate":…,"text":…,"words":[WordBoundary…]}

Word events keep edge-tts's own fields verbatim — text plus `offset`/`duration`
in 100 ns ticks, already rebased onto the sentence by edge-tts itself. There is
NO character offset in that protocol (unlike the Speech SDK's textOffset), so
the Node side derives the character ranges by walking the sentence text
(scripts/lib/audio-format.mjs → alignWords).

The MP3 is 48 kbps CBR, which makes its byte offsets a clock: 6 bytes/ms, i.e.
exactly 288 bytes per 1152-sample frame = 48 ms — the same grid as the 24 kHz
mono PCM the Node script assembles (48 bytes/ms). That is why timing needs no
ffprobe guesswork anywhere.

stdout is one JSON summary (ASCII); failures are per-sentence so Node can retry
only what actually failed. Exit codes: 0 all ok, 3 some sentence failed,
2 malformed job, 4 edge-tts missing, 1 unexpected.

Job (stdin): {"rate":"+25%","items":[{"text":…,"voice":…,"mp3":…,"json":…}]}
Summary (stdout): {"ok":bool,"results":[{"ok":bool,"bytes":n,"words":n,"error":?}]}

Env: PYTHONUTF8=1 is set by the Node caller; every file handle here still names
utf-8 explicitly, and stdout stays ASCII, so a cp1251 console cannot corrupt
Japanese or accented text in either direction.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

MAX_CHARS_PER_REQUEST = 4000  # edge-tts splits above ~3.5k bytes; we stay under it


def write_atomic(path: str, data: bytes) -> None:
    """Never leave a half-written cache file behind (Node does the same)."""
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as handle:
        handle.write(data)
    os.replace(tmp, path)


async def synthesize_one(item: dict, rate: str) -> int:
    """One sentence → <mp3> + <json>. Raises when the service gave no audio."""
    import edge_tts

    communicate = edge_tts.Communicate(
        text=item["text"],
        voice=item["voice"],
        rate=rate,
        # 7.x defaults to SentenceBoundary; word taps need the finer one.
        boundary="WordBoundary",
    )
    audio = bytearray()
    words: list[dict] = []
    async for chunk in communicate.stream():
        kind = chunk.get("type")
        if kind == "audio":
            audio.extend(chunk["data"])
        elif kind in ("WordBoundary", "SentenceBoundary"):
            words.append(
                {
                    "text": chunk["text"],
                    "offset": int(chunk["offset"]),
                    "duration": int(chunk["duration"]),
                }
            )
    if not audio:
        raise RuntimeError("no audio received for this sentence")

    write_atomic(item["mp3"], bytes(audio))
    write_atomic(
        item["json"],
        json.dumps(
            {
                "version": 1,
                "voice": item["voice"],
                "rate": rate,
                "text": item["text"],
                "words": words,
            },
            ensure_ascii=False,
        ).encode("utf-8"),
    )
    return len(audio)


async def run_batch(items: list[dict], rate: str) -> list[dict]:
    """Sentences go one at a time: Node parallelizes across stories instead."""
    results = []
    for item in items:
        try:
            nbytes = await synthesize_one(item, rate)
            results.append({"ok": True, "bytes": nbytes})
        except Exception as error:  # reported per sentence, retried by Node
            results.append({"ok": False, "error": f"{type(error).__name__}: {error}"})
    return results


def main() -> int:
    raw = sys.stdin.buffer.read().decode("utf-8")
    try:
        job = json.loads(raw)
        items = job["items"]
        rate = job.get("rate", "+0%")
    except Exception as error:
        emit({"ok": False, "error": f"malformed job on stdin: {error}"})
        return 2
    if not isinstance(items, list) or not items:
        emit({"ok": False, "error": "job has no items"})
        return 2
    oversized = [i for i, item in enumerate(items) if len(item.get("text", "")) > MAX_CHARS_PER_REQUEST]
    if oversized:
        emit(
            {
                "ok": False,
                "error": "sentence too long for one request: indexes "
                + ", ".join(str(i + 1) for i in oversized),
            }
        )
        return 2

    try:
        import edge_tts  # noqa: F401  (presence check only; re-imported per sentence)
    except ImportError:
        emit(
            {
                "ok": False,
                "error": "edge-tts is not installed for this interpreter — run: "
                "python -m pip install --user edge-tts",
            }
        )
        return 4

    try:
        results = asyncio.run(run_batch(items, rate))
    except KeyboardInterrupt:
        emit({"ok": False, "error": "interrupted"})
        return 1
    failed = [r for r in results if not r["ok"]]
    emit({"ok": not failed, "results": results})
    return 0 if not failed else 3


def emit(summary: dict) -> None:
    sys.stdout.write(json.dumps(summary) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main())
