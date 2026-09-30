// Generate static neural-TTS audio for every story: ONE MP3 per story plus a
// timing JSON with per-sentence and per-word offsets in ms.
//
// Authoring-time only — NOT wired into `prebuild` or CI. Run
// `npm run audio:generate` when story text (or a voice/rate) changes; public/
// audio/ is what the reader plays, and the deploy needs nothing but those files.
//
// Pipeline per story:
//   1. every sentence goes through scripts/lib/edge_tts_synth.py (Microsoft
//      Edge's read-aloud endpoint — free, no key) → one 48 kbps CBR MP3 + one
//      sidecar of WordBoundary events, both cached in .audio-cache/sentences
//      under a voice+rate+text hash, so a killed run resumes and an edited
//      sentence alone re-synthesizes;
//   2. each cached MP3 is decoded to 24 kHz mono PCM (cached too), because
//      decoded PCM — not ffprobe, not player estimates — is what makes
//      sample-accurate timings;
//   3. the PCM pieces are joined with SENTENCE_GAP_MS of silence between them
//      and encoded ONCE, CBR, into the story MP3;
//   4. sentence start/end come from the exact PCM byte lengths, word timings
//      from each WordBoundary offset, and word character ranges are recovered by
//      alignWords (this protocol says WHEN a word is spoken, never WHERE).
//
// Why PCM rather than stream-copying a concat: 48 kbps CBR puts one 1152-sample
// frame every 288 MP3 bytes = 2304 PCM bytes = 48 ms, so the byte-derived word
// offsets edge-tts sends and the PCM timeline being assembled share one grid.
// Joining at PCM level keeps that grid exact — no frame drift, no concat-filter
// resample, one encoder pass instead of a per-sentence encode plus a remux.
// ffprobe only ever RECONCILES the finished file's duration against the PCM fed
// in; it never produces a timing value.
//
// Usage:
//   npm run audio:generate
//   npm run audio:generate -- --lang es --limit-per-level 1  (one story/level)
//   npm run audio:generate -- --only es/01-cambio-de-rumbo
//   npm run audio:generate -- --dry-run           (no Python, no ffmpeg needed)
//   npm run audio:generate -- --rate +40%         (default +25%, see below)
//   npm run audio:generate -- --only ja/01-momotaro --show-boundaries
//   npm run audio:fixture                         (beeps; ffmpeg only, offline)
//
// The default rate is +25%, deliberately modest: the reader has its own
// 0.5×–1.5× playback control, and a second speed-up baked into the file would
// stack on top of it and blur exactly the words a learner slows down for.
// Override with EDGE_TTS_RATE (see .env.example) or --rate. Changing the rate
// re-synthesizes: it is part of every cache key and of the story hash.
//
// Env: EDGE_TTS_RATE, PYTHON (the interpreter also used for Sudachi), FFMPEG.
// No API key anywhere — see README → Story audio for what that costs (the
// sentence text is sent to Microsoft's endpoint, at authoring time only).

import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { parseSentences } from "./lib/story-format.mjs";
import {
  AUDIO_BYTES_PER_MS,
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  SENTENCE_GAP_MS,
  TIMING_VERSION,
  alignWords,
  manifestEntry,
  manifestEntryMatches,
  mp3BytesToMs,
  pcmBytesToMs,
  round3,
  sentenceTimings,
  staleStoryFiles,
  storyFileNames,
  ticksToMs,
  wordTiming,
} from "./lib/audio-format.mjs";
import { sentenceHash8, storyHash8 } from "./lib/audio-hash.mjs";
import { FIXTURE_VOICE, sentenceFixture } from "./lib/audio-fixture.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(root, "content");
const OUT_DIR = path.join(root, "public", "audio");
const CACHE_DIR = path.join(root, ".audio-cache", "sentences");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const SYNTH_HELPER = path.join(root, "scripts", "lib", "edge_tts_synth.py");

/** One voice per language — a single voice narrates a whole story. Keys must
 *  match the languages in lib/types.ts (es/ru/ja). */
const VOICES = {
  es: "es-ES-AlvaroNeural",
  ru: "ru-RU-DmitryNeural",
  ja: "ja-JP-NanamiNeural",
};

/** MP3 encode: CBR on purpose (never VBR) so seeks land on exact frames and the
 *  bitrate stays the 6 bytes/ms the whole timing model assumes. */
const MP3_BITRATE = "48k";

/** Speaking rate sent to edge-tts when nothing overrides it. */
const DEFAULT_RATE = "+25%";
const RATE_RE = /^[+-]\d{1,3}%$/;

/** Stories in flight = concurrent Python processes. Two is polite to a free
 *  endpoint with no quota to inspect; inside a story sentences go one by one,
 *  which is also what keeps the resume granularity useful. */
const DEFAULT_CONCURRENCY = 2;

/** Per-process budget. The service answers a sentence in seconds, so this only
 *  exists to stop one wedged websocket from holding the whole run. */
const SYNTH_TIMEOUT_BASE_MS = 45_000;
const SYNTH_TIMEOUT_PER_SENTENCE_MS = 40_000;

/** Tolerance for the ffprobe cross-check of a finished story MP3: encoder delay
 *  (~53 ms) + a frame + Xing-header rounding. Generous on purpose — the check
 *  exists to catch a broken JOIN (hundreds of ms), not lame's padding. */
const PROBE_TOLERANCE_MS = 250;

const RETRYABLE_RE =
  /429|throttl|rate.?limit|too many|temporar|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket|network|unavailable|websocket|handshake|no audio|5\d\d/i;
const FATAL_RE = /invalid voice|voice not found|traceback|malformed job|edge-tts is not installed|no result JSON/i;
const MAX_ATTEMPTS = 3;

function fail(message) {
  console.error(`audio: ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(flag, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail(`${flag} needs a positive integer`);
  return value;
}

function parseArgs(argv) {
  const opts = {
    concurrency: DEFAULT_CONCURRENCY,
    rate: DEFAULT_RATE,
    showBoundaries: 0,
    limitPerLevel: 0,
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--fixture") opts.fixture = true;
    else if (arg === "--only") {
      const value = argv[++i];
      if (!value) fail("--only needs lang/slug (comma-separate for several)");
      opts.only = new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--lang") {
      const value = argv[++i];
      if (!value || !VOICES[value]) fail(`--lang needs one of ${Object.keys(VOICES).join(", ")}`);
      opts.lang = value;
    } else if (arg === "--limit-per-level") {
      opts.limitPerLevel = positiveInt(arg, argv[++i]);
    } else if (arg === "--limit") {
      opts.limit = positiveInt(arg, argv[++i]);
    } else if (arg === "--rate") {
      opts.rate = argv[++i];
      if (!RATE_RE.test(opts.rate ?? "")) fail('--rate needs a signed percentage, e.g. "+25%"');
    } else if (arg === "--concurrency") {
      opts.concurrency = Math.min(positiveInt(arg, argv[++i]), 8);
    } else if (arg === "--show-boundaries") {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0) {
        opts.showBoundaries = value;
        i++;
      } else {
        opts.showBoundaries = 10;
      }
    } else {
      fail(`unknown flag ${arg}`);
    }
  }
  // The process env is read only after loadEnvFiles(), so a literal default is
  // compared there; beeps have no rate and must not share the real run's cache.
  if (opts.fixture) opts.rate = "+0%";
  return opts;
}

/** Read .env.local / .env without a dependency; the process env always wins. */
function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
      if (line.trimStart().startsWith("#")) continue;
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2].replace(/\s+#.*$/, "");
      if (
        value.length > 1 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** All selected stories (sentences only — the content validator owns format
 *  errors, this just reads what lib/stories.ts reads). */
function loadStories(opts) {
  const stories = [];
  for (const file of walk(CONTENT)) {
    const rel = path.relative(CONTENT, file).split(path.sep);
    if (rel.length !== 3) continue;
    const [lang, level, name] = rel;
    if (!VOICES[lang]) continue;
    if (opts.lang && lang !== opts.lang) continue;
    const slug = name.replace(/\.md$/, "");
    const key = `${lang}/${slug}`;
    if (opts.only && !opts.only.has(key)) continue;
    const sentences = parseSentences(fs.readFileSync(file, "utf-8"));
    if (!sentences.length) {
      console.warn(`audio: skipping ${key} — no sentences`);
      continue;
    }
    stories.push({
      lang,
      level,
      slug,
      key,
      sentences,
      chars: sentences.reduce((n, s) => n + s.length, 0),
    });
  }
  stories.sort((a, b) => a.key.localeCompare(b.key));
  return applyLimits(stories, opts);
}

/** Small-batch runs (the first run of a new pipeline should be one):
 *  --limit-per-level N keeps the first N stories of every level, so the sample
 *  still spans the difficulty range, and --limit N takes the first N stories. */
function applyLimits(stories, opts) {
  let out = stories;
  if (opts.limitPerLevel) {
    const seen = new Map();
    out = out.filter((s) => {
      const key = `${s.lang}/${s.level}`;
      const taken = seen.get(key) ?? 0;
      if (taken >= opts.limitPerLevel) return false;
      seen.set(key, taken + 1);
      return true;
    });
  }
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

/** Manifest keys for every story file on disk (no parsing — pruning only). */
function contentKeys() {
  const keys = new Set();
  for (const file of walk(CONTENT)) {
    const rel = path.relative(CONTENT, file).split(path.sep);
    if (rel.length !== 3) continue;
    const [lang, , name] = rel;
    if (VOICES[lang]) keys.add(`${lang}/${name.replace(/\.md$/, "")}`);
  }
  return keys;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    /* missing or half-written — callers regenerate */
    return null;
  }
}

function readManifest() {
  return readJson(MANIFEST) ?? {};
}

/** Write via tmp+rename so a killed run never leaves a partial file. */
function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Fixed-size worker pool: stops handing out work after a fatal failure. */
async function mapPool(items, limit, worker) {
  let next = 0;
  let failure = null;
  const run = async () => {
    while (next < items.length && !failure) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (e) {
        failure = failure || e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (failure) throw failure;
}

/** Retry transient service failures with backoff; a bad voice or a broken job
 *  fails fast instead of burning three attempts on every story. */
async function withRetry(label, fn) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (FATAL_RE.test(msg) || !RETRYABLE_RE.test(msg) || attempt >= MAX_ATTEMPTS) {
        throw new Error(`${label}: ${msg}`);
      }
      const wait = delay + Math.floor(Math.random() * 500);
      console.warn(
        `audio: ${label} — attempt ${attempt} failed (${msg.slice(0, 160)}); retrying in ${Math.round(wait / 1000)}s`
      );
      await sleep(wait);
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

function fmtBytes(n) {
  return n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${(n / 1024).toFixed(1)} KB`;
}

function measureAudioDir() {
  let files = 0;
  let bytes = 0;
  let largest = 0;
  const stack = fs.existsSync(OUT_DIR) ? [OUT_DIR] : [];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      const size = fs.statSync(p).size;
      files++;
      bytes += size;
      largest = Math.max(largest, size);
    }
  }
  return { files, bytes, largest };
}

/**
 * ffmpeg.exe in the places Windows installs put it but a fresh shell's PATH
 * does not know about: winget drops it under %LOCALAPPDATA% and the PATH change
 * only reaches terminals opened AFTER the install. Only consulted when plain
 * `ffmpeg` does not resolve, so a real PATH install always wins, and FFMPEG=
 * beats everything (see .env.example).
 */
function discoverFfmpeg() {
  if (process.platform !== "win32") return null;
  const candidates = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    path.join(process.env.ProgramFiles || "", "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ffmpeg", "bin", "ffmpeg.exe"),
  ];
  const winget = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  try {
    for (const pkg of fs.readdirSync(winget)) {
      if (!/^Gyan\.FFmpeg_/i.test(pkg)) continue;
      for (const inner of fs.readdirSync(path.join(winget, pkg))) {
        candidates.push(path.join(winget, pkg, inner, "bin", "ffmpeg.exe"));
      }
    }
  } catch {
    /* winget not used on this machine */
  }
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

let ffmpegBin; // resolved once: decoder, encoder and probe must share one binary
function ffmpegPath() {
  if (ffmpegBin === undefined) {
    if (process.env.FFMPEG) ffmpegBin = process.env.FFMPEG;
    else if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0)
      ffmpegBin = "ffmpeg";
    else ffmpegBin = discoverFfmpeg() ?? "ffmpeg";
  }
  return ffmpegBin;
}

/** Fail fast BEFORE synthesis when encoding is actually needed. */
function assertFfmpeg() {
  const bin = ffmpegPath();
  const probe = spawnSync(bin, ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    fail(
      `ffmpeg not found (tried "${bin}"). Install it and re-run:\n` +
        "  Windows: winget install Gyan.FFmpeg   (then open a NEW terminal)\n" +
        "  macOS:   brew install ffmpeg\n" +
        "  Linux:   sudo apt install ffmpeg\n" +
        "  …or point FFMPEG at the binary (see .env.example)."
    );
  }
}

/** ffprobe ships next to ffmpeg; it only RECONCILES a finished file (see
 *  PROBE_TOLERANCE_MS). Null means "cannot check", never an error — timings are
 *  byte-derived and never depend on it. */
function ffprobePath() {
  const ffmpeg = ffmpegPath();
  const sibling = /^ffmpeg$/i.test(ffmpeg)
    ? "ffprobe"
    : ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  if (sibling === ffmpeg) return null; // FFMPEG points at something exotic
  return spawnSync(sibling, ["-version"], { stdio: "ignore" }).status === 0 ? sibling : null;
}

/** Same interpreter resolution as scripts/precompute-ja.mjs: PYTHON wins, then
 *  `python`, then `python3` — one Python for the whole repo, configured once. */
let pythonBin;
function pythonPath() {
  if (pythonBin === undefined) {
    const candidates = [process.env.PYTHON, "python", "python3"].filter(Boolean);
    pythonBin =
      candidates.find((c) => spawnSync(c, ["-c", ""], { stdio: "ignore" }).status === 0) ??
      candidates[0];
  }
  return pythonBin;
}

/** Checked once, up front: learning that edge-tts lives in a different
 *  interpreter on the 400th of 850 sentences is the worst way to find out. */
function assertEdgeTts() {
  const bin = pythonPath();
  const probe = spawnSync(bin, ["-c", "import edge_tts"], { encoding: "utf-8" });
  if (probe.error || probe.status !== 0) {
    const reason = (probe.stderr || probe.error?.message || "import failed")
      .trim()
      .split("\n")
      .pop();
    fail(
      `edge-tts is not importable by "${bin}" (${reason}).\n` +
        `  Install it: ${bin} -m pip install --user edge-tts\n` +
        "  …or point PYTHON at the interpreter that has it (see .env.example)."
    );
  }
}

/** One ffmpeg pass: raw PCM on stdin → CBR MP3 (tmp+rename = crash-safe). */
function encodeMp3(pcm, outPath) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    const tmp = `${outPath}.tmp.mp3`;
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      String(AUDIO_CHANNELS),
      "-i",
      "pipe:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      MP3_BITRATE, // CBR on purpose — VBR frames would desync seeking
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      String(AUDIO_CHANNELS),
      tmp,
    ];
    const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
    child.on("error", (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        fs.rmSync(tmp, { force: true });
        reject(
          new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 400) || "no stderr output"}`)
        );
        return;
      }
      fs.renameSync(tmp, outPath);
      resolve();
    });
    child.stdin.on("error", () => {
      /* ffmpeg failing early closes stdin — the close handler reports it */
    });
    child.stdin.end(pcm);
  });
}

/**
 * Sentence MP3 → s16le PCM, cached beside it so an unchanged sentence decodes
 * once. The decoder is never told to discard encoder delay, and this stream
 * carries no LAME/Info tag that would make it do so implicitly: the PCM is the
 * MP3's own frame grid, which is what keeps edge-tts's byte-derived word offsets
 * valid after the join. The length check below makes that a checked assumption.
 */
function decodePcm(mp3Path, pcmPath) {
  if (fs.existsSync(pcmPath) && fs.statSync(pcmPath).size > 0) return;
  const bin = ffmpegPath();
  const tmp = `${pcmPath}.tmp`;
  const res = spawnSync(
    bin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      mp3Path,
      "-f",
      "s16le",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      String(AUDIO_CHANNELS),
      tmp,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const stderr = (res.stderr ?? "").toString("utf-8").trim();
  if (res.error || res.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`decoding ${path.basename(mp3Path)} failed: ${stderr.slice(0, 200) || bin}`);
  }
  const pcmBytes = fs.statSync(tmp).size;
  if (!pcmBytes) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`decoding ${path.basename(mp3Path)} produced no audio`);
  }
  // Both clocks must agree on the length. More than one 48 ms frame of
  // disagreement means the voice is NOT answering in 48 kbps CBR, so its
  // byte-derived word offsets are not on this timeline (sentence timings stay
  // right — they come from the PCM — but the words inside would drift).
  const driftMs = Math.abs(pcmBytesToMs(pcmBytes) - mp3BytesToMs(fs.statSync(mp3Path).size));
  if (driftMs > 48) {
    console.warn(
      `audio: WARNING — ${path.basename(mp3Path)} decodes ${round3(driftMs)} ms away from its ` +
        "48 kbps CBR byte length; word timings in that sentence may drift."
    );
  }
  fs.renameSync(tmp, pcmPath);
}

/** Duration ffprobe reports for a finished file, in ms (null = cannot check). */
function probeDurationMs(file) {
  const bin = ffprobePath();
  if (!bin) return null;
  const res = spawnSync(
    bin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf-8" }
  );
  if (res.error || res.status !== 0) return null;
  const seconds = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Cache slots for one sentence: the MP3 the service returned, its decoded PCM,
 * and the WordBoundary sidecar. Keyed by voice + rate + text in one flat,
 * gitignored directory, so an edited sentence re-synthesizes alone, a killed run
 * resumes, and a voice or rate change simply MISSES instead of reusing audio
 * that no longer matches. The cache is the only place audio exists twice, and it
 * grows only with distinct sentences — deleting it is always safe.
 */
function cachePaths(voice, rate, text) {
  const key = `${voice}-${sentenceHash8(voice, rate, text)}`;
  return {
    mp3: path.join(CACHE_DIR, `${key}.mp3`),
    pcm: path.join(CACHE_DIR, `${key}.pcm`),
    json: path.join(CACHE_DIR, `${key}.json`),
  };
}

/** Synthesized and word events on disk? (the PCM slot is only a speed-up) */
function isSynthesized(files) {
  return fs.existsSync(files.mp3) && fs.existsSync(files.json) && fs.statSync(files.json).size > 0;
}

/** The helper prints one JSON line; a chatty interpreter could add noise, so
 *  the LAST parseable line wins. */
function readLastJson(text) {
  for (const line of text.trim().split("\n").reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      /* not the summary line */
    }
  }
  return null;
}

/**
 * Ask scripts/lib/edge_tts_synth.py for one batch (a batch is one story, so a
 * crash costs at most that story). `labels` maps result positions to story
 * sentence numbers so a failure names the sentence, not the array index.
 */
function runSynthHelper(job, labels) {
  const timeoutMs = SYNTH_TIMEOUT_BASE_MS + SYNTH_TIMEOUT_PER_SENTENCE_MS * job.items.length;
  return new Promise((resolve, reject) => {
    const bin = pythonPath();
    const child = spawn(bin, [SYNTH_HELPER], {
      // The job is JSON with the story text in it; a cp1251 stdio would mangle
      // Japanese and accented Spanish before edge-tts ever saw it.
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no answer from edge-tts in ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const settled = (fn) => {
      clearTimeout(timer);
      fn();
    };
    child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
    child.on("error", (e) => settled(() => reject(new Error(`"${bin}" failed to start: ${e.message}`))));
    child.on("close", (code) => {
      const summary = readLastJson(stdout);
      if (!summary) {
        const tail = (stderr || stdout).trim().split("\n").slice(-2).join(" ");
        settled(() =>
          reject(new Error(`edge-tts helper exited ${code}: ${tail.slice(0, 300) || "no output"}`))
        );
        return;
      }
      const results = Array.isArray(summary.results) ? summary.results : [];
      if (!results.length) {
        settled(() => reject(new Error(String(summary.error ?? "no result JSON"))));
        return;
      }
      const bad = results
        .map((r, i) => ({ r, i }))
        .filter((x) => !x.r?.ok)
        .map((x) => `#${labels[x.i] ?? x.i + 1}: ${String(x.r?.error).slice(0, 120)}`);
      if (bad.length) {
        settled(() => reject(new Error(`${bad.length} sentence(s) failed — ${bad.join(" | ")}`)));
        return;
      }
      settled(() => resolve(results));
    });
    child.stdin.on("error", () => {
      /* helper died early and closed stdin — the close handler reports it */
    });
    child.stdin.end(JSON.stringify(job));
  });
}

/**
 * Synthesize whatever the cache lacks, retrying the batch until the cache is
 * complete or the attempts run out. Sentences that DID succeed stay cached, so a
 * retry asks only for the ones still missing — that is what makes a 429 or a
 * dropped websocket cost seconds instead of a re-run.
 */
async function synthesizeStory(item) {
  const { story, voice, rate, files } = item;
  await withRetry(`${story.key} synthesis`, async () => {
    const missing = story.sentences
      .map((_, i) => i)
      .filter((i) => !isSynthesized(files[i]));
    if (!missing.length) return;
    console.log(
      `audio: ${story.key} — synthesizing ${missing.length}/${story.sentences.length} sentence(s): ${voice} at ${rate}…`
    );
    await runSynthHelper(
      {
        rate,
        items: missing.map((i) => ({
          text: story.sentences[i],
          voice,
          mp3: files[i].mp3,
          json: files[i].json,
        })),
      },
      missing.map((i) => i + 1)
    );
    const stillMissing = missing.filter((i) => !isSynthesized(files[i]));
    if (stillMissing.length) {
      throw new Error(
        `${stillMissing.length} sentence(s) reported ok but left no files (#${stillMissing.map((i) => i + 1).join(", #")})`
      );
    }
  });
}

/**
 * Beep stand-ins, written into the same cache slots — so the assembly, the
 * timing math, the encoder and the manifest below run unchanged and offline.
 * This mode has no MP3 to decode: the PCM arrives already synthesized.
 */
function writeFixtureSentences(item) {
  const { story, voice, rate, files } = item;
  story.sentences.forEach((text, i) => {
    const { pcm, words } = sentenceFixture(text, i);
    writeAtomic(
      files[i].json,
      Buffer.from(JSON.stringify({ version: 1, voice, rate, text, words }), "utf-8")
    );
    writeAtomic(files[i].pcm, pcm);
  });
}

/**
 * Assemble one story from cached sentences: PCM pieces joined by
 * SENTENCE_GAP_MS of silence, ONE CBR encode, sentence timings from exact PCM
 * byte lengths, word timings from the voice's own offsets, word character
 * ranges from alignWords. Nothing here touches the network.
 */
async function generateStory(item, opts) {
  const { story, voice, rate, hash8, mp3Path, jsonPath, files } = item;
  fs.mkdirSync(path.dirname(mp3Path), { recursive: true });

  if (opts.fixture) writeFixtureSentences(item);
  else for (const f of files) decodePcm(f.mp3, f.pcm);

  const silence = Buffer.alloc(Math.round(SENTENCE_GAP_MS * AUDIO_BYTES_PER_MS));
  const parts = [];
  const byteLengths = [];
  const wordsPerSentence = [];
  const aligned = [];
  story.sentences.forEach((text, i) => {
    const side = readJson(files[i].json);
    if (
      !side ||
      side.text !== text ||
      side.voice !== voice ||
      side.rate !== rate ||
      !Array.isArray(side.words)
    ) {
      throw new Error(
        `${story.key}: cached sidecar ${path.basename(files[i].json)} is not what this run expects — ` +
          "delete .audio-cache/sentences and re-run."
      );
    }
    const pcm = fs.readFileSync(files[i].pcm);
    parts.push(pcm);
    if (i < story.sentences.length - 1) parts.push(silence);
    byteLengths.push(pcm.length);
    wordsPerSentence.push(side.words);
    aligned.push(alignWords(text, side.words));
  });

  const timings = sentenceTimings(byteLengths);
  const durationMs = timings.length ? timings[timings.length - 1].endMs : 0;
  const totalWords = aligned.reduce((n, a) => n + a.total, 0);
  const unresolvedWords = aligned.reduce((n, a) => n + (a.total - a.matched), 0);
  const timing = {
    version: TIMING_VERSION,
    lang: story.lang,
    voice,
    rate,
    sampleRate: AUDIO_SAMPLE_RATE,
    gapMs: SENTENCE_GAP_MS,
    durationMs: round3(durationMs),
    // `text` is duplicated on purpose: the manifest is keyed lang/slug, so the
    // client can only detect "story edited, audio not regenerated" by comparing
    // the sentence it displays with the sentence this audio narrates
    // (lib/story-audio.ts falls back to Web Speech on a mismatch).
    sentences: timings.map((t, i) => ({
      text: story.sentences[i],
      startMs: t.startMs,
      endMs: t.endMs,
      words: wordsPerSentence[i].map((w, wi) => wordTiming(w, t.startMs, aligned[i].ranges[wi])),
    })),
  };

  await encodeMp3(Buffer.concat(parts), mp3Path);
  writeAtomic(jsonPath, Buffer.from(`${JSON.stringify(timing, null, 2)}\n`, "utf-8"));

  // Reconciliation, not measurement: ffprobe's idea of the finished file must
  // agree with the PCM that went in, or the join or the encoder is lying and
  // every offset in that JSON is wrong. It never produces a timing value.
  const probedMs = probeDurationMs(mp3Path);
  const probeDriftMs = probedMs === null ? null : Math.round(probedMs - durationMs);
  if (probeDriftMs !== null && Math.abs(probeDriftMs) > PROBE_TOLERANCE_MS) {
    console.warn(
      `audio: WARNING — ${story.key}: ffprobe reports ${Math.round(probedMs)} ms but the timings say ` +
        `${round3(durationMs)} ms (${probeDriftMs} ms apart, tolerance ${PROBE_TOLERANCE_MS}). ` +
        "That MP3 and its timing JSON disagree — do not ship it."
    );
  }

  // Files from an older content hash of this slug are dead weight; the manifest
  // points at the new names only. Not in fixture mode: a real rendering of this
  // story must survive a fixture run.
  if (!opts.fixture) {
    for (const name of staleStoryFiles(fs.readdirSync(path.dirname(mp3Path)), story.slug, hash8)) {
      fs.rmSync(path.join(path.dirname(mp3Path), name));
    }
  }

  return {
    entry: manifestEntry(story.lang, story.slug, hash8, durationMs, opts.fixture),
    durationMs: Math.round(durationMs),
    probeDriftMs,
    unresolvedWords,
    totalWords,
    sentences: story.sentences.length,
  };
}

/** --show-boundaries: what the voice emitted for sentence 1, raw, plus the
 *  character range each event aligned to (null = that word's tap falls back). */
function showBoundaries(item, opts) {
  if (!opts.showBoundaries) return;
  const { story, files } = item;
  const first = story.sentences[0];
  if (!first) return;
  const side = readJson(files[0].json);
  if (!Array.isArray(side?.words) || !side.words.length) {
    console.log(`audio: ${story.key} — no word events in the sentence-1 cache.`);
    return;
  }
  const aligned = alignWords(first, side.words);
  const list = side.words.slice(0, opts.showBoundaries);
  console.log(
    `audio: ${story.key} — first ${list.length} of ${aligned.total} word event(s) of sentence 1 ` +
      `(${aligned.matched}/${aligned.total} aligned to a character range):`
  );
  list.forEach((w, i) => {
    const r = aligned.ranges[i];
    console.log(
      `audio:   [${i}] ${JSON.stringify(w.text)} offset=${w.offset} (${round3(ticksToMs(w.offset))} ms) ` +
        `duration=${w.duration} (${round3(ticksToMs(w.duration))} ms)` +
        (r
          ? ` → chars [${r.charStart}, ${r.charEnd})`
          : " → UNALIGNED: a tap on this word uses the device voice")
    );
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stories = loadStories(opts);

  if (opts.only) {
    const missing = [...opts.only].filter((k) => !stories.some((s) => s.key === k));
    if (missing.length) fail(`--only matched no story: ${missing.join(", ")}`);
  }
  if (!stories.length) {
    console.log("audio: no stories selected — nothing to do.");
    return;
  }

  const sentenceCount = stories.reduce((n, s) => n + s.sentences.length, 0);
  const totalChars = stories.reduce((n, s) => n + s.chars, 0);

  if (opts.dryRun) {
    console.log(
      `audio: dry run — ${stories.length} story(ies), ${sentenceCount} sentences, ` +
        `${totalChars.toLocaleString("en-US")} characters at ${opts.rate} ` +
        "(no synthesis; needs no Python, edge-tts or ffmpeg)."
    );
    for (const s of stories) {
      console.log(
        `audio:   ${s.key} — ${s.sentences.length} sentences, ${s.chars.toLocaleString("en-US")} chars, voice ${VOICES[s.lang]}`
      );
    }
    return;
  }

  loadEnvFiles();
  // --rate on the command line already replaced the default, so an env value
  // only applies when neither was given explicitly.
  if (!opts.fixture && opts.rate === DEFAULT_RATE && process.env.EDGE_TTS_RATE?.trim()) {
    const value = process.env.EDGE_TTS_RATE.trim();
    if (!RATE_RE.test(value)) fail(`EDGE_TTS_RATE="${value}" is not a signed percentage like "+25%"`);
    opts.rate = value;
  }
  if (opts.fixture) {
    console.log(
      "audio: FIXTURE MODE — locally synthesized beeps instead of speech (no Python, no network).\n" +
        'audio: the reader labels them "Studio Audio · test"; run again without --fixture for real narration.'
    );
  } else {
    console.log(
      `audio: ${stories.length} story(ies), ${sentenceCount} sentence(s) at ${opts.rate}, ` +
        `${opts.concurrency} in flight; edge-tts through "${pythonPath()}".`
    );
  }

  const manifest = readManifest();
  const plan = stories.map((story) => {
    const voice = opts.fixture ? FIXTURE_VOICE : VOICES[story.lang];
    const hash8 = storyHash8(story.lang, voice, opts.rate, story.sentences);
    const names = storyFileNames(story.slug, hash8);
    const mp3Path = path.join(OUT_DIR, story.lang, names.mp3);
    const jsonPath = path.join(OUT_DIR, story.lang, names.timing);
    const files = story.sentences.map((text) => cachePaths(voice, opts.rate, text));
    return {
      story,
      voice,
      rate: opts.rate,
      hash8,
      names,
      mp3Path,
      jsonPath,
      files,
      filesExist: fs.existsSync(mp3Path) && fs.existsSync(jsonPath),
    };
  });

  // Tools are checked only when something needs them, but ALWAYS before the
  // first request: learning about a missing ffmpeg after 400 synthesized
  // sentences is the expensive way to find out.
  if (plan.some((p) => !p.filesExist)) {
    assertFfmpeg();
    const bin = ffmpegPath();
    if (bin !== "ffmpeg" && !process.env.FFMPEG)
      console.log(`audio: using ffmpeg at ${bin} (not on PATH; set FFMPEG to pick another)`);
    if (!opts.fixture) {
      assertEdgeTts();
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  let generated = 0;
  let recovered = 0;
  let skipped = 0;
  let synthesized = 0;
  let reused = 0;
  const todo = [];

  for (const item of plan) {
    const { story } = item;
    if (item.filesExist && manifestEntryMatches(manifest[story.key], story.slug, item.hash8)) {
      skipped++;
      console.log(`audio: ${story.key} — up to date (${item.hash8}).`);
      showBoundaries(item, opts);
      continue;
    }
    if (item.filesExist) {
      // Files without a (matching) manifest entry: a killed run or a fresh
      // clone. Re-link the manifest from the timing JSON — no synthesis.
      const timing = readJson(item.jsonPath);
      if (timing?.version === TIMING_VERSION && Number.isFinite(timing.durationMs)) {
        manifest[story.key] = manifestEntry(
          story.lang,
          story.slug,
          item.hash8,
          timing.durationMs,
          opts.fixture
        );
        recovered++;
        console.log(`audio: ${story.key} — recovered from existing files (${item.hash8}).`);
        showBoundaries(item, opts);
        continue;
      }
    }
    todo.push(item);
  }

  await mapPool(todo, opts.concurrency, async (item) => {
    const pending = item.story.sentences.filter((_, i) => !isSynthesized(item.files[i])).length;
    if (!opts.fixture) await synthesizeStory(item);
    const result = await generateStory(item, opts);
    manifest[item.story.key] = result.entry;
    generated += 1;
    synthesized += pending;
    reused += item.story.sentences.length - pending;
    console.log(
      `audio: ${item.story.key} — wrote ${item.names.mp3} (${result.durationMs} ms, ` +
        `${result.sentences} sentence(s)` +
        (opts.fixture
          ? "; FIXTURE beeps)."
          : `; ${pending} synthesized, ${item.story.sentences.length - pending} from cache).`)
    );
    if (result.probeDriftMs !== null) {
      console.log(
        `audio:   ffprobe cross-check: ${result.probeDriftMs >= 0 ? "+" : ""}${result.probeDriftMs} ms ` +
          `against the PCM-derived timings.`
      );
    }
    if (result.unresolvedWords) {
      console.warn(
        `audio:   ${result.unresolvedWords}/${result.totalWords} word event(s) did not align to a ` +
          "character range; taps on those words fall back to the device voice."
      );
    }
    showBoundaries(item, opts);
  });

  // Entries whose story is gone (deleted or renamed slug) would keep the reader
  // pointing at dead files, so the manifest is pruned to what content/ has.
  const keys = contentKeys();
  const orphans = Object.keys(manifest).filter((k) => !keys.has(k));
  for (const key of orphans) delete manifest[key];

  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeAtomic(MANIFEST, Buffer.from(`${JSON.stringify(sorted, null, 2)}\n`, "utf-8"));
  if (orphans.length)
    console.log(
      `audio: pruned ${orphans.length} manifest entry(ies) for stories no longer in content/.`
    );

  const size = measureAudioDir();
  console.log(
    `audio: done — ${generated} generated, ${recovered} recovered, ${skipped} up to date; ` +
      `${synthesized} sentence(s) synthesized, ${reused} reused from cache.`
  );
  if (opts.fixture) {
    console.log(
      'audio: FIXTURE — public/audio holds beeps (manifest entries carry "fixture": true, so the reader\n' +
        "audio: labels them test audio). Run the same command WITHOUT --fixture for real narration."
    );
  }
  console.log(
    `audio: public/audio — ${size.files} files, ${fmtBytes(size.bytes)} total, largest ${fmtBytes(size.largest)}.`
  );
  if (size.largest > 25 * 1024 * 1024) {
    console.warn("audio: WARNING — a file is larger than Cloudflare Pages' 25 MiB per-file limit.");
  }
}

main().catch((e) => fail(e.message));

