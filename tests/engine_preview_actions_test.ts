/** Executable scope previews are advisory projections, never Gate effects. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { pathExists } from "../src/shared/fs_presence.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

Deno.test("done reports configured preview actions without executing them", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "preview-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[scopes.web]",
        'paths = ["web/**"]',
        'preview = "touch preview-action-ran"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await Deno.mkdir(join(dir, "web"), { recursive: true });
    await Deno.writeTextFile(join(dir, "web/change.txt"), "change\n");

    const result = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = decodeCliResult(result.stdout, "done");
    assertResultDataKey(parsed, "preview_actions");
    assertEquals(parsed.data.preview_actions, [{
      scope: "web",
      command: "touch preview-action-ran",
    }]);
    assert(
      parsed.hints?.some((hint) =>
        hint.includes("touch preview-action-ran") &&
        hint.includes("did not run it")
      ),
      result.stdout,
    );
    assertEquals(await pathExists(join(dir, "preview-action-ran")), false);

    const markdown = await runAgent(dir, [
      "done",
      "--standalone",
      "--markdown",
    ]);
    assertEquals(markdown.code, 0, markdown.output);
    assertTerminalTextIncludes(markdown.stdout, "touch preview-action-ran");
    assertTerminalTextIncludes(markdown.stdout, "did not run this command");
    assertEquals(await pathExists(join(dir, "preview-action-ran")), false);

    const terminal = await runAgent(dir, [
      "done",
      "--standalone",
      "--no-color",
    ]);
    assertEquals(terminal.code, 0, terminal.output);
    assertTerminalTextIncludes(terminal.stdout, "touch preview-action-ran");
    assertTerminalTextIncludes(terminal.stdout, "did not run it");
    assertEquals(await pathExists(join(dir, "preview-action-ran")), false);
  });
});
