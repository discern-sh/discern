/**
 * Binary distribution inputs come from Git's authored-file projection, not the
 * physical directory tree. Ignored machine state must stay out of release
 * binaries, while an uncommitted but non-ignored source file remains buildable.
 *
 * Guards: boundary:offline-owned-engine, boundary:production-dependency-closure
 */

import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { globToRegExp, join } from "@std/path";
import {
  authoredDistributionFiles,
  compileArguments,
  distributionExclusions,
  stageBundledManual,
} from "../scripts/build.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { BUNDLED_MANUAL_STAGE_DIR } from "../src/lib/paths.ts";
import { observeValidationInputs } from "../src/engine/validation/runtime.ts";
import { EDITOR_PATH_POLICIES } from "../scripts/repository_files.ts";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

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
    BUNDLED_MANUAL_STAGE_DIR,
    ["templates", "src/lib/tidy_plugins"],
    ["templates/.DS_Store", "templates/local.machine-state"],
  );
  const includes = args.flatMap((arg, index) =>
    arg === "--include" ? [args[index + 1]] : []
  );
  assertEquals(includes, [
    "templates",
    "src/lib/tidy_plugins",
    BUNDLED_MANUAL_STAGE_DIR,
  ]);
  const excludes = args.flatMap((arg, index) =>
    arg === "--exclude" ? [args[index + 1]] : []
  );
  assertEquals(excludes, [
    "templates/.DS_Store",
    "templates/local.machine-state",
  ]);
  assertEquals(
    args.some((arg) => arg === "--allow-net" || arg.startsWith("--allow-net=")),
    false,
    "the public binary must not carry Deno network permission",
  );
});

Deno.test("compile arguments embed only npm packages in the product graph", () => {
  const args = compileArguments(
    {
      triple: "x86_64-unknown-linux-gnu",
      output: "discern-x86_64-unknown-linux-gnu",
      runner: "fixture",
    },
    "dist/discern-x86_64-unknown-linux-gnu",
    BUNDLED_MANUAL_STAGE_DIR,
    ["templates", "src/lib/tidy_plugins"],
    [],
  );

  assertEquals(
    args.includes("--bundle"),
    true,
    "production compilation must not embed raw npm files with build-host cache paths",
  );
  assertEquals(
    args.includes("--node-modules-dir=none"),
    true,
    "production compilation must not project the workspace's physical node_modules tree",
  );
  assertEquals(
    args.includes("--exclude-unused-npm"),
    true,
    "an npm dependency used only by an unrelated development tool must stay outside the binary",
  );
});

Deno.test("live binary scratch stays outside source scans and inside the environment declaration", async () => {
  await withTempDir(async (root) => {
    await Deno.copyFile(
      join(REPO_ROOT, ".gitignore"),
      join(root, ".gitignore"),
    );
    await gitInit(root);
    const staged = await stageBundledManual(
      REPO_AUTHORED_PATHS.manual,
      join(root, BUNDLED_MANUAL_STAGE_DIR, "docs"),
    );
    const compilerScratch = `.deno_compile_bundle_${crypto.randomUUID()}.mjs`;
    const outputs = [
      ...staged.map((path) => `${BUNDLED_MANUAL_STAGE_DIR}/docs/${path}`),
      compilerScratch,
      ...BUILD_TARGETS.map((target) => `dist/${target.output}`),
    ];
    for (
      const path of [
        compilerScratch,
        ...outputs.filter((path) => path.startsWith("dist/")),
      ]
    ) {
      await Deno.mkdir(join(root, path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, path), "temporary build output\n");
    }
    // The scan completes while every output still exists; cleanup cannot mask overlap.
    assertEquals(
      await structuralGuardScope({
        guard:
          "tests/build_distribution_inputs_test.ts#build-output-source-closure",
        universe: "authored-text",
      }, root),
      [".gitignore"],
    );
    assertEquals(await gitOut(root, "status", "--porcelain=v1"), "");
    const config = await loadConfig(REPO_ROOT);
    const exclusions = z.object({ exclude: z.array(z.string()) });
    const deno = decodeWith(
      z.object({ fmt: exclusions, lint: exclusions, test: exclusions }),
      await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
    );
    for (const section of [deno.fmt, deno.lint, deno.test]) {
      const excludes = section.exclude.map((pattern) =>
        globToRegExp(pattern.endsWith("/") ? `${pattern}**` : pattern)
      );
      assertEquals(
        outputs.filter((path) =>
          !excludes.some((pattern) => pattern.test(path))
        ),
        [],
      );
    }
    assert(
      EDITOR_PATH_POLICIES.some((entry) =>
        entry.path === BUNDLED_MANUAL_STAGE_DIR
      ),
    );
    assert(
      (await Deno.readTextFile(join(REPO_ROOT, ".idea/discern.iml"))).includes(
        BUNDLED_MANUAL_STAGE_DIR,
      ),
    );
    const implicit = await observeValidationInputs(root);
    assertEquals(Object.keys(implicit.files), [".gitignore"]);
    const declared = await observeValidationInputs(root, [compilerScratch]);
    assert(declared.files[compilerScratch] !== undefined && declared.complete);
    await Deno.writeTextFile(
      join(root, compilerScratch),
      "changed toolchain identity\n",
    );
    assert(
      (await observeValidationInputs(root, [compilerScratch]))
        .files[compilerScratch]?.digest !==
        declared.files[compilerScratch]?.digest,
    );
    const ignored = config.execution.local?.ignored.map((pattern) =>
      globToRegExp(pattern)
    );
    assert(ignored !== undefined);
    assertEquals(
      outputs.filter((path) => !ignored.some((pattern) => pattern.test(path))),
      [],
    );
    for (const path of outputs) {
      assert((await Deno.stat(join(root, path))).isFile);
    }

    await Deno.mkdir(join(root, "unrelated_workspace"));
    await Deno.writeTextFile(
      join(root, "unrelated_workspace/future.ts"),
      "authored\n",
    );
    await git(root, "add", "-f", compilerScratch);
    assertEquals(
      await structuralGuardScope({
        guard:
          "tests/build_distribution_inputs_test.ts#build-output-authored-changes",
        universe: "authored-text",
      }, root),
      [".gitignore", compilerScratch, "unrelated_workspace/future.ts"].sort(),
    );
  });
});
