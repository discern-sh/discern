/** Host metadata stays outside Git-derived mechanical source projections. */

import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { isHostMetadataPath } from "../src/shared/host_metadata.ts";
import { authoredTextFiles } from "./repo_authored_paths.ts";
import { withTempDir } from "./helpers.ts";

/** Run one Git command successfully in a fixture repository. */
async function runGit(root: string, args: string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
}

Deno.test("host metadata recognition is narrow and path-aware", () => {
  const cases = new Map<string, boolean>([
    [".DS_Store", true],
    ["nested/._SKILL.md", true],
    ["nested/Thumbs.db", true],
    ["nested/Desktop.ini", true],
    [".Spotlight-V100/index", true],
    [".gitignore.fragment", false],
    [".claude/settings.json.tmpl", false],
    ["nested/use._data", false],
    [".well-known/config", false],
  ]);
  for (const [path, expected] of cases) {
    assertEquals(isHostMetadataPath(path), expected, path);
  }
});

Deno.test("authored-file guards omit force-added host metadata", async () => {
  await withTempDir(async (root) => {
    const files = new Map([
      [".gitignore", ".DS_Store\nThumbs.db\n.Spotlight-V100/\n"],
      [".well-known/config", "authored hidden file"],
      ["ordinary/.hidden", "untracked but not ignored"],
      [".DS_Store", "finder"],
      ["nested/Thumbs.db", "explorer"],
      [".Spotlight-V100/index", "spotlight"],
    ]);
    for (const [rel, text] of files) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeTextFile(join(root, rel), text);
    }

    await runGit(root, ["init", "--quiet"]);
    await runGit(root, ["add", ".gitignore", ".well-known/config"]);
    await runGit(root, [
      "add",
      "--force",
      ".DS_Store",
      "nested/Thumbs.db",
      ".Spotlight-V100/index",
    ]);

    assertEquals(await authoredTextFiles(root), [
      ".gitignore",
      ".well-known/config",
      "ordinary/.hidden",
    ]);
  });
});
