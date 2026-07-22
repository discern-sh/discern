/**
 * The hint registry — the single module defining every advisory hint the
 * engine and installer can emit into a result's `hints[]` channel (ADR 0172).
 *
 * A hint is an entry here, never an inline string at an emission site: the
 * closed set is what lets the gate validate quoted `discern` commands against
 * the live verb registry, lets renderers drop agent-only hints by id instead
 * of string equality, lets the logbook record which hints fired, and lets
 * tests assert a hint by rendering its entry rather than pinning prose.
 *
 * In process a fired hint is an id/text pair ({@link FiredHint}); on the wire
 * the envelope's `hints` stays `string[]`, so ids never reach a public
 * contract. Entry documentation carries rationale and provenance; rendered
 * template text stays self-contained (no internal decision numbers — the
 * ADR-citation guard holds for these strings like any other).
 */

/**
 * How an entry means to steer the caller. `next-step` names the action to
 * take from here; `guardrail` states a rule protecting shared state before
 * it is broken; `notice` discloses a condition the caller should weigh but
 * need not act on.
 */
export type HintCategory = "next-step" | "guardrail" | "notice";

/**
 * Which surfaces render an entry. `all` reaches every surface; `agent` marks
 * hints written for coding agents that the interactive human renderers drop
 * (the fleet-ownership and trunk guardrails today) — the drop keys on this
 * field, not on reconstructing the rendered string.
 */
export type HintAudience = "all" | "agent";

/** One registered hint: a stable id, its classification, and a typed template. */
export interface HintDef<P = void> {
  /** Stable kebab-case identifier — the logbook, renderers, and tests key on it. */
  readonly id: string;
  readonly category: HintCategory;
  readonly audience: HintAudience;
  /**
   * Groups variants of one underlying fact (the restart-session family, the
   * generated-file-drift family) so wording reviews see them side by side.
   */
  readonly family?: string;
  /** Renders the hint from named, compiler-checked parameters. */
  readonly template: (params: P) => string;
}

/** Identity helper so an entry's parameter type is inferred at the definition. */
export function defineHint<P = void>(def: HintDef<P>): HintDef<P> {
  return def;
}

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  readonly text: string;
}

/**
 * Fire a registry entry. A parameterless entry (`HintDef<void>`) is fired with
 * no second argument; a parameterized one requires its params — the
 * conditional tuple makes the compiler enforce both.
 */
export function fire<P>(
  def: HintDef<P>,
  ...params: P extends void ? [] : [params: P]
): FiredHint {
  const [p] = params;
  // The tuple type above guarantees `p` is `P` exactly when the template
  // needs it; the cast bridges what the conditional tuple cannot express.
  return { id: def.id, text: def.template(p as P) };
}

/** Project fired hints onto the envelope's wire shape, order preserved. */
export function hintTexts(fired: readonly FiredHint[]): string[] {
  return fired.map((f) => f.text);
}

/**
 * The registry. Entries land site-by-site as the emission sites migrate off
 * inline strings; once the last site moves, the closed-set guard pins this
 * table as the only source `hints[]` accepts.
 */
export const HINTS = {} as const;
