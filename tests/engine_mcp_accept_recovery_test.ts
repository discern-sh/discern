/** MCP acceptance preserves landed outcomes through cancellation and cleanup retry. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { AcceptDataSchema } from "../src/shared/result_schemas.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  completeWorktreeForAcceptance,
  readMcpVerbEvents,
} from "./engine_mcp_accept_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { waitForPendingCondition } from "./waiting.ts";

Deno.test("discern mcp: a partial accept that removed its held worktree still re-aims and records the landed effects", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "partial-branch-delete");
    const branch = await gitOut(worktree, "branch", "--show-current");

    // Let landing and worktree removal complete, then fail only the final branch
    // deletion. A loose-ref lock is Git's deterministic refusal at that seam.
    const branchLock = join(
      dir,
      ".git",
      "refs",
      "heads",
      `${branch}.lock`,
    );
    await writeConfig(
      worktree,
      `[project]\nslug = "engine-test"\n[repository]\ntrunk = "main"\nensure = [${
        JSON.stringify(`touch '${branchLock}'`)
      }]\n`,
    );
    const refresh = await runAgent(worktree, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    await completeWorktreeForAcceptance(worktree);
    const landedSha = await gitOut(worktree, "rev-parse", "HEAD");

    const acceptTool = TOOLS.find((tool) => tool.name === "discern_accept");
    const statusTool = TOOLS.find((tool) => tool.name === "discern_status");
    assert(acceptTool !== undefined);
    assert(statusTool !== undefined);
    const working = new WorkingRoot(worktree);

    const partial = await runTool(
      acceptTool,
      working,
      { confirmed: true },
      undefined,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    assertEquals(partial.isError, true, JSON.stringify(partial));
    assertEquals(
      partial.structuredContent.error,
      "partial_acceptance",
      JSON.stringify(partial),
    );
    const partialData = AcceptDataSchema.parse(partial.structuredContent.data);
    const canonicalRoot = await Deno.realPath(dir);
    assertEquals(partialData.root, canonicalRoot);
    assertEquals(partialData.consent, { source: "conversation" });
    assertEquals(partialData.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: false,
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), landedSha);
    assertStringIncludes(String(partial.structuredContent.message), "Landed");
    assertStringIncludes(
      String(partial.structuredContent.message),
      `Run discern worktree prune from ${canonicalRoot}`,
    );
    assertEquals(await targetExists(worktree), false);
    assertEquals(
      working.get(),
      canonicalRoot,
      "the deleted held root must re-aim even though the envelope is partial",
    );

    const follow = await runTool(
      statusTool,
      working,
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(follow.isError, false, JSON.stringify(follow));
    const followData = follow.structuredContent.data as {
      location?: unknown;
      root?: unknown;
    } | undefined;
    assertEquals(followData?.location, "main");
    assertEquals(followData?.root, canonicalRoot);

    const event = (await readMcpVerbEvents(dir)).findLast((candidate) =>
      candidate.verb === "accept"
    );
    assert(event !== undefined);
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: true,
        branch_deleted: false,
      },
    );

    await Deno.remove(branchLock);
    assertEquals(await gitOut(dir, "rev-parse", branch), landedSha);
    // The landing consumed the submission: a retried accept from the re-aimed
    // main root is a read-only queue view and replays no consent.
    const resumed = await runTool(
      acceptTool,
      working,
      {},
      undefined,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    assertEquals(resumed.isError, true, JSON.stringify(resumed));
    assertStringIncludes(
      String(resumed.structuredContent.message),
      "No effort has submitted a revision for landing.",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), landedSha);
    // The by-hand cleanup the partial result names finishes the recovery.
    assertEquals(await gitOut(dir, "rev-parse", branch), landedSha);
    await git(dir, "branch", "-d", branch);
    assertEquals(await gitOut(dir, "branch", "--list", branch), "");
  });
});

Deno.test("discern mcp: cancellation during main convergence preserves landing and permits cleanup-only recovery", async () => {
  await withTempDir(async (dir) => {
    const root = join(dir, "repo");
    await Deno.mkdir(root);
    const armed = join(dir, "armed");
    const ready = join(dir, "ready");
    const calls = join(dir, "calls");
    const ensure =
      `if [ -f '${armed}' ]; then echo run >> '${calls}'; touch '${ready}'; tail -f /dev/null; else echo run >> '${calls}'; fi`;
    await scaffoldEngine(root);
    await writeConfig(
      root,
      `[project]\nslug = "engine-test"\n[repository]\ntrunk = "main"\nensure = [${
        JSON.stringify(ensure)
      }]\n`,
    );
    await gitInit(root);
    const worktree = await addWorktree(root, "cancel-convergence");
    await completeWorktreeForAcceptance(worktree);
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    await Deno.writeTextFile(calls, "");
    await Deno.writeTextFile(armed, "");
    const tool = TOOLS.find((item) => item.name === "discern_accept");
    assert(tool !== undefined);
    const working = new WorkingRoot(worktree);
    const controller = new AbortController();
    const pending = runTool(
      tool,
      working,
      { confirmed: true },
      controller.signal,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    try {
      await waitForPendingCondition(
        pending,
        () => targetExists(ready),
        "main convergence to start",
      );
    } finally {
      controller.abort();
    }
    const cancelled = await pending;
    assertEquals(
      cancelled.structuredContent.error,
      "partial_acceptance",
      JSON.stringify(cancelled),
    );
    // The landing is durable and its cleanup completes: cancellation cannot
    // roll the trunk back or strand the effort's checkout.
    const cancelledData = AcceptDataSchema.parse(
      cancelled.structuredContent.data,
    );
    assertEquals(cancelledData.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
    assertEquals(await gitOut(root, "rev-parse", "HEAD"), target);
    assertEquals(await targetExists(worktree), false);
    assertEquals(
      working.get(),
      await Deno.realPath(root),
      "the removed held root must re-aim to the main checkout",
    );
    await Deno.remove(armed);
    // A retried accept from the re-aimed main checkout is a read-only queue
    // view: the landing consumed the submission and replays no authority.
    const resumed = await runTool(
      tool,
      working,
      {},
      undefined,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    assertEquals(resumed.isError, true, JSON.stringify(resumed));
    assertStringIncludes(
      String(resumed.structuredContent.message),
      "No effort has submitted a revision for landing.",
    );
    assertEquals(await gitOut(root, "rev-parse", "HEAD"), target);
    // The interrupted convergence ran ensure once; recovery replays nothing.
    assertEquals((await Deno.readTextFile(calls)).trim().split("\n"), ["run"]);
  });
});
