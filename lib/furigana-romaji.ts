import { Token } from "./types";

/**
 * Sudachi returns katakana readings; this converts them to romaji
 * (with a hiragana fallback for client-side use).
 */
const KANA_TO_ROMAJI: Record<string, string> = {
  ア:"a", イ:"i", ウ:"u", エ:"e", オ:"o",
  カ:"ka", キ:"ki", ク:"ku", ケ:"ke", コ:"ko",
  サ:"sa", シ:"shi", ス:"su", セ:"se", ソ:"so",
  タ:"ta", チ:"chi", ツ:"tsu", テ:"te", ト:"to",
  ナ:"na", ニ:"ni", ヌ:"nu", ネ:"ne", ノ:"no",
  ハ:"ha", ヒ:"hi", フ:"fu", ヘ:"he", ホ:"ho",
  マ:"ma", ミ:"mi", ム:"mu", メ:"me", モ:"mo",
  ヤ:"ya", ユ:"yu", ヨ:"yo",
  ラ:"ra", リ:"ri", ル:"ru", レ:"re", ロ:"ro",
  ワ:"wa", ヲ:"wo", ン:"n",
  ガ:"ga", ギ:"gi", グ:"gu", ゲ:"ge", ゴ:"go",
  ザ:"za", ジ:"ji", ズ:"zu", ゼ:"ze", ゾ:"zo",
  ダ:"da", ヂ:"ji", ヅ:"zu", デ:"de", ド:"do",
  バ:"ba", ビ:"bi", ブ:"bu", ベ:"be", ボ:"bo",
  パ:"pa", ピ:"pi", プ:"pu", ペ:"pe", ポ:"po",
  キャ:"kya", シャ:"sha", チャ:"cha", ニャ:"nya", ヒャ:"hya",
  ミャ:"mya", リャ:"rya", ギャ:"gya", ジャ:"ja", ビャ:"bya",
  ピャ:"pya", ファ:"fa", フィ:"fi", フェ:"fe", フォ:"fo",
  ヴァ:"va", ティ:"ti", ディ:"di", トゥ:"tu", ドゥ:"du",
  キュ:"kyu", シュ:"shu", チュ:"chu", ニュ:"nyu", ヒュ:"hyu",
  ミュ:"myu", リュ:"ryu", ギュ:"gyu", ジュ:"ju", ビュ:"byu",
  ピュ:"pyu", チェ:"che", シェ:"she", ジェ:"je",
  ウィ:"wi", ウェ:"we", ウォ:"wo", ヴ:"vu", ヴィ:"vi",
  ツァ:"tsa", ツィ:"tsi", ツェ:"tse", ツォ:"tso",
  クァ:"kwa", グァ:"gwa", テュ:"tyu", デュ:"dyu",
  ァ:"a", ィ:"i", ゥ:"u", ェ:"e", ォ:"o",
  ャ:"ya", ュ:"yu", ョ:"yo", ヵ:"ka", ヶ:"ke",
  // Archaic/rare kana that still appear in proper nouns and loanwords; left
  // unmapped they would fall through and leak raw glyphs into the romaji line.
  ヷ:"va", ヸ:"vi", ヹ:"ve", ヺ:"vo", ヮ:"wa", ヰ:"i", ヱ:"e",
  "・":" ", "　":" ",
};

function katakanaToRomaji(katakana: string): string {
  let out = "";
  let i = 0;
  while (i < katakana.length) {
    // Long-vowel mark lengthens the previous vowel (コーヒー → "koohii"),
    // it is never dropped.
    if (katakana[i] === "ー") {
      const m = out.match(/[aeiou]$/);
      if (m) out += m[0];
      i += 1;
      continue;
    }
    const two = katakana.slice(i, i + 2);
    if (katakana[i] === "ッ") {
      // Sokuon: geminates the following consonant (シュッパツ → "shuppatsu").
      // A TRAILING ッ (促音便 stems: コモッ, イッ, ヨコタワッ) has nothing to
      // geminate, so it is dropped — the old branch required a following char
      // and otherwise fell through to the raw-glyph path, printing "komoッ".
      const next = katakana[i + 1];
      if (next) out += katakanaToRomaji(next)[0] ?? "";
      i += 1;
      continue;
    }
    if (KANA_TO_ROMAJI[two] !== undefined) {
      out += KANA_TO_ROMAJI[two];
      i += 2;
    } else if (KANA_TO_ROMAJI[katakana[i]] !== undefined) {
      out += KANA_TO_ROMAJI[katakana[i]];
      i += 1;
    } else {
      // Unmapped character: keep ASCII (digits, hyphens), never emit raw kana
      // — a romaji line is ASCII-only by contract.
      if (/[\x20-\x7E]/.test(katakana[i])) out += katakana[i];
      i += 1;
    }
  }
  return out;
}

function hiraganaToKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

/** At least one kana — the only readings that can produce romaji at all. */
const KANA_RE = /[\u3041-\u3096\u30A1-\u30FA\u30FC]/;

export function tokenWithRomaji(token: Token): Token {
  // Sudachi reports punctuation tokens with their glyph as the reading (、。「」).
  // Deriving a "romaji" for them printed a duplicate glyph under the token, so
  // readings without kana — and readings that convert to nothing (・ → " ") —
  // get no romaji field at all.
  if (!token.reading || !KANA_RE.test(token.reading)) return token;
  const romaji = katakanaToRomaji(hiraganaToKatakana(token.reading));
  if (!romaji.trim()) return token;
  return { ...token, romaji };
}
