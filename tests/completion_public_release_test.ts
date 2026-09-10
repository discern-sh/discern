import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
/** Public acceptance may refresh only explicitly released source environments. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { verifyRecoveryPayload } from "../src/engine/execution/payloads.ts";
import { readEnvironmentArtifact } from "../src/engine/execution/artifact_read.ts";
import { WorkspaceStateSchema } from "../src/engine/execution/workspace_state.ts";
import { statIfExists } from "../src/shared/fs_presence.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

const declaration = `
[execution.local]
kind = 'borrowed'
capacity = 1
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

Deno.test("review feedback returns to the same effort: edit after release, revalidate, and land the revision", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"], declaration);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    // Review feedback: the same effort keeps its worktree and edits in place.
    await Deno.writeTextFile(`${path}/source`, "revised after review\n");
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Apply review feedback");
    // The stale release cannot carry the old evidence forward; the revised
    // source proves itself again through the ordinary boundary.
    const redo = await runAgent(path, ["done", "--json"]);
    assertEquals(redo.code, 0, redo.output);
    await grantEffort(
      path,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const accepted = await runAgent(path, ["accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(result.data !== undefined && "queue" in result.data);
    assertEquals(
      result.data.queue?.map((row) => [row.state, row.retirement]),
      [["landed", "retired"]],
    );
    assertEquals(
      await Deno.readTextFile(`${root}/source`),
      "revised after review\n",
    );
    assert(
      result.message?.startsWith(
        "Selected effort `agent/public-done`: landed. Its checkout was removed.",
      ),
      result.message,
    );
  });
});

for (const retained of [false, true]) {
  Deno.test(`fresh accept ${retained ? "preserves a retained checkout" : "refreshes a released candidate"} after trunk moves`, async () => {
    await withTempDir(async (root) => {
      const path = await project(root, ["local"], declaration);
      const done = await runAgent(path, [
        "done",
        "--json",
        ...(retained ? ["--retain-checkout"] : []),
      ]);
      assertEquals(done.code, 0, done.output);
      // Native status may refresh the index cache without changing any checkout data.
      await Deno.utime(`${path}/source`, 1234567890, 1234567890);
      assertEquals(await gitOut(path, "status", "--porcelain"), "");
      const original = await gitOut(path, "rev-parse", "HEAD");
      const environments = observedRecords(await observeQueue(root, "main"))
        .filter((record) => record.kind === "environment")
        .filter((record) => record.data.state.kind !== "disposed");
      assertEquals(environments.length, 1);
      assertEquals(environments[0]?.data.state.kind, "idle");
      assertEquals(
        environments[0]?.data.release.kind,
        retained ? "held" : "released",
      );
      await grantEffort(
        path,
        "agent/public-done",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      await Deno.writeTextFile(
        `${root}/predecessor`,
        "separately landed source\n",
      );
      await git(root, "add", "predecessor");
      await git(root, "commit", "-m", "Advance predecessor");
      const before = await gitOut(root, "rev-parse", "main");
      const accepted = await runAgent(root, ["accept", "--json"]);
      assertEquals(accepted.code, retained ? 1 : 0, accepted.output);
      if (retained) {
        assertEquals(
          await gitOut(path, "rev-parse", "HEAD"),
          original,
          "validation must restore the authored source",
        );
        assertEquals(
          await gitOut(path, "symbolic-ref", "HEAD"),
          "refs/heads/agent/public-done",
        );
        assertEquals(await gitOut(path, "status", "--short"), "");

        assert(
          accepted.output.includes("environment-unavailable"),
          accepted.output,
        );
        assertEquals(await gitOut(root, "rev-parse", "main"), before);
        assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
      } else {
        const result = decodeCliResult(accepted.stdout, "accept");
        assert(
          result.data !== undefined && "queue" in result.data,
          accepted.output,
        );
        assertEquals(result.data.queue?.map((row) => row.state), ["landed"]);
        assertEquals(result.data.queue?.map((row) => row.retirement), [
          "retired",
        ]);
        assertEquals(await statIfExists(path), undefined);
        const retirement = observedRecords(await observeQueue(root, "main"))
          .find((record) => record.kind === "retirement");
        assert(
          retirement?.kind === "retirement" &&
            retirement.data.capture !== undefined,
        );
        const capture = await readEnvironmentArtifact(
          root,
          retirement.data.capture,
        );
        assert(
          typeof capture === "object" && capture !== null &&
            "snapshot" in capture && typeof capture.snapshot === "object" &&
            capture.snapshot !== null && "value" in capture.snapshot,
        );
        const returned = WorkspaceStateSchema.parse(capture.snapshot.value);
        assertEquals(returned.git?.head, original);
        assertEquals(returned.git?.branch, "refs/heads/agent/public-done");
        const executions = returned.git?.files.find((file) =>
          file.path === "executions"
        );
        assert(executions !== undefined);
        assertEquals(
          await Deno.readTextFile(
            await verifyRecoveryPayload(root, executions.contents),
          ),
          "tt",
        );
        assertEquals(await Deno.readTextFile(`${root}/source`), "authored\n");
        assertEquals(
          await Deno.readTextFile(`${root}/predecessor`),
          "separately landed source\n",
        );
        const records = observedRecords(await observeQueue(root, "main"));
        assertEquals(
          records.filter((record) => record.kind === "candidate").length,
          2,
        );
        const foreign = records.filter((record) =>
          record.kind === "attempt" &&
          record.data.identity.executor.originating_effort === "main" &&
          record.data.subjects.length > 0
        );
        assertEquals(
          foreign.length,
          1,
          "the fresh actor owns its validation attempt without adopting the effort",
        );
      }
    });
  });
}
