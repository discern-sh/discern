/** Historical retention stays separate from current landing and cleanup. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { firedHintsFromTexts } from "../src/shared/hints.ts";

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
    assertStringIncludes(firstResult.message ?? "", "has not been released");
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
    assertStringIncludes(status.message ?? "", "has not been released");
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
      assertStringIncludes(prose, "has not been released");
    }
  });
});
