// Content hashes for the audio pipeline. Kept apart from audio-format.mjs
// because this module needs node:crypto and must never reach the client
// bundle (lib/story-audio.ts imports only audio-format.mjs).

import crypto from "crypto";

/**
 * Whole-story audio hash: language + voice + speaking rate + ordered sentence
 * texts. The filename embeds it, so a changed sentence (or a voice/rate swap)
 * produces a NEW URL and Cloudflare's immutable cache can never serve stale audio.
 * The rate belongs in the key because it changes the audio itself: raising
 * EDGE_TTS_RATE re-synthesizes instead of silently reusing cached files.
 * @param {string} lang @param {string} voice @param {string} rate @param {string[]} texts
 */
export function storyHash8(lang, voice, rate, texts) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([lang, voice, rate, texts]))
    .digest("hex")
    .slice(0, 8);
}

/**
 * Per-sentence cache key: voice + rate + text. An edited sentence re-synthesizes
 * alone; every other cached file survives (.audio-cache/, gitignored), so a
 * killed run resumes where it stopped.
 * @param {string} voice @param {string} rate @param {string} text
 */
export function sentenceHash8(voice, rate, text) {
  return crypto
    .createHash("sha256")
    .update(`${voice}\u0000${rate}\u0000${text}`)
    .digest("hex")
    .slice(0, 8);
}
