/**
 * The **hidden-verb registry** — the single source of truth for every
 * top-level verb deliberately kept out of the operator help listing.
 *
 * Hiding a verb is a product decision with a blast radius: the generated CLI
 * reference follows the visible surface, so a hidden verb also leaves the
 * docs — and with them every future session's working memory. The decision
 * therefore lives here as data (why the verb is hidden, and what returns it
 * to the listing) instead of at a `.hidden()` call site, where it would
 * survive only as a commit message. `buildCli` applies this registry to the
 * registered commands, and the guard test (`tests/engine_help_groups_test.ts`)
 * holds the live hidden set equal to it in both bootstrap states — a verb can
 * neither hide without enrolling here nor stay enrolled after it returns to
 * the listing.
 */

/** When a hiding applies: unconditionally, or only once the install records
 * `[meta].bootstrapped`. */
export type HiddenWhen = "always" | "bootstrapped";

/** One hidden verb's recorded decision. The prose is self-contained — an
 * owner reads it back without chasing a commit. */
export interface HiddenVerbEntry {
  /** When the hiding applies. */
  readonly when: HiddenWhen;
  /** Why the verb is out of the listing. */
  readonly reason: string;
  /** The condition that returns it to the listing. */
  readonly revival: string;
}

/** Every deliberately hidden top-level verb, keyed by its `KNOWN_VERBS` name. */
export const HIDDEN_VERBS: Readonly<Record<string, HiddenVerbEntry>> = {
  // The staged setup handshake is ADR 0075/0078; self-hiding after bootstrap
  // keeps the daily listing to verbs the project still needs.
  setup: {
    when: "bootstrapped",
    reason: "the one-time bootstrap verb; once the install is bootstrapped " +
      "it would only crowd the daily listing.",
    revival: "listed automatically whenever the install is not yet " +
      "bootstrapped; explicit re-seeding stays callable with `setup begin --reseed` while hidden.",
  },
  // A mystery that stays out of the listing.
  triangle: {
    when: "always",
    reason: "its purpose is intentionally enigmatic, and listing it would " +
      "spend the mystery.",
    revival: "none planned; it stays dispatchable for anyone who already " +
      "knows its name.",
  },
};

/** The verb names hidden in a given bootstrap state. */
export function hiddenVerbNames(bootstrapped: boolean): Set<string> {
  return new Set(
    Object.entries(HIDDEN_VERBS)
      .filter(([, entry]) => entry.when === "always" || bootstrapped)
      .map(([name]) => name),
  );
}
