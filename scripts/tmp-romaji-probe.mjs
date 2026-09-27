import fs from "fs";
import ts from "typescript";

const src = fs.readFileSync("lib/furigana-romaji.ts", "utf8");
const js = ts
  .transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(/from ["']\.\/types["']/, 'from "data:text/javascript,"');
const mod = await import("data:text/javascript," + encodeURIComponent(js));

const readings = [
  "コーヒー", "ラーメン", "ガッコウ", "シュッパツ", "コモッ", "イッ",
  "ヨコタワッ", "アッ", "コッ", "クヷ", "ニホンゴ", "ッ", "ー", "・",
  "。", "！？", "キョット", "チャ", "_ABC", "123",
];
for (const r of readings) {
  const t = mod.tokenWithRomaji({ surface: "x", reading: r });
  console.log(JSON.stringify(r), "->", JSON.stringify(t.romaji), "keys:", Object.keys(t).join(","));
}
console.log("--- no-romaji passthrough ---");
for (const r of [undefined, "", "、", "「", "!", "…"]) {
  const t = mod.tokenWithRomaji({ surface: "y", reading: r });
  console.log(JSON.stringify(r), "->", JSON.stringify(t.romaji), Object.keys(t).join(","));
}
