/**
 * Select product changes that still need a feature/benefit currency review.
 *
 * The three canons deliberately share feature identities in one source file.
 * A path-wide `unless_changed` exemption therefore cannot tell whether all
 * three accounts moved. This bounded matcher compares the feature, human-
 * benefit, and agent-benefit source regions independently between the
 * governing commit and the candidate worktree. It serves the advisory until
 * every region changed; an unchanged region may be correct, but must be
 * judged rather than hidden by an unrelated edit elsewhere in the file.
 */

import type { CheckpointWhenInput } from "../src/shared/checkpoints.ts";
import { resolveContainedProjectReadPath } from "../src/shared/project_path.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { type GitResult, runGit } from "../src/shared/subprocess.ts";
import {
  checkpointExactUtf8,
  checkpointGitBytes,
  checkpointInvocationRoot,
  checkpointProjectRoot,
  checkpointWhenInputFromEnvironment,
} from "./checkpoint_when_input.ts";

/** The one checkpoint this command is safe to serve. */
export const FEATURE_BENEFIT_CURRENCY_CHECKPOINT_ID =
  "feature-benefit-currency";

/** The shared registry whose independently authored regions are compared. */
export const FEATURE_BENEFIT_REGISTRY_PATH = "scripts/feature_registry.ts";

/** Canon regions whose currency receives an independent judgment. */
export const FEATURE_BENEFIT_CANON_SECTION_IDS = [
  "feature",
  "human-benefit",
  "agent-benefit",
] as const;

export type FeatureBenefitCanonSectionId =
  typeof FEATURE_BENEFIT_CANON_SECTION_IDS[number];

/** Stable boundaries embedded in the shared registry source. */
export const FEATURE_BENEFIT_CANON_SECTION_MARKERS: Readonly<
  Record<FeatureBenefitCanonSectionId, string>
> = {
  feature: "// discern-canon-section: feature",
  "human-benefit": "// discern-canon-section: human-benefit",
  "agent-benefit": "// discern-canon-section: agent-benefit",
};

/** Maximum registry bytes read from either tree. */
export const FEATURE_BENEFIT_REGISTRY_MAX_BYTES = 1024 * 1024;

const GIT_TIMEOUT_MS = 2_000;

/** Raise one bounded matcher failure. Exit 2 makes the checkpoint fail open. */
function fail(message: string): never {
  throw new Error(message);
}

/** Convert an unsuccessful Git operation into a bounded matcher failure. */
function requireGitSuccess(result: GitResult, label: string): void {
  if (!result.success) {
    const reason = result.timedOut === true
      ? "timed out"
      : result.outputLimitExceeded === true
      ? "exceeded its output limit"
      : `exited ${result.code}`;
    fail(`${label} ${reason}`);
  }
}

/** Find one unique section marker. */
function markerOffset(
  source: string,
  id: FeatureBenefitCanonSectionId,
): number {
  const marker = FEATURE_BENEFIT_CANON_SECTION_MARKERS[id];
  const first = source.indexOf(marker);
  if (first < 0) return fail(`registry is missing the ${id} section marker`);
  if (source.indexOf(marker, first + marker.length) >= 0) {
    return fail(`registry repeats the ${id} section marker`);
  }
  return first;
}

/** Partition one registry source into its three exact authored regions. */
export function featureBenefitCanonSections(
  source: string,
): Readonly<Record<FeatureBenefitCanonSectionId, string>> {
  const feature = markerOffset(source, "feature");
  const human = markerOffset(source, "human-benefit");
  const agent = markerOffset(source, "agent-benefit");
  if (!(feature < human && human < agent)) {
    return fail("registry canon section markers are out of order");
  }
  return {
    feature: source.slice(feature, human),
    "human-benefit": source.slice(human, agent),
    "agent-benefit": source.slice(agent),
  };
}

/** Return the canon regions whose source changed in the candidate. */
export function changedFeatureBenefitCanonSections(
  governingSource: string,
  candidateSource: string,
): FeatureBenefitCanonSectionId[] {
  const governing = featureBenefitCanonSections(governingSource);
  const candidate = featureBenefitCanonSections(candidateSource);
  return FEATURE_BENEFIT_CANON_SECTION_IDS.filter((id) =>
    governing[id] !== candidate[id]
  );
}

/** Whether at least one canon account remains unchanged and needs judgment. */
export function featureBenefitCurrencyReviewRequired(
  governingSource: string,
  candidateSource: string,
): boolean {
  return changedFeatureBenefitCanonSections(
    governingSource,
    candidateSource,
  ).length < FEATURE_BENEFIT_CANON_SECTION_IDS.length;
}

/** Read the candidate registry through the shared project boundary. */
async function candidateRegistry(root: string): Promise<string> {
  const absolute = await resolveContainedProjectReadPath(
    root,
    FEATURE_BENEFIT_REGISTRY_PATH,
  );
  if (absolute === undefined) {
    return fail("candidate registry does not resolve inside the worktree");
  }
  const info = await lstatIfExists(absolute);
  if (info === undefined || !info.isFile) {
    return fail("candidate registry is not a regular file");
  }
  if (info.size > FEATURE_BENEFIT_REGISTRY_MAX_BYTES) {
    return fail("candidate registry exceeds the read limit");
  }
  const bytes = await Deno.readFile(absolute);
  if (bytes.byteLength > FEATURE_BENEFIT_REGISTRY_MAX_BYTES) {
    return fail("candidate registry grew beyond the read limit");
  }
  return checkpointExactUtf8(bytes, "candidate registry");
}

/** Read the registry from the exact policy commit governing this effort. */
async function governingRegistry(
  root: string,
  policyCommit: string,
): Promise<string> {
  const result = await runGit(
    ["show", `${policyCommit}:${FEATURE_BENEFIT_REGISTRY_PATH}`],
    {
      cwd: root,
      bin: "git",
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: FEATURE_BENEFIT_REGISTRY_MAX_BYTES + 4_096,
    },
  );
  requireGitSuccess(result, "governing registry read");
  const bytes = checkpointGitBytes(result);
  if (bytes.byteLength > FEATURE_BENEFIT_REGISTRY_MAX_BYTES) {
    return fail("governing registry exceeds the read limit");
  }
  return checkpointExactUtf8(bytes, "governing registry");
}

/** Resolve the exact changed paths whose currency question remains open. */
export async function matchingFeatureBenefitCurrencyChanges(
  cwd: string,
  input: CheckpointWhenInput,
): Promise<string[]> {
  const root = await checkpointProjectRoot(cwd);
  const [governing, candidate] = await Promise.all([
    governingRegistry(root, input.policy_commit),
    candidateRegistry(root),
  ]);
  return featureBenefitCurrencyReviewRequired(governing, candidate)
    ? input.changed_files.map((file) => file.path)
    : [];
}

/** Run the read-only checkpoint command. */
async function main(): Promise<number> {
  const input = await checkpointWhenInputFromEnvironment({
    id: FEATURE_BENEFIT_CURRENCY_CHECKPOINT_ID,
    mode: "advise",
  });
  const matches = await matchingFeatureBenefitCurrencyChanges(
    checkpointInvocationRoot(),
    input,
  );
  for (const path of matches) console.log(`DISCERN_MATCH ${path}`);
  return matches.length > 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${FEATURE_BENEFIT_CURRENCY_CHECKPOINT_ID}: ${message}`);
    Deno.exit(2);
  }
}
