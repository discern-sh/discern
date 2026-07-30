/**
 * Reading-grade measurement for the feature canon's plain-language register
 * (ADR 0226): a deterministic Flesch–Kincaid grade over every node's plain
 * prose, feeding the `plain_reading_grade` standard. The plain canon exists
 * for non-technical readers; this number is the guard that the register
 * stays plain as it grows — a ceiling that may only fall.
 *
 * Everything here is pure text arithmetic: no dictionary, no network, no
 * randomness, so the same registry always measures the same grade. The
 * syllable counter is the standard vowel-group heuristic — crude on unusual
 * words, but consistently crude, which is all a never-loosen comparison
 * needs.
 */

import { allFeatureNodes, stripCodeSpans } from "./feature_registry.ts";

/** Heuristic syllable count for one word (minimum 1). */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  if (groups === 0) return 1;
  // A trailing silent 'e' drops a group ("before"), except when it carries
  // the consonant-'le' ending's own syllable ("table").
  const silentE = w.endsWith("e") && !w.endsWith("le") && groups > 1;
  return Math.max(1, groups - (silentE ? 1 : 0));
}

/** The counted shape of a passage: sentences, words, syllables. */
export interface ProseCounts {
  sentences: number;
  words: number;
  syllables: number;
}

/**
 * Count one passage. Code spans read as one-word names (a reader says "the
 * discern-done instruction" and moves on), so they neither shorten sentences
 * nor charge the register for command vocabulary it deliberately quotes.
 */
export function countProse(text: string): ProseCounts {
  const readable = stripCodeSpans(text).replace(/\s+/g, " ").trim();
  if (readable.length === 0) return { sentences: 0, words: 0, syllables: 0 };
  const sentences = readable
    .split(/[.!?]+(?:\s|$)/)
    .filter((part) => part.trim().length > 0).length;
  const words = readable
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z'-]/g, ""))
    .filter((token) => /[a-zA-Z]/.test(token));
  const syllableTotal = words.reduce(
    (sum, word) =>
      sum +
      word.split(/[-']/).reduce((s, part) => s + syllables(part), 0),
    0,
  );
  return {
    sentences: Math.max(1, sentences),
    words: words.length,
    syllables: syllableTotal,
  };
}

/** The plain-register prose corpus: every node's plain what/why/agent. */
export function plainRegisterCorpus(): string[] {
  const passages: string[] = [];
  for (const { node } of allFeatureNodes()) {
    passages.push(node.plain.what);
    if (node.plain.why !== undefined) passages.push(node.plain.why);
    if (node.plain.agent !== undefined) passages.push(node.plain.agent);
  }
  return passages;
}

/** Flesch–Kincaid grade for aggregated counts, to two decimal places. */
export function fleschKincaidGrade(counts: ProseCounts): number {
  if (counts.sentences === 0 || counts.words === 0) return 0;
  const grade = 0.39 * (counts.words / counts.sentences) +
    11.8 * (counts.syllables / counts.words) -
    15.59;
  return Math.round(grade * 100) / 100;
}

/** The whole plain register's reading grade — the standard's metric value. */
export function plainReadingGrade(): number {
  const total: ProseCounts = { sentences: 0, words: 0, syllables: 0 };
  for (const passage of plainRegisterCorpus()) {
    const counts = countProse(passage);
    total.sentences += counts.sentences;
    total.words += counts.words;
    total.syllables += counts.syllables;
  }
  return fleschKincaidGrade(total);
}
