#!/usr/bin/env node
// Audio hygiene (Phase 6 local tooling): reconcile public/audio/manifest.json
// with content/**. The manifest is keyed by lang/slug and its timing JSONs are
// pinned to the exact sentence texts they narrated (lib/story-audio.ts fails
// closed on any drift), so after scripts/sync-content.mjs rewrites content/**
// from D1, entries can go stale three ways — all surfaced here:
//
//   orphaned  story no longer exists in content/ (deleted or renamed in /admin)
//   drifted   story text changed; the MP3 still exists but no longer matches
//   missing   files the manifest points at are gone from disk
//
//   node scripts/audio-reconcile.mjs            # report only (exit 1 on issues)
//   node scripts/audio-reconcile.mjs --prune    # drop orphaned/drifted entries
//   node scripts/audio-reconcile.mjs --quiet    # exit code only
//
// Pruning DELETES mp3/timing files for orphaned and drifted entries (a drifted
// entry must be regenerated anyway — its narration is for the old text); the
// reader falls back to Web Speech synthesis until `npm run audio:generate`
// runs. Fixing drift is never automatic: synthesis needs Python/edge-tts and
// sends text to Microsoft, which is an operator decision (see .env.example).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSentences } from "./lib/story-format.mjs";
import { TIMING_VERSION } from "./lib/audio-format.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = path.join(root, "public", "audio");
const MANIFEST = path.join(AUDIO, "manifest.json");
const CONTENT = path.join(root, "content");

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const quiet = args.includes("--quiet");
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: node scripts/audio-reconcile.mjs [--prune] [--quiet]",
      "",
      "  --prune   delete manifest entries (and their files) that are orphaned",
      "            or drifted; `npm run audio:generate` regenerates them",
      "  --quiet   suppress the report; exit code still reflects the verdict",
    ].join("\n")
  );
  process.exit(0);
}

const say = (...a) => {
  if (!quiet) console.log(...a);
};

if (!fs.existsSync(MANIFEST)) {
  say("audio-reconcile: no public/audio/manifest.json — nothing generated yet (reader uses Web Speech).");
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));

/** `/audio/es/x.abc.mp3` → <root>/public/audio/es/x.abc.mp3 */
function localFile(url) {
  return path.join(root, "public", decodeURI(String(url).replace(/^\//, "")));
}

/** The narrated sentences of the story behind a manifest key, or null. */
function contentSentences(key) {
  const [lang, slug] = key.split("/");
  const dir = path.join(CONTENT, lang ?? "");
  if (!slug || !fs.existsSync(dir)) return null;
  for (const level of fs.readdirSync(dir)) {
    const file = path.join(dir, level, `${slug}.md`);
    if (fs.existsSync(file)) return parseSentences(fs.readFileSync(file, "utf-8"));
  }
  return null;
}

/** Mirror of isTimingUsable (lib/story-audio.ts) without the TS import. */
function timingMatches(timing, texts) {
  if (!timing || typeof timing !== "object") return false;
  if (timing.version !== TIMING_VERSION || !Array.isArray(timing.sentences)) return false;
  if (timing.sentences.length !== texts.length) return false;
  let prev = -1;
  return timing.sentences.every((s, i) => {
    if (!s || typeof s.text !== "string" || s.text !== texts[i]) return false;
    if (typeof s.startMs !== "number" || !Number.isFinite(s.startMs)) return false;
    if (s.startMs < prev) return false;
    prev = s.startMs;
    return true;
  });
}

const orphaned = [];
const drifted = [];
const missing = [];
let ok = 0;

for (const [key, entry] of Object.entries(manifest)) {
  const mp3Path = entry && typeof entry.mp3 === "string" ? localFile(entry.mp3) : null;
  const timingPath = entry && typeof entry.timing === "string" ? localFile(entry.timing) : null;
  if (!mp3Path || !timingPath) {
    missing.push({ key, reason: "malformed manifest entry" });
    continue;
  }
  if (!fs.existsSync(mp3Path) || !fs.existsSync(timingPath)) {
    missing.push({ key, reason: `missing ${!fs.existsSync(mp3Path) ? entry.mp3 : entry.timing}` });
    continue;
  }
  const texts = contentSentences(key);
  if (texts === null) {
    orphaned.push(key);
    continue;
  }
  let timing;
  try {
    timing = JSON.parse(fs.readFileSync(timingPath, "utf-8"));
  } catch {
    drifted.push(key);
    continue;
  }
  if (!timingMatches(timing, texts)) {
    drifted.push(key);
    continue;
  }
  ok++;
}

say(`audio-reconcile: ${Object.keys(manifest).length} manifest entries — ${ok} current, ${orphaned.length} orphaned, ${drifted.length} drifted, ${missing.length} missing files.`);

const hasIssues = orphaned.length + drifted.length + missing.length > 0;
if (hasIssues && !quiet) {
  for (const key of orphaned) console.warn(`  orphaned: ${key} — story deleted/renamed in content/`);
  for (const key of drifted) console.warn(`  drifted:  ${key} — text changed; re-run npm run audio:generate`);
  for (const m of missing) console.warn(`  missing:  ${m.key} — ${m.reason}`);
}

if (prune && hasIssues) {
  const drop = new Set([...orphaned, ...drifted, ...missing.map((m) => m.key)]);
  for (const key of drop) {
    const entry = manifest[key];
    for (const url of [entry?.mp3, entry?.timing]) {
      if (typeof url !== "string") continue;
      try {
        fs.rmSync(localFile(url), { force: true });
      } catch (err) {
        console.warn(`  prune failed for ${url}: ${err.message}`);
      }
    }
    delete manifest[key];
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  say(`audio-reconcile: pruned ${drop.size} entries (and their files); regenerate with npm run audio:generate.`);
}

process.exit(hasIssues ? 1 : 0);
