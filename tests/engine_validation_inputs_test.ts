/**
 * Validation inputs of any size prove; an input the gate cannot observe is
 * refused by name through the `validation_inputs` stage, never a crash report.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { writeLargeInput } from "./large_input.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { BOUNDED_CAPTURE_BYTES } from "../src/shared/bounded_file.ts";
import { GATE_FAILURE_REMEDIES } from "../src/shared/hints.ts";
import { readDirIfExists } from "../src/shared/fs_presence.ts";
import { VALIDATION_INPUTS_TOOL } from "../src/engine/validation/input_identity.ts";

/** Crash report names under the repository that owns `root`; empty means none was written. */
async function crashReports(root: string): Promise<string[]> {
  const entries = await readDirIfExists(join(root, ".git", "discern", "crash"));
  return (entries ?? []).map((entry) => entry.name);
}

Deno.test("done proves a committed tree holding an input above the bounded-capture ceiling", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    await writeLargeInput(join(path, "large"), BOUNDED_CAPTURE_BYTES + 1);
    await git(path, "add", "large");
    await git(path, "commit", "-m", "Track a large input");
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(decodeCliResult(done.stdout, "done").ok, true);
    assertEquals(await crashReports(root), []);
  });
});

Deno.test("done and test refuse an unobservable input by name instead of crashing", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    // A registered nested repository is a tracked boundary the default `**`
    // closure selects, and it leaves the tree clean for the full gate.
    await git(
      path,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${await gitOut(path, "rev-parse", "HEAD")},module`,
    );
    const moduleHead = await gitOut(path, "rev-parse", "HEAD");
    await git(path, "commit", "-m", "Register module");
    await git(
      path,
      "clone",
      "--quiet",
      "--no-checkout",
      path,
      `${path}/module`,
    );
    await git(`${path}/module`, "checkout", "--quiet", moduleHead);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const doneEnvelope = decodeCliResult(done.stdout, "done");
    assertEquals(doneEnvelope.ok, false);
    assertResultDataKey(doneEnvelope, "failed_stage");
    assertEquals(doneEnvelope.data.failed_stage, "validation_inputs");
    const test = await runAgent(path, ["test", "--json"]);
    assertEquals(test.code, 1, test.output);
    const testEnvelope = decodeCliResult(test.stdout, "test");
    assertEquals(testEnvelope.ok, false);
    for (const envelope of [doneEnvelope, testEnvelope]) {
      const diagnostic = envelope.diagnostics?.find((entry) =>
        entry.tool === VALIDATION_INPUTS_TOOL
      );
      assert(diagnostic !== undefined, JSON.stringify(envelope));
      assertEquals(diagnostic.file, "module");
      assertStringIncludes(diagnostic.message, '"module"');
      assertStringIncludes(diagnostic.message, "nested repository");
      assertHasHint(envelope, GATE_FAILURE_REMEDIES.validation_inputs);
    }
    assertEquals(await crashReports(root), []);
  });
});
