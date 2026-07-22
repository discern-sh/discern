/**
 * The public command vocabulary: retired command spellings refuse with a direct
 * successor, harmless grammatical variants of the current canon normalize
 * silently before Cliffy dispatches them, and familiar words from other tools
 * earn a did-you-mean suggestion naming the canonical verb.
 */

/** Retired command paths and the canonical command path each names now. */
export const RETIRED_COMMAND_REDIRECTS: Readonly<Record<string, string>> = {
  finish: "done",
  graduate: "accept",
  "setup land": "setup accept",
  integrate: "update",
  scopes: "impact",
  ratchets: "standards",
  docs: "map",
  "config set-ratchet": "config set-standard",
  "config set-capability": "config set-job",
  "config set-check": "config set-job",
};

/** Retired top-level config keys and the canonical key each names now. */
export const RETIRED_CONFIG_KEY_REDIRECTS: Readonly<Record<string, string>> = {
  ratchets: "standards",
  docs: "map",
  recipes: "scripts",
  capabilities: "jobs",
  checks: "jobs",
};

/** The successor for a retired top-level config key, if `key` is one. */
export function retiredConfigKeySuccessor(key: string): string | undefined {
  return RETIRED_CONFIG_KEY_REDIRECTS[key];
}

/**
 * Familiar words from other tools' vocabularies, each mapped to the canonical
 * verb the unknown-command path should SUGGEST. Suggestions only — none of
 * these words ever dispatches or forwards (ADR 0120 reserves silent forwarding
 * for grammatical variants of the canon; a different word gets a one-line
 * lesson naming the right verb instead). Kept beside the retired-command
 * redirects above so the whole non-canonical vocabulary — retired spellings
 * that refuse, variants that normalize, synonyms that suggest — reads as one
 * table-driven system.
 */
export const COMMAND_SYNONYM_SUGGESTIONS: Readonly<Record<string, string>> = {
  init: "setup",
  install: "setup",
  check: "prepare",
  sync: "update",
  land: "accept",
  merge: "accept",
};

/** The canonical verb to suggest for a familiar-but-unknown word, if any. */
export function commandSynonymSuggestion(word: string): string | undefined {
  return COMMAND_SYNONYM_SUGGESTIONS[word];
}

/** The one-line message opening every unknown-command refusal. */
export function unknownCommandMessage(word: string): string {
  return `unknown command "${word}".`;
}

/** Irregular grammatical forms that are safe to normalize silently. */
export const VERB_FORM_VARIANTS: Readonly<Record<string, string>> = {
  improve: "improvement",
};

/** The successor for a retired command path, if `command` is one. */
export function retiredCommandSuccessor(
  command: string,
): string | undefined {
  return RETIRED_COMMAND_REDIRECTS[command];
}

/** The one-line refusal for a retired command spelling. */
export function retiredCommandMessage(
  retired: string,
  successor: string,
): string {
  return `\`discern ${retired}\` was renamed; run \`discern ${successor}\`.`;
}

/**
 * Normalize a grammatical variant against the live canonical verb set. Exact
 * canonical names win. Then an explicit irregular form may match. Finally, a
 * single trailing `s` is added or removed only when that produces exactly one
 * canonical verb; an ambiguous or unknown spelling is left untouched for the
 * normal unknown-command path.
 */
export function normalizeVerbVariant(
  verb: string,
  canonicalVerbs: ReadonlySet<string>,
): string {
  if (canonicalVerbs.has(verb)) {
    return verb;
  }

  const explicit = VERB_FORM_VARIANTS[verb];
  if (explicit !== undefined && canonicalVerbs.has(explicit)) {
    return explicit;
  }

  const candidates = new Set<string>();
  const withoutS = verb.endsWith("s") ? verb.slice(0, -1) : undefined;
  if (withoutS !== undefined && canonicalVerbs.has(withoutS)) {
    candidates.add(withoutS);
  }
  const withS = `${verb}s`;
  if (canonicalVerbs.has(withS)) {
    candidates.add(withS);
  }
  return candidates.size === 1 ? [...candidates][0] ?? verb : verb;
}
