/** The shared local design-system link keeps the published consumer pin untouched. */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import {
  assertChildDesignSystemGraph,
  assertLocalDesignSystemPackage,
  CLI_DESIGN_SYSTEM_EXPORTS,
  designSystemGraphMismatch,
  designSystemSpecifier,
  isLocalPackageResolution,
  localDesignSystemConfig,
  resolveDesignSystemCheckout,
  SITE_DESIGN_SYSTEM_EXPORTS,
  withLocalDesignSystem,
} from "../scripts/local_design_system.ts";
import {
  cliDesignSystemCommand,
  DESK_CHECK_TARGETS,
  parseCliDesignSystemArgs,
} from "../scripts/cli_local_design_system.ts";
import { denoRunInvocation } from "../site/dev_invocation.ts";
import { mainRepoPath } from "../src/shared/main_repo.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import {
  authoredImportSpecifiers,
  moduleSpecifiers,
} from "./design_system_dependency.ts";
import { withTempDir } from "./helpers.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** The link a temporary config records. */
const LinkedConfigSchema = z.object({ links: z.array(z.string()) })
  .passthrough();

/** Write a minimal package checkout exposing exactly `exports`. */
async function writeLocalPackage(
  packageRoot: string,
  exports: readonly string[],
  version = "91.2.3",
): Promise<void> {
  const sourceRoot = join(packageRoot, "source");
  await Deno.mkdir(sourceRoot, { recursive: true });
  const entries = exports.map((exportPath, index) => {
    const file = `./source/export-${index}.ts`;
    return [exportPath, file] as const;
  });
  await Deno.writeTextFile(
    join(packageRoot, "deno.json"),
    `${
      JSON.stringify(
        {
          name: "@discern-sh/design-system",
          version,
          exports: Object.fromEntries(entries),
        },
        null,
        2,
      )
    }\n`,
  );
  for (const [exportPath, file] of entries) {
    await Deno.writeTextFile(
      join(packageRoot, file),
      `export const source = ${JSON.stringify(`local ${exportPath}`)};\n`,
    );
  }
}

Deno.test("the local design-system config overlays a link without mutating the consumer config", () => {
  const base = {
    imports: {
      "discern-design-system": "jsr:@discern-sh/design-system@0.12.0",
      react: "npm:react@18.3.1",
    },
    nodeModulesDir: "auto",
    tasks: { "site:build": "deno run site/build.ts" },
  };
  const snapshot = structuredClone(base);

  assertEquals(
    localDesignSystemConfig(base, "/tmp/future-component-system"),
    {
      ...base,
      imports: {
        ...base.imports,
        "discern-design-system": "jsr:@discern-sh/design-system",
      },
      links: ["/tmp/future-component-system"],
      lock: false,
      nodeModulesDir: "none",
    },
  );
  assertEquals(base, snapshot);
  assertThrows(
    () => localDesignSystemConfig({}, "/tmp/future-component-system"),
    Error,
    "must declare imports",
  );
});

Deno.test("the temporary link resolves an unrelated local version, and a bump while it serves, without changing the consumer pin", async () => {
  await withTempDir(async (temporaryRoot) => {
    const packageRoot = join(temporaryRoot, "future-layout-kit");
    const configPath = join(temporaryRoot, "deno.json");
    const consumer = {
      imports: {
        "discern-design-system": "jsr:@discern-sh/design-system@4.5.6",
      },
    };
    const snapshot = structuredClone(consumer);
    await writeLocalPackage(packageRoot, SITE_DESIGN_SYSTEM_EXPORTS);
    await Deno.writeTextFile(
      configPath,
      `${
        JSON.stringify(localDesignSystemConfig(consumer, packageRoot), null, 2)
      }\n`,
    );

    const resolveRuntime = async (): Promise<string> => {
      const probe = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--cached-only",
          "--config",
          configPath,
          'console.log(import.meta.resolve("discern-design-system/runtime"))',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        probe.success,
        true,
        new TextDecoder().decode(probe.stderr),
      );
      return new TextDecoder().decode(probe.stdout).trim();
    };
    assertEquals(
      isLocalPackageResolution(await resolveRuntime(), packageRoot),
      true,
    );
    // The checkout bumps its version while the preview keeps its config.
    const packageConfig = join(packageRoot, "deno.json");
    await Deno.writeTextFile(
      packageConfig,
      (await Deno.readTextFile(packageConfig)).replace("91.2.3", "92.0.0"),
    );
    assertEquals(
      isLocalPackageResolution(await resolveRuntime(), packageRoot),
      true,
      "a version bump in the checkout fell back to the registry",
    );
    assertEquals(consumer, snapshot);
  }, { prefix: "discern-local-package-guard-" });
});

Deno.test("the package guard requires every export of the selected surface", () => {
  for (
    const exports of [SITE_DESIGN_SYSTEM_EXPORTS, CLI_DESIGN_SYSTEM_EXPORTS]
  ) {
    const valid = {
      name: "@discern-sh/design-system",
      version: "91.2.3",
      exports: Object.fromEntries(
        exports.map((exportPath) => [exportPath, "./src/mod.ts"]),
      ),
    };
    assertLocalDesignSystemPackage(valid, "/tmp/design-system", exports);
    assertThrows(
      () =>
        assertLocalDesignSystemPackage(
          { ...valid, version: "future" },
          "/tmp/unversioned-kit",
          exports,
        ),
      Error,
      "semantic version",
    );
    assertThrows(
      () =>
        assertLocalDesignSystemPackage(
          { ...valid, name: "@example/future-kit" },
          "/tmp/future-kit",
          exports,
        ),
      Error,
      "@discern-sh/design-system",
    );
    for (const missing of exports) {
      const partial = Object.fromEntries(
        Object.entries(valid.exports).filter(([key]) => key !== missing),
      );
      assertThrows(
        () =>
          assertLocalDesignSystemPackage(
            { ...valid, exports: partial },
            "/tmp/incomplete-kit",
            exports,
          ),
        Error,
        `must export ${missing}`,
      );
    }
  }
});

Deno.test("resolution proof accepts any file in the selected checkout and rejects registry fallback", () => {
  assertEquals(
    isLocalPackageResolution(
      "file:///tmp/future-component-system/src/runtime.ts",
      "/tmp/future-component-system",
    ),
    true,
  );
  assertEquals(
    isLocalPackageResolution(
      "jsr:@discern-sh/design-system@0.12.0/runtime",
      "/tmp/future-component-system",
    ),
    false,
  );
  assertEquals(
    isLocalPackageResolution(
      "file:///tmp/another-checkout/src/runtime.ts",
      "/tmp/future-component-system",
    ),
    false,
  );
});

Deno.test("package export paths map to the specifiers discern imports", () => {
  assertEquals(
    CLI_DESIGN_SYSTEM_EXPORTS.map(designSystemSpecifier),
    [
      "discern-design-system",
      "discern-design-system/cli",
      "discern-design-system/cli/interactive",
      "discern-design-system/cli/interactive/testing",
      "discern-design-system/cli/projection",
    ],
  );
  assertThrows(() => designSystemSpecifier("cli"), TypeError, "./");
});

Deno.test("an explicit checkout wins; the default is the sibling of the main checkout", async () => {
  assertEquals(
    await resolveDesignSystemCheckout("/tmp/stream-worktree", () => {
      throw new Error("an explicit checkout must not query Git");
    }),
    "/tmp/stream-worktree",
  );
  assertEquals(
    await resolveDesignSystemCheckout(
      undefined,
      () => Promise.resolve("/srv/nebula-client"),
    ),
    "/srv/discern-design-system",
  );
  await assertRejects(
    () => resolveDesignSystemCheckout("  ", () => Promise.resolve("/srv/x")),
    Error,
    "cannot be empty",
  );
  await assertRejects(
    () =>
      resolveDesignSystemCheckout(undefined, () => Promise.resolve(undefined)),
    Error,
    "could not locate discern's main checkout",
  );
});

Deno.test("a CLI link proves every consumed export locally and leaves the dependency files unchanged", async () => {
  await withTempDir(async (temporaryRoot) => {
    const packageRoot = join(temporaryRoot, "linked-kit");
    await writeLocalPackage(packageRoot, CLI_DESIGN_SYSTEM_EXPORTS);
    const canonical = await Deno.realPath(packageRoot);
    const before = await Promise.all(
      ["deno.json", "deno.lock"].map((name) =>
        Deno.readTextFile(join(ROOT, name))
      ),
    );
    let seenConfig = "";
    const code = await withLocalDesignSystem(
      packageRoot,
      CLI_DESIGN_SYSTEM_EXPORTS,
      async (link) => {
        seenConfig = link.configPath;
        assertEquals(link.packageRoot, canonical);
        assertEquals(
          [...link.resolutions.keys()],
          CLI_DESIGN_SYSTEM_EXPORTS.map(designSystemSpecifier),
        );
        for (const resolution of link.resolutions.values()) {
          assert(isLocalPackageResolution(resolution, canonical), resolution);
        }
        const written = decodeWith(
          LinkedConfigSchema,
          await Deno.readTextFile(link.configPath),
        );
        assertEquals(written.links, [canonical]);
        return 7;
      },
    );
    assertEquals(code, 7);
    assert(seenConfig !== "");
    await assertRejects(() => Deno.stat(seenConfig), Deno.errors.NotFound);
    assertEquals(
      await Promise.all(
        ["deno.json", "deno.lock"].map((name) =>
          Deno.readTextFile(join(ROOT, name))
        ),
      ),
      before,
    );

    const siteOnly = join(temporaryRoot, "site-only-kit");
    await writeLocalPackage(siteOnly, SITE_DESIGN_SYSTEM_EXPORTS);
    await assertRejects(
      () =>
        withLocalDesignSystem(siteOnly, CLI_DESIGN_SYSTEM_EXPORTS, () => {
          throw new Error("a checkout without the CLI exports must not run");
        }),
      Error,
      "must export ./cli",
    );
  }, { prefix: "discern-local-package-lifecycle-" });
});

Deno.test("a child config must load the same design-system build as its parent", () => {
  const local = "file:///work/kit/src/cli/mod.ts";
  const published = "jsr:/@discern-sh/design-system@0.37.0/cli";
  assertEquals(
    designSystemGraphMismatch(local, { links: ["/work/kit"] }, "child.json"),
    undefined,
  );
  assertEquals(
    designSystemGraphMismatch(published, {}, "deno.json"),
    undefined,
  );
  const parentLocal = designSystemGraphMismatch(local, {}, "deno.json");
  assert(parentLocal?.includes("does not link that checkout"), parentLocal);
  const otherCheckout = designSystemGraphMismatch(
    local,
    { links: ["/work/other-kit"] },
    "child.json",
  );
  assert(otherCheckout?.includes("/work/kit/src/cli/mod.ts"), otherCheckout);
  const parentPublished = designSystemGraphMismatch(
    published,
    { links: ["/work/kit"] },
    "child.json",
  );
  assert(
    parentPublished?.includes("uses the published design system"),
    parentPublished,
  );
});

Deno.test("this pinned process refuses a linked child config and accepts its own", async () => {
  assertChildDesignSystemGraph(join(ROOT, "deno.json"));
  await withTempDir(async (temporaryRoot) => {
    const childConfig = join(temporaryRoot, "deno.json");
    await Deno.writeTextFile(
      childConfig,
      JSON.stringify(localDesignSystemConfig(
        { imports: {} },
        join(temporaryRoot, "kit"),
      )),
    );
    assertThrows(
      () => assertChildDesignSystemGraph(childConfig),
      Error,
      "uses the published design system",
    );
  });
});

Deno.test("the CLI export set covers every design-system specifier the CLI surfaces import", async () => {
  // The local loop proves only the exports it names. A CLI-side module that
  // imports another package export would run against the link unverified, so
  // every graph the CLI modes launch must stay inside the declared set.
  const declared = new Set<string>(
    CLI_DESIGN_SYSTEM_EXPORTS.map(designSystemSpecifier),
  );
  for (
    const entrypoint of [
      "src/main.ts",
      "scripts/desk_capture.ts",
      "scripts/terminal_capture.ts",
      "tests/fixtures/desk_tty_harness.ts",
    ]
  ) {
    const imported = await authoredImportSpecifiers(
      join(ROOT, entrypoint),
      "discern-design-system",
    );
    assert(imported.length > 0, `${entrypoint} imports no package export`);
    assertEquals(
      imported.filter((specifier) => !declared.has(specifier)),
      [],
      `${entrypoint} imports package exports the CLI link does not prove`,
    );
  }
});

Deno.test("the local design-system helpers load no design-system module", async () => {
  // The helpers run under the committed pin while their children run against
  // the link. A helper graph that reached the package, or a product module
  // rendering with it, would stop loading once discern adopts an API only the
  // linked checkout provides.
  for (
    const helper of [
      "scripts/local_design_system.ts",
      "scripts/site_local_design_system.ts",
      "scripts/cli_local_design_system.ts",
    ]
  ) {
    const modules = await moduleSpecifiers(join(ROOT, helper));
    assertEquals(
      modules.filter((specifier) =>
        specifier.includes("@discern-sh/design-system")
      ),
      [],
      `${helper} reaches the design system`,
    );
    assert(
      modules.includes(toFileUrl(join(ROOT, helper)).href),
      `${helper} graph was not read`,
    );
  }
});

/** The task table each helper's permission flags are read from. */
const DenoTasksSchema = z.object({ tasks: z.record(z.string(), z.string()) });

Deno.test("each helper task's sandbox finds the main checkout and supervises a child", async () => {
  // A helper runs under its task's own permission flags, not the test
  // runner's. Git reports a denied environment read as a failed run rather
  // than an exception, so the probe must return the lookup's value: a clean
  // exit alone would hide a helper that cannot find its default checkout.
  const expected = await mainRepoPath(ROOT);
  assert(expected !== undefined);
  const config = decodeWith(
    DenoTasksSchema,
    await Deno.readTextFile(join(ROOT, "deno.json")),
  );
  for (
    const [task, entry] of [
      ["site:design-system", "scripts/site_local_design_system.ts"],
      ["cli:design-system", "scripts/cli_local_design_system.ts"],
    ] as const
  ) {
    const invocation = denoRunInvocation(config.tasks[task] ?? "");
    assertEquals(invocation?.entry, entry, task);
    await withTempDir(async (dir) => {
      const probe = join(dir, "probe.ts");
      await Deno.writeTextFile(
        probe,
        [
          `import { mainRepoPath } from ${
            JSON.stringify(
              toFileUrl(join(ROOT, "src/shared/main_repo.ts")).href,
            )
          };`,
          `import { runOwnedChild } from ${
            JSON.stringify(
              toFileUrl(join(ROOT, "src/engine/owned_child.ts")).href,
            )
          };`,
          `console.log(JSON.stringify(await mainRepoPath(${
            JSON.stringify(ROOT)
          })));`,
          `const result = await runOwnedChild(Deno.execPath(), { args: ["eval", ""] });`,
          "Deno.exit(result.status.code);",
        ].join("\n"),
      );
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--config",
          join(ROOT, "deno.json"),
          ...(invocation?.permissionFlags ?? []),
          probe,
        ],
        cwd: ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.success,
        true,
        new TextDecoder().decode(output.stderr),
      );
      assertEquals(
        decodeWith(z.string(), new TextDecoder().decode(output.stdout)),
        expected,
        `${task} cannot find the main checkout under its own flags`,
      );
    });
  }
});

Deno.test("CLI loop arguments name a checkout, a mode, and its operands", () => {
  assertEquals(parseCliDesignSystemArgs(["check"]), {
    mode: "check",
    operands: [],
  });
  assertEquals(
    parseCliDesignSystemArgs([
      "--",
      "--checkout",
      "/work/kit",
      "desk",
      "--project",
      "/tmp/sandbox/project",
      "--",
      "--theme",
      "light",
    ]),
    {
      checkout: "/work/kit",
      mode: "desk",
      project: "/tmp/sandbox/project",
      operands: ["--theme", "light"],
    },
  );
  assertEquals(
    parseCliDesignSystemArgs(["test", "tests/a_test.ts", "tests/b_test.ts"])
      .operands,
    ["tests/a_test.ts", "tests/b_test.ts"],
  );
  for (
    const [args, message] of [
      [[], "choose a mode"],
      [["serve"], "choose a mode"],
      [["--checkout"], "--checkout needs a value"],
      [["test"], "name the test files"],
      [["capture", "a", "b"], "at most one output directory"],
      [["check", "--watch"], "takes no options"],
      [["desk", "--theme"], "after --"],
    ] as const
  ) {
    assertThrows(() => parseCliDesignSystemArgs(args), TypeError, message);
  }
});

Deno.test("every CLI loop child runs this source under the one linked config", () => {
  const config = "/tmp/link/deno.json";
  const deno = "/usr/local/bin/deno";
  const main = join(ROOT, "src/main.ts");
  const configsIn = (args: readonly string[]): string[] =>
    args.flatMap((argument, index) =>
      argument === "--config" ? [args[index + 1] ?? ""] : []
    );
  const plan = (args: readonly string[]) =>
    cliDesignSystemCommand(parseCliDesignSystemArgs(args), config, deno);

  const desk = plan(["desk", "--project", "/tmp/sandbox/project"]);
  assertEquals(desk.args, ["run", "--config", config, "-A", main, "desk"]);
  assertEquals(desk.cwd, "/tmp/sandbox/project");

  const capture = plan(["capture", "/tmp/gallery"]);
  assertEquals(capture.args.slice(0, 8), [
    "run",
    "--config",
    config,
    "-A",
    main,
    "queue",
    "--",
    deno,
  ]);
  assert(capture.args.includes(join(ROOT, "scripts/desk_capture.ts")));
  assertEquals(configsIn(capture.args), [config, config, config]);

  const test = plan(["test", "tests/engine_desk_live_test.ts"]);
  assertEquals(test.args.slice(4, 7), [main, "queue", "--"]);
  assert(test.args.includes(join(ROOT, "scripts/run_tests.ts")));
  assertEquals(configsIn(test.args), [config, config, config]);
  assertEquals(test.args.at(-1), "tests/engine_desk_live_test.ts");

  const check = plan(["check"]);
  assertEquals(check.args.slice(0, 3), ["check", "--config", config]);
  assertEquals(
    check.args.slice(3),
    DESK_CHECK_TARGETS.map((target) => join(ROOT, target)),
  );
  assertEquals(plan(["check", "src/main.ts"]).args.slice(3), ["src/main.ts"]);
});

Deno.test("the default check targets exist", async () => {
  for (const target of DESK_CHECK_TARGETS) {
    await Deno.stat(join(ROOT, target));
  }
});
