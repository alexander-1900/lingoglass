// Precompute Japanese tokens at build time. Runs on `prebuild` (after the
// content validator) and writes data/ja-tokens.generated.json, which is
// COMMITTED so deploy machines (Cloudflare/Netlify) never need Python.
//
// Replaces the old /api/tokenize-ja route: child_process is impossible on
// serverless runtimes, and stories are static data, so build-time is the
// correct place for tokenization.
//
// Fallback: without Python/Sudachi, a JS regex splitter (kanji / hiragana /
// katakana / other — same buckets as the old server fallback) still fills
// the file so JA text stays tappable, just without readings/lemmas.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(root, "content");
const OUT = path.join(root, "data", "ja-tokens.generated.json");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// Same parsing rules as lib/stories.ts / scripts/validate-content.mjs.
function parseSentences(raw) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const body = (fm ? text.slice(fm[0].length) : text).trim();
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  return blocks
    .map((block) =>
      block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("*") && !l.startsWith(">"))
        .join(" ")
    )
    .filter(Boolean);
}

// JS fallback tokenizer — same buckets as the old server fallback.
function fallbackTokenize(text) {
  const tokens = [];
  const re =
    /([\u4e00-\u9fff\u{20000}-\u{2ebef}]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[^\s\u4e00-\u9fff\u{20000}-\u{2ebef}\u3040-\u30ff]+)/gu;
  let m;
  while ((m = re.exec(text))) tokens.push({ surface: m[1] });
  return tokens;
}

function spawnSudachiBatch(py, texts) {
  return new Promise((resolve, reject) => {
    const script = path.join(root, "services", "sudachi", "sudachi_tokenize.py");
    const child = spawn(py, [script], { cwd: path.dirname(script), windowsHide: true });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error("sudachi timeout"));
      }
    }, 120000); // 25 stories in ONE spawn: generous for cold dict load
    child.stdout.on("data", (d) => (out += d.toString("utf-8")));
    child.stderr.on("data", (d) => (err += d.toString("utf-8")));
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
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
        resolve(data.tokens);
      } catch (e) {
        reject(new Error("sudachi bad output: " + e.message));
      }
    });
    child.stdin.end(JSON.stringify({ texts }), "utf-8");
  });
}

async function main() {
  const files = fs.existsSync(path.join(CONTENT, "ja"))
    ? walk(path.join(CONTENT, "ja"))
    : [];

  /** key "ja/<level>/<slug>" -> sentence texts */
  const stories = new Map();
  const allTexts = [];
  const offsets = new Map(); // key -> [startIdx, count]
  for (const file of files) {
    const rel = path.relative(CONTENT, file).split(path.sep); // [ja, level, slug.md]
    if (rel.length !== 3) continue;
    const key = `${rel[0]}/${rel[1]}/${rel[2].replace(/\.md$/, "")}`;
    const sentences = parseSentences(fs.readFileSync(file, "utf-8"));
    offsets.set(key, [allTexts.length, sentences.length]);
    for (const s of sentences) allTexts.push(s);
    stories.set(key, sentences);
  }

  // Content signature: skip the (slow) Python spawn when nothing changed.
  const signature = crypto
    .createHash("sha256")
    .update(JSON.stringify(allTexts))
    .digest("hex")
    .slice(0, 16);

  if (fs.existsSync(OUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, "utf-8"));
      if (prev.signature === signature && prev.stories && !process.env.FORCE_PRECOMPUTE) {
        console.log(`precompute-ja: up to date (signature ${signature}).`);
        return;
      }
    } catch {
      /* regenerate below */
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    signature,
    stories: Object.fromEntries([...stories.keys()].map((k) => [k, []])),
    fallback: false,
  };

  if (allTexts.length > 0) {
    const candidates = [process.env.PYTHON, "python", "python3"].filter(Boolean);
    let ok = false;
    for (const py of candidates) {
      try {
        const batch = await spawnSudachiBatch(py, allTexts);
        for (const [key, [start, count]] of offsets) {
          result.stories[key] = batch.slice(start, start + count);
        }
        console.log(`precompute-ja: ${allTexts.length} sentences tokenized via ${py} (Sudachi).`);
        ok = true;
        break;
      } catch (e) {
        if (e.code === "ENOENT") continue; // try the next interpreter name
        console.warn(`precompute-ja: ${py} failed: ${e.message}`);
      }
    }
    if (!ok) {
      // No Python/Sudachi: regex-split so JA stays tappable (no readings).
      result.fallback = true;
      for (const [key, [start, count]] of offsets) {
        result.stories[key] = allTexts
          .slice(start, start + count)
          .map(fallbackTokenize);
      }
      console.warn(
        "precompute-ja: WARNING — Python/Sudachi unavailable. Wrote regex-split tokens WITHOUT readings/lemmas. Install sudachipy + sudachidict-core and rebuild for full quality."
      );
    }
  } else {
    console.log("precompute-ja: no Japanese stories found — wrote empty file.");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1), "utf-8");
  console.log(`precompute-ja: wrote ${OUT} (${Object.keys(result.stories).length} stories).`);
}

main().catch((e) => {
  // Never fail the build for this: the app treats missing tokens as the
  // pre-auth fallback (JA renders blob-split).
  console.warn(`precompute-ja: FAILED — ${e.message}. Continuing without tokens.`);
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(
      OUT,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        signature: "",
        stories: {},
        fallback: true,
      }),
      "utf-8"
    );
  } catch {
    /* ignore */
  }
});