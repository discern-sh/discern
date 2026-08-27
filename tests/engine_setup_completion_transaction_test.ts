/**
 * Setup completion as one stateful transaction: safe replay, canonical Proof
 * recovery, and owned rollback. These are source-CLI process journeys, not
 * direct calls into setup helpers, because the defects live between stages.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { withTempDir } from "./helpers.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  commitSetupAuthoring,
  COUNTED_GREEN_GATE,
  readyForSetupDone,
  setupCompletionSnapshot,
} from "./fixtures/setup_completion_harness.ts";

Deno.test("setup done replay preserves canonical completion and performs zero effects", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);

    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "setup done");
    assertResultDataKey(firstResult, "bootstrapped");
    assertExists(firstResult.data.proof_line);
    const completed = await setupCompletionSnapshot(dir);
    assertEquals(completed.gateInvocations, 2);

    const replay = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(replay.code, 0, replay.output);
    const replayResult = decodeCliResult(replay.stdout, "setup done");
    assertResultDataKey(replayResult, "bootstrapped");
    assertEquals(replayResult.data.proof_line, firstResult.data.proof_line);
    assertEquals(replayResult.data.proof, firstResult.data.proof);
    assertEquals(replayResult.data.inventory, firstResult.data.inventory);
    assertEquals(replayResult.data.landing, firstResult.data.landing);
    assertEquals(await setupCompletionSnapshot(dir), completed);

    const accepted = await runAgent(dir, ["setup", "accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const acceptance = decodeCliResult(accepted.stdout, "setup accept");
    assertResultDataKey(acceptance, "landed");
    assertEquals(acceptance.data.proof_line, firstResult.data.proof_line);
  });
});

Deno.test("a truncated setup done read recovers the same facts through effect-free replay", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);
    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "setup done");
    assertResultDataKey(firstResult, "bootstrapped");
    const deliberatelyTruncated = first.stdout.slice(0, 80);
    assert(!deliberatelyTruncated.includes("proof_line"));
    const completed = await setupCompletionSnapshot(dir);

    const recovered = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(recovered.code, 0, recovered.output);
    const recoveredResult = decodeCliResult(recovered.stdout, "setup done");
    assertResultDataKey(recoveredResult, "bootstrapped");
    assertEquals(recoveredResult.data.proof_line, firstResult.data.proof_line);
    assertEquals(recoveredResult.data.inventory, firstResult.data.inventory);
    assertEquals(recoveredResult.data.landing, firstResult.data.landing);
    assertEquals(await setupCompletionSnapshot(dir), completed);
  });
});

Deno.test("a refused marker-bearing replay retains honored Proof byte-for-byte", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "true");
    await commitSetupAuthoring(dir);
    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const proofPath = await gitAdminStatePath(dir, "gateProof");
    assertExists(proofPath);
    const proofBefore = await Deno.readTextFile(proofPath);
    const headBefore = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeTextFile(join(dir, "local-scratch.txt"), "untracked\n");

    const replay = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    assertEquals(await Deno.readTextFile(proofPath), proofBefore);
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
    assertEquals(
      await Deno.readTextFile(join(dir, "local-scratch.txt")),
      "untracked\n",
    );
  });
});

Deno.test("a marker-bearing clean HEAD with missing Proof validates without another marker commit", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);
    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "setup done");
    assertResultDataKey(firstResult, "bootstrapped");
    const proofPath = await gitAdminStatePath(dir, "gateProof");
    assertExists(proofPath);
    await Deno.remove(proofPath);
    const beforeValidation = await setupCompletionSnapshot(dir);

    const validated = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(validated.code, 0, validated.output);
    const validatedResult = decodeCliResult(validated.stdout, "setup done");
    assertResultDataKey(validatedResult, "bootstrapped");
    assertEquals(validatedResult.data.proof_line, firstResult.data.proof_line);
    const afterValidation = await setupCompletionSnapshot(dir);
    assertEquals(afterValidation.head, beforeValidation.head);
    assertEquals(afterValidation.history, beforeValidation.history);
    assertEquals(afterValidation.refs, beforeValidation.refs);
    assertEquals(afterValidation.config, beforeValidation.config);
    assertEquals(afterValidation.status, beforeValidation.status);
    assertEquals(afterValidation.gateInvocations, 4);
    assertExists(afterValidation.proof);
  });
});

Deno.test("failure after the completion marker removes only that owned commit", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "false");
    await commitSetupAuthoring(dir);
    const before = await setupCompletionSnapshot(dir);

    const failed = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const result = decodeCliResult(failed.stdout, "setup done");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "worktree_probe");
    const failureData = result.data as Record<string, unknown>;
    assertEquals(failureData.rollback, "owned_commit_removed");
    const after = await setupCompletionSnapshot(dir);
    assertEquals(after.head, before.head);
    assertEquals(after.history, before.history);
    assertEquals(after.refs, before.refs);
    assertEquals(after.status, before.status);
    assertEquals(after.config, before.config);
    assertEquals(after.proof, before.proof);
    assertEquals(after.worktrees, before.worktrees);
    assertEquals(parseConfigOrThrow(after.config).meta.bootstrapped, false);
    assertEquals(
      (await gitOut(dir, "log", "--format=%s")).includes(
        "Restore incomplete discern setup",
      ),
      false,
    );
  });
});

Deno.test("nested Map content diagnostics survive setup completion projection", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "true");
    const internal = join(dir, "discern/map/_internal");
    await Deno.mkdir(internal, { recursive: true });
    await Deno.writeTextFile(join(internal, "brief.md"), "# Internal brief\n");
    const publicPage = join(dir, "discern/map/README.md");
    await Deno.writeTextFile(
      publicPage,
      "# Real docs\n\nSee the [internal brief](_internal/brief.md).\n",
    );
    await commitSetupAuthoring(dir);

    const failed = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const result = decodeCliResult(failed.stdout, "setup done");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "worktree_probe");
    const diagnostic = result.diagnostics?.find((entry) =>
      entry.rule === "audience-boundary"
    );
    assertExists(diagnostic);
    assertEquals(diagnostic.file, "discern/map/README.md");
    assertEquals(diagnostic.line, 3);
    assertEquals(diagnostic.rule, "audience-boundary");
    assertEquals(diagnostic.reproduce_cmd, "discern done");
    const failureData = result.data as Record<string, unknown>;
    assertStringIncludes(String(failureData.recovery), "discern/map/README.md");
    assertEquals(String(failureData.recovery).includes("[worktree]"), false);
  });
});
