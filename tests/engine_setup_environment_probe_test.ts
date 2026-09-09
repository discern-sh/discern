/**
 * S02 through the public command: `discern setup done` proves a declared
 * environment in its throwaway worktree before completing, reports what it
 * established, and refuses completion when the declared restore leaves the
 * copy different from its source.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  commitSetupAuthoring,
  COUNTED_GREEN_GATE,
  readyForSetupDone,
  setupCompletionSnapshot,
} from "./fixtures/setup_completion_harness.ts";

/** Declare a borrowed environment whose prepare writes ignored output beside a tracked manifest. */
async function declareEnvironment(dir: string, restore: string): Promise<void> {
  const configPath = join(dir, "discern.toml");
  const text = await Deno.readTextFile(configPath);
  const stripped = text.replace(
    /\n\[execution\.local\][\s\S]*?(?=\n\[|\n*$)/,
    "",
  );
  await Deno.writeTextFile(
    configPath,
    `${stripped.trimEnd()}

[execution.local]
  kind = "borrowed"
  prepare = "cat build/manifest.txt > build/output.bin"
  restore = ${JSON.stringify(restore)}
  reusable = true
  resources = []
  ignored = ["build/output.bin"]
  inputs = ["**"]
  capacity = 1
`,
  );
  await Deno.mkdir(join(dir, "build"), { recursive: true });
  await Deno.writeTextFile(join(dir, "build", "manifest.txt"), "v1\n");
  const ignore = join(dir, ".gitignore");
  const current = await Deno.readTextFile(ignore);
  if (!current.includes("build/output.bin")) {
    await Deno.writeTextFile(
      ignore,
      `${current.trimEnd()}\nbuild/output.bin\n`,
    );
  }
}

Deno.test("setup done proves a declared environment in the throwaway worktree, then refuses a declaration whose restore leaves output behind", async (t) => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await declareEnvironment(dir, "rm -f build/output.bin");
    const formatted = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(formatted.code, 0, formatted.output);
    await commitSetupAuthoring(dir);

    await t.step(
      "a proven declaration is reported with the contexts it covers",
      async () => {
        const done = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(done.code, 0, done.output);
        const result = decodeCliResult(done.stdout, "setup done");
        assertResultDataKey(result, "bootstrapped");
        assertEquals(result.data.completion, "created");
        assertEquals(result.data.environment_probe, {
          proven: ["local"],
          undeclared: [],
          isolated: [],
        });
        assertStringIncludes(
          result.data.instructions,
          "returned a throwaway copy to its exact source after a passing, a failing, and a cancelled validation",
        );
        // The probe worktree is gone and the setup checkout is untouched.
        assertEquals(
          (await gitOut(dir, "worktree", "list", "--porcelain")).split("\n\n")
            .filter(Boolean).length,
          1,
        );
        assertEquals(await gitOut(dir, "status", "--porcelain"), "");
        // A replay repeats the same facts without running the probe again.
        const replay = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(replay.code, 0, replay.output);
        const replayed = decodeCliResult(replay.stdout, "setup done");
        assertResultDataKey(replayed, "bootstrapped");
        assertEquals(replayed.data.completion, "replayed");
        assertEquals(replayed.data.environment_probe, undefined);
      },
    );

    await t.step(
      "a restore that leaves declared output behind fails the environment stage and rolls the marker back",
      async () => {
        await declareEnvironment(dir, "true");
        // Unrecord completion so setup done runs the full final-tree transaction.
        const configPath = join(dir, "discern.toml");
        await Deno.writeTextFile(
          configPath,
          (await Deno.readTextFile(configPath))
            .replace(/^\s*bootstrapped = true\n/m, "  bootstrapped = false\n")
            .replace(/^\s*setup_completion = "proven"\n/m, ""),
        );
        const formatted = await runAgent(dir, ["prepare", "--json"]);
        assertEquals(formatted.code, 0, formatted.output);
        await git(dir, "add", "-A");
        await git(
          dir,
          "commit",
          "-q",
          "-m",
          "Break the declared restore",
          "--no-gpg-sign",
        );
        const before = await setupCompletionSnapshot(dir);

        const failed = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(failed.code, 1, failed.output);
        const result = decodeCliResult(failed.stdout, "setup done");
        assertEquals(result.error, "gate_failed");
        assertResultDataKey(result, "stage");
        assertEquals(result.data.stage, "environment_probe");
        const failure = result.data as Record<string, unknown>;
        assertEquals(failure.rollback, "owned_commit_removed");
        assertStringIncludes(result.message ?? "", "build/output.bin (new)");
        assertStringIncludes(
          String(failure.recovery),
          "[execution.<context>]",
        );
        assertStringIncludes(String(failure.recovery), "lookahead = 0");
        const after = await setupCompletionSnapshot(dir);
        assertEquals(after.head, before.head);
        assertEquals(after.history, before.history);
        assertEquals(after.status, before.status);
        assertEquals(after.worktrees, before.worktrees);
        assert(
          !after.config.includes("bootstrapped = true"),
          "a refused environment probe must not record completion",
        );
      },
    );

    await t.step(
      "a restore that fails keeps the probe copy with its recovery and routes to the command that returns it",
      async () => {
        const repair = join(dir, "..", "probe-restore.sh");
        await Deno.writeTextFile(repair, "exit 1\n");
        await declareEnvironment(dir, `sh ${repair}`);
        const formatted = await runAgent(dir, ["prepare", "--json"]);
        assertEquals(formatted.code, 0, formatted.output);
        await git(dir, "add", "-A");
        await git(
          dir,
          "commit",
          "-q",
          "-m",
          "Declare a restore that cannot run",
          "--no-gpg-sign",
        );
        const before = await setupCompletionSnapshot(dir);

        const failed = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(failed.code, 1, failed.output);
        const result = decodeCliResult(failed.stdout, "setup done");
        assertResultDataKey(result, "stage");
        assertEquals(result.data.stage, "environment_probe");
        const failure = result.data as Record<string, unknown>;
        assertEquals(failure.rollback, "owned_commit_removed");
        assertStringIncludes(
          String(failure.next_action),
          "discern done --recover ",
        );
        assertStringIncludes(String(failure.recovery), "was kept");
        assertStringIncludes(String(failure.recovery), "discern worktree drop");
        // The probe copy is retained beside the setup checkout; the setup
        // branch itself is back at its predecessor.
        const worktrees = (await gitOut(dir, "worktree", "list", "--porcelain"))
          .split("\n\n").filter(Boolean);
        assertEquals(worktrees.length, 2, worktrees.join("\n"));
        const own = await Deno.realPath(dir);
        const retained = worktrees.map((block) =>
          block.split("\n")[0]?.replace("worktree ", "") ?? ""
        ).find((path) => path !== "" && path !== own);
        assert(retained !== undefined);
        assertStringIncludes(String(failure.recovery), retained);
        const after = await setupCompletionSnapshot(dir);
        assertEquals(after.head, before.head);
        assertEquals(after.status, before.status);
        assert(!after.config.includes("bootstrapped = true"));

        // Once the frozen restore can run, the named command returns the copy,
        // and the copy can be discarded; nothing else changed.
        await Deno.writeTextFile(repair, "rm -f build/output.bin\n");
        const recoverCommand = String(failure.next_action).split(" ");
        const recovered = await runAgent(retained, [
          ...recoverCommand.slice(1),
          "--json",
        ]);
        assertEquals(recovered.code, 0, recovered.output);
        const dropped = await runAgent(dir, [
          "worktree",
          "drop",
          "--force",
          retained,
          "--json",
        ]);
        assertEquals(dropped.code, 0, dropped.output);
        assertEquals(
          (await gitOut(dir, "worktree", "list", "--porcelain")).split("\n\n")
            .filter(Boolean).length,
          1,
        );
        assertEquals(await gitOut(dir, "status", "--porcelain"), "");
        assertEquals((await setupCompletionSnapshot(dir)).head, before.head);
      },
    );
  });
});
