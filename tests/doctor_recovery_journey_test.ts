/**
 * S04 and 6A.2: an interrupted temporary composition leaves a stranded
 * environment. Doctor observes it read-only and names the recovery command;
 * `discern upgrade` runs without touching the recovery records; the public
 * recovery action returns the checkout once its frozen restore procedure can
 * run; doctor then reports the environment idle with every record intact.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { runChecks } from "../src/commands/doctor.ts";
import type { Check } from "../src/shared/result_schemas.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";

/** Find one named check, failing loudly when doctor omitted it. */
function named(checks: readonly Check[], name: string): Check {
  const found = checks.find((check) => check.name === name);
  assert(found !== undefined, `expected a '${name}' check`);
  return found;
}

Deno.test("doctor observes a stranded environment, upgrade preserves it, recovery returns it after repair, and doctor reports it idle", async () => {
  await withTempDir(async (base) => {
    const repair = join(base, "restore.sh");
    const root = join(base, "repo");
    await Deno.mkdir(root);
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
restore = 'sh ${repair}'
inputs = ['**']
ignored = ['executions']
`,
    );
    // Trunk moves after the effort branched, so completion must compose a
    // differing candidate in the declared environment and restore afterwards.
    await Deno.writeTextFile(join(root, "predecessor.txt"), "landed\n");
    await git(root, "add", "predecessor.txt");
    await git(root, "commit", "-m", "Move trunk");
    const stopped = await runAgent(path, ["done", "--json"]);
    assertEquals(stopped.code, 1, stopped.output);
    const records = observedRecords(await observeCompletionRecords(path));
    const environment = records.find((record) =>
      record.kind === "environment" && record.data.state.kind === "recovery"
    );
    assert(environment?.kind === "environment", stopped.output);
    const attempts = records.filter((record) => record.kind === "attempt");
    assert(attempts.length > 0);

    // Doctor reads the stranded state from the main checkout without changing it.
    const before = await runChecks(root);
    const recovery = named(before, "checkout recovery");
    assertEquals(recovery.status, "warn");
    assertStringIncludes(recovery.detail, environment.id);
    assertStringIncludes(recovery.detail, "stopped in restore");
    assertStringIncludes(recovery.fix ?? "", "discern done --recover");
    assertEquals(
      (await requireEnvironment(path, environment.id)).record,
      environment,
    );

    // Upgrade reconciles the install and leaves every recovery record alone.
    const upgraded = await runAgent(root, ["upgrade", "--json"]);
    assertEquals(upgraded.code, 0, upgraded.output);
    assertEquals(
      (await requireEnvironment(path, environment.id)).record,
      environment,
    );
    assertEquals(
      observedRecords(await observeCompletionRecords(path)).filter((record) =>
        record.kind === "attempt"
      ).map((record) => record.id).sort(),
      attempts.map((record) => record.id).sort(),
    );

    // Recovery refuses while the frozen restore procedure still cannot run.
    const refused = await runAgent(path, [
      "done",
      "--recover",
      environment.id,
      "--json",
    ]);
    assertEquals(refused.code, 1, refused.output);
    assertEquals(
      (await requireEnvironment(path, environment.id)).record.data.state.kind,
      "recovery",
    );

    // The owner repairs the procedure outside the checkout; recovery then
    // returns the checkout through the frozen contract, no config edit needed.
    await Deno.writeTextFile(repair, "exit 0\n");
    const recovered = await runAgent(path, [
      "done",
      "--recover",
      environment.id,
      "--json",
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    const returned = await requireEnvironment(path, environment.id);
    assertEquals(returned.record.data.state.kind, "idle");
    const after = await runChecks(root);
    assertEquals(named(after, "checkout recovery").status, "ok");
    assertStringIncludes(named(after, "execution leases").detail, "enrolled");
    // Recovery validated nothing and issued no Proof.
    assertEquals(
      observedRecords(await observeCompletionRecords(path)).filter((record) =>
        record.kind === "proof"
      ),
      [],
    );
  });
});
