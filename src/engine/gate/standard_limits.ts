/**
 * The shared Tier-1 half of standards: read the trunk configuration once and
 * verify every existing Standard's definition and limit, including Standards
 * deleted from the branch.
 * Both `done` and the standalone `standards` verb consume this one snapshot, so
 * they cannot disagree about redefinition, loosening, deletion, or an
 * unreadable trunk.
 */

import {
  EXTENTS,
  type StandardConfig,
  toCommandList,
} from "../../shared/config_schema.ts";
import { RawConfig } from "../../shared/config_read.ts";
import type { Diagnostic } from "../../shared/result.ts";
import type {
  StandardLimitProposalData,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import {
  loosenedLimitReason,
  type PlannedStandard,
  standardJobLabel,
} from "./standard_plan.ts";

/** How one Standard field participates in the held quality claim. */
export interface StandardDefinitionPolicy {
  kind: "monotonic-bound" | "enforcement-meaning" | "execution-or-pinning";
  reason: string;
}

/**
 * The total policy for every schema field in a Standard. This is deliberately
 * keyed by `StandardConfig`: adding a field to the config schema cannot compile
 * until its effect on the held claim has been decided here.
 */
export const STANDARD_DEFINITION_POLICIES = {
  metric: {
    kind: "enforcement-meaning",
    reason: "selects the emitted numerator the Standard reads",
  },
  direction: {
    kind: "enforcement-meaning",
    reason: "decides whether the held number is a floor or a ceiling",
  },
  limit: {
    kind: "monotonic-bound",
    reason: "is the separately ordered floor or ceiling that may only tighten",
  },
  run: {
    kind: "enforcement-meaning",
    reason: "produces the measurement evidence",
  },
  per: {
    kind: "enforcement-meaning",
    reason: "selects the denominator that turns a count into a rate",
  },
  scale: {
    kind: "enforcement-meaning",
    reason: "sets the human units of a rate",
  },
  margin: {
    kind: "execution-or-pinning",
    reason:
      "changes only a future pin target, not today's measurement or verdict",
  },
  measure: {
    kind: "enforcement-meaning",
    reason: "decides whether every Gate refreshes the measurement evidence",
  },
  inputs: {
    kind: "enforcement-meaning",
    reason:
      "decides when recorded evidence may be replayed instead of refreshed",
  },
  timeout: {
    kind: "execution-or-pinning",
    reason:
      "bounds execution time without changing the measured claim or value",
  },
} as const satisfies Record<keyof StandardConfig, StandardDefinitionPolicy>;

/** One schema field after equivalent spellings and defaults are normalized. */
type NormalizedStandardConfig = {
  readonly [Field in keyof StandardConfig]: unknown;
};

type NormalizedPer =
  | { kind: "metric"; metric: string }
  | { kind: "extent"; measure: (typeof EXTENTS)[number]; globs: string[] }
  | { kind: "legacy-table"; fields: string[] };

/** Normalize the schema-validated branch spelling without flattening commands
 * into a rendered shell string: `toCommandList` is the shared execution form. */
function normalizeBranchStandard(
  name: string,
  spec: StandardConfig,
): NormalizedStandardConfig {
  let per: NormalizedPer | undefined;
  if (typeof spec.per === "string") {
    per = { kind: "metric", metric: spec.per };
  } else if (spec.per !== undefined) {
    for (const measure of EXTENTS) {
      const globs = spec.per[measure];
      if (globs !== undefined) {
        per = {
          kind: "extent",
          measure,
          globs: typeof globs === "string" ? [globs] : [...globs],
        };
        break;
      }
    }
  }
  return {
    metric: spec.metric ?? name,
    direction: spec.direction,
    limit: spec.limit,
    run: toCommandList(spec.run),
    per,
    scale: spec.scale,
    margin: spec.margin,
    measure: spec.measure,
    inputs: spec.inputs === undefined ? undefined : [...spec.inputs],
    timeout: spec.timeout,
  } satisfies NormalizedStandardConfig;
}

/** Stable identity of every Standard-definition field except its monotonic
 * bound. A proposal changes only `limit`; any other field movement makes
 * the recorded proposal stale instead of letting incomparable measurements
 * share an approval. */
export async function standardDefinitionFingerprint(
  name: string,
  spec: StandardConfig,
): Promise<string> {
  const normalized = normalizeBranchStandard(name, spec);
  const material = {
    metric: normalized.metric,
    direction: normalized.direction,
    run: normalized.run,
    per: normalized.per,
    scale: normalized.scale,
    margin: normalized.margin,
    measure: normalized.measure,
    inputs: normalized.inputs,
    timeout: normalized.timeout,
  };
  return await sha256Hex(`standard-definition-v1\n${JSON.stringify(material)}`);
}

/** Normalize one optional or defaulted numeric field from the raw trunk. */
function rawNumber(
  config: RawConfig,
  key: string,
  defaultValue: number | undefined,
): unknown {
  const value = config.getNumber(key);
  if (value !== undefined) return value;
  if (!config.has(key)) return defaultValue;
  return { legacyValue: config.get(key, "<non-scalar>") };
}

/** Read a denominator from the tolerant raw trunk view. Scalar and one-item
 * list extents converge on the same representation used for the branch. */
function normalizeTrunkPer(
  config: RawConfig,
  key: string,
): NormalizedPer | undefined {
  for (const measure of EXTENTS) {
    const extentKey = `${key}.${measure}`;
    if (config.has(extentKey)) {
      return { kind: "extent", measure, globs: config.array(extentKey) };
    }
  }
  const legacyFields = config.keys(key).sort();
  if (legacyFields.length > 0) {
    return { kind: "legacy-table", fields: legacyFields };
  }
  return config.has(key)
    ? { kind: "metric", metric: config.get(key) }
    : undefined;
}

/** Normalize the deliberately unvalidated trunk table field by field.
 * Omitted fields receive current semantic defaults; unrecognized values remain
 * comparable sentinels rather than making the trunk unreadable. */
function normalizeTrunkStandard(
  config: RawConfig,
  name: string,
): NormalizedStandardConfig {
  const prefix = `standards.${name}`;
  const metricKey = `${prefix}.metric`;
  const directionKey = `${prefix}.direction`;
  const inputsKey = `${prefix}.inputs`;
  return {
    metric: config.has(metricKey) ? config.get(metricKey) : name,
    direction: config.has(directionKey) ? config.get(directionKey) : "up",
    limit: rawNumber(config, `${prefix}.limit`, undefined),
    run: config.array(`${prefix}.run`),
    per: normalizeTrunkPer(config, `${prefix}.per`),
    scale: rawNumber(config, `${prefix}.scale`, 1),
    margin: rawNumber(config, `${prefix}.margin`, 0),
    measure: config.has(`${prefix}.measure`)
      ? config.get(`${prefix}.measure`)
      : "gate",
    inputs: config.has(inputsKey) ? config.array(inputsKey) : undefined,
    timeout: rawNumber(config, `${prefix}.timeout`, undefined),
  } satisfies NormalizedStandardConfig;
}

interface StandardDefinitionChange {
  field: keyof StandardConfig;
  trunk: unknown;
  branch: unknown;
}

/** Compare the bounded JSON-compatible shapes the field normalizers emit. */
function sameNormalizedValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Select every enforcement-meaning field whose normalized values differ. */
function changedDefinitionFields(
  trunk: NormalizedStandardConfig,
  branch: NormalizedStandardConfig,
): StandardDefinitionChange[] {
  const changes: StandardDefinitionChange[] = [];
  for (
    const field of Object.keys(
      STANDARD_DEFINITION_POLICIES,
    ) as (keyof StandardConfig)[]
  ) {
    if (STANDARD_DEFINITION_POLICIES[field].kind !== "enforcement-meaning") {
      continue;
    }
    if (!sameNormalizedValue(trunk[field], branch[field])) {
      changes.push({ field, trunk: trunk[field], branch: branch[field] });
    }
  }
  return changes;
}

const DEFINITION_VALUE_LIMIT = 120;

/** Render one old/new value without letting a command or path list consume an
 * unbounded diagnostic. JSON escaping also keeps control characters visible. */
function boundedDefinitionValue(value: unknown): string {
  const rendered = JSON.stringify(value) ?? String(value);
  if (rendered.length <= DEFINITION_VALUE_LIMIT) return rendered;
  return `${rendered.slice(0, DEFINITION_VALUE_LIMIT - 1)}…`;
}

const REDEFINITION_NEXT_STEP =
  "Restore the trunk definition on this branch. To redefine or recalibrate it " +
  "intentionally, ask the owner to approve the old and new meanings, make that " +
  "change on the trunk, then run `discern update` in this worktree. A measured-" +
  "breach override is a separate flow and cannot waive a definition change.";

/** Explain one redefinition with every changed field and the owner route. */
function redefinedStandardReason(
  name: string,
  mainBranch: string,
  changes: readonly StandardDefinitionChange[],
): string {
  const fields = changes.map((change) =>
    `${change.field}: ${boundedDefinitionValue(change.trunk)} -> ${
      boundedDefinitionValue(change.branch)
    }`
  ).join("; ");
  return `standard '${name}' changes its enforcement definition versus ${mainBranch} (${fields}). ` +
    `A held limit keeps its meaning only while these fields stay equivalent. ${REDEFINITION_NEXT_STEP}`;
}

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
  const rel = "discern.toml";
  const out = await runGit(["show", `${commit}:./${rel}`], {
    cwd: root,
  });
  if (out.success) {
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
  proposals: ReadonlyMap<string, StandardLimitProposalData>;
}

/** The next step a loosening diagnostic tells an agent to take. */
const LOOSENING_NEXT_STEP =
  "If this branch caused the metric breach, commit the final clean tree and " +
  'run `discern standards propose <name> --reason "…"`; that command measures ' +
  "the named Standard before creating its proposal. " +
  "Otherwise move the metric the right way. Only an exact proposal and exact " +
  "owner approval can move the held limit.";

/**
 * Verify every configured Standard's normalized enforcement definition and
 * monotonic limit against one read of the trunk's committed config, then walk
 * the trunk table for standards deleted on this branch. A new branch standard
 * passes vacuously, as does a trunk with no config at all.
 */
export async function verifyTrunkLimits(
  root: string,
  mainBranch: string,
  standards: PlannedStandard[],
  proposals: ReadonlyMap<string, StandardLimitProposalData> = new Map(),
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
      proposals: new Map(),
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
          `the Standard never-loosen check cannot verify definitions and limits from [standards]: ${trunk.reason}. ` +
          `Fix the trunk's config (a broken trunk config is a real defect, not a skippable one).`,
        reproduce_cmd: `git show ${mainBranch}:./discern.toml`,
      }],
      blocking: true,
      blockedStandards: new Set(),
      proposals: new Map(),
    };
  }
  if (trunk.kind === "absent") {
    return {
      summary: { status: "verified", trunk: mainBranch },
      diagnostics: [],
      blocking: false,
      blockedStandards: new Set(),
      proposals: new Map(),
    };
  }

  const diagnostics: Diagnostic[] = [];
  const blockedStandards = new Set<string>();
  const acceptedProposals = new Map<string, StandardLimitProposalData>();
  const branchNames = new Set(standards.map((standard) => standard.name));

  for (const standard of standards) {
    const mainValue = trunk.config.getNumber(standard.limitKey);
    // A trunk table without a numeric bound was never an enforceable Standard.
    // Preserve the tolerant legacy behavior: the branch entry is new for this
    // comparison rather than making an old schema shape fail current parsing.
    if (mainValue === undefined) {
      continue;
    }
    const trunkDefinition = normalizeTrunkStandard(
      trunk.config,
      standard.name,
    );
    const branchDefinition = normalizeBranchStandard(
      standard.name,
      standard.spec,
    );
    const definitionChanges = changedDefinitionFields(
      trunkDefinition,
      branchDefinition,
    );
    if (definitionChanges.length > 0) {
      blockedStandards.add(standard.name);
      diagnostics.push({
        tool: standardJobLabel(standard.name),
        severity: "error",
        message: redefinedStandardReason(
          standard.name,
          mainBranch,
          definitionChanges,
        ),
        reproduce_cmd: "discern standards --dry-run",
      });
      // Once meanings differ, their numbers are not comparable. In particular,
      // never use the branch direction to reinterpret the trunk bound.
      continue;
    }
    const mainDirection = trunkDefinition.direction;
    if (mainDirection !== "up" && mainDirection !== "down") {
      // Unreachable after an equal comparison with the schema-validated branch,
      // but retain the tolerant trunk boundary if a future normalizer changes.
      continue;
    }
    const loosened = loosenedLimitReason(
      standard.name,
      standard.direction,
      standard.limit,
      mainDirection,
      mainValue,
      mainBranch,
    );
    if (loosened === undefined) {
      continue;
    }
    const proposal = proposals.get(standard.name);
    if (
      proposal !== undefined && proposal.trunk_limit === mainValue &&
      proposal.proposed_limit === standard.limit &&
      proposal.direction === standard.direction
    ) {
      acceptedProposals.set(standard.name, proposal);
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
          `${blockedStandards.size} Standard(s) redefined, loosened, or deleted versus ${mainBranch}`,
      },
      diagnostics,
      blocking: true,
      blockedStandards,
      proposals: acceptedProposals,
    };
  }
  if (acceptedProposals.size > 0) {
    return {
      summary: {
        status: "proposed",
        trunk: mainBranch,
        reason: `${acceptedProposals.size} ${
          acceptedProposals.size === 1
            ? "Standard limit proposal explains"
            : "Standard limit proposals explain"
        } otherwise-forbidden limit changes`,
      },
      diagnostics: [],
      blocking: false,
      blockedStandards,
      proposals: acceptedProposals,
    };
  }
  return {
    summary: { status: "verified", trunk: mainBranch },
    diagnostics: [],
    blocking: false,
    blockedStandards,
    proposals: acceptedProposals,
  };
}
