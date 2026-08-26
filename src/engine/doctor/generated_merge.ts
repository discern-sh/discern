/** Git-authoritative generated-merge diagnostics for `discern doctor`. */

import { isAbsolute, resolve } from "@std/path";
import {
  DISCERN_GENERATED_MERGE_DRIVER,
} from "../../lib/agent_gitattributes.ts";
import {
  type ResolvedGeneratedGroup,
  trackedGeneratedArtifactPaths,
} from "../../shared/generated_artifacts.ts";
import {
  parseCheckAttrZ,
  parseScopedGitConfigValueZ,
} from "../../shared/git_paths.ts";
import { runGit } from "../../shared/subprocess.ts";

/** One doctor-compatible finding; doctor normalizes the compatibility fields. */
export interface GeneratedMergeCheck {
  readonly name: string;
  readonly status: "ok" | "fail";
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

const DRIVER_KEY = `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`;

/** Quote one path for the POSIX recovery command without losing newlines. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Resolve a path emitted relative to Git's command working directory. */
function gitPath(root: string, value: string): string {
  return resolve(isAbsolute(value) ? value : resolve(root, value));
}

/** Whether `root` is a linked worktree rather than the repository's main checkout. */
async function isLinkedWorktree(root: string): Promise<boolean | undefined> {
  const [gitDir, commonDir] = await Promise.all([
    runGit(["rev-parse", "--absolute-git-dir"], { cwd: root }),
    runGit(["rev-parse", "--git-common-dir"], { cwd: root }),
  ]);
  const gitDirValue = gitDir.stdout.trim();
  const commonDirValue = commonDir.stdout.trim();
  if (
    !gitDir.success || !commonDir.success || gitDirValue === "" ||
    commonDirValue === ""
  ) {
    return undefined;
  }
  return gitPath(root, gitDirValue) !== gitPath(root, commonDirValue);
}

/** Explain Git's four attribute states without conflating them with values. */
function attributeValue(value: string): string {
  switch (value) {
    case "unspecified":
      return "unspecified";
    case "unset":
      return "unset (`-merge`)";
    case "set":
      return "set without a driver name (`merge`)";
    default:
      return `set to ${JSON.stringify(value)}`;
  }
}

/** One reproducible NUL-safe command for a potentially unusual path. */
function attributeRecovery(path: string): string {
  return `Correct the project-owned rule that overrides this path in a .gitattributes or Git info/attributes file, then verify it with \`printf '%s\\0' ${
    shellQuote(path)
  } | git check-attr --stdin -z merge\` and re-run \`discern doctor\``;
}

/** Verify the effective driver command and retain Git's scope/origin evidence. */
async function driverCheck(root: string): Promise<GeneratedMergeCheck> {
  const result = await runGit([
    "config",
    "--null",
    "--show-origin",
    "--show-scope",
    "--get",
    DRIVER_KEY,
  ], { cwd: root });
  const recovery =
    `run \`git config --local extensions.worktreeConfig true\`, then \`git config --worktree ${DRIVER_KEY} true\`, and re-run \`discern doctor\``;
  if (!result.success) {
    if (result.code === 1 && result.stdout === "") {
      return {
        name: "generated merge driver",
        status: "fail",
        ok: false,
        detail:
          `this linked worktree selects ${DISCERN_GENERATED_MERGE_DRIVER}, but its effective Git configuration has no ${DRIVER_KEY}; generated merges are unsafe`,
        fix: recovery,
      };
    }
    const reason = result.stderr.trim() || result.stdout.trim() ||
      `git exited with status ${result.code}`;
    return {
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail:
        `Git could not resolve ${DRIVER_KEY} in this linked worktree: ${reason}`,
      fix: recovery,
    };
  }
  const entry = parseScopedGitConfigValueZ(result.stdout);
  if (entry === undefined) {
    return {
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail:
        `Git returned malformed machine output while resolving ${DRIVER_KEY} in this linked worktree`,
      fix: recovery,
    };
  }
  const evidence = `scope ${JSON.stringify(entry.scope)}, origin ${
    JSON.stringify(entry.origin)
  }`;
  if (entry.value !== "true" || entry.scope !== "worktree") {
    return {
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail: `${DRIVER_KEY} resolves to ${
        JSON.stringify(entry.value)
      } from ${evidence}; expected worktree-local \"true\", so generated merges are unsafe`,
      fix: recovery,
    };
  }
  return {
    name: "generated merge driver",
    status: "ok",
    ok: true,
    detail:
      `${DRIVER_KEY}=true is effective in this linked worktree (${evidence})`,
  };
}

/**
 * Ask Git for the effective merge attribute of every canonical tracked output.
 * Git owns precedence; this code only supplies the canonical path population and
 * decodes the NUL protocol. The managed or project-owned rules are never read or
 * rewritten here.
 */
export async function generatedMergeChecks(
  root: string,
  groups: readonly ResolvedGeneratedGroup[],
  trackedPaths: readonly string[],
  builtInPaths: readonly string[],
): Promise<GeneratedMergeCheck[]> {
  const paths = trackedGeneratedArtifactPaths(
    groups,
    trackedPaths,
    builtInPaths,
  ).sort();
  if (paths.length === 0) return [];

  const checked = await runGit(
    ["check-attr", "--stdin", "-z", "merge"],
    { cwd: root, stdin: `${paths.join("\0")}\0` },
  );
  if (!checked.success) {
    const reason = checked.stderr.trim() || checked.stdout.trim() ||
      `git exited with status ${checked.code}`;
    return [{
      name: "generated merge attributes",
      status: "fail",
      ok: false,
      detail:
        `Git could not resolve effective merge attributes for ${paths.length} tracked generated path(s): ${reason}`,
      fix:
        "run `git check-attr --stdin -z merge` in this checkout, correct the error it reports, then re-run `discern doctor`",
    }];
  }
  const records = parseCheckAttrZ(checked.stdout);
  if (
    records === undefined || records.length !== paths.length ||
    records.some((record, index) =>
      record.path !== paths[index] || record.attribute !== "merge"
    )
  ) {
    return [{
      name: "generated merge attributes",
      status: "fail",
      ok: false,
      detail:
        "Git returned malformed or mismatched machine output while resolving generated merge attributes",
      fix:
        "run `git check-attr --stdin -z merge` in this checkout, correct the error it reports, then re-run `discern doctor`",
    }];
  }

  const findings: GeneratedMergeCheck[] = [];
  for (const record of records) {
    if (record.value === DISCERN_GENERATED_MERGE_DRIVER) continue;
    findings.push({
      name: `generated merge attribute: ${record.path}`,
      status: "fail",
      ok: false,
      detail: `tracked generated path ${
        JSON.stringify(record.path)
      } has effective merge attribute ${
        attributeValue(record.value)
      } according to Git in this checkout; generated merges are unsafe because Git will not invoke ${DISCERN_GENERATED_MERGE_DRIVER}`,
      fix: attributeRecovery(record.path),
    });
  }
  if (findings.length === 0) {
    findings.push({
      name: "generated merge attributes",
      status: "ok",
      ok: true,
      detail:
        `${paths.length} tracked generated path(s) effectively select merge=${DISCERN_GENERATED_MERGE_DRIVER} according to Git's NUL-delimited check-attr protocol`,
    });
  }

  const linked = await isLinkedWorktree(root);
  if (linked === true) findings.push(await driverCheck(root));
  if (linked === undefined) {
    findings.push({
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail:
        "Git could not determine whether this checkout is a linked worktree, so the generated merge driver configuration could not be verified",
      fix:
        "run `git rev-parse --absolute-git-dir --git-common-dir`, correct the error it reports, then re-run `discern doctor`",
    });
  }
  return findings;
}
