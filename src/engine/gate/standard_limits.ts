/**
 * The shared Tier-1 half of standards: read the trunk configuration once and
 * verify every branch limit, including standards deleted from the branch.
 * Both `done` and the standalone `standards` verb consume this one snapshot, so
 * they cannot disagree about loosening, deletion, or an unreadable trunk.
 */

import { RawConfig } from "../../shared/config_read.ts";
import type { Diagnostic } from "../../shared/result.ts";
import type { StandardsLimitsData } from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  loosenedLimitReason,
  type PlannedStandard,
  standardJobLabel,
} from "./standard_plan.ts";

/** How reading the trunk's committed config went — the evidence Tier 1
 * distinguishes: a parsed config, no config on the trunk at all, an unreadable
 * trunk, or a config that was fetched but does not parse. */
export type TrunkConfigRead =
  | {
    kind: "parsed";
    config: RawConfig;
    text: string;
    commit: string;
    path: string;
  }
  | { kind: "absent"; commit: string }
  | { kind: "unreadable"; reason: string }
  | { kind: "parse_failed"; reason: string; commit: string; path: string };

/**
 * Read the trunk's committed config raw (it may be older or un-migrated, so it
 * must not trip the current schema). The `rev:./path` spelling is load-bearing:
 * Git resolves a bare `rev:path` against the repository top level, while a
 * discern project may be rooted in a subdirectory.
 */
export async function readTrunkConfig(
  root: string,
  mainBranch: string,
): Promise<TrunkConfigRead> {
  const ref = await runGit(
    ["rev-parse", "--verify", "--quiet", `${mainBranch}^{commit}`],
    { cwd: root },
  );
  if (!ref.success) {
    return {
      kind: "unreadable",
      reason: `the trunk '${mainBranch}' does not resolve to a commit here`,
    };
  }
  const commit = ref.stdout.trim();
  for (const rel of ["discern.toml", ".discern/config.toml"]) {
    const out = await runGit(["show", `${commit}:./${rel}`], {
      cwd: root,
    });
    if (!out.success) {
      continue;
    }
    try {
      return {
        kind: "parsed",
        config: new RawConfig(out.stdout),
        text: out.stdout,
        commit,
        path: rel,
      };
    } catch (error) {
      return {
        kind: "parse_failed",
        commit,
        path: rel,
        reason: `the trunk's ${rel} does not parse: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  return { kind: "absent", commit };
}

/** The shared Tier-1 outcome. `blockedStandards` names configured standards
 * whose own measurement must be skipped plus deleted trunk standards that need
 * a synthetic standalone failure step. A parse failure is global, so it fails
 * the invocation without populating this set. */
export interface TrunkLimitsVerification {
  summary: StandardsLimitsData;
  diagnostics: Diagnostic[];
  blocking: boolean;
  blockedStandards: ReadonlySet<string>;
}

/** The next step a loosening diagnostic tells an agent to take. */
const LOOSENING_NEXT_STEP =
  "Relay this finding to your owner rather than working around it: lowering a " +
  "limit is an owner decision taken on the trunk — at their explicit " +
  "instruction, an agent working in the main checkout edits " +
  "[standards.<name>] in the trunk's discern.toml, in daylight, in trunk " +
  "history. On this branch, move the metric the right way instead.";

/**
 * Verify every configured limit against one read of the trunk's committed
 * config, and walk the trunk table for standards deleted on this branch. A new
 * branch standard passes vacuously, as does a trunk with no config at all.
 */
export async function verifyTrunkLimits(
  root: string,
  mainBranch: string,
  standards: PlannedStandard[],
): Promise<TrunkLimitsVerification> {
  const trunk = await readTrunkConfig(root, mainBranch);
  if (trunk.kind === "unreadable") {
    return {
      summary: {
        status: "unverified",
        trunk: mainBranch,
        reason: trunk.reason,
      },
      diagnostics: [],
      blocking: false,
      blockedStandards: new Set(),
    };
  }
  if (trunk.kind === "parse_failed") {
    return {
      summary: {
        status: "parse_failed",
        trunk: mainBranch,
        reason: trunk.reason,
      },
      diagnostics: [{
        tool: "standards",
        severity: "error",
        message:
          `the never-loosen check cannot verify [standards] limits: ${trunk.reason}. ` +
          `Fix the trunk's config (a broken trunk config is a real defect, not a skippable one).`,
        reproduce_cmd: `git show ${mainBranch}:./discern.toml`,
      }],
      blocking: true,
      blockedStandards: new Set(),
    };
  }
  if (trunk.kind === "absent") {
    return {
      summary: { status: "verified", trunk: mainBranch },
      diagnostics: [],
      blocking: false,
      blockedStandards: new Set(),
    };
  }

  const diagnostics: Diagnostic[] = [];
  const blockedStandards = new Set<string>();
  const branchNames = new Set(standards.map((standard) => standard.name));

  for (const standard of standards) {
    const mainValue = trunk.config.getNumber(standard.limitKey);
    const loosened = loosenedLimitReason(
      standard.name,
      standard.direction,
      standard.limit,
      mainValue,
      mainBranch,
    );
    if (loosened === undefined) {
      continue;
    }
    blockedStandards.add(standard.name);
    diagnostics.push({
      tool: standardJobLabel(standard.name),
      severity: "error",
      message: `${loosened} ${LOOSENING_NEXT_STEP}`,
      reproduce_cmd: "discern standards --dry-run",
    });
  }

  for (const name of trunk.config.subsections("standards")) {
    if (branchNames.has(name)) {
      continue;
    }
    const limit = trunk.config.getNumber(`standards.${name}.limit`);
    if (limit === undefined) {
      continue;
    }
    const bound = trunk.config.get(`standards.${name}.direction`, "up") ===
        "down"
      ? "ceiling"
      : "floor";
    blockedStandards.add(name);
    diagnostics.push({
      tool: standardJobLabel(name),
      severity: "error",
      message:
        `standard '${name}' was deleted on this branch (${mainBranch} holds its ${bound} at ${limit}) — ` +
        `deletion is the ultimate loosening. Restore the [standards.${name}] table. ${LOOSENING_NEXT_STEP}`,
      reproduce_cmd: `git show ${mainBranch}:./discern.toml`,
    });
  }

  if (diagnostics.length > 0) {
    return {
      summary: {
        status: "loosened",
        trunk: mainBranch,
        reason:
          `${diagnostics.length} limit(s) loosened or deleted versus ${mainBranch}`,
      },
      diagnostics,
      blocking: true,
      blockedStandards,
    };
  }
  return {
    summary: { status: "verified", trunk: mainBranch },
    diagnostics: [],
    blocking: false,
    blockedStandards,
  };
}
