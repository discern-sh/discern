import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

/** One live-valid policy fixture; the committed form optionally carries a key
 * from a schema this running binary does not recognize. */
function policyConfig(unknownWorktreeKey: boolean): string {
  return [
    "[project]",
    'slug = "governing-config"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "true"',
    "",
    ...(unknownWorktreeKey ? ["[worktree]", "old_spelling = true", ""] : []),
    "[standards.guard]",
    'direction = "up"',
    "limit = 1",
    'run = "echo DISCERN_METRIC guard 1"',
    "",
    "[checkpoints.watch-source]",
    'paths = ["src/**"]',
    'mode = "advise"',
    'question = "Has the source change been reviewed?"',
    "",
  ].join("\n");
}

/** Find the governing-config advisory and require its exact ignored key. */
function assertIgnoredKey(
  result: ReturnType<typeof decodeCliResult>,
  path: string,
): void {
  const advisory = result.advisories?.find((entry) =>
    entry.kind === "governing-config-key-ignored"
  );
  assert(advisory !== undefined, JSON.stringify(result));
  assertStringIncludes(advisory.evidence.join("\n"), `'${path}'`);
}

Deno.test("an unknown historical worktree key cannot wedge governing standards or checkpoints and is advised", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [] });
    await writeConfig(dir, policyConfig(true));
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "agent/config-transition");

    // The branch has the current live spelling, while its merge-base retains a
    // key only the historical schema knew. Live reads must stay strict, so the
    // unknown key exists only in the committed governing copy.
    await writeConfig(dir, policyConfig(false));
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "change.ts"), "export {};\n");

    const prepared = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepared.code, 0, prepared.output);
    const prepareResult = decodeCliResult(prepared.stdout, "prepare");
    assertIgnoredKey(prepareResult, "worktree.old_spelling");

    const finished = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(finished.code, 0, finished.output);
    const doneResult = decodeCliResult(finished.stdout, "done");
    assertIgnoredKey(doneResult, "worktree.old_spelling");
    assert(
      doneResult.data !== undefined && "failed_stage" in doneResult.data,
      JSON.stringify(doneResult),
    );
    assertEquals(doneResult.data?.standards_limits?.status, "verified");
    assertEquals(
      doneResult.data?.checkpoints?.advise?.map((entry) => entry.id),
      ["watch-source"],
    );
  });
});
