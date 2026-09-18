import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";
import { isJapaneseText } from "@/lib/furigana-romaji";

interface TokenOut {
  surface: string;
  /** Dictionary / normalized form from Sudachi (飲みます -> 飲む). */
  lemma?: string;
  reading?: string;
  pos?: string;
}

// Native tokenizer: a standalone local Python script (services/sudachi/
// sudachi_tokenize.py) invoked via child_process. No Docker, no HTTP endpoint.
// (Named sudachi_tokenize.py — "tokenize.py" would shadow the Python stdlib
// module of the same name and break sudachipy's import chain.)
const SCRIPT = path.join(process.cwd(), "services", "sudachi", "sudachi_tokenize.py");
const PYTHON_CANDIDATES = [process.env.PYTHON, "python", "python3"].filter(
  (p): p is string => typeof p === "string" && p.length > 0
);

// Sentences repeat across visits; spawning Python (which loads the Sudachi
// dictionary every time) is not free, so memoize within the server process.
const cache = new Map<string, TokenOut[]>();
const CACHE_MAX = 300;

function spawnOnce(py: string, text: string): Promise<TokenOut[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(py, [SCRIPT], { cwd: path.dirname(SCRIPT), windowsHide: true });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error("sudachi timeout"));
      }
    }, 10000); // generous: the first run loads the Sudachi dictionary from disk
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf-8");
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf-8");
    });
    // EPIPE if the script exits early — never crash the route for it.
    child.stdin.on("error", () => {});
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error(e.message), { code: e.code }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`sudachi exit ${code}: ${err.slice(0, 200)}`));
        return;
      }
      try {
        const data = JSON.parse(out);
        if (!Array.isArray(data?.tokens)) throw new Error("bad shape");
        resolve(data.tokens as TokenOut[]);
      } catch {
        reject(new Error("sudachi bad output"));
      }
    });
    child.stdin.end(JSON.stringify({ text }), "utf-8");
  });
}

/** Try each Python candidate; ENOENT moves to the next, anything else stops. */
async function runNativeSudachi(text: string): Promise<TokenOut[] | null> {
  for (const py of PYTHON_CANDIDATES) {
    try {
      return await spawnOnce(py, text);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException & { code?: string }).code;
      if (code === "ENOENT") continue; // interpreter not found — try next name
      return null; // script missing / module missing / timeout → fallback
    }
  }
  return null;
}

export async function POST(req: Request) {
  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 2000);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ tokens: [] });
  if (!isJapaneseText(text)) return NextResponse.json({ tokens: [] });

  // Native Sudachi (local Python script) with an in-process cache.
  const cached = cache.get(text);
  if (cached) {
    return NextResponse.json({ tokens: cached });
  }
  const native = await runNativeSudachi(text);
  if (native && native.length && native.every((t) => typeof t?.surface === "string")) {
    const clean = native.map((t) => ({
      surface: t.surface,
      lemma: typeof t.lemma === "string" && t.lemma ? t.lemma : undefined,
      reading: typeof t.reading === "string" && t.reading ? t.reading : undefined,
      pos: typeof t.pos === "string" && t.pos ? t.pos : undefined,
    }));
    if (cache.size >= CACHE_MAX) {
      cache.delete(cache.keys().next().value as string);
    }
    cache.set(text, clean);
    return NextResponse.json({ tokens: clean });
  }

  // Fallback tokenizer: groups of kanji / kana / other, no readings.
  const tokens: TokenOut[] = [];
  // Kanji buckets cover U+4E00–9FFF (incl. the 9FB0–9FFF tail) and astral
  // Extension B–F, matching isJapaneseText; /u flag needed for the astral
  // range. (The old version missed both tails and duplicated \u30a0-\u30ff.)
  const re =
    /([\u4e00-\u9fff\u{20000}-\u{2ebef}]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[^\s\u4e00-\u9fff\u{20000}-\u{2ebef}\u3040-\u30ff]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push({ surface: m[1] });
  }
  return NextResponse.json({ tokens });
}

