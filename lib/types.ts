export type Lang = "ru" | "es" | "ja";

export const LANGS: Lang[] = ["es", "ru", "ja"];

export const LANG_NAMES: Record<Lang, string> = {
  es: "Español",
  ru: "Русский",
  ja: "日本語",
};

export const LEVELS: Record<Lang, string[]> = {
  ru: ["a1", "a2", "b1", "b2", "c1", "c2"],
  es: ["a1", "a2", "b1", "b2", "c1", "c2"],
  ja: ["n5", "n4", "n3", "n2", "n1"],
};

export interface GlossaryWord {
  surface: string;
  note: string;
}

export interface StorySentence {
  target: string;
  en: string;
  glossary: GlossaryWord[];
}

export interface StoryMeta {
  lang: Lang;
  level: string;
  slug: string;
  title: string;
  titleEn: string;
  minutes: number;
  image?: string;
  sentenceCount: number;
}

export interface Story extends StoryMeta {
  sentences: StorySentence[];
}

export interface Token {
  surface: string;
  /** Dictionary / normalized form (飲みます → 飲む) from Sudachi. */
  lemma?: string;
  reading?: string;
  romaji?: string;
  pos?: string;
}

