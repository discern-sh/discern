/**
 * 6A.1: doctor reads a recorded execution claim the way `status` does, by
 * observing it live, and distinguishes a live owner, an abandoned executor, a
 * surviving child process group, uncertain child receipts, and an interrupted
 * recovery. It changes no record along the way; the effectful recovery command
 * is what returns the checkout.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { processAllowance, waitUntil } from "./waiting.ts";
import { shellBarrier } from "./shell_barrier.ts";
import {
  DEATH_DECLARATION,
  environmentId,
  pausedExecutor,
} from "./fixtures/completion_death_fixture.ts";
import { runChecks } from "../src/commands/doctor.ts";
import type { Check } from "../src/shared/result_schemas.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import { executionChildrenQuiescent } from "../src/engine/execution/lifetime.ts";
import { recoverCompletionResult } from "../src/engine/execution/public_recovery.ts";

/** Doctor's account of the recorded execution claims, read from the main checkout. */
async function leases(root: string): Promise<Check> {
  const found = (await runChecks(root)).find((check) =>
    check.name === "execution leases"
  );
  assert(found !== undefined, "expected an 'execution leases' check");
  return found;
}

/** The recorded attempt behind the fixture's one executing environment. */
async function executingAttempt(path: string, id: string): Promise<string> {
  const current = await requireEnvironment(path, id);
  assert(current.record.data.state.kind === "executing");
  return current.record.data.state.attempt_id;
}

Deno.test("doctor distinguishes a live owner, an abandoned claim, an interrupted recovery, and uncertain receipts without changing a record", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const path = await project(root, ["local"], DEATH_DECLARATION);
      // Trunk moves so completion composes a differing candidate; the return
      // then has real restore work for recovery to resume.
      await Deno.writeTextFile(join(root, "predecessor"), "new trunk\n");
      await git(root, "add", "predecessor");
      await git(root, "commit", "-m", "Advance predecessor");
      const engine = await pausedExecutor(path, join(aux, "ready"), "validate");
      const id = await environmentId(path);
      try {
        // A live owner: the claim is ordinary work, not a problem.
        const live = await leases(root);
        assertEquals(live.status, "ok", live.detail);
        assertStringIncludes(live.detail, "with a live owner");
        assertEquals(live.fix, undefined);
      } finally {
        await engine.stop();
      }
      const stamp = (await requireEnvironment(path, id)).stamp;

      // The executor is gone and its recorded children have stopped: abandoned.
      const abandoned = await leases(root);
      assertEquals(abandoned.status, "warn");
      assertStringIncludes(abandoned.detail, "observed live");
      assertStringIncludes(abandoned.detail, "abandoned");
      assertStringIncludes(
        abandoned.detail,
        "every recorded child process has stopped",
      );
      assertStringIncludes(abandoned.fix ?? "", "discern done --recover");
      assertEquals((await requireEnvironment(path, id)).stamp, stamp);

      // Recovery itself interrupted after it republished the claim: a live
      // owner again while it runs, abandoned again once it is killed.
      const recovering = await pausedExecutor(
        path,
        join(aux, "recovering"),
        "environment",
        id,
      );
      try {
        const owned = await leases(root);
        assertEquals(owned.status, "ok", owned.detail);
        assertStringIncludes(owned.detail, "with a live owner");
      } finally {
        await recovering.stop();
      }
      const interrupted = await leases(root);
      assertEquals(interrupted.status, "warn");
      assertStringIncludes(interrupted.detail, "abandoned");

      // Uncertain receipts: missing child enrollment evidence is never read as
      // absence, so doctor says the children are not proved stopped.
      const attemptId = await executingAttempt(path, id);
      const children = await artifactPath(
        path,
        attemptId,
        "environment/children",
      );
      const enrolled: { name: string; content: string }[] = [];
      for await (const entry of Deno.readDir(children)) {
        if (!entry.name.startsWith("enrolled-")) continue;
        enrolled.push({
          name: entry.name,
          content: await Deno.readTextFile(join(children, entry.name)),
        });
        await Deno.remove(join(children, entry.name));
      }
      assert(enrolled.length > 0, "the attempt recorded child enrollment");
      const uncertain = await leases(root);
      assertEquals(uncertain.status, "warn");
      assertStringIncludes(uncertain.detail, "not proved stopped");
      assertStringIncludes(uncertain.detail, "enrolled-");
      assertStringIncludes(uncertain.fix ?? "", "reconcile its receipts");
      for (const receipt of enrolled) {
        await Deno.writeTextFile(join(children, receipt.name), receipt.content);
      }

      // The supported recovery returns the checkout; doctor then reports no claim.
      const recovered = await runAgent(path, [
        "done",
        "--recover",
        id,
        "--json",
      ]);
      assertEquals(recovered.code, 0, recovered.output);
      const settled = await leases(root);
      assertEquals(settled.status, "ok", settled.detail);
      assertStringIncludes(settled.detail, "held by its owner");
      assertEquals(
        (await requireEnvironment(path, id)).record.data.state.kind,
        "idle",
      );
    });
  });
});

Deno.test("doctor reports a surviving child process group as unstopped work until it exits", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const path = await project(root, ["local"], DEATH_DECLARATION);
      const marker = join(aux, "child");
      using barrier = await shellBarrier(marker + ".fifo");
      const engine = await pausedExecutor(path, marker, "surviving-child");
      const id = await environmentId(path);
      const attemptId = await executingAttempt(path, id);
      const directory = await artifactPath(
        path,
        attemptId,
        "environment/children",
      );
      try {
        await waitUntil(
          async () => {
            for await (const entry of Deno.readDir(directory)) {
              if (
                entry.name.startsWith("started-") &&
                !await exists(
                  join(directory, entry.name.replace("started-", "settled-")),
                )
              ) return true;
            }
            return false;
          },
          "the child's durable start receipt",
          { allowance: processAllowance() },
        );
        await engine.stop();
        const surviving = await leases(root);
        assertEquals(surviving.status, "warn");
        assertStringIncludes(surviving.detail, "not proved stopped");
        assertStringIncludes(surviving.detail, "remains live");
        assertStringIncludes(
          surviving.fix ?? "",
          "stop the named process group",
        );
        await barrier.release();
        await waitUntil(
          () => executionChildrenQuiescent(path, attemptId),
          "orphaned group to exit after its owner releases the barrier",
          { allowance: processAllowance() },
        );
        const stopped = await leases(root);
        assertEquals(stopped.status, "warn");
        assertStringIncludes(stopped.detail, "abandoned");
        const returned = await recoverCompletionResult(path, id);
        assert(returned.ok, JSON.stringify(returned));
      } finally {
        await barrier.release();
        await engine.stop();
      }
    });
  });
});
