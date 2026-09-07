/** Public recovery returns ownership without rerunning successful producers or rewriting evidence. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  observedRecords,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";
import { recoverCompletionResult } from "../src/engine/execution/public_recovery.ts";

Deno.test("public recovery preserves unexpected ignored artifacts and reuses passing evidence after owner reconciliation", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
reusable = true
resources = []
capacity = 1
prepare = 'true'
restore = 'true'
inputs = ['**']
ignored = ['executions']
`,
      "mkdir -p .scratch; printf preserve > .scratch/probe; printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'",
    );
    await Deno.writeTextFile(
      join(path, ".gitignore"),
      (await Deno.readTextFile(join(path, ".gitignore"))) + "\n.scratch/\n",
    );
    await git(path, "add", ".gitignore");
    await git(path, "commit", "-m", "Declare ignored probe");
    const stopped = await runAgent(path, ["done", "--json"]);
    assertTerminalTextIncludes(
      stopped.output,
      "Ignored state outside the declaration changed",
    );
    const records = observedRecords(await observeCompletionRecords(path));
    const environment = records.find((record) =>
      record.kind === "environment" && record.data.state.kind === "recovery"
    );
    assert(environment?.kind === "environment", stopped.output);
    const evidence = records.filter((record) => record.kind === "evidence");
    assert(evidence.length > 0);
    const preview = await recoverCompletionResult(path, environment.id, true);
    assert(preview.ok, JSON.stringify(preview));
    assertEquals(
      (await requireEnvironment(path, environment.id)).record,
      environment,
    );
    const blocked = await recoverCompletionResult(path, environment.id);
    assert(!blocked.ok);
    assertStringIncludes(
      blocked.message ?? "",
      "Ignored state outside the declaration",
    );
    assertEquals(
      await Deno.readTextFile(join(path, ".scratch/probe")),
      "preserve",
    );
    // The owner preserves the artifact outside the checkout before reconciling drift.
    await Deno.copyFile(
      join(path, ".scratch/probe"),
      join(root, "preserved-probe"),
    );
    await Deno.remove(join(path, ".scratch/probe"));
    const interrupted = await recoverCompletionResult(
      path,
      environment.id,
      false,
      {
        afterReturn: () => {
          throw new Error("stop after durable checkout return");
        },
      },
    );
    assert(!interrupted.ok);
    assertEquals(
      (await requireEnvironment(path, environment.id)).record.data.state.kind,
      "idle",
    );
    const recovered = await runAgent(path, [
      "done",
      "--recover",
      environment.id,
      "--json",
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    assertTerminalTextIncludes(
      recovered.output,
      "Authoring control has returned",
    );
    const returned = await requireEnvironment(path, environment.id);
    assertEquals(returned.record.data.state.kind, "idle");
    assertEquals(returned.record.data.release.kind, "held");
    const queue = await requireQueue(path);
    assert(
      queue.record.data.entries.every((entry) => entry.state !== "active"),
    );
    const repeat = await recoverCompletionResult(path, environment.id);
    assert(repeat.ok, JSON.stringify(repeat));
    assertEquals(
      (await requireEnvironment(path, environment.id)).stamp,
      returned.stamp,
    );
    assertEquals((await requireQueue(path)).stamp, queue.stamp);
    assertEquals(
      observedRecords(await observeCompletionRecords(path)).filter((record) =>
        record.kind === "evidence"
      ),
      evidence,
    );
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(done.output, '"proof"');
    assertEquals(await Deno.readTextFile(join(path, "executions")), "t");
    assertEquals(
      await Deno.readTextFile(join(root, "preserved-probe")),
      "preserve",
    );
  });
});

Deno.test("ordinary source-tip completion preserves an ignored nested repository created by its producer", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      "",
      "git init -q cache/package; printf package > cache/package/content; printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'",
    );
    await Deno.writeTextFile(
      join(path, ".gitignore"),
      (await Deno.readTextFile(join(path, ".gitignore"))) + "\ncache/\n",
    );
    await git(path, "add", ".gitignore");
    await git(path, "commit", "-m", "Declare package cache");
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(done.output, '"proof"');
    assert((await Deno.lstat(join(path, "cache/package/.git"))).isDirectory);
    assertEquals(
      await Deno.readTextFile(join(path, "cache/package/content")),
      "package",
    );
    const accepted = await runAgent(path, ["accept", "--confirmed", "--json"]);
    assertTerminalTextIncludes(accepted.output, "nested repository");
    assert((await Deno.lstat(join(path, "cache/package/.git"))).isDirectory);
    assertEquals(
      await Deno.readTextFile(join(path, "cache/package/content")),
      "package",
    );
  });
});
