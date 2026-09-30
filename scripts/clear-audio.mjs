// Delete generated story audio (public/audio/) in one step.
//
// Everything under public/audio/ is REGENERABLE — npm run audio:generate rebuilds
// it from content/ (real narration needs Python + edge-tts and ffmpeg; `npm run
// audio:fixture` needs only ffmpeg). Main use: start clean after a voice or rate
// change, or drop a beep/fixture run before deploying. The .audio-cache/ sentence
// cache is left alone on purpose — it is what makes the next run cheap.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

let files = 0;
let bytes = 0;
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
}

if (!fs.existsSync(dir)) {
  console.log("audio: public/audio is not there — nothing to clear.");
} else {
  walk(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    `audio: removed public/audio — ${files} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB. ` +
      "Regenerate with npm run audio:generate (or audio:fixture for test beeps)."
  );
}
