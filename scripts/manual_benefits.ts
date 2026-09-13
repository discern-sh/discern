/**
 * Human Benefit obligations for the published product manual.
 *
 * Feature-to-benefit evidence remains in the Human Benefit Canon. This
 * repository-only registry binds only the selected human outcomes to stable
 * manual page identities; it does not duplicate feature `drawsOn` edges.
 */

import { dirname, fromFileUrl } from "@std/path";
import {
  allHumanBenefitEntries,
  HUMAN_BENEFIT_CANON,
  type HumanBenefitCluster,
} from "./feature_registry.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import {
  buildManualProjection,
  type ManualProjection,
} from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";

/**
 * Selected benefit id → the manual pages required to deliver it. The FIRST
 * page id in each list is the benefit's declared primary home; any later ids
 * are supporting homes that reinforce the same outcome. Every listed page must
 * exist, publish, and carry an eligible teaching kind.
 */
export const MANUAL_BENEFIT_OBLIGATIONS: Readonly<
  Record<string, readonly string[]>
> = {
  "shape-substantial-work": ["guide-delegate-work"],
  "parallel-work-on-one-machine": ["guide-coordinate-parallel-tasks"],
  "wait-without-relay": ["guide-wait-for-another-task"],
  "compose-staged-work": ["guide-coordinate-parallel-tasks"],
  "land-finished-work-as-the-project-moves": ["guide-finish-and-land-a-change"],
  "resume-later": ["guide-recover-an-interrupted-task"],
  "reduce-routine-review": ["explanation-proof"],
  "judgment-at-the-change": ["explanation-checkpoints"],
  "decisions-in-one-view": ["guide-coordinate-parallel-tasks"],
  "useful-failures-sooner": ["guide-finish-and-land-a-change"],
  "catch-related-files": ["guide-finish-and-land-a-change"],
  "run-relevant-checks": ["guide-finish-and-land-a-change"],
  "context-for-the-task": ["explanation-practice-and-roles"],
  "project-defined-completion": ["explanation-proof"],
  "evidence-for-this-change": ["explanation-proof"],
  "evidence-that-lasts": ["explanation-proof"],
  "explicit-release-decision": ["explanation-proof"],
  "bounded-standing-permission": ["guide-finish-and-land-a-change"],
  "unfinished-work-stays-isolated": ["explanation-worktrees-and-trunk"],
  "recover-interrupted-operations": ["guide-recover-an-interrupted-task"],
  "local-without-another-model": ["explanation-local-control"],
  "explicit-write-authority": ["explanation-local-control"],
};

/** Deliberately unselected benefits and the inventory's retained reason. */
export const MANUAL_BENEFIT_EXCLUSIONS: Readonly<Record<string, string>> = {
  "retain-measured-gains":
    "The Standards explanation uses it, but administration of retained metrics is not required to understand the launch evidence and authority loop safely.",
  "pin-new-baseline":
    "This is a specialized Standards-maintenance procedure; guide and Reference coverage are sufficient.",
  "standards-that-scale":
    "Metric design, replay, rates, on-demand cost, and escalation are advanced tuning rather than first-use prerequisites.",
  "remove-bug-class":
    "This optional agent playbook remains owned by its Skill and the Map.",
  "retire-old-pattern":
    "This optional migration playbook does not define ordinary safe product use.",
  "keep-clutter-down":
    "This optional maintenance playbook and `tidy` task do not need a guarded value page.",
  "catch-documentation-breakage":
    "Mechanical document/Map integrity remains important, but it should not force a human-value page solely for an internal guard.",
  "improve-practice-from-evidence":
    "It requires accumulated local evidence and belongs to advanced practice improvement.",
  "teach-project-once":
    "Instruction and Skill pages are already required by source and task coverage; another benefit guard adds no forcing function.",
  "inspect-agent-understanding":
    "The separately framed public Map trust exhibit owns this outcome.",
  "preserve-decision-reasons":
    "This is contributor and decision-record discipline, not ordinary safe use.",
  "instructions-at-failure":
    "Agent-facing recovery is delivered at failure time; Troubleshooting remains discoverable by symptom.",
  "orient-new-session":
    "This is primarily agent-session ergonomics already forced by discovery/help/instruction surfaces.",
  "export-project-briefing":
    "This is a specific Map/export utility; guide and Reference coverage are sufficient.",
  "reuse-engineering-discipline":
    "This is an optional portable playbook rather than a core operating requirement.",
  "agent-commissioning":
    "The first-success tutorial is already a required complete journey; duplicating its outcome in the benefit registry adds no independent guard.",
  "small-installation-footprint":
    "This is an evaluation/Reference fact, not a critical comprehension obligation.",
  "inspect-live-example":
    "The public Map/trust exhibit owns dogfooding evidence, which is not independent validation.",
  "clean-abandoned-environments":
    "This is advanced lifecycle maintenance and recovery.",
  "switch-providers":
    "Provider Guide/Reference coverage is required already, and switching is not needed for safe core use.",
  "practice-across-stacks":
    "This is category/evaluation context rather than a distinct reader action or safety boundary.",
  "build-on-published-contracts": "This is an integrator Reference concern.",
  "planned-upgrades": "This is a maintenance procedure owned by the guide.",
  "retain-work-after-uninstall":
    "This is an exit and ownership fact, useful but outside the central operating model.",
};

const OBLIGATED_ROLES: ReadonlySet<HumanBenefitCluster["role"]> = new Set([
  "lead promise",
  "conversion benefit",
  "core value",
  "trust assurance",
]);
const ELIGIBLE_KINDS = new Set(["tutorial", "guide", "explanation"]);

/** Validate both sides of the benefit-to-manual relationship. */
export function manualBenefitCoverageIssues(
  manual: ManualProjection,
  canon: readonly HumanBenefitCluster[] = HUMAN_BENEFIT_CANON,
  obligations: Readonly<Record<string, readonly string[]>> =
    MANUAL_BENEFIT_OBLIGATIONS,
  exclusions: Readonly<Record<string, string>> = MANUAL_BENEFIT_EXCLUSIONS,
): string[] {
  const issues: string[] = [];
  const benefits = new Map(
    allHumanBenefitEntries(canon).map(({ cluster, entry }) => [
      entry.id,
      { cluster, entry },
    ]),
  );
  for (const [benefitId, { cluster }] of benefits) {
    const obligated = OBLIGATED_ROLES.has(cluster.role);
    const homes = obligations[benefitId];
    const reason = exclusions[benefitId];
    if (obligated && homes === undefined) {
      issues.push(`${benefitId}: selected ${cluster.role} has no manual home`);
    }
    if (!obligated && reason === undefined) {
      issues.push(
        `${benefitId}: unselected ${cluster.role} has no retained reason`,
      );
    }
    if (homes !== undefined && reason !== undefined) {
      issues.push(`${benefitId}: cannot be both obligated and excluded`);
    }
  }
  for (const [benefitId, pageIds] of Object.entries(obligations)) {
    const benefit = benefits.get(benefitId);
    if (benefit === undefined) {
      issues.push(`${benefitId}: obligation names no Human Benefit`);
      continue;
    }
    if (!OBLIGATED_ROLES.has(benefit.cluster.role)) {
      issues.push(
        `${benefitId}: ${benefit.cluster.role} is not selected for obligation`,
      );
    }
    if (pageIds.length === 0) {
      issues.push(`${benefitId}: must name at least one page`);
    }
    for (const pageId of pageIds) {
      const page = manual.byId.get(pageId);
      if (page === undefined) {
        issues.push(
          `${benefitId}: manual page ${pageId} does not exist or publish`,
        );
      } else if (!ELIGIBLE_KINDS.has(page.kind)) {
        issues.push(`${benefitId}: ${pageId} has ineligible kind ${page.kind}`);
      }
    }
  }
  for (const [benefitId, reason] of Object.entries(exclusions)) {
    if (!benefits.has(benefitId)) {
      issues.push(`${benefitId}: exclusion names no Human Benefit`);
    }
    if (reason.trim() === "") {
      issues.push(`${benefitId}: exclusion reason is empty`);
    }
  }
  return issues;
}

if (import.meta.main) {
  const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
  const manualDir = resolveRepositoryManualDir(repoRoot).abs;
  const tree = await discoverDocs({ cwd: repoRoot, dir: manualDir });
  if (tree === undefined) throw new Error(`no manual at ${manualDir}`);
  const issues = manualBenefitCoverageIssues(
    await buildManualProjection(tree.entries),
  );
  if (issues.length > 0) {
    throw new Error(
      `manual benefit coverage is invalid:\n- ${issues.join("\n- ")}`,
    );
  }
  console.log(
    `${Object.keys(MANUAL_BENEFIT_OBLIGATIONS).length} obligated benefits and ${
      Object.keys(MANUAL_BENEFIT_EXCLUSIONS).length
    } explicit exclusions resolve`,
  );
}
