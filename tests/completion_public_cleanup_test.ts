/** Historical retention stays separate from current landing and cleanup. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { firedHintsFromTexts } from "../src/shared/hints.ts";
import { pathExists } from "../src/shared/fs_presence.ts";

Deno.test("public acceptance keeps an unrelated historical retained landing out of current cleanup", async () => {
  await withTempDir(async (root) => {
    const earlier = await project(root, ["local"]);
    const done = await runAgent(earlier, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(done.code, 0, done.output);
    const first = await runAgent(earlier, ["accept", "--confirmed", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "accept");
    assertStringIncludes(firstResult.message ?? "", "until released");
    assert(firstResult.data !== undefined && "queue" in firstResult.data);
    assertEquals(firstResult.data?.queue?.map((row) => row.retirement), [
      "retained",
    ]);
    const later = await addWorktree(root, "independent-arrival");
    await Deno.writeTextFile(`${later}/arrival`, "independent work\n");
    await git(later, "add", "arrival");
    await git(later, "commit", "-m", "Add independent work");
    const ready = await runAgent(later, ["done", "--json"]);
    assertEquals(ready.code, 0, ready.output);
    const accepted = await runAgent(later, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(result.data !== undefined && "queue" in result.data);
    assertEquals(result.data?.queue?.map((row) => row.branch), [
      "refs/heads/agent/independent-arrival",
    ]);
    assertEquals(result.data?.queue?.map((row) => row.retirement), ["retired"]);
    assertEquals(await Deno.readTextFile(`${earlier}/source`), "authored\n");
    const retainedStatus = await runAgent(earlier, ["status", "--json"]);
    assertEquals(retainedStatus.code, 0, retainedStatus.output);
    const status = decodeCliResult(retainedStatus.stdout, "status");
    assertStringIncludes(
      status.message ?? "",
      await gitOut(earlier, "rev-parse", "HEAD"),
    );
    assertStringIncludes(status.message ?? "", "has landed");
    assertStringIncludes(status.message ?? "", "until released");
    assertEquals(
      firedHintsFromTexts(status.hints).some((hint) =>
        hint.id === "status-branch-behind"
      ),
      false,
    );
    for (const surface of [["--plain", "--no-color"], ["--markdown"]]) {
      const visible = await runAgent(earlier, ["status", ...surface]);
      assertEquals(visible.code, 0, visible.output);
      const prose = visible.stdout.replace(/\s+/g, " ");
      assertStringIncludes(prose, "has landed");
      assertStringIncludes(prose, "until released");
    }
    const release = await runAgent(earlier, [
      "done",
      "--release-checkout",
      "--json",
    ]);
    assertEquals(release.code, 0, release.output);
    const released = decodeCliResult(release.stdout, "done");
    assert(released.data !== undefined && "gate_ran" in released.data);
    assertEquals(released.data.gate_ran, false);
    assertEquals(await Deno.readTextFile(`${earlier}/executions`), "t");
    const cleanup = await runAgent(root, ["accept", "--json"]);
    assertEquals(cleanup.code, 0, cleanup.output);
    assertEquals(await pathExists(earlier), false);
    const cleaned = decodeCliResult(cleanup.stdout, "accept");
    assert(cleaned.data !== undefined && "storage_cleanup" in cleaned.data);
    assert(cleaned.data.storage_cleanup !== undefined);
    assertEquals(cleaned.data.storage_cleanup.state, "settled", cleanup.output);
    const retirement = cleaned.data.storage_cleanup.retirement_ids[0];
    assert(retirement !== undefined);
    const beforeRetry = await gitOut(root, "rev-parse", "HEAD");
    for (const selected of ["not-a-retirement-id", crypto.randomUUID()]) {
      const refused = await runAgent(root, [
        "accept",
        "--reclaim",
        selected,
        "--json",
      ]);
      assertEquals(refused.code, 1, refused.output);
      const refusal = decodeCliResult(refused.stdout, "accept");
      assert(refusal.data !== undefined && "storage_cleanup" in refusal.data);
      assertEquals(refusal.data.storage_cleanup?.state, "retained");
      assertEquals(await gitOut(root, "rev-parse", "HEAD"), beforeRetry);
    }
    for (const flags of [["--dry-run"], []]) {
      const retried = await runAgent(root, [
        "accept",
        "--reclaim",
        retirement,
        ...flags,
        "--json",
      ]);
      assertEquals(retried.code, 0, retried.output);
      const retry = decodeCliResult(retried.stdout, "accept");
      assert(retry.data !== undefined && "landing" in retry.data);
      assertEquals(retry.data.landing, {
        recovery_performed: false,
        trunk_landed: false,
        worktree_removed: false,
        branch_deleted: false,
      });
    }
  });
});
