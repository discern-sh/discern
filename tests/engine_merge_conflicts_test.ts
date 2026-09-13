/** Real merge observations must survive aborted updates and disposable integration cleanup. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import {
  buildStreamFacts,
  runDetector,
} from "../src/engine/logbook/detectors.ts";
import { recurringMergeConflicts } from "../src/engine/logbook/merge_conflicts.ts";
import { HINTS } from "../src/shared/hints.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  readLogbookEvents,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** Commit authored fixture work through ordinary Git, with no product bypass in assertions. */
async function commit(root: string, message: string): Promise<void> {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", message, "--no-gpg-sign");
}

Deno.test("conflict evidence and prevention advice survive CLI, MCP, retries, and acceptance cleanup", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = true",
        "[project]",
        'slug = "merge-evidence"',
        "[repository]",
        'trunk = "main"',
        "[jobs]",
        'lint = ":"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
    await Deno.writeTextFile(join(dir, "catalog.txt"), "base\n");
    await commit(dir, "prepare project");
    const clean = await addWorktree(dir, "clean");
    const efforts: string[] = [];
    for (const name of ["alpha", "beta", "gamma"]) {
      const wt = await addWorktree(dir, name);
      await Deno.writeTextFile(join(wt, "catalog.txt"), `${name}\n`);
      await commit(wt, `change ${name}`);
      // Only subjects exercised through acceptance need a pre-move Proof.
      if (name !== "beta") {
        const done = await runAgent(wt, ["done", "--json"]);
        assertEquals(done.code, 0, done.output);
      }
      efforts.push(wt);
    }
    const [alpha, beta, gamma] = efforts;
    assert(alpha !== undefined && beta !== undefined && gamma !== undefined);
    await Deno.writeTextFile(join(dir, "catalog.txt"), "trunk\n");
    await commit(dir, "move trunk");
    const trunk = await gitOut(dir, "rev-parse", "HEAD");
    const gammaHead = await gitOut(gamma, "rev-parse", "HEAD");

    const first = await runAgent(alpha, ["accept", "--confirmed", "--json"]);
    assertEquals(first.code, 1, first.output);
    const second = await runAgent(beta, ["update", "--json"]);
    assertEquals(second.code, 1, second.output);
    assertEquals((await runAgent(clean, ["update", "--json"])).code, 0);

    const tool = TOOLS.find((entry) => entry.name === "discern_update");
    assert(tool !== undefined);
    const mcp = await runTool(
      tool,
      new WorkingRoot(gamma),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(mcp.isError, true);
    assertStringIncludes(JSON.stringify(mcp.structuredContent.hints), "3 of 4");
    assertStringIncludes(
      JSON.stringify(mcp.structuredContent.hints),
      "[generated.<name>]",
    );
    assertStringIncludes(
      JSON.stringify(mcp.structuredContent.hints),
      "authored sources",
    );

    const retry = await runAgent(gamma, ["accept", "--confirmed", "--json"]);
    assertEquals(retry.code, 1, retry.output);
    const refused = decodeCliResult(retry.stdout, "accept");
    assertEquals(refused.error, "precondition_failed");
    assertStringIncludes((refused.hints ?? []).join("\n"), "3 of 4");
    assertStringIncludes(refused.message ?? "", "Nothing has been landed");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), trunk);
    assertEquals(await gitOut(gamma, "rev-parse", "HEAD"), gammaHead);
    assertEquals(await gitOut(gamma, "status", "--porcelain"), "");
    assertEquals(await gitOut(dir, "branch", "--list", "integration/*"), "");

    const events = await readLogbookEvents(dir);
    const recorded = events.filter((event) => event.kind === "verb");
    const attempts = recorded.flatMap((event) => event.merges?.attempts ?? []);
    assertEquals(attempts.length, 5);
    assert(
      attempts.every((attempt) => !attempt.effort.startsWith("integration/")),
    );
    assert(attempts.every((attempt) => attempt.incoming === trunk));
    const mcpEvent = recorded.find((event) => event.surface === "mcp");
    assertEquals(mcpEvent?.merges?.attempts[0]?.head, gammaHead);
    assert(
      mcpEvent?.hint_ids?.includes(HINTS["logbook-merge-conflict-finding"].id),
    );
    const finding = runDetector(
      recurringMergeConflicts,
      buildStreamFacts(events, "main"),
    );
    assertEquals(finding.findings[0]?.evidence.merge_attempts, 4);
    assertEquals(finding.findings[0]?.evidence.conflicts, 3);

    const human = await runAgent(beta, ["update", "--markdown"]);
    assertEquals(human.code, 1);
    assertTerminalTextIncludes(human.output, "3 of 4");
    assertStringIncludes(human.output, "[generated.<name>]");

    const status = TOOLS.find((entry) => entry.name === "discern_status");
    assert(status !== undefined);
    await runTool(
      status,
      new WorkingRoot(gamma),
      { local: true },
      undefined,
      () => Promise.resolve(undefined),
    );
    const last = (await readLogbookEvents(dir)).filter((event) =>
      event.kind === "verb"
    ).at(-1);
    assertEquals(
      last?.merges,
      undefined,
      "MCP observations must drain after each call",
    );

    const preview = await runAgent(beta, ["update", "--dry-run", "--json"]);
    assertEquals(preview.code, 0);
    const afterPreview = (await readLogbookEvents(dir)).filter((event) =>
      event.kind === "verb"
    ).at(-1);
    assertEquals(afterPreview?.merges, undefined);
  });
});
