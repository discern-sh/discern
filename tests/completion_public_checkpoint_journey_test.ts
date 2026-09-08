/** Source questions are served before completion acquires execution. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";

Deno.test("public source checkpoint stops before environment enrollment or candidate execution", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
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
      observedRecords(await observeQueue(root, "main")).filter((record) =>
        record.kind === "environment" || record.kind === "attempt" ||
        record.kind === "candidate" || record.kind === "evidence"
      ),
      [],
      "a known unanswered question must not acquire execution or capture a checkout",
    );
  });
});
