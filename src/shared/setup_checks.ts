/**
 * Derived per-step completion checks for `discern setup done` (ADR 0078).
 *
 * The marker walk (`findSkeletonMarkers`) catches a skeleton whose
 * `<!-- setup fills this -->` sentinel still remains. It does NOT catch the
 * shallow-compliance case discern exists to prevent: an agent that DELETES the
 * marker without meaningfully filling the file. These predicates close that gap —
 * each re-derives, from repo state, that the authoring work a checkable step asked
 * for is actually evident, and `setup done` blocks (naming the unmet check) when
 * one fails. They SUPPLEMENT, never replace, the marker + refresh/doctor/finish
 * proof.
 *
 * Stateless by construction (ADR 0075): each predicate reads the tree; nothing is
 * self-reported. A predicate is N/A (passes) when its scaffolded file is ABSENT —
 * an existing-docs project that adapted the steps to its own tree was never given
 * that skeleton, so the check proves "the work the skeleton asked for was done,"
 * not "this exact path exists."
 *
 * Each check's `describe` is the SAME text as its step's `completion_check` spine
 * field in `templates/setup/instructions.md`, tied by a forcing-function test
 * (ADR 0051) so a brief edit and a predicate edit cannot drift.
 */

import { join } from "@std/path";
import { KNOWN_JOBS } from "./capabilities.ts";
import { type DiscernConfig, toCommandList } from "./config_schema.ts";
import { normalizeMapDir } from "./map_path.ts";
import { instructionSeedRel } from "./paths_registry.ts";
import { readSetupOrientation } from "./setup_project_context.ts";
import { hasMapExplanation, setupMapIssues } from "./setup_map.ts";
import { readTextIfExists } from "./fs_presence.ts";

/** The conventional Gate-gotchas page the setup skeleton authors. */
export function conventionalSetupGotchasDoc(mapDir: string): string {
  return `${normalizeMapDir(mapDir)}development/done-gate-gotchas.md`;
}

/** What a completion predicate reads: the project root and its loaded config. */
export interface SetupCheckContext {
  root: string;
  config: DiscernConfig;
}

/** One derived per-step completion check. */
export interface SetupCompletionCheck {
  /** The setup step this proves (matches the page's `step`). */
  step: number;
  /** Stable machine slug for the diagnostic and tests. */
  name: string;
  /** Human one-liner — IDENTICAL to the step's `completion_check` spine field. */
  describe: string;
  /** Re-derive pass/fail from repo state. True when the step's work is evident, or
   * N/A (the scaffolded file is absent). */
  evaluate(ctx: SetupCheckContext): Promise<boolean>;
}

/** The outcome of evaluating one check. */
export interface SetupCheckResult {
  step: number;
  name: string;
  describe: string;
  passed: boolean;
}

/** Read a repo-relative text file, or undefined when it is absent. */
async function readFileOr(
  root: string,
  rel: string,
): Promise<string | undefined> {
  return await readTextIfExists(join(root, rel));
}

/**
 * The registry. Only the steps with a machine-checkable predicate appear here —
 * steps 0/1/3/6/7/10 are self-verified prose checks with no derived proof. Each
 * `describe` mirrors its page's `completion_check` field; the parity test pins
 * them together so neither can drift.
 */
export const SETUP_COMPLETION_CHECKS: readonly SetupCompletionCheck[] = [
  {
    step: 2,
    name: "known_jobs",
    describe:
      "at least one applicable known job is wired in discern.toml, or every known job is declared not applicable.",
    evaluate({ config }): Promise<boolean> {
      const wired = Object.keys(KNOWN_JOBS).some(
        (name) =>
          config.jobs[name as keyof typeof KNOWN_JOBS] !==
            undefined,
      );
      const allNotApplicable = config.setup.not_applicable.length ===
        Object.keys(KNOWN_JOBS).length;
      return Promise.resolve(wired || allNotApplicable);
    },
  },
  {
    step: 4,
    name: "design_principles",
    describe:
      "Any retained design-principles page explains the agreed constraints; no principle count is required.",
    async evaluate({ root, config }): Promise<boolean> {
      const text = await readSetupOrientation(
        root,
        config.map.dir,
        "design-principles.md",
      );
      if (text === undefined) {
        return true; // not laid here (existing-docs project) → N/A
      }
      return hasMapExplanation(text);
    },
  },
  {
    step: 5,
    name: "instructions",
    describe:
      "The instruction source has a real one-line pitch and a filled-in Conventions section.",
    async evaluate({ root, config }): Promise<boolean> {
      const text = await readFileOr(
        root,
        instructionSeedRel(config.instructions.sources),
      );
      if (text === undefined) {
        return true; // not laid → N/A
      }
      const hasConventions = /^#{2,}\s+conventions\b/im.test(text);
      // The skeleton's pitch + conventions placeholders are NOT skeleton markers,
      // so a clear-the-marker-but-leave-the-stub fill must be caught here. Match the
      // distinctive italic-paren placeholder forms, not the bare words, so real
      // prose that happens to mention "conventions" or a "pitch" is never flagged.
      const pitchFilled = !/_\(one-line pitch/i.test(text);
      const conventionsFilled = !/_\(replace this section/i.test(text);
      return hasConventions && pitchFilled && conventionsFilled;
    },
  },
  {
    step: 8,
    name: "complete_validation",
    describe:
      "Every configured standard names a producer that exists, and no two producers run the same command.",
    evaluate({ config }): Promise<boolean> {
      const producers = new Map<string, string>();
      const register = (selector: string, run: readonly string[]): void => {
        producers.set(selector, JSON.stringify(run));
      };
      for (const [name, value] of Object.entries(config.jobs)) {
        const run = toCommandList(value);
        if (run.length > 0) register(`jobs.${name}`, run);
      }
      for (const [name, scope] of Object.entries(config.scopes)) {
        const run = toCommandList(scope.gate);
        if (run.length > 0) register(`scopes.${name}.gate`, run);
      }
      for (const [name, standard] of Object.entries(config.standards)) {
        if (standard.run !== undefined) {
          register(`standards.${name}`, toCommandList(standard.run));
        }
      }
      const resolvable = Object.entries(config.standards).every(
        ([name, standard]) =>
          standard.producer === undefined
            ? producers.has(`standards.${name}`)
            : producers.has(standard.producer),
      );
      const distinct = new Set(producers.values()).size === producers.size;
      return Promise.resolve(resolvable && distinct);
    },
  },
  {
    step: 9,
    name: "primary_subsystem_context",
    describe:
      "Every selected current map page has an explanation and is reachable from the root; each region has a README, and an authored conventional gotchas page is wired through [project].gotchas_doc.",
    async evaluate({ root, config }): Promise<boolean> {
      if ((await setupMapIssues(root, config.map.dir)).length > 0) {
        return false;
      }
      const conventional = conventionalSetupGotchasDoc(config.map.dir);
      const gotchas = await readFileOr(root, conventional);
      return gotchas === undefined ||
        config.project.gotchas_doc.trim() === conventional;
    },
  },
];

/** Evaluate every completion check against the repo, in step order. */
export async function evaluateSetupCompletion(
  ctx: SetupCheckContext,
): Promise<SetupCheckResult[]> {
  const results: SetupCheckResult[] = [];
  for (const check of SETUP_COMPLETION_CHECKS) {
    const passed = await check.evaluate(ctx);
    results.push({
      step: check.step,
      name: check.name,
      describe: check.describe,
      passed,
    });
  }
  return results;
}
