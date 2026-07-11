/**
 * The public command vocabulary: retired command spellings refuse with a direct
 * successor, while harmless grammatical variants of the current canon normalize
 * silently before Cliffy dispatches them.
 */

/** Retired command paths and the canonical command path each names now. */
export const RETIRED_COMMAND_REDIRECTS: Readonly<Record<string, string>> = {
  finish: "done",
  graduate: "accept",
  "setup land": "setup accept",
  integrate: "update",
  scopes: "impact",
};

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
 * normal recipe/typo path.
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
