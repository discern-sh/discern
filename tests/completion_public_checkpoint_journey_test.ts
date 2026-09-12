/** Source questions are served before completion acquires execution. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";

/** Project recorded readings onto validated envelopes. */
async function observedRecords(root: string): Promise<CompletionRecord[]> {
  return (await observeCompletionRecords(root)).records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
}

Deno.test("public source checkpoint stops before environment enrollment or candidate execution", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      `
[checkpoints.review]
paths = ['source']
question = 'Does this source meet its requirement?'
`,
    );
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assertEquals(result.error, "awaiting_declaration");
    assert(result.message?.includes("Does this source meet its requirement?"));
    assertEquals(
      (await observedRecords(root)).filter((record) =>
        record.kind === "attempt" ||
        record.kind === "candidate" || record.kind === "evidence"
      ),
      [],
      "a known unanswered question must not reserve an attempt or record evidence",
    );
  });
});
