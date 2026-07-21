/**
 * The known-job vocabulary and gate-stage machinery — the SINGLE source of
 * truth shared by the installer (validation, doctor, config migrations) and the
 * engine (the gate). One copy feeds both, so the installer's validation and the
 * engine's gate cannot drift.
 */

/**
 * The gate STAGES, in the order the gate reasons about them. A custom job
 * declares one explicitly; a known job's stage is derived (see `KNOWN_JOBS`).
 */
export const STAGES = ["fix", "build", "check", "test"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The known job vocabulary: each built-in name mapped to the gate stage the
 * engine derives for it. A key outside this set is a custom job and must declare
 * its stage. A known job omitted from a config is "knowably absent" (the
 * readiness signal `doctor` reports).
 *
 * `smoke` is the odd one out: not "run tool X" but "prove the project is ready in
 * THIS checkout" — a FAST, side-effect-light command that boots the app with its
 * real config and any essential shared runtime dependency (a framework's about, a
 * CLI `--version`, a config-load-and-exit), NOT an e2e suite (anything heavier
 * belongs in a custom job). It rides the fail-fast `test` group so a quick
 * failure cancels slower siblings. Both `discern done` and `discern test` include
 * it, and every gate re-proves readiness wherever it runs — including inside a
 * worktree, where every future task lives (ADR 0090). Anything env-anchored (an
 * untracked `.env`, an uninstalled dependency dir) that doesn't survive into a
 * fresh worktree makes it fail there, which is the point. Discern-owned write
 * authority is engine-known and preflighted separately; a prerequisite unique to
 * one custom command belongs in that command.
 */
export const KNOWN_JOBS = {
  format: "fix",
  build: "build",
  lint: "check",
  typecheck: "check",
  test: "test",
  smoke: "test",
} as const satisfies Record<string, Stage>;
export type KnownJob = keyof typeof KNOWN_JOBS;

/** The derived stage for a known job, or undefined when the name is unknown. */
export function jobStage(name: string): Stage | undefined {
  return Object.hasOwn(KNOWN_JOBS, name)
    ? KNOWN_JOBS[name as KnownJob]
    : undefined;
}

/** True when `name` is one of the known jobs. */
export function isKnownJob(name: string): name is KnownJob {
  return Object.hasOwn(KNOWN_JOBS, name);
}

/** True when `stage` is a valid gate stage (a custom job's `stage` value). */
export function stageIsValid(stage: string): stage is Stage {
  return (STAGES as readonly string[]).includes(stage);
}

/** Human-readable list of the known jobs, for fix-up hints. */
export function knownJobList(): string {
  return Object.keys(KNOWN_JOBS).join(", ");
}

/** Human-readable list of the valid stages, for fix-up hints. */
export function stageList(): string {
  return STAGES.join(", ");
}

/** The slug shape the wizard validates and the docs document. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True when `slug` matches the required shape. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** A short explanation of the slug rule, shown on invalid input. */
export const SLUG_RULE =
  "lowercase letters, digits and dashes; must start with a letter or digit (e.g. my-app)";
