/**
 * Setup completion as one stateful transaction: safe replay, canonical Proof
 * recovery, and owned rollback. These are source-CLI process journeys, not
 * direct calls into setup helpers, because the defects live between stages.
 *
 * A proven completion costs two full Gate runs (the probe worktree and the
 * final checkout), so the transaction's states chain on one fixture in the
 * order they arise — unproven marker, proven completion, replay, refused
 * replay, validation of a marker-bearing HEAD, landing — and the owned
 * rollback states chain on one red fixture. Each step carries the name of
 * the case it replaced, so a failure still names the behaviour.
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
import { parseGateProofFile } from "../src/engine/gate/proof_records.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  commitSetupAuthoring,
  COUNTED_GREEN_GATE,
  readyForSetupDone,
  setupCompletionSnapshot,
} from "./fixtures/setup_completion_harness.ts";

Deno.test("setup completion is one transaction: an unproven marker converges, the proven completion replays without effects, and a marker-bearing HEAD validates without another marker commit before landing", async (t) => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, COUNTED_GREEN_GATE);
    await commitSetupAuthoring(dir);

    // ── the unproven marker, then the ordinary proven path ──────────────────
    const forced = await runAgent(dir, [
      "setup",
      "done",
      "--unproven",
      "--json",
    ]);
    assertEquals(forced.code, 0, forced.output);
    const marker = await setupCompletionSnapshot(dir);
    assertEquals(
      marker.releaseCheck,
      undefined,
      "unproven adoption does not seed a clock",
    );

    const first = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "setup done");
    assertResultDataKey(firstResult, "bootstrapped");
    const completed = await setupCompletionSnapshot(dir);
    assertExists(
      completed.releaseCheck,
      "proven adoption seeds first-seen evidence",
    );
    assert(!completed.releaseCheck.includes("last_handoff_at"));

    await t.step(
      "an unproven marker converges only after the ordinary proven path succeeds",
      async () => {
        const forcedResult = decodeCliResult(forced.stdout, "setup done");
        assertResultDataKey(forcedResult, "bootstrapped");
        assertEquals(forcedResult.data.completion, "unproven");
        assertEquals(forcedResult.data.setup_completion, "unproven");
        assertEquals(forcedResult.data.gate_proven, false);
        assertEquals(forcedResult.data.proof, undefined);
        assertEquals(forcedResult.data.gate_ran, false);
        assertEquals(marker.gateInvocations, 0);
        assertStringIncludes(
          marker.config,
          'setup_completion = "unproven"',
        );

        assertEquals(firstResult.data.completion, "created");
        assertEquals(firstResult.data.gate_proven, true);
        assertExists(firstResult.data.proof_line);
        assert(
          completed.head !== marker.head,
          "promotion must persist a new completion state",
        );
        assert(completed.history !== marker.history);
        assert(completed.refs !== marker.refs);
        assertEquals(completed.status, marker.status);
        assertEquals(completed.gateInvocations, 2);
        // Proven is a persisted replacement state, not a transient Proof overlay.
        assertStringIncludes(
          await Deno.readTextFile(join(dir, "discern.toml")),
          'setup_completion = "proven"',
        );
      },
    );

    // ── replay ──────────────────────────────────────────────────────────────
    const replay = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(replay.code, 0, replay.output);
    const replayResult = decodeCliResult(replay.stdout, "setup done");
    assertResultDataKey(replayResult, "bootstrapped");

    await t.step(
      "setup done replay preserves canonical completion and performs zero effects",
      async () => {
        assertExists(firstResult.data.proof_line);
        assertEquals(firstResult.data.completion, "created");
        assertEquals(firstResult.data.effects_performed, true);
        assertEquals(firstResult.data.gate_ran, true);
        assertEquals(completed.gateInvocations, 2);

        assertEquals(replayResult.data.proof_line, firstResult.data.proof_line);
        assertEquals(replayResult.data.proof, firstResult.data.proof);
        assertEquals(replayResult.data.inventory, firstResult.data.inventory);
        assertEquals(replayResult.data.landing, firstResult.data.landing);
        assertEquals(replayResult.data.completion, "replayed");
        assertEquals(replayResult.data.effects_performed, false);
        assertEquals(replayResult.data.gate_ran, false);
        assertEquals(await setupCompletionSnapshot(dir), completed);
      },
    );

    await t.step(
      "a truncated setup done read recovers the same facts through effect-free replay",
      async () => {
        const deliberatelyTruncated = first.stdout.slice(0, 80);
        assert(!deliberatelyTruncated.includes("proof_line"));

        assertEquals(replayResult.data.proof_line, firstResult.data.proof_line);
        assertEquals(replayResult.data.inventory, firstResult.data.inventory);
        assertEquals(replayResult.data.landing, firstResult.data.landing);
        assertEquals(await setupCompletionSnapshot(dir), completed);
      },
    );

    // ── a refused replay on a dirty tree ────────────────────────────────────
    const proofPath = await gitAdminStatePath(dir, "gateProof");
    assertExists(proofPath);

    await t.step(
      "a refused marker-bearing replay retains honored Proof byte-for-byte",
      async () => {
        const proofBefore = await Deno.readTextFile(proofPath);
        const headBefore = await gitOut(dir, "rev-parse", "HEAD");
        await Deno.writeTextFile(join(dir, "local-scratch.txt"), "untracked\n");

        const refused = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(refused.code, 1, refused.output);
        assertEquals(await Deno.readTextFile(proofPath), proofBefore);
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), headBefore);
        assertEquals(
          await Deno.readTextFile(join(dir, "local-scratch.txt")),
          "untracked\n",
        );
        // The scratch file was the refusal's only cause; the tree is clean again.
        await Deno.remove(join(dir, "local-scratch.txt"));
        assertEquals(await setupCompletionSnapshot(dir), completed);
      },
    );

    // ── validation of a marker-bearing clean HEAD ───────────────────────────
    await t.step(
      "a marker-bearing clean HEAD with missing Proof validates without another marker commit",
      async () => {
        await Deno.remove(proofPath);
        const beforeValidation = await setupCompletionSnapshot(dir);

        const validated = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(validated.code, 0, validated.output);
        const validatedResult = decodeCliResult(validated.stdout, "setup done");
        assertResultDataKey(validatedResult, "bootstrapped");
        assertEquals(
          validatedResult.data.proof_line,
          firstResult.data.proof_line,
        );
        assertEquals(validatedResult.data.completion, "validated");
        assertEquals(validatedResult.data.effects_performed, true);
        assertEquals(validatedResult.data.gate_ran, true);
        const afterValidation = await setupCompletionSnapshot(dir);
        assertEquals(afterValidation.head, beforeValidation.head);
        assertEquals(afterValidation.history, beforeValidation.history);
        assertEquals(afterValidation.refs, beforeValidation.refs);
        assertEquals(afterValidation.config, beforeValidation.config);
        assertEquals(afterValidation.status, beforeValidation.status);
        // The unproven marker ran no Gate and the proven completion ran it twice,
        // so validation's own probe-and-final pair lands at four.
        assertEquals(afterValidation.gateInvocations, 4);
        assertExists(afterValidation.proof);
      },
    );

    await t.step(
      "a marker-bearing clean HEAD with stale Proof validates that HEAD without another marker commit",
      async () => {
        const currentProof = await Deno.readTextFile(proofPath);
        const parsedProof = parseGateProofFile(currentProof);
        assert(parsedProof.status === "recorded");
        const predecessor = await gitOut(dir, "rev-parse", "HEAD^");
        await Deno.writeTextFile(
          proofPath,
          `${JSON.stringify({ ...parsedProof.record, head: predecessor })}\n`,
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
        // Validation runs exactly its probe-and-final pair again.
        assertEquals(
          afterValidation.gateInvocations,
          beforeValidation.gateInvocations + 2,
        );
        assertExists(afterValidation.proof);
        const refreshedProof = parseGateProofFile(afterValidation.proof);
        assert(refreshedProof.status === "recorded");
        assertEquals(refreshedProof.record.head, afterValidation.head);
      },
    );

    // ── landing ─────────────────────────────────────────────────────────────
    await t.step(
      "the proven completion lands with the same canonical Proof line",
      async () => {
        const accepted = await runAgent(dir, ["setup", "accept", "--json"]);
        assertEquals(accepted.code, 0, accepted.output);
        const acceptance = decodeCliResult(accepted.stdout, "setup accept");
        assertResultDataKey(acceptance, "landed");
        assertEquals(acceptance.data.proof_line, firstResult.data.proof_line);
      },
    );
  });
});

Deno.test("a red Gate rolls setup completion back to the committed state, first from the authored tree and then from an unproven marker", async (t) => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "false");
    await commitSetupAuthoring(dir);

    await t.step(
      "failure after the completion marker removes only that owned commit",
      async () => {
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
      },
    );

    await t.step(
      "a failed proof convergence restores the committed unproven state",
      async () => {
        const forced = await runAgent(dir, [
          "setup",
          "done",
          "--unproven",
          "--json",
        ]);
        assertEquals(forced.code, 0, forced.output);
        const red = await runAgent(dir, ["done", "--json"]);
        assertEquals(red.code, 1, red.output);
        const before = await setupCompletionSnapshot(dir);

        const replay = await runAgent(dir, ["setup", "done", "--json"]);
        assertEquals(replay.code, 1, replay.output);
        const result = decodeCliResult(replay.stdout, "setup done");
        assertEquals(result.error, "gate_failed");
        assertResultDataKey(result, "stage");
        assertEquals(result.data.stage, "worktree_probe");
        const failureData = result.data as Record<string, unknown>;
        assertStringIncludes(String(failureData.state), "removed");
        assertEquals(failureData.next_action, "discern worktree setup");
        assertEquals(await setupCompletionSnapshot(dir), before);
      },
    );
  });
});

Deno.test("nested Map content diagnostics survive setup completion projection", async () => {
  await withTempDir(async (dir) => {
    await readyForSetupDone(dir, "true");
    const publicPage = join(dir, "discern/map/README.md");
    await Deno.writeTextFile(
      publicPage,
      "# Real docs\n\nSee the [missing guide](missing.md).\n\n[Runtime](10-runtime/)\n",
    );
    await commitSetupAuthoring(dir);
    const before = await setupCompletionSnapshot(dir);

    const human = await runAgent(dir, ["setup", "done"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.output, "discern/map/README.md:3");
    assertStringIncludes(human.output, "[dead-link]");
    assertTerminalTextIncludes(human.output, "Reproduce: discern done");
    assertEquals(await setupCompletionSnapshot(dir), before);

    const markdown = await runAgent(dir, ["setup", "done", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertStringIncludes(markdown.stdout, "discern/map/README.md:3");
    assertStringIncludes(markdown.stdout, "dead-link");
    assertTerminalTextIncludes(markdown.stdout, "discern done");
    assertEquals(await setupCompletionSnapshot(dir), before);

    const failed = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const result = decodeCliResult(failed.stdout, "setup done");
    assertResultDataKey(result, "stage");
    assertEquals(result.data.stage, "worktree_probe");
    const diagnostic = result.diagnostics?.find((entry) =>
      entry.rule === "dead-link"
    );
    assertExists(diagnostic);
    assertEquals(diagnostic.file, "discern/map/README.md");
    assertEquals(diagnostic.line, 3);
    assertEquals(diagnostic.rule, "dead-link");
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
      entry.rule === "dead-link"
    );
    assertExists(mcpDiagnostic);
    assertEquals(mcpDiagnostic.file, "discern/map/README.md");
    assertEquals(mcpDiagnostic.line, 3);
    assertEquals(mcpDiagnostic.reproduce_cmd, "discern done");
    assertStringIncludes(mcp.content[0]?.text ?? "", "dead-link");
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
