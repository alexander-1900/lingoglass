import { NextResponse } from "next/server";
import { isJapaneseText } from "@/lib/furigana-romaji";

interface TokenOut {
  surface: string;
  reading?: string;
  pos?: string;
}

const SUDACHI_URL = process.env.SUDACHI_SERVICE_URL;

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

  // Preferred: external Sudachi service (services/sudachi, Docker)
  if (SUDACHI_URL) {
    try {
      const res = await fetch(SUDACHI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        // Never trust the tokenizer blindly: fall back unless the shape is right.
        if (Array.isArray(data.tokens) && data.tokens.every((t: unknown) =>
          typeof t === "object" && t !== null && typeof (t as { surface?: unknown }).surface === "string"
        )) {
          return NextResponse.json({ tokens: data.tokens });
        }
      }
    } catch {
      // fall through to fallback
    }
  }

  // Fallback tokenizer: groups of kanji / kana / other, no readings.
  const tokens: TokenOut[] = [];
  const re = /([\u4e00-\u9faf]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[^\s\u4e00-\u9faf\u3040-\u30ff\u30a0-\u30ff]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push({ surface: m[1] });
  }
  return NextResponse.json({ tokens });
}
