/** Historical retention stays separate from current landing and cleanup. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, runAgent } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

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
  });
});
