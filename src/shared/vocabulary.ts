/**
 * The public command vocabulary: retired command spellings refuse with a direct
 * successor, harmless grammatical variants of the current canon normalize
 * silently before Cliffy dispatches them, and familiar words from other tools
 * earn a did-you-mean suggestion naming the canonical verb.
 */

/** Retired command paths and the canonical command path each names now.
 * Deliberately NOT here: `script`, which is not a retired command but a
 * grammatical variant of `scripts` — typed input folds to the canonical verb
 * through the explicit form registry, while every surface discern writes spells
 * `scripts` exclusively. */
export const RETIRED_COMMAND_REDIRECTS: Readonly<Record<string, string>> = {
  finish: "done",
  graduate: "accept",
  "setup land": "setup accept",
  integrate: "update",
  scopes: "impact",
  ratchets: "standards",
  "config set-ratchet": "config set-standard",
  "config set-capability": "config set-job",
  "config set-check": "config set-job",
};

/** Retired top-level config keys and the canonical key each names now. */
export const RETIRED_CONFIG_KEY_REDIRECTS: Readonly<Record<string, string>> = {
  guidance: "instructions",
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

/** One retired config position that is DEAD — it is rejected during parsing,
 * and its instructions may name the canonical replacement — matched against a schema
 * unrecognized-keys issue. */
export interface DeadConfigPosition {
  /** Dotted parent path of the unrecognized key ("" is the document root). */
  readonly path: string;
  /** The dead key itself, or undefined to match ANY unknown key at `path`. */
  readonly key?: string;
  /** Renders the rejection message for the offending key list. */
  readonly message: (keys: string) => string;
  /** A minimal TOML document that trips this position. The schema test parses
   * every entry's example and asserts this entry's message, so a new row is
   * exercised by existing here. */
  readonly example: string;
}

/**
 * Retired config positions with no successor key. The schema's issue
 * translator and its class test both read this table — retiring a config
 * position means adding a row here, nowhere else. Order matters: the first
 * matching row wins, so keyed rows precede a same-path wildcard.
 *
 * Pre-release contract corrections also live here when a known local install
 * may still hold the retired nested key. The retired spelling never parses as an
 * alias; the row only makes the refusal actionable.
 */
export const DEAD_CONFIG_POSITIONS: readonly DeadConfigPosition[] = [
  {
    path: "repository",
    key: "receipt_notes",
    message: () =>
      "[repository].receipt_notes has been retired; rename it to [repository].proof_notes before running discern upgrade.",
    example: '[repository]\nreceipt_notes = "local"\n',
  },
];

/** The first dead-position row matching an unrecognized-keys issue, if any.
 * `positions` is injectable so tests can prove the matching semantics
 * (key-before-wildcard order, root vs section paths) on synthetic tables. */
export function deadConfigPosition(
  path: string,
  keys: readonly string[],
  positions: readonly DeadConfigPosition[] = DEAD_CONFIG_POSITIONS,
): DeadConfigPosition | undefined {
  return positions.find((position) =>
    position.path === path &&
    (position.key === undefined || keys.includes(position.key))
  );
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

/** Deliberately accepted grammatical forms, each enrolled explicitly. */
export const VERB_FORM_VARIANTS: Readonly<Record<string, string>> = {
  improve: "improvement",
  script: "scripts",
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
 * canonical names win. Then an explicit enrolled form may match. No generic
 * pluralization exists: adding a command cannot silently create another input
 * spelling or turn a retired command into a different live group.
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

  return verb;
}
