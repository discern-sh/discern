/**
 * Binary distribution inputs come from Git's authored-file projection, not the
 * physical directory tree. Ignored machine state must stay out of release
 * binaries, while an uncommitted but non-ignored source file remains buildable.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  authoredDistributionFiles,
  compileArguments,
  distributionExclusions,
} from "../scripts/build.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("binary inputs include authored files and exclude ignored or host metadata", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "templates/nested"), { recursive: true });
    await Deno.mkdir(join(root, "src/lib/tidy_plugins"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(root, ".gitignore"),
      ".DS_Store\n*.machine-state\n",
    );
    await Deno.writeTextFile(join(root, "templates/seed.txt"), "seed\n");
    await Deno.writeTextFile(
      join(root, "templates/.hidden-template"),
      "hidden but authored\n",
    );
    await Deno.writeTextFile(
      join(root, "src/lib/tidy_plugins/format.wasm"),
      "fixture\n",
    );
    await Deno.writeTextFile(
      join(root, "templates/nested/.DS_Store"),
      "finder\n",
    );
    await gitInit(root);

    // A force-added host artifact is still not a distribution input. This is
    // defense in depth beyond the ordinary Git-ignore boundary.
    await git(root, "add", "-f", "templates/nested/.DS_Store");

    // New authored work must build before its first commit.
    await Deno.writeTextFile(
      join(root, "templates/new file.txt"),
      "new\n",
    );
    // Fresh-name probe: exclusion comes from Git, not a `.DS_Store` denylist.
    await Deno.writeTextFile(
      join(root, "templates/local.machine-state"),
      "machine\n",
    );

    const authored = await authoredDistributionFiles(root);
    assertEquals(authored, [
      "src/lib/tidy_plugins/format.wasm",
      "templates/.hidden-template",
      "templates/new file.txt",
      "templates/seed.txt",
    ]);
    assertEquals(
      await distributionExclusions(
        root,
        ["templates", "src/lib/tidy_plugins"],
        authored,
      ),
      ["templates/local.machine-state", "templates/nested"],
    );
  });
});

Deno.test("compile arguments bound distribution roots with exact exclusions", () => {
  const args = compileArguments(
    {
      triple: "aarch64-apple-darwin",
      output: "discern-aarch64-apple-darwin",
      runner: "fixture",
    },
    "dist/discern-aarch64-apple-darwin",
    ".discern-bundled-docs",
    ["templates", "src/lib/tidy_plugins"],
    ["templates/.DS_Store", "templates/local.machine-state"],
  );
  const includes = args.flatMap((arg, index) =>
    arg === "--include" ? [args[index + 1]] : []
  );
  assertEquals(includes, [
    "templates",
    "src/lib/tidy_plugins",
    ".discern-bundled-docs",
  ]);
  const excludes = args.flatMap((arg, index) =>
    arg === "--exclude" ? [args[index + 1]] : []
  );
  assertEquals(excludes, [
    "templates/.DS_Store",
    "templates/local.machine-state",
  ]);
});
