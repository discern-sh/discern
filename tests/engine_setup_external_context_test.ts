/**
 * Setup completion with a required context this checkout cannot validate:
 * the local gate is green, completion awaits the other context, and the marker
 * commit is kept so that context can validate exactly it. Once the evidence
 * arrives, setup done records completion without a second marker commit.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  commitSetupAuthoring,
  COUNTED_GREEN_GATE,
  readyForSetupDone,
  setupCompletionSnapshot,
} from "./fixtures/setup_completion_harness.ts";

/** Require a second execution context beside the local one. */
async function requireContexts(dir: string): Promise<void> {
  const configPath = join(dir, "discern.toml");
  const text = await Deno.readTextFile(configPath);
  const table = /^\[completion\]\n/m;
  const line = '  required_contexts = ["local", "ci"]\n';
  await Deno.writeTextFile(
    configPath,
    table.test(text)
      ? text.replace(table, `[completion]\n${line}`).replace(
        /^\s*required_contexts = \["local"\]\n/m,
        "",
      )
      : `${text.trimEnd()}\n\n[completion]\n${line}`,
  );
}

/** Count commits on the current branch. */
async function commitCount(dir: string): Promise<number> {
  return Number((await gitOut(dir, "rev-list", "--count", "HEAD")).trim());
}

Deno.test("setup done keeps its marker while an external required context validates it, then records completion on the same commit", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await requireContexts(dir);
    const formatted = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(formatted.code, 0, formatted.output);
    await commitSetupAuthoring(dir);
    const authored = await setupCompletionSnapshot(dir);
    const commitsBefore = await commitCount(dir);

    // The local gate is green; completion awaits the other context, so the
    // marker commit is kept rather than rolled back.
    const pending = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(pending.code, 1, pending.output);
    const result = decodeCliResult(pending.stdout, "setup done");
    assertEquals(result.error, "incomplete");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "contexts");
    const failure = result.data as Record<string, unknown>;
    assertEquals(failure.rollback, "retained");
    assertEquals(failure.next_action, "discern done --context ci");
    assertStringIncludes(String(failure.recovery), "exactly this commit");
    assertStringIncludes(String(failure.recovery), "discern setup done");
    assertEquals(await commitCount(dir), commitsBefore + 1);
    const marker = await gitOut(dir, "rev-parse", "HEAD");
    assert(marker !== authored.head);
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );

    // A retry before the other context validates changes nothing: same
    // marker, same route, no second marker commit.
    const again = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(again.code, 1, again.output);
    const repeated = decodeCliResult(again.stdout, "setup done");
    assertResultDataKey(repeated, "stage");
    assertEquals(repeated.data.stage, "contexts");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), marker);
    assertEquals(await commitCount(dir), commitsBefore + 1);

    // The other context validates exactly the marker commit.
    const ci = await runAgent(dir, ["done", "--context", "ci", "--json"]);
    assertEquals(ci.code, 0, ci.output);
    const complete = decodeCliResult(ci.stdout, "done");
    assert(complete.data !== undefined && "completion" in complete.data);
    assertEquals(complete.data.completion?.kind, "complete");

    // Setup completion now records against the same marker commit.
    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const recorded = decodeCliResult(done.stdout, "setup done");
    assertResultDataKey(recorded, "bootstrapped");
    assertEquals(recorded.data.gate_proven, true);
    assert(
      recorded.data.completion === "replayed" ||
        recorded.data.completion === "validated",
      recorded.data.completion,
    );
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), marker);
    assertEquals(await commitCount(dir), commitsBefore + 1);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      'setup_completion = "proven"',
    );
  });
});
