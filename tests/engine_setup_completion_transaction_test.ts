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
import { DiagnosticSchema } from "../src/shared/result_schemas.ts";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import { renderMcpResult } from "../src/engine/mcp/server.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
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
    assertEquals(firstResult.data.completion, "created");
    assertEquals(firstResult.data.effects_performed, true);
    assertEquals(firstResult.data.gate_ran, true);
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
    assertEquals(replayResult.data.completion, "replayed");
    assertEquals(replayResult.data.effects_performed, false);
    assertEquals(replayResult.data.gate_ran, false);
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
    assertEquals(validatedResult.data.completion, "validated");
    assertEquals(validatedResult.data.effects_performed, true);
    assertEquals(validatedResult.data.gate_ran, true);
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

Deno.test("a marker-bearing clean HEAD with stale Proof validates that HEAD without another marker commit", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);
    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const proofPath = await gitAdminStatePath(dir, "gateProof");
    assertExists(proofPath);
    const currentProof = await Deno.readTextFile(proofPath);
    const predecessor = await gitOut(dir, "rev-parse", "HEAD^");
    const newline = currentProof.indexOf("\n");
    await Deno.writeTextFile(
      proofPath,
      `${predecessor}${newline < 0 ? "" : currentProof.slice(newline)}`,
    );
    const beforeValidation = await setupCompletionSnapshot(dir);

    const validated = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(validated.code, 0, validated.output);
    const result = decodeCliResult(validated.stdout, "setup done");
    assertResultDataKey(result, "bootstrapped");
    assertEquals(result.data.completion, "validated");
    assertEquals(result.data.effects_performed, true);
    assertEquals(result.data.gate_ran, true);
    const afterValidation = await setupCompletionSnapshot(dir);
    assertEquals(afterValidation.head, beforeValidation.head);
    assertEquals(afterValidation.history, beforeValidation.history);
    assertEquals(afterValidation.refs, beforeValidation.refs);
    assertEquals(afterValidation.status, beforeValidation.status);
    assertEquals(afterValidation.gateInvocations, 4);
    assertExists(afterValidation.proof);
    assert(afterValidation.proof.startsWith(`${afterValidation.head}\n`));
  });
});

Deno.test("a forced marker remains unproved until the non-forced validation path succeeds", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);

    const forced = await runAgent(dir, [
      "setup",
      "done",
      "--force",
      "--json",
    ]);
    assertEquals(forced.code, 0, forced.output);
    const forcedResult = decodeCliResult(forced.stdout, "setup done");
    assertResultDataKey(forcedResult, "bootstrapped");
    assertEquals(forcedResult.data.completion, "forced");
    assertEquals(forcedResult.data.gate_proven, false);
    assertEquals(forcedResult.data.proof, undefined);
    assertEquals(forcedResult.data.gate_ran, false);
    const marker = await setupCompletionSnapshot(dir);
    assertEquals(marker.gateInvocations, 0);

    const validated = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(validated.code, 0, validated.output);
    const result = decodeCliResult(validated.stdout, "setup done");
    assertResultDataKey(result, "bootstrapped");
    assertEquals(result.data.completion, "validated");
    assertEquals(result.data.gate_proven, true);
    assertExists(result.data.proof_line);
    const proved = await setupCompletionSnapshot(dir);
    assertEquals(proved.head, marker.head);
    assertEquals(proved.history, marker.history);
    assertEquals(proved.refs, marker.refs);
    assertEquals(proved.gateInvocations, 2);
  });
});

Deno.test("an unchanged recorded marker failure is visible without another retry", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "false");
    await commitSetupAuthoring(dir);
    const forced = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(forced.code, 0, forced.output);
    const red = await runAgent(dir, ["done", "--json"]);
    assertEquals(red.code, 1, red.output);
    const before = await setupCompletionSnapshot(dir);

    const replay = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    const result = decodeCliResult(replay.stdout, "setup done");
    assertEquals(result.error, "unchanged_tree_rerun");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "proof");
    const failureData = result.data as Record<string, unknown>;
    assertStringIncludes(String(failureData.state), "recorded failure");
    assertStringIncludes(String(failureData.next_action), "--rerun");
    assertEquals(await setupCompletionSnapshot(dir), before);
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
    const before = await setupCompletionSnapshot(dir);

    const human = await runAgent(dir, ["setup", "done"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.output, "discern/map/README.md:3");
    assertStringIncludes(human.output, "[audience-boundary]");
    assertTerminalTextIncludes(human.output, "Reproduce: discern done");
    assertEquals(await setupCompletionSnapshot(dir), before);

    const markdown = await runAgent(dir, ["setup", "done", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertStringIncludes(markdown.stdout, "discern/map/README.md:3");
    assertStringIncludes(markdown.stdout, "audience-boundary");
    assertTerminalTextIncludes(markdown.stdout, "discern done");
    assertEquals(await setupCompletionSnapshot(dir), before);

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
    assertExists(result.diagnostics);
    const mcp = renderMcpResult({
      ok: false,
      verb: "setup done",
      error: "gate_failed",
      diagnostics: result.diagnostics,
      data: result.data,
    });
    const mcpDiagnostics = DiagnosticSchema.array().parse(
      mcp.structuredContent.diagnostics,
    );
    const mcpDiagnostic = mcpDiagnostics.find((entry) =>
      entry.rule === "audience-boundary"
    );
    assertExists(mcpDiagnostic);
    assertEquals(mcpDiagnostic.file, "discern/map/README.md");
    assertEquals(mcpDiagnostic.line, 3);
    assertEquals(mcpDiagnostic.reproduce_cmd, "discern done");
    assertStringIncludes(mcp.content[0]?.text ?? "", "audience-boundary");
    assertStringIncludes(mcp.content[0]?.text ?? "", "discern/map/README.md:3");
    assertEquals(await setupCompletionSnapshot(dir), before);
  });
});

Deno.test("worktree resource failures retain resource-specific diagnostics on every setup surface", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "true");
    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await writeDiscernToml(
      configPath,
      `${config}\n[worktree.resources.fixture_db]\n` +
        'create = "false"\n' +
        'destroy = "true"\n',
    );
    const refreshed = await runAgent(dir, ["refresh"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitSetupAuthoring(dir);
    const before = await setupCompletionSnapshot(dir);

    const human = await runAgent(dir, ["setup", "done"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.output, "worktree-resource");
    assertStringIncludes(
      human.output,
      "worktree.resources.fixture_db.create",
    );
    assertTerminalTextIncludes(
      human.output,
      "Reproduce: discern worktree setup",
    );
    assertStringIncludes(human.output, "[worktree.resources]");
    assertEquals(await setupCompletionSnapshot(dir), before);

    const markdown = await runAgent(dir, ["setup", "done", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertStringIncludes(markdown.stdout, "worktree-resource");
    assertStringIncludes(
      markdown.stdout,
      "worktree.resources.fixture_db.create",
    );
    assertTerminalTextIncludes(markdown.stdout, "discern worktree setup");
    assertEquals(await setupCompletionSnapshot(dir), before);

    const failed = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const result = decodeCliResult(failed.stdout, "setup done");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "worktree_probe");
    const diagnostic = result.diagnostics?.find((entry) =>
      entry.tool === "worktree-resource"
    );
    assertExists(diagnostic);
    assertEquals(diagnostic.file, "discern.toml");
    assertEquals(
      diagnostic.rule,
      "worktree.resources.fixture_db.create",
    );
    assertStringIncludes(diagnostic.message, "fixture_db");
    assertEquals(diagnostic.reproduce_cmd, "discern worktree setup");
    const failureData = result.data as Record<string, unknown>;
    assertStringIncludes(String(failureData.recovery), "[worktree.resources]");
    assertEquals(String(failureData.recovery).includes("discern/map"), false);
    assertExists(result.diagnostics);
    const mcp = renderMcpResult({
      ok: false,
      verb: "setup done",
      error: "gate_failed",
      diagnostics: result.diagnostics,
      data: result.data,
    });
    const mcpDiagnostics = DiagnosticSchema.array().parse(
      mcp.structuredContent.diagnostics,
    );
    const mcpDiagnostic = mcpDiagnostics.find((entry) =>
      entry.tool === "worktree-resource"
    );
    assertExists(mcpDiagnostic);
    assertEquals(mcpDiagnostic.file, "discern.toml");
    assertEquals(
      mcpDiagnostic.rule,
      "worktree.resources.fixture_db.create",
    );
    assertEquals(mcpDiagnostic.reproduce_cmd, "discern worktree setup");
    assertStringIncludes(
      mcp.content[0]?.text ?? "",
      "worktree.resources.fixture_db.create",
    );
    assertStringIncludes(
      mcp.content[0]?.text ?? "",
      "Fix its configured create command or prerequisites",
    );
    assertEquals(mcp.content[0]?.text?.includes("discern/map"), false);
    assertEquals(await setupCompletionSnapshot(dir), before);
  });
});
