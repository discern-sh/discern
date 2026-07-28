/**
 * The single source of truth for discern-authored commit sites (ADR 0203) and the only
 * production boundary allowed to invoke `git commit` for them.
 *
 * Callers still own their surrounding workflow: they stage their scoped paths,
 * decide whether a failure is fatal, and perform any rollback. This boundary
 * owns the commit message, attribution, and declared-scope invocation. Most
 * callers use Git pathspecs; a caller with independently proven staged bytes
 * can require an exact staged path set and commit the index as-is.
 */

import { DISCERN_BOT } from "./brand.ts";
import { discernCommitAttributionEnabled, type EnvReader } from "./env.ts";
import { splitNulRecords } from "./git_paths.ts";
import {
  describeSpawnError,
  gitBin,
  type GitResult,
  runGit,
  SPAWN_FAILED,
} from "./subprocess.ts";

export interface DiscernAuthoredCommitSiteDefinition {
  readonly id: string;
  /** Shipped module allowed to import the commit capability for this site. */
  readonly callerModule: `src/${string}.ts`;
}

/** Every workflow whose diff discern itself composes and commits. */
export const DISCERN_AUTHORED_COMMIT_SITES = {
  scaffoldWiring: {
    id: "scaffold-wiring",
    callerModule: "src/commands/setup.ts",
  },
  setupCompletion: {
    id: "setup-completion",
    callerModule: "src/commands/setup.ts",
  },
  standardsPin: {
    id: "standards-pin",
    callerModule: "src/engine/gate/standards.ts",
  },
} as const satisfies Readonly<
  Record<string, DiscernAuthoredCommitSiteDefinition>
>;

export type DiscernAuthoredCommitSite = typeof DISCERN_AUTHORED_COMMIT_SITES[
  keyof typeof DISCERN_AUTHORED_COMMIT_SITES
];

export interface DiscernStagedCommitProof {
  /** Branch whose ref the commit may advance. */
  readonly branch: string;
  /** HEAD before the commit, or null for an unborn branch. */
  readonly head: string | null;
  /** The only tree the resulting commit may contain. */
  readonly tree: string;
}

interface DiscernCommitBaseOptions {
  /** Canonical workflow identity; its registry entry also enrolls the caller. */
  readonly site: DiscernAuthoredCommitSite;
  readonly cwd: string;
  readonly subject: string;
  readonly body?: string;
  /**
   * The exact paths this commit may carry. Empty pathspecs are refused. With
   * `source: "staged-index"`, these paths are an exact staged-set assertion and
   * are deliberately not passed to `git commit`.
   */
  readonly pathspecs: readonly string[];
  /** Injectable environment read for parallel-safe attribution tests. */
  readonly env?: EnvReader;
}

const authoredCommitSites = new Set<DiscernAuthoredCommitSite>(
  Object.values(DISCERN_AUTHORED_COMMIT_SITES),
);

export type DiscernCommitOptions =
  | DiscernCommitBaseOptions & {
    /** The established pathspec-scoped Git invocation. */
    readonly source?: "worktree-pathspecs";
    readonly stagedProof?: never;
  }
  | DiscernCommitBaseOptions & {
    /**
     * Commit the already-proven index bytes. The helper verifies the staged
     * names before Git runs and the resulting commit tree after hooks run.
     */
    readonly source: "staged-index";
    readonly stagedProof: DiscernStagedCommitProof;
  };

function refusedCommit(
  site: DiscernAuthoredCommitSite,
  reason: string,
): GitResult {
  return {
    success: false,
    code: 2,
    stdout: "",
    stderr: `discern-authored commit site '${site.id}' ${reason}`,
  };
}

async function gitValue(
  cwd: string,
  args: string[],
): Promise<string | undefined> {
  const result = await runGit(args, { cwd });
  const value = result.stdout.trim();
  return result.success && value !== "" ? value : undefined;
}

async function headValue(cwd: string): Promise<string | null | undefined> {
  const result = await runGit(["rev-parse", "--verify", "-q", "HEAD"], {
    cwd,
  });
  if (result.success) {
    const value = result.stdout.trim();
    return value === "" ? undefined : value;
  }
  return result.code === 1 ? null : undefined;
}

async function rollbackUnexpectedCommit(
  cwd: string,
  proof: DiscernStagedCommitProof,
  committedHead: string,
): Promise<GitResult> {
  const ref = `refs/heads/${proof.branch}`;
  return proof.head === null
    ? await runGit(["update-ref", "-d", ref, committedHead], { cwd })
    : await runGit(["update-ref", ref, proof.head, committedHead], { cwd });
}

/** Render subject, optional body, and the default-on co-author trailer. */
export function discernCommitMessage(
  subject: string,
  body: string | undefined,
  env: EnvReader = Deno.env,
): string {
  const paragraphs = [subject];
  if (body !== undefined && body !== "") {
    paragraphs.push(body);
  }
  if (discernCommitAttributionEnabled(env)) {
    paragraphs.push(DISCERN_BOT.trailer);
  }
  return paragraphs.join("\n\n");
}

/** Commit one discern-composed diff without changing author or committer identity. */
export async function commitDiscernChanges(
  options: DiscernCommitOptions,
): Promise<GitResult> {
  if (!authoredCommitSites.has(options.site)) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: "The discern-authored commit site is not registered in " +
        "DISCERN_AUTHORED_COMMIT_SITES.",
    };
  }
  if (options.pathspecs.length === 0) {
    return refusedCommit(
      options.site,
      "has no pathspecs; refusing an unscoped commit",
    );
  }
  const message = discernCommitMessage(
    options.subject,
    options.body,
    options.env,
  );
  if (options.source === "staged-index") {
    const staged = await runGit(
      ["diff", "--cached", "--name-only", "--no-renames", "-z", "--"],
      { cwd: options.cwd },
    );
    if (!staged.success) {
      return staged;
    }
    const expected = [...options.pathspecs].sort();
    const actual = splitNulRecords(staged.stdout).sort();
    if (
      new Set(expected).size !== expected.length ||
      expected.length !== actual.length ||
      expected.some((path, index) => path !== actual[index])
    ) {
      return refusedCommit(
        options.site,
        "staged paths do not match its proven scope; refusing the commit",
      );
    }
    const [branch, head, tree] = await Promise.all([
      gitValue(options.cwd, ["branch", "--show-current"]),
      headValue(options.cwd),
      gitValue(options.cwd, ["write-tree"]),
    ]);
    if (
      branch !== options.stagedProof.branch ||
      head !== options.stagedProof.head ||
      tree !== options.stagedProof.tree
    ) {
      return refusedCommit(
        options.site,
        "staged proof changed before Git ran; refusing the commit",
      );
    }
  }
  const args = ["commit", "-m", message];
  if (options.source !== "staged-index") {
    args.push("--", ...options.pathspecs);
  }
  const bin = gitBin();
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command(bin, {
      args,
      cwd: options.cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    return {
      success: false,
      code: SPAWN_FAILED,
      stdout: "",
      stderr: describeSpawnError(error, bin),
    };
  }
  const decoder = new TextDecoder();
  const commit: GitResult = {
    success: output.success,
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
  if (!commit.success || options.source !== "staged-index") {
    return commit;
  }

  const [committedHead, committedBranch] = await Promise.all([
    headValue(options.cwd),
    gitValue(options.cwd, ["branch", "--show-current"]),
  ]);
  const committedTree = typeof committedHead === "string"
    ? await gitValue(options.cwd, [
      "rev-parse",
      "--verify",
      `${committedHead}^{tree}`,
    ])
    : undefined;
  if (
    typeof committedHead === "string" &&
    committedBranch === options.stagedProof.branch &&
    committedTree === options.stagedProof.tree
  ) {
    return commit;
  }
  if (typeof committedHead !== "string") {
    return refusedCommit(
      options.site,
      "could not verify the commit Git reported as successful",
    );
  }

  const rollback = await rollbackUnexpectedCommit(
    options.cwd,
    options.stagedProof,
    committedHead,
  );
  if (!rollback.success) {
    return {
      success: false,
      code: rollback.code,
      stdout: commit.stdout,
      stderr:
        `discern-authored commit site '${options.site.id}' produced a tree outside its proven scope, and Git could not roll it back: ${rollback.stderr.trim()}`,
    };
  }
  return {
    success: false,
    code: 2,
    stdout: commit.stdout,
    stderr:
      `discern-authored commit site '${options.site.id}' produced a tree outside its proven scope; the commit was rolled back with its index and worktree changes preserved`,
  };
}
