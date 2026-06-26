/**
 * The discern **feature** toggles — the on/off switches for whole subsystems
 * (ADR 0020). The single source of truth every other module consults to decide
 * whether worktrees, ratchets, guidance compilation, skills, or the docs browser
 * are active. A disabled feature must vanish coherently: its verbs hide, its
 * hooks aren't written, its guidance section is omitted, and its doctor checks
 * are skipped.
 *
 * ⚠️ Do NOT confuse a *feature* with a *capability*. `[capabilities]` is the
 * gate's command table (format/lint/typecheck/test/build). `[features]` toggles
 * subsystems. They are different sections with different jobs.
 *
 * Every feature defaults to ON. Only an explicit `[features].<name> = false`
 * disables one, so an install (or a config predating `[features]`) gets the full
 * harness. The quality gate, config surface, and doctor are *core* — always on,
 * never listed here.
 */

import type { DiscernConfig } from "./config_schema.ts";

/** The toggleable subsystems, in display order. Must match the keys of the
 * schema's `[features]` section (a guard test pins this). */
export const FEATURES = [
  "worktrees",
  "ratchets",
  "guidance",
  "skills",
  "docs",
] as const;

/** One toggleable subsystem name. */
export type Feature = (typeof FEATURES)[number];

/** True when `name` is a known feature. */
export function isFeature(name: string): name is Feature {
  return (FEATURES as readonly string[]).includes(name);
}

/**
 * Whether feature `name` is enabled for `config`. Every feature defaults to ON;
 * the schema turns an absent `[features]` table or key into `true`, so a feature
 * is enabled unless `[features].<name>` is the literal `false`.
 */
export function isFeatureEnabled(
  config: DiscernConfig,
  name: Feature,
): boolean {
  return config.features[name];
}

/** The enabled features for `config`, in {@link FEATURES} order. */
export function enabledFeatures(config: DiscernConfig): Feature[] {
  return FEATURES.filter((f) => config.features[f]);
}

/**
 * The feature that owns a top-level verb, or undefined for a core verb (always
 * available). `worktree:<sub>` is normalised to `worktree` before this is called.
 * Used by the CLI router to give a clear "feature disabled" error instead of an
 * "unknown recipe" fallthrough.
 */
export const VERB_FEATURE: Readonly<Record<string, Feature>> = {
  worktree: "worktrees",
  "worktree-name": "worktrees",
  ratchets: "ratchets",
  refresh: "guidance",
  graduate: "worktrees",
  skills: "skills",
  docs: "docs",
};

/** The feature owning `verb`, or undefined when `verb` is a core verb. */
export function featureForVerb(verb: string): Feature | undefined {
  return Object.hasOwn(VERB_FEATURE, verb) ? VERB_FEATURE[verb] : undefined;
}
