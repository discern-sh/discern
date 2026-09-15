/** Local adoption boundaries shared by public operations and internal planners. */
import { loadConfig } from "../shared/config_schema.ts";
import { managedVersionRegression } from "../shared/managed_version.ts";
export {
  assertManagedMaterialWritable,
  managedMaterialBoundary,
  ManagedMaterialError,
} from "../shared/managed_version.ts";
import { integrationBranch } from "./worktree/git.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import { parse as parseToml } from "@std/toml";
import { tryParseVersion } from "../shared/semver.ts";
import { readTrunkConfig } from "./gate/standard_limits.ts";
import { runGit } from "../shared/subprocess.ts";

/** Read one adoption fact without interpreting unrelated config keys. */
function recordedManagedVersion(text: string): string | undefined {
  const meta = parseToml(text).meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  const value: unknown = "managed_version" in meta
    ? meta.managed_version
    : undefined;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || tryParseVersion(value) === undefined) {
    throw new Error(
      "The shared branch has invalid meta.managed_version evidence.",
    );
  }
  return value;
}

/** The governing trunk's committed fact survives branch reverts and deletion. */
export async function trunkManagedVersionBoundary(
  root: string,
  config?: DiscernConfig,
): Promise<string | undefined> {
  const cfg = config ?? await loadConfig(root);
  const trunk = integrationBranch(cfg.repository.trunk);
  return await compareWithTrunk(root, trunk, cfg.meta.managed_version);
}

/** Acceptance checks the frozen submission, even when the checkout has moved. */
export async function committedManagedVersionBoundary(
  root: string,
  trunk: string,
  submission: string,
): Promise<string | undefined> {
  const proposed = await readTrunkConfig(root, submission);
  if (proposed.kind === "unreadable" || proposed.kind === "parse_failed") {
    return `Could not read the submission's managed-version evidence: ${proposed.reason}`;
  }
  return await compareWithTrunk(
    root,
    trunk,
    proposed.kind === "absent"
      ? undefined
      : recordedManagedVersion(proposed.text),
  );
}

/** Use the same pinned committed-config reader as the Gate's other ratchets. */
async function compareWithTrunk(
  root: string,
  trunk: string,
  proposed: string | undefined,
): Promise<string | undefined> {
  const recorded = await readTrunkConfig(root, trunk);
  if (recorded.kind === "absent") return undefined;
  // An absent local trunk has its own existing Gate/landing diagnostic.
  if (recorded.kind === "unreadable") {
    const ref = await runGit([
      "rev-parse",
      "--verify",
      "--quiet",
      `${trunk}^{commit}`,
    ], { cwd: root });
    if (!ref.success) return undefined;
    return `Could not read the shared branch's managed-version evidence: ${recorded.reason}. Restore access to the trunk before proving or landing this branch.`;
  }
  // The established governing-config check owns malformed policy and its hard
  // refusal. Adoption must not replace that diagnostic with an unrelated one.
  if (recorded.kind === "parse_failed") return undefined;
  return managedVersionRegression(
    recordedManagedVersion(recorded.text),
    proposed,
  );
}
