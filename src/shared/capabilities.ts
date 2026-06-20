/**
 * The capability vocabulary and gate-stage machinery — the SINGLE source of
 * truth shared by the installer (validation, doctor, config migrations) and the
 * TS-native engine (the gate). Before the single-binary refactor this was
 * duplicated across `src/lib/config.ts` and the shell `lib/capabilities.sh` +
 * `lib/validate.sh`; with the shell engine gone there is one copy, so the
 * installer's validation and the engine's gate cannot drift.
 */

/**
 * The gate STAGES, in the order the gate reasons about them. A `[checks.<name>]`
 * declares one explicitly; a capability's stage is derived (see
 * `KNOWN_CAPABILITIES`).
 */
export const STAGES = ["fix", "build", "check", "test"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The known capability vocabulary: each capability name mapped to the gate stage
 * the engine derives for it. This is a CLOSED set — a key outside it is custom
 * work and belongs in `[checks.<name>]` with an explicit stage. A known
 * capability omitted from a config is "knowably absent" (the readiness signal
 * `doctor` reports).
 */
export const KNOWN_CAPABILITIES = {
  format: "fix",
  build: "build",
  lint: "check",
  typecheck: "check",
  test: "test",
} as const satisfies Record<string, Stage>;
export type Capability = keyof typeof KNOWN_CAPABILITIES;

/** The derived stage for a known capability, or undefined when the name is unknown. */
export function capStage(name: string): Stage | undefined {
  return Object.hasOwn(KNOWN_CAPABILITIES, name)
    ? KNOWN_CAPABILITIES[name as Capability]
    : undefined;
}

/** True when `name` is one of the known capabilities. */
export function isKnownCapability(name: string): name is Capability {
  return Object.hasOwn(KNOWN_CAPABILITIES, name);
}

/** True when `stage` is a valid gate stage (a `[checks.<name>].stage` value). */
export function stageIsValid(stage: string): stage is Stage {
  return (STAGES as readonly string[]).includes(stage);
}

/** Human-readable list of the known capabilities, for fix-up hints. */
export function capabilityList(): string {
  return Object.keys(KNOWN_CAPABILITIES).join(", ");
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
