/**
 * A declared `[completion].lookahead` that cannot take effect is named on
 * the daily surfaces, status and a green done, until the declaration is
 * proven; a proven declaration or a lookahead of 0 says nothing.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { recordEnvironmentProof } from "../src/engine/execution/probe_record.ts";
import { declarationIdentity } from "../src/engine/execution/subjects.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";

const declaration = `
[execution.local]
kind = 'borrowed'
capacity = 2
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

const NOTICE_LEAD = "Early checking is off:";

/** The rendered notice a command carries, or undefined when it says nothing. */
async function noticeIn(
  path: string,
  args: string[],
): Promise<string | undefined> {
  const run = await runAgent(path, [...args, "--json"]);
  assertEquals(run.code, 0, run.output);
  const result = decodeCliResult(
    run.stdout,
    args[0] === "status" ? "status" : "done",
  );
  // The wire carries texts; the notice is known by its opening words.
  return result.hints?.find((text) => text.startsWith(NOTICE_LEAD));
}

Deno.test("status and a green done name early checking that cannot run, until the declaration is proven", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      declaration,
      "printf 'DISCERN_METRIC coverage 93\\n'",
      ["**"],
      { concurrency: 2, lookahead: 1 },
    );
    const fromStatus = await noticeIn(path, ["status"]);
    assert(fromStatus !== undefined, "status carries the notice");
    assertStringIncludes(fromStatus, "Early checking is off");
    assertStringIncludes(fromStatus, "`local`");
    assertStringIncludes(fromStatus, "discern setup done");
    const fromDone = await noticeIn(path, ["done"]);
    assert(fromDone !== undefined, "a green done carries the notice");
    const config = await loadConfig(root);
    const local = config.execution["local"];
    assert(local !== undefined);
    await recordEnvironmentProof(root, {
      context: "local",
      declaration: await declarationIdentity(local),
      proven_at: SYSTEM_CLOCK.wallNow(),
      source: {
        branch: "refs/heads/main",
        head: await gitOut(root, "rev-parse", "HEAD"),
      },
      exercised: ["success", "failure", "cancellation"],
    });
    assertEquals(await noticeIn(path, ["status"]), undefined);
  });
});

Deno.test("a lookahead of 0 asks for nothing, so nothing is said", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    assertEquals(await noticeIn(path, ["status"]), undefined);
  });
});
