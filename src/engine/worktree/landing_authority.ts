/**
 * Landing authority — the one resolver shared by acceptance and its lifecycle
 * envelopes.
 *
 * Standing grants are read from the trunk's committed config at a pinned commit,
 * never from the branch. Scope membership routes through the gate's matcher.
 * Effort grants come from the desk-owned Git-admin marker and bind to the
 * effort's branch. Every uncertainty leaves authority unverified. Warnings
 * remain visible even when evidence is also missing.
 */

import { parse as parseToml } from "@std/toml";
import {
  configSchema,
  type DiscernConfig,
  governingConfigValue,
} from "../../shared/config_schema.ts";
import type {
  LandingAuthorityKind,
  LandingConsent,
  LandingConsentSource,
} from "../../shared/consent.ts";
import { runGit } from "../../shared/subprocess.ts";
import { readTrunkConfig } from "../gate/standard_limits.ts";
import { collectPaths, scopeNamesForPath } from "../scopes/scopes.ts";
import {
  generatedGroupForPath,
  resolveGeneratedGroups,
} from "../../shared/generated_artifacts.ts";
import { type EffortGrant, readEffortGrant } from "./effort_grant.ts";

/** One changed path and every configured scope it matches. */
export interface ClassifiedLandingPath {
  readonly path: string;
  readonly scopes: readonly string[];
  /** Owned by a `[generated.<name>]` group. Evidence for display collapse
   * only — authority counts generated paths like any other change. */
  readonly generated?: boolean;
}

/** Pure facts supplied to {@link resolveLandingAuthority}. */
export interface LandingAuthorityFacts {
  readonly effortGranted: boolean;
  readonly classifications: readonly ClassifiedLandingPath[];
  readonly grantedScopes: readonly string[];
  readonly definedScopes: readonly string[];
  readonly warnings?: readonly string[];
  /** Defect in the committed policy record, reported beside any consent. */
  readonly blockingReason?: string;
  readonly trunkCommit?: string;
  readonly headCommit?: string;
}

/** The complete authority decision, including evidence needed at apply time. */
export type LandingAuthorityResolution =
  & (
    | {
      readonly kind: "authorized";
      readonly consent: LandingConsent;
      /** Every known standing scope recorded on the trunk, used or not. */
      readonly standingScopes: readonly string[];
      readonly classifications: readonly ClassifiedLandingPath[];
      readonly uncovered: readonly [];
      readonly warnings: readonly string[];
      /** Configured scope names matched by this tree when an acceptance caller
       * requested metadata evidence. It never participates in authority. */
      readonly scopeNames?: readonly string[];
      readonly trunkCommit?: string;
      readonly headCommit?: string;
    }
    | {
      readonly kind: "conversation-required";
      /** Every known standing scope recorded on the trunk, used or not. */
      readonly standingScopes: readonly string[];
      readonly classifications: readonly ClassifiedLandingPath[];
      readonly uncovered: readonly ClassifiedLandingPath[];
      readonly warnings: readonly string[];
      /** Configured scope names matched by this tree when an acceptance caller
       * requested metadata evidence. It never participates in authority. */
      readonly scopeNames?: readonly string[];
      readonly blockingReason?: string;
      readonly trunkCommit?: string;
      readonly headCommit?: string;
    }
  )
  & { readonly effortGrant?: EffortGrant };

/** The structured projection lifecycle envelopes publish when a grant exists. */
export interface LandingAuthorityProjection {
  readonly kind: LandingAuthorityKind;
  readonly source?: LandingConsentSource;
  /** Standing scopes that cover this exact tree (authorized posture only). */
  readonly scopes?: string[];
  /** Known trunk grants, useful before or outside full coverage. */
  readonly standing_scopes?: string[];
  readonly uncovered?: {
    path: string;
    scopes: string[];
    generated?: boolean;
  }[];
  /** Distinct scope names across every uncovered path. */
  readonly uncovered_scopes?: string[];
  /** Uncovered paths matching no configured scope. */
  readonly uncovered_unscoped_total?: number;
  /** Uncovered paths owned by a `[generated.<name>]` group. */
  readonly uncovered_generated_total?: number;
  readonly warnings?: string[];
}

/** Deduplicate scope names while preserving their first-seen order. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Resolve already-gathered facts. Pure: no Git, config, clock, or filesystem
 * reads. An effort grant wins; otherwise every changed path must match at least
 * one known granted scope. Empty and unclassified changes require conversation.
 */
export function resolveLandingAuthority(
  facts: LandingAuthorityFacts,
): LandingAuthorityResolution {
  const warnings = [...(facts.warnings ?? [])];
  if (facts.effortGranted && facts.blockingReason === undefined) {
    return {
      kind: "authorized",
      consent: { source: "effort-grant" },
      standingScopes: [],
      classifications: facts.classifications,
      uncovered: [],
      warnings,
      ...(facts.trunkCommit !== undefined
        ? { trunkCommit: facts.trunkCommit }
        : {}),
      ...(facts.headCommit !== undefined
        ? { headCommit: facts.headCommit }
        : {}),
    };
  }

  const defined = new Set(facts.definedScopes);
  const granted = unique(facts.grantedScopes);
  const unknown = granted.filter((scope) => !defined.has(scope));
  if (unknown.length > 0) {
    warnings.push(
      `The trunk's [acceptance] grant names unknown ${
        unknown.length === 1 ? "scope" : "scopes"
      }: ${unknown.join(", ")}. Unknown scopes cover nothing.`,
    );
  }
  const knownGranted = granted.filter((scope) => defined.has(scope));
  const grantedSet = new Set(knownGranted);
  const used = new Set<string>();
  const uncovered: ClassifiedLandingPath[] = [];
  for (const classification of facts.classifications) {
    const covering = classification.scopes.filter((scope) =>
      grantedSet.has(scope)
    );
    if (covering.length === 0) {
      uncovered.push(classification);
      continue;
    }
    for (const scope of covering) {
      used.add(scope);
    }
  }

  if (
    facts.classifications.length > 0 && uncovered.length === 0 &&
    used.size > 0 && facts.blockingReason === undefined
  ) {
    return {
      kind: "authorized",
      consent: {
        source: "standing-grant",
        scopes: knownGranted.filter((scope) => used.has(scope)),
      },
      standingScopes: knownGranted,
      classifications: facts.classifications,
      uncovered: [],
      warnings,
      ...(facts.trunkCommit !== undefined
        ? { trunkCommit: facts.trunkCommit }
        : {}),
      ...(facts.headCommit !== undefined
        ? { headCommit: facts.headCommit }
        : {}),
    };
  }

  return {
    kind: "conversation-required",
    standingScopes: knownGranted,
    classifications: facts.classifications,
    uncovered,
    warnings,
    ...(facts.blockingReason !== undefined
      ? { blockingReason: facts.blockingReason }
      : {}),
    ...(facts.trunkCommit !== undefined
      ? { trunkCommit: facts.trunkCommit }
      : {}),
    ...(facts.headCommit !== undefined ? { headCommit: facts.headCommit } : {}),
  };
}

/** Resolve the empty-authority case while retaining warnings and a blocking reason. */
function conversationRequired(
  warnings: readonly string[] = [],
  blockingReason?: string,
): LandingAuthorityResolution {
  return resolveLandingAuthority({
    effortGranted: false,
    classifications: [],
    grantedScopes: [],
    definedScopes: [],
    warnings,
    ...(blockingReason !== undefined ? { blockingReason } : {}),
  });
}

/** Parse trunk configuration against the current schema and return its first actionable failure. */
function schemaFailure(
  text: string,
  path: string,
): { config?: DiscernConfig; reason?: string } {
  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch (error) {
    return {
      reason: `the trunk's ${path} does not parse: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  // Deliberately schema-only: an unknown acceptance scope is not a malformed
  // document here. The pure resolver reports it and gives it zero authority.
  const parsed = configSchema.safeParse(governingConfigValue(raw));
  if (parsed.success) {
    return { config: parsed.data as DiscernConfig };
  }
  const issue = parsed.error.issues[0];
  const at = issue?.path.length === 0 ? "" : ` at ${issue?.path.join(".")}`;
  return {
    reason:
      `the trunk's ${path} does not match the current config schema${at}: ${
        issue?.message ?? "invalid configuration"
      }`,
  };
}

/** Explain why a missing, invalid, unreadable, or branch-mismatched effort grant cannot authorize landing. */
function effortWarnings(
  status: Awaited<ReturnType<typeof readEffortGrant>>,
  branch: string | undefined,
): string[] {
  if (status.status === "missing") {
    return [];
  }
  if (status.status === "invalid" || status.status === "newer") {
    return [`The worktree's effort grant is invalid: ${status.reason}.`];
  }
  if (status.status === "unavailable") {
    return [
      `The worktree's effort grant could not be checked: ${status.reason}.`,
    ];
  }
  if (branch !== undefined && status.grant.branch !== branch) {
    return [
      `The effort grant names ${status.grant.branch}, not the current branch ${branch}; it covers nothing.`,
    ];
  }
  return [];
}

type LandingClassification =
  | {
    readonly kind: "classified";
    readonly classifications: ClassifiedLandingPath[];
    readonly scopeNames: string[];
    readonly headCommit: string;
  }
  | { readonly kind: "unavailable"; readonly reason: "head" | "paths" };

/** Classify the committed landing against the pinned trunk config. Callers
 * decide whether an unavailable classification affects authority or only
 * omits optional metadata. */
async function classifyLanding(
  cwd: string,
  trunkCommit: string,
  config: DiscernConfig,
): Promise<LandingClassification> {
  const headRead = await runGit(
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    { cwd },
  );
  if (!headRead.success || headRead.stdout.trim() === "") {
    return { kind: "unavailable", reason: "head" };
  }
  const headCommit = headRead.stdout.trim();
  const changedPaths = await collectPaths(cwd, trunkCommit, headCommit);
  if (changedPaths === null) {
    return { kind: "unavailable", reason: "paths" };
  }
  const paths = unique(changedPaths);
  const generatedGroups = resolveGeneratedGroups(config);
  const classifications = paths.map((path) => ({
    path,
    scopes: scopeNamesForPath(path, config),
    ...(generatedGroupForPath(generatedGroups, path) === undefined
      ? {}
      : { generated: true }),
  }));
  return {
    kind: "classified",
    classifications,
    scopeNames: unique(classifications.flatMap((entry) => entry.scopes))
      .sort(),
    headCommit,
  };
}

/** The effort grant read beside this worktree's branch. */
interface EffortGrantState {
  readonly effort: Awaited<ReturnType<typeof readEffortGrant>>;
  readonly branch: string | undefined;
  /** Granted when the recorded grant names the checked-out branch. */
  readonly granted: boolean;
}

/** Read the grant beside this worktree's branch and decide once whether it covers the effort. */
async function readEffortGrantState(cwd: string): Promise<EffortGrantState> {
  const [branchRead, effort] = await Promise.all([
    runGit(["branch", "--show-current"], { cwd }),
    readEffortGrant(cwd),
  ]);
  const branch = branchRead.success && branchRead.stdout.trim() !== ""
    ? branchRead.stdout.trim()
    : undefined;
  const granted = effort.status === "granted" &&
    branch !== undefined && effort.grant.branch === branch;
  return { effort, branch, granted };
}

/** The recorded effort grant covering `branch`, when one is granted for it.
 * The one row-level grant derivation the landing queue's view consumes, so
 * grant validity keeps a single runtime reader boundary. */
export async function effortGrantCovering(
  path: string,
  branch: string,
): Promise<{ readonly granted_at: string } | undefined> {
  const grant = await readEffortGrant(path);
  if (grant.status !== "granted" || grant.grant.branch !== branch) {
    return undefined;
  }
  return { granted_at: grant.grant.granted_at };
}

/**
 * Read the current worktree's landing authority. The trunk snapshot is pinned
 * before its config and diff are read, so a branch cannot alter either side of
 * the standing-grant decision.
 */
export async function inspectLandingAuthority(
  cwd: string,
  trunk: string,
  opts: {
    includeScopeEvidence?: boolean;
    /** Classify the changed paths of another checkout — an integrated
     * landing's copy, whose HEAD is the exact tree that lands — while the
     * effort grant and warnings still come from `cwd`. */
    classifyAt?: string;
  } = {},
): Promise<LandingAuthorityResolution> {
  const { effort, branch, granted: effortGranted } = await readEffortGrantState(
    cwd,
  );
  const warnings = effortWarnings(effort, branch);

  const trunkConfig = await readTrunkConfig(cwd, trunk);
  if (trunkConfig.kind === "unreadable") {
    return conversationRequired([
      ...warnings,
      `Standing landing authority could not be checked: ${trunkConfig.reason}.`,
    ]);
  }
  if (trunkConfig.kind === "absent") {
    if (effortGranted && effort.status === "granted") {
      return {
        ...resolveLandingAuthority({
          effortGranted: true,
          classifications: [],
          grantedScopes: [],
          definedScopes: [],
          warnings,
        }),
        effortGrant: effort.grant,
      };
    }
    return conversationRequired(warnings);
  }
  if (trunkConfig.kind === "parse_failed") {
    return conversationRequired(
      [
        ...warnings,
        `Standing landing authority could not be checked: ${trunkConfig.reason}.`,
      ],
      trunkConfig.reason,
    );
  }

  const typed = schemaFailure(trunkConfig.text, trunkConfig.path);
  if (typed.config === undefined) {
    const reason = typed.reason ??
      `the trunk's ${trunkConfig.path} is invalid`;
    return conversationRequired(
      [
        ...warnings,
        `Standing landing authority could not be checked: ${reason}.`,
      ],
      reason,
    );
  }
  const classifyRoot = opts.classifyAt ?? cwd;
  const classification = opts.includeScopeEvidence === true
    ? await classifyLanding(classifyRoot, trunkConfig.commit, typed.config)
    : undefined;
  const scopeEvidence = classification?.kind === "classified"
    ? classification
    : undefined;
  if (effortGranted && effort.status === "granted") {
    const authority = {
      ...resolveLandingAuthority({
        effortGranted: true,
        classifications: [],
        grantedScopes: [],
        definedScopes: Object.keys(typed.config.scopes),
        warnings,
      }),
      effortGrant: effort.grant,
    };
    return scopeEvidence === undefined
      ? authority
      : { ...authority, scopeNames: scopeEvidence.scopeNames };
  }
  const grantedScopes = typed.config.acceptance.pre_authorized;
  if (grantedScopes.length === 0) {
    const authority = conversationRequired(warnings);
    return scopeEvidence === undefined
      ? authority
      : { ...authority, scopeNames: scopeEvidence.scopeNames };
  }

  const authorityClassification = classification ??
    await classifyLanding(classifyRoot, trunkConfig.commit, typed.config);
  if (authorityClassification.kind === "unavailable") {
    return conversationRequired([
      ...warnings,
      authorityClassification.reason === "head"
        ? "Standing landing authority could not be checked: HEAD does not resolve to a commit."
        : "Standing landing authority could not classify the changed paths.",
    ]);
  }
  return resolveLandingAuthority({
    effortGranted: false,
    classifications: authorityClassification.classifications,
    grantedScopes,
    definedScopes: Object.keys(typed.config.scopes),
    warnings,
    trunkCommit: trunkConfig.commit,
    headCommit: authorityClassification.headCommit,
  });
}

/**
 * Project one resolution into the public lifecycle shape. No grant and no
 * authority warning stays absent, preserving the default envelopes exactly.
 */
export function landingAuthorityProjection(
  authority: LandingAuthorityResolution,
): LandingAuthorityProjection | undefined {
  if (authority.kind === "authorized") {
    return {
      kind: authority.kind,
      source: authority.consent.source,
      ...(authority.consent.scopes !== undefined
        ? { scopes: [...authority.consent.scopes] }
        : {}),
      ...(authority.standingScopes.length > 0
        ? { standing_scopes: [...authority.standingScopes] }
        : {}),
      ...(authority.warnings.length > 0
        ? { warnings: [...authority.warnings] }
        : {}),
    };
  }
  if (
    authority.standingScopes.length === 0 &&
    authority.uncovered.length === 0 &&
    authority.warnings.length === 0
  ) {
    return undefined;
  }
  const uncoveredScopes = unique(
    authority.uncovered.flatMap((entry) => entry.scopes),
  ).sort();
  const unscoped = authority.uncovered
    .filter((entry) => entry.scopes.length === 0).length;
  const generated = authority.uncovered
    .filter((entry) => entry.generated === true).length;
  return {
    kind: authority.kind,
    ...(authority.standingScopes.length > 0
      ? { standing_scopes: [...authority.standingScopes] }
      : {}),
    ...(authority.uncovered.length > 0
      ? {
        uncovered: authority.uncovered.map((entry) => ({
          path: entry.path,
          scopes: [...entry.scopes],
          ...(entry.generated === true ? { generated: true } : {}),
        })),
      }
      : {}),
    ...(uncoveredScopes.length > 0
      ? { uncovered_scopes: uncoveredScopes }
      : {}),
    ...(unscoped > 0 ? { uncovered_unscoped_total: unscoped } : {}),
    ...(generated > 0 ? { uncovered_generated_total: generated } : {}),
    ...(authority.warnings.length > 0
      ? { warnings: [...authority.warnings] }
      : {}),
  };
}

/**
 * Project authority at effort creation, before this task has a final tree.
 * Standing scopes are a possibility, never a promise: setup artifacts or a
 * `--from` branch must not make start claim the eventual landing is covered.
 */
export function prospectiveLandingAuthorityProjection(
  authority: LandingAuthorityResolution,
): LandingAuthorityProjection | undefined {
  if (
    authority.kind === "authorized" &&
    authority.consent.source === "effort-grant"
  ) {
    return landingAuthorityProjection(authority);
  }
  if (
    authority.standingScopes.length === 0 && authority.warnings.length === 0
  ) {
    return undefined;
  }
  return {
    kind: "conversation-required",
    ...(authority.standingScopes.length > 0
      ? { standing_scopes: [...authority.standingScopes] }
      : {}),
    ...(authority.warnings.length > 0
      ? { warnings: [...authority.warnings] }
      : {}),
  };
}

/** Human-sized path evidence shared by every uncovered-authority surface. */
export function uncoveredLandingAuthorityDetails(
  authority: LandingAuthorityResolution,
  cap = 8,
): string[] {
  if (authority.kind !== "conversation-required") {
    return [];
  }
  const shown = authority.uncovered.slice(0, cap).map((entry) =>
    `\`${entry.path}\` (${
      entry.scopes.length === 0
        ? "no matching scope"
        : `scopes: ${entry.scopes.join(", ")}`
    })`
  );
  if (authority.uncovered.length > shown.length) {
    shown.push(`and ${authority.uncovered.length - shown.length} more`);
  }
  return shown;
}
