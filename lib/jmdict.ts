/**
 * Minimal local English dictionary for Japanese words (JMdict-style), used to
 * give bookmarked Japanese words an English meaning without any network call.
 *
 * Curated subset: core grammar words plus the vocabulary used in the app's
 * Japanese stories. Keys are dictionary (kanji) forms AND common kana
 * spellings — Sudachi's lemma resolves conjugations (飲みます → 飲む) before
 * lookup happens, so kana keys mainly serve the regex-fallback path where no
 * lemma is available.
 *
 * To go beyond the subset, export JMdict JSON (jmdict-eng-3.x.x.json) and
 * extend DICT to the same flat shape.
 */

import type { AffixCandidate } from "./ja-morphology";

interface JmdictEntry {
  /** English gloss(es); senses separated by "; ". */
  gloss: string;
  /** Part-of-speech tag kept as dictionary metadata (not rendered). */
  pos?: string;
}

const DICT: Record<string, JmdictEntry> = {
  // --- particles / grammar -------------------------------------------------
  は: { gloss: "(topic particle)" },
  が: { gloss: "(subject particle)" },
  を: { gloss: "(object particle)" },
  に: { gloss: "(location/time particle)" },
  で: { gloss: "(location/means particle)" },
  と: { gloss: "and; with" },
  も: { gloss: "also; too" },
  の: { gloss: "(possessive particle)" },
  から: { gloss: "from; because" },
  まで: { gloss: "until; as far as" },
  より: { gloss: "than; from" },
  ね: { gloss: "(sentence-final particle)" },
  よ: { gloss: "(sentence-final particle)" },
  か: { gloss: "(question particle)" },
  こと: { gloss: "thing; matter (nominalizer)" },
  もの: { gloss: "thing; item" },
  ため: { gloss: "for the sake of; in order to" },
  そう: { gloss: "so; like that" },
  これ: { gloss: "this" },
  それ: { gloss: "that" },
  あれ: { gloss: "that (over there)" },
  ここ: { gloss: "here" },
  そこ: { gloss: "there" },
  どこ: { gloss: "where" },
  いつ: { gloss: "when" },
  なに: { gloss: "what" },
  だれ: { gloss: "who" },
  どう: { gloss: "how" },
  そして: { gloss: "and then" },
  でも: { gloss: "but" },
  しかし: { gloss: "however" },
  たくさん: { gloss: "a lot; many", pos: "adv" },
  とても: { gloss: "very", pos: "adv" },
  みんな: { gloss: "everyone; all" },
  もう: { gloss: "already; soon" },
  まだ: { gloss: "still; not yet" },
  とき: { gloss: "time; when" },

  // --- verbs ---------------------------------------------------------------
  する: { gloss: "to do", pos: "v" },
  なる: { gloss: "to become", pos: "v" },
  いる: { gloss: "to exist (animate); to be", pos: "v" },
  ある: { gloss: "to exist (inanimate); to have", pos: "v" },
  です: { gloss: "to be (copula)" },
  だ: { gloss: "to be (copula, plain)" },
  来る: { gloss: "to come", pos: "v" },
  くる: { gloss: "to come", pos: "v" },
  行く: { gloss: "to go", pos: "v" },
  いく: { gloss: "to go", pos: "v" },
  帰る: { gloss: "to return home", pos: "v" },
  かえる: { gloss: "to return home", pos: "v" },
  見る: { gloss: "to see; to watch", pos: "v" },
  みる: { gloss: "to see; to watch", pos: "v" },
  聞く: { gloss: "to hear; to ask", pos: "v" },
  きく: { gloss: "to hear; to ask", pos: "v" },
  話す: { gloss: "to speak; to talk", pos: "v" },
  はなす: { gloss: "to speak; to talk", pos: "v" },
  読む: { gloss: "to read", pos: "v" },
  よむ: { gloss: "to read", pos: "v" },
  書く: { gloss: "to write", pos: "v" },
  かく: { gloss: "to write", pos: "v" },
  飲む: { gloss: "to drink", pos: "v" },
  のむ: { gloss: "to drink", pos: "v" },
  食べる: { gloss: "to eat", pos: "v" },
  たべる: { gloss: "to eat", pos: "v" },
  住む: { gloss: "to live; to reside", pos: "v" },
  すむ: { gloss: "to live; to reside", pos: "v" },
  作る: { gloss: "to make; to produce", pos: "v" },
  つくる: { gloss: "to make; to produce", pos: "v" },
  取る: { gloss: "to take", pos: "v" },
  とる: { gloss: "to take", pos: "v" },
  拾う: { gloss: "to pick up", pos: "v" },
  ひろう: { gloss: "to pick up", pos: "v" },
  切る: { gloss: "to cut", pos: "v" },
  きる: { gloss: "to cut", pos: "v" },
  付ける: { gloss: "to attach; to name", pos: "v" },
  つける: { gloss: "to attach; to name", pos: "v" },
  生まれる: { gloss: "to be born", pos: "v" },
  うまれる: { gloss: "to be born", pos: "v" },
  盗む: { gloss: "to steal", pos: "v" },
  ぬすむ: { gloss: "to steal", pos: "v" },
  倒す: { gloss: "to defeat; to knock down", pos: "v" },
  たおす: { gloss: "to defeat; to knock down", pos: "v" },
  合わせる: { gloss: "to join together; to combine", pos: "v" },
  あわせる: { gloss: "to join together; to combine", pos: "v" },
  思う: { gloss: "to think; to feel", pos: "v" },
  おもう: { gloss: "to think; to feel", pos: "v" },
  会う: { gloss: "to meet", pos: "v" },
  あう: { gloss: "to meet", pos: "v" },
  使う: { gloss: "to use", pos: "v" },
  つかう: { gloss: "to use", pos: "v" },
  分かる: { gloss: "to understand", pos: "v" },
  わかる: { gloss: "to understand", pos: "v" },
  知る: { gloss: "to know", pos: "v" },
  しる: { gloss: "to know", pos: "v" },
  終わる: { gloss: "to end; to finish", pos: "v" },
  おわる: { gloss: "to end; to finish", pos: "v" },
  待つ: { gloss: "to wait", pos: "v" },
  まつ: { gloss: "to wait", pos: "v" },
  歩く: { gloss: "to walk", pos: "v" },
  あるく: { gloss: "to walk", pos: "v" },
  働く: { gloss: "to work", pos: "v" },
  はたらく: { gloss: "to work", pos: "v" },
  寝る: { gloss: "to sleep", pos: "v" },
  ねる: { gloss: "to sleep", pos: "v" },
  起きる: { gloss: "to get up", pos: "v" },
  おきる: { gloss: "to get up", pos: "v" },
  教える: { gloss: "to teach; to tell", pos: "v" },
  おしえる: { gloss: "to teach; to tell", pos: "v" },
  勉強する: { gloss: "to study", pos: "v" },
  べんきょうする: { gloss: "to study", pos: "v" },
  持つ: { gloss: "to hold; to have", pos: "v" },
  もつ: { gloss: "to hold; to have", pos: "v" },
  出る: { gloss: "to leave; to come out", pos: "v" },
  でる: { gloss: "to leave; to come out", pos: "v" },
  入る: { gloss: "to enter", pos: "v" },
  はいる: { gloss: "to enter", pos: "v" },
  買う: { gloss: "to buy", pos: "v" },
  かう: { gloss: "to buy", pos: "v" },
  決める: { gloss: "to decide", pos: "v" },
  きめる: { gloss: "to decide", pos: "v" },
  忘れる: { gloss: "to forget", pos: "v" },
  わすれる: { gloss: "to forget", pos: "v" },
  手伝う: { gloss: "to help", pos: "v" },
  てつだう: { gloss: "to help", pos: "v" },

  // --- adjectives / na-adjectives ------------------------------------------
  大きい: { gloss: "big; large", pos: "adj" },
  おおきい: { gloss: "big; large", pos: "adj" },
  小さい: { gloss: "small", pos: "adj" },
  ちいさい: { gloss: "small", pos: "adj" },
  新しい: { gloss: "new", pos: "adj" },
  あたらしい: { gloss: "new", pos: "adj" },
  古い: { gloss: "old (thing)", pos: "adj" },
  ふるい: { gloss: "old (thing)", pos: "adj" },
  いい: { gloss: "good", pos: "adj" },
  悪い: { gloss: "bad", pos: "adj" },
  わるい: { gloss: "bad", pos: "adj" },
  強い: { gloss: "strong", pos: "adj" },
  つよい: { gloss: "strong", pos: "adj" },
  高い: { gloss: "expensive; high; tall", pos: "adj" },
  たかい: { gloss: "expensive; high; tall", pos: "adj" },
  安い: { gloss: "cheap", pos: "adj" },
  やすい: { gloss: "cheap", pos: "adj" },
  楽しい: { gloss: "fun; enjoyable", pos: "adj" },
  たのしい: { gloss: "fun; enjoyable", pos: "adj" },
  美しい: { gloss: "beautiful", pos: "adj" },
  うつくしい: { gloss: "beautiful", pos: "adj" },
  元気: { gloss: "healthy; energetic; lively", pos: "na-adj" },
  げんき: { gloss: "healthy; energetic; lively", pos: "na-adj" },
  静か: { gloss: "quiet; calm", pos: "na-adj" },
  しずか: { gloss: "quiet; calm", pos: "na-adj" },
  有名: { gloss: "famous", pos: "na-adj" },
  ゆうめい: { gloss: "famous", pos: "na-adj" },

  // --- people / places / nouns ---------------------------------------------
  私: { gloss: "I; me", pos: "n" },
  わたし: { gloss: "I; me", pos: "n" },
  あなた: { gloss: "you", pos: "n" },
  人: { gloss: "person", pos: "n" },
  ひと: { gloss: "person", pos: "n" },
  男の子: { gloss: "boy", pos: "n" },
  おとこのこ: { gloss: "boy", pos: "n" },
  女の子: { gloss: "girl", pos: "n" },
  おんなのこ: { gloss: "girl", pos: "n" },
  おじいさん: { gloss: "grandfather; old man", pos: "n" },
  おばあさん: { gloss: "grandmother; old woman", pos: "n" },
  友達: { gloss: "friend", pos: "n" },
  ともだち: { gloss: "friend", pos: "n" },
  家族: { gloss: "family", pos: "n" },
  かぞく: { gloss: "family", pos: "n" },
  子供: { gloss: "child", pos: "n" },
  こども: { gloss: "child", pos: "n" },
  名前: { gloss: "name", pos: "n" },
  なまえ: { gloss: "name", pos: "n" },
  昔: { gloss: "long ago; old times", pos: "n" },
  むかし: { gloss: "long ago; old times", pos: "n" },
  所: { gloss: "place", pos: "n" },
  ところ: { gloss: "place", pos: "n" },
  家: { gloss: "house; home", pos: "n" },
  いえ: { gloss: "house; home", pos: "n" },
  部屋: { gloss: "room", pos: "n" },
  へや: { gloss: "room", pos: "n" },
  学校: { gloss: "school", pos: "n" },
  がっこう: { gloss: "school", pos: "n" },
  会社: { gloss: "company; office", pos: "n" },
  かいしゃ: { gloss: "company; office", pos: "n" },
  村: { gloss: "village", pos: "n" },
  むら: { gloss: "village", pos: "n" },
  道: { gloss: "road; way; path", pos: "n" },
  みち: { gloss: "road; way; path", pos: "n" },
  川: { gloss: "river", pos: "n" },
  かわ: { gloss: "river", pos: "n" },
  山: { gloss: "mountain", pos: "n" },
  やま: { gloss: "mountain", pos: "n" },
  空: { gloss: "sky", pos: "n" },
  そら: { gloss: "sky", pos: "n" },
  鬼: { gloss: "ogre; demon", pos: "n" },
  おに: { gloss: "ogre; demon", pos: "n" },
  桃: { gloss: "peach", pos: "n" },
  もも: { gloss: "peach", pos: "n" },

  犬: { gloss: "dog", pos: "n" },
  いぬ: { gloss: "dog", pos: "n" },
  猿: { gloss: "monkey", pos: "n" },
  さる: { gloss: "monkey", pos: "n" },
  雉: { gloss: "pheasant", pos: "n" },
  きじ: { gloss: "pheasant", pos: "n" },
  仲間: { gloss: "companion; group member", pos: "n" },
  なかま: { gloss: "companion; group member", pos: "n" },
  力: { gloss: "strength; power", pos: "n" },
  ちから: { gloss: "strength; power", pos: "n" },
  宝物: { gloss: "treasure", pos: "n" },
  たからもの: { gloss: "treasure", pos: "n" },
  毎朝: { gloss: "every morning", pos: "n" },
  まいあさ: { gloss: "every morning", pos: "n" },
  今日: { gloss: "today", pos: "n" },
  きょう: { gloss: "today", pos: "n" },
  明日: { gloss: "tomorrow", pos: "n" },
  あした: { gloss: "tomorrow", pos: "n" },
  今: { gloss: "now", pos: "n" },
  いま: { gloss: "now", pos: "n" },
  朝: { gloss: "morning", pos: "n" },
  あさ: { gloss: "morning", pos: "n" },
  夜: { gloss: "night; evening", pos: "n" },
  よる: { gloss: "night; evening", pos: "n" },
  日: { gloss: "day; sun", pos: "n" },
  ひ: { gloss: "day; sun", pos: "n" },
  ご飯: { gloss: "rice; meal", pos: "n" },
  ごはん: { gloss: "rice; meal", pos: "n" },
  水: { gloss: "water", pos: "n" },
  みず: { gloss: "water", pos: "n" },
  コーヒー: { gloss: "coffee", pos: "n" },
  きびだんご: { gloss: "millet dumpling", pos: "n" },
  花: { gloss: "flower", pos: "n" },
  はな: { gloss: "flower; nose", pos: "n" },
  本: { gloss: "book", pos: "n" },
  ほん: { gloss: "book", pos: "n" },
  仕事: { gloss: "work; job", pos: "n" },
  しごと: { gloss: "work; job", pos: "n" },
  世界: { gloss: "world", pos: "n" },
  せかい: { gloss: "world", pos: "n" },
  夢: { gloss: "dream", pos: "n" },
  ゆめ: { gloss: "dream", pos: "n" },
  物語: { gloss: "story; tale", pos: "n" },
  ものがたり: { gloss: "story; tale", pos: "n" },
  月: { gloss: "moon; month", pos: "n" },
  つき: { gloss: "moon; month", pos: "n" },
  竹: { gloss: "bamboo", pos: "n" },
  たけ: { gloss: "bamboo", pos: "n" },
  光: { gloss: "light", pos: "n" },
  ひかり: { gloss: "light", pos: "n" },
  姫: { gloss: "princess", pos: "n" },
  ひめ: { gloss: "princess", pos: "n" },

  // --- frequent grammar fragments (Sudachi emits each as its own token) ------
  た: { gloss: "(past-tense / plain-form auxiliary)" },
  て: { gloss: "(connective particle)" },
  ます: { gloss: "(polite verb ending)" },
  れる: { gloss: "(passive / potential auxiliary)" },
  られる: { gloss: "(passive / potential auxiliary)" },
  せる: { gloss: "(causative auxiliary)" },
  ない: { gloss: "not; nonexistent (negative)" },
  ず: { gloss: "(negative form, classical / formal)" },
  へ: { gloss: "(directional particle)" },
  や: { gloss: "and; or (listing particle)" },
  つつ: { gloss: "while; although" },
  ながら: { gloss: "while; at the same time as" },
  ほど: { gloss: "about; roughly; degree" },
  その: { gloss: "that" },
  小さな: { gloss: "small; little", pos: "det" },
  御: { gloss: "honorific prefix (o-, go-)", pos: "prefix" },
  達: { gloss: "plural suffix (people)", pos: "suffix" },
  さ: { gloss: "-ness; degree (noun-forming suffix)", pos: "suffix" },
  的: { gloss: "-like; -ic; -ly (suffix)", pos: "suffix" },
  化: { gloss: "-ization; change into (suffix)", pos: "suffix" },
  彼: { gloss: "he; him; that", pos: "n" },
  自ら: { gloss: "oneself; in person", pos: "n" },

  // --- verbs -----------------------------------------------------------------
  言う: { gloss: "to say", pos: "v" },
  しまう: { gloss: "to finish; to put away; to store", pos: "v" },
  追う: { gloss: "to chase; to pursue", pos: "v" },
  出す: { gloss: "to take out; to hand out", pos: "v" },
  残す: { gloss: "to leave behind; to keep", pos: "v" },
  立つ: { gloss: "to stand", pos: "v" },
  上げる: { gloss: "to raise; to lift", pos: "v" },
  受ける: { gloss: "to receive; to undergo; to pass (an exam)", pos: "v" },
  込む: { gloss: "to be crowded; (after a verb) to do thoroughly", pos: "v" },
  かける: { gloss: "to hang; to put on; to ride; to spend (time)", pos: "v" },

  // --- adjectives -----------------------------------------------------------
  優しい: { gloss: "gentle; kind; tender", pos: "adj" },
  若い: { gloss: "young", pos: "adj" },
  深い: { gloss: "deep", pos: "adj" },
  激しい: { gloss: "fierce; intense", pos: "adj" },
  嘗て: { gloss: "formerly; once", pos: "adv" },

  // --- nouns ----------------------------------------------------------------
  中: { gloss: "inside; middle; among", pos: "n" },
  男: { gloss: "man; male", pos: "n" },
  爺: { gloss: "old man; grandfather", pos: "n" },
  婆: { gloss: "old woman; grandmother", pos: "n" },
  間: { gloss: "interval; gap; time between", pos: "n" },
  姿: { gloss: "figure; appearance; form", pos: "n" },
  命: { gloss: "life", pos: "n" },
  大蛇: { gloss: "giant snake; serpent", pos: "n" },
  酒: { gloss: "sake; alcohol", pos: "n" },
  体: { gloss: "body", pos: "n" },
  僧: { gloss: "monk; priest", pos: "n" },
  雀: { gloss: "sparrow", pos: "n" },
  竜: { gloss: "dragon", pos: "n" },
  灰: { gloss: "ashes; ash", pos: "n" },
  都: { gloss: "capital; metropolis", pos: "n" },
  約束: { gloss: "promise; appointment", pos: "n" },
  箱: { gloss: "box", pos: "n" },
  他: { gloss: "other; another; elsewhere", pos: "n" },
};

/**
 * Sudachi's normalized form is kanji (為る / 居る / 成る), while this table is
 * keyed mostly by kana — the mismatch that kept those taps empty. Aliased only
 * when the kana target actually exists below.
 */
const LEMMA_ALIASES: Record<string, string> = {
  為る: "する",
  居る: "いる",
  成る: "なる",
  有る: "ある",
  其の: "その",
  無い: "ない",
  仕舞う: "しまう",
};

/** 為る is normally する but is also read ナル in 為になる: skip the alias for
 *  that reading so the tap falls through instead of claiming "to do". */
const ALIAS_SKIP_PREFIX: Record<string, string> = { 為る: "ナ" };

function aliasTarget(lemma: string, reading?: string): string | undefined {
  const target = LEMMA_ALIASES[lemma];
  if (!target) return undefined;
  const skip = ALIAS_SKIP_PREFIX[lemma];
  if (skip && reading?.startsWith(skip)) return undefined;
  return target;
}

/** Numerals need no dictionary entry to have a meaning. */
const DIGITS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

export interface JapaneseMeaning {
  gloss: string;
  /** The key that matched — the card shows this instead of Sudachi's lemma
   *  when an alias or an affixed host word answered. */
  key: string;
  via: "lemma" | "alias" | "affix" | "surface";
  /** Host reading for an affix hit (オジイサン for the tapped さん). */
  reading?: string;
}

/**
 * Full lookup for a Japanese word. Order: lemma → kanji-lemma alias → host
 * word rebuilt from a split affix (おじいさん) → surface. Undefined means the
 * local dictionary has nothing, which the card renders as
 * "No dictionary entry yet" instead of borrowing the sentence translation.
 */
export function lookupJapaneseDetail(
  lemma: string | undefined,
  surface: string,
  affixes?: readonly AffixCandidate[],
  reading?: string
): JapaneseMeaning | undefined {
  const surfaceKey = surface.trim();
  const digit = DIGITS[surfaceKey];
  if (digit) return { gloss: digit, key: surfaceKey, via: "surface" };

  const lemmaKey = (lemma ?? "").trim();
  if (lemmaKey && DICT[lemmaKey]) {
    return { gloss: DICT[lemmaKey].gloss, key: lemmaKey, via: "lemma" };
  }

  const alias = lemmaKey ? aliasTarget(lemmaKey, reading) : undefined;
  if (alias && DICT[alias]) return { gloss: DICT[alias].gloss, key: alias, via: "alias" };

  for (const c of affixes ?? []) {
    if (DICT[c.surface]) {
      return { gloss: DICT[c.surface].gloss, key: c.surface, via: "affix", reading: c.reading };
    }
  }

  if (surfaceKey && DICT[surfaceKey]) {
    return { gloss: DICT[surfaceKey].gloss, key: surfaceKey, via: "surface" };
  }
  return undefined;
}

/**
 * English meaning for a Japanese word. `lemma` (Sudachi dictionary form) is
 * preferred; `surface` is the fallback (regex-tokenized text has no lemma).
 * Returns undefined when the word isn't in the local dictionary.
 */
export function lookupJapaneseMeaning(
  lemma: string | undefined,
  surface: string
): string | undefined {
  return lookupJapaneseDetail(lemma, surface)?.gloss;
}


