/**
 * Hermetic setup-completion fixture shared by focused transaction tests and the
 * cold-setup journey. Every command crosses the repository-source CLI process
 * boundary through `runAgent`; this helper only authors the representative
 * project and samples externally visible state between invocations.
 */

import { assertEquals } from "@std/assert";
import { isAbsolute, join, resolve } from "@std/path";
import { readTextIfExists } from "../../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../../src/shared/git_admin_state.ts";
import { SETUP_BRANCH } from "../../src/shared/setup_state.ts";
import {
  defaultMapPath,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "../engine_helpers.ts";

/** One exact externally visible setup state, suitable for before/after equality. */
export interface SetupCompletionSnapshot {
  readonly head: string;
  readonly history: string;
  readonly refs: string;
  readonly status: string;
  readonly config: string;
  readonly proof: string | undefined;
  readonly releaseCheck: string | undefined;
  readonly worktrees: string;
  readonly gateInvocations: number;
}

/** Replace setup skeletons with a small substantive project and wire one Gate job. */
export async function readyForSetupDone(
  dir: string,
  command: string,
  env: Record<string, string> = {},
): Promise<void> {
  await scaffoldEngine(dir, { bootstrapped: false });
  await gitInit(dir);
  await git(dir, "checkout", "-q", "-b", SETUP_BRANCH);
  const begun = await runAgent(dir, ["setup", "begin", "--confirmed"], {
    env,
  });
  assertEquals(begun.code, 0, begun.output);

  await Deno.remove(defaultMapPath(dir), { recursive: true });
  await Deno.mkdir(defaultMapPath(dir, "10-runtime"), { recursive: true });
  await Deno.writeTextFile(
    defaultMapPath(dir, "README.md"),
    "# Real docs\n\nThe project runs configured commands.\n\n[Runtime](10-runtime/)\n",
  );
  await Deno.writeTextFile(
    defaultMapPath(dir, "10-runtime", "README.md"),
    "# Runtime\n\n## Start here\n\nBegin at `main.ts`.\n\n" +
      "## Boundary\n\nThe runtime owns project execution.\n\n" +
      "## Non-obvious invariant\n\nPreserve the configured command's exit status.\n",
  );
  await Deno.writeTextFile(
    join(dir, "discern/instructions.md"),
    "# Project instructions\n\nA real pitch describing the project and who it serves.\n\n" +
      "## Conventions\n\nReal, project-specific conventions.\n",
  );
  const wired = await runAgent(dir, ["config", "set-job", "test", command], {
    env,
  });
  assertEquals(wired.code, 0, wired.output);
  const refreshed = await runAgent(dir, ["refresh"], { env });
  assertEquals(refreshed.code, 0, refreshed.output);
}

/** Commit all setup authoring so `setup done` reaches its final-tree transaction. */
export async function commitSetupAuthoring(dir: string): Promise<void> {
  await git(dir, "add", "-A");
  await git(
    dir,
    "commit",
    "-q",
    "-m",
    "author the setup",
    "--no-gpg-sign",
  );
}

/** A Gate command whose only side effect is a count in the repository Git admin area. */
export const COUNTED_GREEN_GATE =
  'counter="$(git rev-parse --git-common-dir)/discern/setup-gate-count"; mkdir -p "$(dirname "$counter")"; printf "run\\n" >> "$counter"';

/** Read how many times {@link COUNTED_GREEN_GATE} has run across all worktrees. */
export async function gateInvocationCount(dir: string): Promise<number> {
  const rawCommon = await gitOut(dir, "rev-parse", "--git-common-dir");
  const common = isAbsolute(rawCommon) ? rawCommon : resolve(dir, rawCommon);
  const text = await readTextIfExists(
    join(common, "discern", "setup-gate-count"),
  );
  return text === undefined ? 0 : text.split("\n").filter(Boolean).length;
}

/** Sample the exact state a completion replay or rollback is allowed to preserve. */
export async function setupCompletionSnapshot(
  dir: string,
): Promise<SetupCompletionSnapshot> {
  const proofPath = await gitAdminStatePath(dir, "gateProof");
  const releasePath = await gitAdminStatePath(dir, "releaseCheck");
  return {
    head: await gitOut(dir, "rev-parse", "HEAD"),
    history: await gitOut(dir, "log", "--format=%H%x00%P%x00%s"),
    refs: await gitOut(
      dir,
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads",
    ),
    status: await gitOut(dir, "status", "--porcelain=v1", "-z"),
    config: await Deno.readTextFile(join(dir, "discern.toml")),
    releaseCheck: releasePath === undefined ? undefined : await readTextIfExists(releasePath),
    proof: proofPath === undefined
      ? undefined
      : await readTextIfExists(proofPath),
    worktrees: await gitOut(dir, "worktree", "list", "--porcelain"),
    gateInvocations: await gateInvocationCount(dir),
  };
}
