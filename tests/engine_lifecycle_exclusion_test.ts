/** Slow lifecycle work retains its own subject while sibling publications proceed. */
import { assert, assertEquals } from "@std/assert";
import { project } from "./completion_public_fixture.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { addWorktree, git, runAgent } from "./engine_helpers.ts";
import { shellBarrier } from "./shell_barrier.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";

for (const mode of ["start", "drop", "park", "prune"] as const) {
  Deno.test(`lifecycle ${mode} preserves ownership without starving a sibling`, async () => {
    await withTempDir(async (root) =>
      await withTempDir(async (scratch) => {
        using barrier = await shellBarrier(`${scratch}/release`);
        const script = `${scratch}/pause.sh`;
        await Deno.writeTextFile(
          script,
          `#!/bin/sh\ncase "$1" in\n *ownedstart*|*ownedremove*) printf '%s' \"$1\" > '${scratch}/started'; ${barrier.wait} ;;\nesac\n`,
        );
        const command = mode === "start"
          ? `sh ${script} "$PWD"`
          : `sh ${script} @worktree@`;
        const extra = mode === "start"
          ? `[worktree.setup]\nsteps = [${JSON.stringify(command)}]\n`
          : `[worktree.resources.state]\ncreate = "true"\ndestroy = ${
            JSON.stringify(command)
          }\n`;
        const sibling = await project(
          root,
          extra,
          "printf 'DISCERN_METRIC coverage 93\\n'",
        );
        let ownedTarget: string | undefined;
        if (mode !== "start") {
          const target = await addWorktree(root, "ownedremove");
          ownedTarget = target;
          const setup = await runAgent(target, ["worktree", "setup", "--json"]);
          assertEquals(setup.code, 0, setup.output);
          await git(target, "add", "-A");
          await git(
            target,
            "commit",
            "--allow-empty",
            "-m",
            "Record fixture provisioning",
          );
          if (mode === "prune") {
            await git(root, "worktree", "remove", "--force", target);
          }
        }
        const args = mode === "start"
          ? ["start", "--name", "ownedstart", "--json"]
          : mode === "prune"
          ? ["worktree", "prune", "--yes", "--json"]
          : [
            "worktree",
            mode,
            "ownedremove",
            ...(mode === "drop" ? ["--force"] : []),
            "--json",
          ];
        const holder = runAgent(root, args);
        try {
          await waitForPendingCondition(
            holder,
            () => pathExists(`${scratch}/started`),
            "lifecycle command to enter",
            { settledError: (value) => new Error(value.output) },
          );
          const completed = await runAgent(sibling, ["done", "--json"]);
          assertEquals(completed.code, 0, completed.output);
          const progress = await operationProgressResult(root);
          assert(progress.ok, JSON.stringify(progress));
          assertEquals(progress.data?.progress?.state, "worktree-command");
          assertEquals(
            progress.data?.operation.verb,
            mode === "start" ? "start" : `worktree ${mode}`,
          );
          if (mode !== "prune") {
            const target = ownedTarget ??
              await Deno.readTextFile(`${scratch}/started`);
            const writer = await runAgent(target, ["refresh", "--json"]);
            assertEquals(writer.code, 1, writer.output);
            assertTerminalTextIncludes(writer.output, "checkout boundary");
            assertTerminalTextIncludes(
              writer.output,
              progress.data?.handle ?? "missing holder handle",
            );
          }
          const competing = await runAgent(root, args);
          assertEquals(competing.code, 1, competing.output);
          assertTerminalTextIncludes(competing.output, "lifecycle boundary");
          assertTerminalTextIncludes(
            competing.output,
            progress.data?.handle ?? "missing holder handle",
          );
        } finally {
          await barrier.release();
          const finished = await holder;
          assertEquals(finished.code, 0, finished.output);
        }
      })
    );
  });
}
