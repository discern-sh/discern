/**
 * Fixture convergence for `done` journeys. A scaffold that has never been
 * refreshed carries none of the materialized artifacts a real project has once
 * setup completes, and the gate's currency preconditions pay for that absence
 * on every run: an un-refreshed scaffold's `done` costs several times a
 * refreshed one's. Journeys that assert gate behaviour — strand attribution,
 * timeouts, diagnostics, Proof reuse — converge their scaffold here first, the
 * way `readyForSetupDone` and `proveSetupBranchForAcceptance` already do, so
 * each run pays only for the behaviour under test. Cases whose subject IS the
 * fresh, un-refreshed state keep their bare scaffold.
 */

import { git, gitOut, runAgent } from "./engine_helpers.ts";

/**
 * Refresh a scaffolded, git-initialized project and commit what refresh
 * materialized, so the tree is clean again and every later `done` starts
 * proof-eligible. Call it after `gitInit` and before any worktree is added or
 * any deliberate dirt is introduced.
 */
export async function refreshScaffold(dir: string): Promise<void> {
  const refreshed = await runAgent(dir, ["refresh", "--json"]);
  if (refreshed.code !== 0) {
    throw new Error(`fixture refresh failed:\n${refreshed.output}`);
  }
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Refresh the scaffold",
      "--no-gpg-sign",
    );
  }
}
