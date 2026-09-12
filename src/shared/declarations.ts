/**
 * The checkpoint **declaration interlock** and the acceptance **variance
 * contract** — the registries their class tests iterate.
 *
 * Both are refusal contracts in the house idiom (a stable slug, read-only in
 * effect, a named recovery), but they are DISTINCT classes, and both sit beside
 * — never inside — `CONSENT_GATED_VERBS`:
 *
 *   - The consent class refuses unconditionally until the OWNER's consent
 *     arrives.
 *   - The declaration interlock ({@link AWAITING_DECLARATION_SLUG}) fires only
 *     while a governing `stop` checkpoint lacks a current conclusion, and is
 *     satisfied by the CALLER'S OWN recorded judgment (`--met <id>`, or
 *     `--unmet <id> --why "<rationale>"`). No authority is involved; the agent
 *     can always resolve it alone.
 *   - The variance contract ({@link AWAITING_VARIANCE_SLUG}) fires only while a
 *     current declared-unmet conclusion stands at acceptance, and is satisfied
 *     ONLY by the owner's current-conversation decision
 *     (`--confirmed --variance <id>`): standing and effort grants never cover
 *     a variance. It is not folded into ordinary landing consent — consent
 *     accepts the landing; a variance additionally authorizes landing a named
 *     question the agent judged unmet.
 *
 * One refusal batches every checkpoint it is about: the declaration refusal
 * lists each awaiting checkpoint with its question and both recoveries; the
 * variance refusal lists each declared-unmet checkpoint with its question,
 * evidence, and rationale, and the one complete decision that resolves it.
 */

/**
 * The stable failure slug `done` (and acceptance's route-back precondition)
 * uses while a governing `stop` checkpoint has no current met-or-unmet
 * conclusion. The envelope's `verb` field disambiguates which act was refused.
 */
export const AWAITING_DECLARATION_SLUG = "awaiting_declaration";

/**
 * The stable failure slug `accept` uses while a current declared-unmet
 * conclusion stands without the owner's variance authorization for it.
 */
export const AWAITING_VARIANCE_SLUG = "awaiting_variance";

/** The declaration flags `done` accepts — the caller's own recorded judgment. */
export const MET_FLAG = "--met";
export const UNMET_FLAG = "--unmet";
export const WHY_FLAG = "--why";

/** The acceptance flag that names one owner-authorized variance. */
export const VARIANCE_FLAG = "--variance";

/** One presentation that must carry the interlock's complete contract. */
export type DeclarationSurface = "terminal" | "json" | "markdown" | "mcp";

/** One verb enrolled in the declaration interlock — pure metadata. */
export interface DeclarationGatedVerb {
  /** Stable identifier for the class (matches the probe key in the class test). */
  readonly id: string;
  /** The CLI command a human types, sans the leading `discern`. */
  readonly command: string;
  /**
   * How this verb's refusal resolves: `declare` serves the questions and takes
   * the conclusions right here; `route-to-done` names `discern done` as the
   * place conclusions are recorded.
   */
  readonly resolution: "declare" | "route-to-done";
  /** Public surfaces that must carry the same batched contract. */
  readonly surfaces: readonly DeclarationSurface[];
}

/**
 * The declaration-interlocked verbs — the single source the interlock class
 * test iterates. Adding a member here enrols it in the shared-refusal
 * contract, which then fails until the new member refuses with
 * {@link AWAITING_DECLARATION_SLUG} and serves its resolution. `done` is the
 * only member: Proof binds the declaration evidence, so no answerable
 * declaration state survives past `done` — acceptance meets a stale
 * conclusion only as a stale Proof and serves the nothing-proven route,
 * never this slug.
 */
export const DECLARATION_GATED_VERBS = [
  {
    id: "done",
    command: "done",
    resolution: "declare",
    surfaces: ["terminal", "json", "markdown", "mcp"],
  },
] as const satisfies readonly DeclarationGatedVerb[];

/** Stable ids used by the declaration-interlock class probes. */
export type DeclarationGatedVerbId =
  (typeof DECLARATION_GATED_VERBS)[number]["id"];

/**
 * The variance contract on acceptance, as typed metadata the class test and
 * every surface share. A single member by design: a variance is an acceptance
 * decision, so no other verb can serve it.
 */
export const VARIANCE_GATED_ACCEPTANCE = {
  slug: AWAITING_VARIANCE_SLUG,
  command: "accept",
  /** Both are required together: the current-conversation consent flag plus
   * one `--variance <id>` per current declared-unmet checkpoint. */
  flags: ["--confirmed", VARIANCE_FLAG],
  surfaces: ["terminal", "json", "markdown", "mcp"],
} as const;
