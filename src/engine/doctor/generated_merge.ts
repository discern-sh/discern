/** Git-authoritative generated-merge diagnostics for `discern doctor`. */

import { isAbsolute, join, resolve } from "@std/path";
import {
  DISCERN_GENERATED_MERGE_DRIVER,
} from "../../lib/agent_gitattributes.ts";
import {
  GENERATED_MERGE_DRIVER_KEY,
  GENERATED_MERGE_DRIVER_VALUE,
} from "../generated_merge_driver.ts";
import {
  type ResolvedGeneratedGroup,
  trackedGeneratedArtifactPaths,
} from "../../shared/generated_artifacts.ts";
import {
  parseCheckAttrZ,
  parseScopedGitConfigValueZ,
} from "../../shared/git_paths.ts";
import { runGit } from "../../shared/subprocess.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";

/** One doctor-compatible finding; doctor normalizes the compatibility fields. */
export interface GeneratedMergeCheck {
  readonly name: string;
  readonly status: "ok" | "fail";
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

/** Quote one path for the POSIX recovery command without losing newlines. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Resolve a path emitted relative to Git's command working directory. */
function gitPath(root: string, value: string): string {
  return resolve(isAbsolute(value) ? value : resolve(root, value));
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
  const commonDir = await resolveCommonGitDir(root);
  if (commonDir === undefined) {
    return {
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail:
        "Git could not resolve the clone-local configuration, so the generated merge driver could not be verified",
      fix:
        "run `git rev-parse --git-common-dir`, correct the error it reports, then re-run `discern doctor`",
    };
  }
  const commonConfig = join(commonDir, "config");
  const result = await runGit([
    "config",
    "--null",
    "--show-origin",
    "--show-scope",
    "--get",
    GENERATED_MERGE_DRIVER_KEY,
  ], { cwd: root });
  const recovery = `run \`git config --file ${
    shellQuote(commonConfig)
  } ${GENERATED_MERGE_DRIVER_KEY} ${GENERATED_MERGE_DRIVER_VALUE}\`, then re-run \`discern doctor\``;
  if (!result.success) {
    if (result.code === 1 && result.stdout === "") {
      return {
        name: "generated merge driver",
        status: "fail",
        ok: false,
        detail:
          `this checkout selects ${DISCERN_GENERATED_MERGE_DRIVER}, but its effective Git configuration has no ${GENERATED_MERGE_DRIVER_KEY}; generated merges are unsafe`,
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
        `Git could not resolve ${GENERATED_MERGE_DRIVER_KEY} in this checkout: ${reason}`,
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
        `Git returned malformed machine output while resolving ${GENERATED_MERGE_DRIVER_KEY} in this checkout`,
      fix: recovery,
    };
  }
  const evidence = `scope ${JSON.stringify(entry.scope)}, origin ${
    JSON.stringify(entry.origin)
  }`;
  const originPath = entry.origin.startsWith("file:")
    ? gitPath(root, entry.origin.slice("file:".length))
    : undefined;
  if (
    entry.value !== GENERATED_MERGE_DRIVER_VALUE || entry.scope !== "local" ||
    originPath !== commonConfig
  ) {
    return {
      name: "generated merge driver",
      status: "fail",
      ok: false,
      detail: `${GENERATED_MERGE_DRIVER_KEY} resolves to ${
        JSON.stringify(entry.value)
      } from ${evidence}; expected clone-local ${
        JSON.stringify(GENERATED_MERGE_DRIVER_VALUE)
      } from ${JSON.stringify(commonConfig)}, so generated merges are unsafe`,
      fix: recovery,
    };
  }
  return {
    name: "generated merge driver",
    status: "ok",
    ok: true,
    detail:
      `${GENERATED_MERGE_DRIVER_KEY}=${GENERATED_MERGE_DRIVER_VALUE} is effective from the clone-local shared configuration (${evidence})`,
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

  findings.push(await driverCheck(root));
  return findings;
}
