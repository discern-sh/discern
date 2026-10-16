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
 * self-reported. A predicate returns its unmet reasons — one specific sentence
 * per failure, naming the file or setting and the rule it misses — so an unmet
 * check can never report only its generic `describe`. A predicate is N/A
 * (passes) when its scaffolded file is ABSENT —
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
import { findSetupOrientation } from "./setup_project_context.ts";
import {
  hasMapExplanation,
  mapExplanationIssue,
  setupMapIssues,
} from "./setup_map.ts";
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
  /** Re-derive the step's unmet reasons from repo state: one specific sentence
   * per failure. Empty when the step's work is evident, or N/A (the scaffolded
   * file is absent). */
  evaluate(ctx: SetupCheckContext): Promise<string[]>;
}

/** The outcome of evaluating one check. */
export interface SetupCheckResult {
  step: number;
  name: string;
  describe: string;
  passed: boolean;
  /** Why the check is unmet, one sentence per failure; empty when passed. */
  reasons: string[];
}

/** Join names for a sentence: `a`, `a and b`, `a, b, and c`. */
function sentenceList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
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
    evaluate({ config }): Promise<string[]> {
      const known = Object.keys(KNOWN_JOBS);
      const wired = known.some(
        (name) =>
          config.jobs[name as keyof typeof KNOWN_JOBS] !==
            undefined,
      );
      const declared = config.setup.not_applicable.length;
      if (wired || declared === known.length) return Promise.resolve([]);
      const notApplicable = new Set<string>(config.setup.not_applicable);
      const undeclared = known.filter((name) => !notApplicable.has(name));
      return Promise.resolve([
        `no known job (${
          sentenceList(known)
        }) is wired in discern.toml's [jobs], and [setup].not_applicable ` +
        `declares ${declared} of ${known.length}: wire each job that ` +
        "applies, or declare every known job not applicable" +
        (undeclared.length === 0
          ? "."
          : ` (still undeclared: ${sentenceList(undeclared)}).`),
      ]);
    },
  },
  {
    step: 4,
    name: "design_principles",
    describe:
      "The design-principles page states project-specific rules, why they matter, and how they guide implementation.",
    async evaluate({ root, config }): Promise<string[]> {
      const page = await findSetupOrientation(
        root,
        config.map.dir,
        "design-principles.md",
      );
      if (page === undefined) {
        return []; // not laid here (existing-docs project) → N/A
      }
      return hasMapExplanation(page.text) ? [] : [
        mapExplanationIssue(page.path),
      ];
    },
  },
  {
    step: 5,
    name: "instructions",
    describe:
      "The instruction source has a real one-line pitch and a filled-in Conventions section.",
    async evaluate({ root, config }): Promise<string[]> {
      const rel = instructionSeedRel(config.instructions.sources);
      const text = await readFileOr(root, rel);
      if (text === undefined) {
        return []; // not laid → N/A
      }
      const reasons: string[] = [];
      // The skeleton's pitch + conventions placeholders are NOT skeleton markers,
      // so a clear-the-marker-but-leave-the-stub fill must be caught here. Match the
      // distinctive italic-paren placeholder forms, not the bare words, so real
      // prose that happens to mention "conventions" or a "pitch" is never flagged.
      if (/_\(one-line pitch/i.test(text)) {
        reasons.push(
          `${rel} still carries the "_(one-line pitch" placeholder: replace ` +
            "it with one sentence saying what the project is.",
        );
      }
      if (!/^#{2,}\s+conventions\b/im.test(text)) {
        reasons.push(
          `${rel} has no "## Conventions" heading: add the section and ` +
            "state the project's real conventions under it.",
        );
      }
      if (/_\(replace this section/i.test(text)) {
        reasons.push(
          `${rel} still carries the "_(replace this section" placeholder: ` +
            "replace it with the project's real conventions.",
        );
      }
      return reasons;
    },
  },
  {
    step: 8,
    name: "complete_validation",
    describe:
      "Every configured standard names a producer that exists, and no two producers run the same command.",
    evaluate({ config }): Promise<string[]> {
      const producers = new Map<string, readonly string[]>();
      const register = (selector: string, run: readonly string[]): void => {
        producers.set(selector, run);
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
      const reasons: string[] = [];
      for (const [name, standard] of Object.entries(config.standards)) {
        if (standard.producer === undefined) {
          if (!producers.has(`standards.${name}`)) {
            reasons.push(
              `[standards.${name}] names no producer and has no run ` +
                "command: set producer to a job or scope gate that runs a " +
                "command, or give the standard its own run.",
            );
          }
        } else if (!producers.has(standard.producer)) {
          reasons.push(
            `[standards.${name}] names producer ${standard.producer}, ` +
              "which is not a configured job, scope gate, or standard with " +
              "a command: point it at one that exists.",
          );
        }
      }
      const byCommand = new Map<string, string[]>();
      for (const [selector, run] of producers) {
        const key = JSON.stringify(run);
        byCommand.set(key, [...byCommand.get(key) ?? [], selector]);
      }
      for (const selectors of byCommand.values()) {
        if (selectors.length < 2) continue;
        const run = producers.get(selectors[0] ?? "") ?? [];
        reasons.push(
          `${sentenceList(selectors)} run the same command ` +
            `(${run.join("; ") || "an empty command"}): keep one producer ` +
            "and point every standard that needs it at that one.",
        );
      }
      return Promise.resolve(reasons);
    },
  },
  {
    step: 9,
    name: "primary_subsystem_context",
    describe:
      "Every selected current map page has an explanation and is reachable from the root; each region has a README. The gate-gotchas page is linked and [project].gotchas_doc points to it.",
    async evaluate({ root, config }): Promise<string[]> {
      const reasons = await setupMapIssues(root, config.map.dir);
      const conventional = conventionalSetupGotchasDoc(config.map.dir);
      const pointer = config.project.gotchas_doc.trim();
      if (
        await readFileOr(root, conventional) !== undefined &&
        pointer !== conventional
      ) {
        reasons.push(
          `${conventional} exists, but [project].gotchas_doc is ` +
            `${pointer === "" ? "unset" : `"${pointer}"`}: set it to ` +
            `"${conventional}".`,
        );
      }
      return reasons;
    },
  },
];

/** Evaluate every completion check against the repo, in step order. */
export async function evaluateSetupCompletion(
  ctx: SetupCheckContext,
): Promise<SetupCheckResult[]> {
  const results: SetupCheckResult[] = [];
  for (const check of SETUP_COMPLETION_CHECKS) {
    const reasons = await check.evaluate(ctx);
    results.push({
      step: check.step,
      name: check.name,
      describe: check.describe,
      passed: reasons.length === 0,
      reasons,
    });
  }
  return results;
}
