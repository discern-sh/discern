/** CI reports compare against the fetched policy while strict completion owns predecessor selection. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";

/** Project recorded readings onto validated envelopes. */
async function observedRecords(root: string): Promise<CompletionRecord[]> {
  return (await observeCompletionRecords(root)).records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
}

Deno.test("a standalone CI report uses the pre-push policy even when current main contains the change", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const base = await gitOut(root, "rev-parse", "main");
    const config = await Deno.readTextFile(`${path}/discern.toml`);
    await Deno.writeTextFile(
      `${path}/discern.toml`,
      config.replace("limit = 90", "limit = 80"),
    );
    await git(path, "add", "discern.toml");
    await git(path, "commit", "-m", "Change held limit");
    await git(root, "merge", "--ff-only", "agent/public-done");
    const strict = await runAgent(root, [
      "done",
      "--policy-base",
      "HEAD",
      "--json",
    ]);
    assertEquals(strict.code, 1, strict.output);
    assert(strict.output.includes("invalid_arguments"), strict.output);
    // The CLI and MCP paths share one refusal naming the live comparison.
    assert(
      strict.output.includes("checks against the trunk's current tip"),
      strict.output,
    );
    const report = await runAgent(root, [
      "done",
      "--ci",
      "--standalone",
      "--policy-base",
      base,
      "--json",
    ]);
    assertEquals(report.code, 1, report.output);
    assert(report.output.includes("loosened"), report.output);
    assertEquals(
      (await observedRecords(root)).filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "candidate"
      ),
      [],
    );
  });
});

Deno.test("a complete CI report runs each declared producer and measurement without queue Proof", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const base = await gitOut(root, "rev-parse", "main");
    const result = await runAgent(path, [
      "done",
      "--ci",
      "--standalone",
      "--policy-base",
      base,
      "--json",
    ]);
    assertEquals(result.code, 0, result.output);
    assert(result.output.includes('"mode":"report"'), result.output);
    assert(result.output.includes('"name":"coverage"'), result.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    assertEquals(
      (await observedRecords(root)).filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "candidate"
      ),
      [],
    );
  });
});
