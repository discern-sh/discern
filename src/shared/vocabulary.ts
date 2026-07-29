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

/** One retired config position that is DEAD — nothing to rename to, only
 * guidance — matched against a schema unrecognized-keys issue. */
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
 */
export const DEAD_CONFIG_POSITIONS: readonly DeadConfigPosition[] = [
  {
    path: "worktree",
    key: "enabled",
    message: (keys) =>
      `dead config ${keys} — the worktree workflow is core now, not a toggle; run \`discern upgrade\` to drop it.`,
    example: "[worktree]\nenabled = true\n",
  },
  {
    path: "worktree",
    key: "graduate_to",
    message: (keys) =>
      `dead config ${keys} — \`discern accept\` always lands on the trunk now (there is one landing target); run \`discern upgrade\` to drop the key.`,
    example: '[worktree]\ngraduate_to = "main"\n',
  },
  {
    path: "worktree",
    message: (keys) =>
      `dead config ${keys} — the engine reads [worktree.resources.<name>] now; run \`discern upgrade\` to migrate it.`,
    example: '[worktree.db]\ncreate = "make-db"\n',
  },
  {
    path: "",
    key: "features",
    message: () =>
      "dead config [features] — the subsystem toggles were retired (every subsystem is core now); run `discern upgrade` to drop the section.",
    example: "[features]\ndocs = false\n",
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
