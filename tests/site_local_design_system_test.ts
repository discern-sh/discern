/** Local design-system development keeps the published consumer pin untouched. */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  assertLocalDesignSystemPackage,
  isLocalPackageResolution,
  localDesignSystemConfig,
  resolveLocalDesignSystemArgs,
  serverArgs,
  watchTaskCommand,
} from "../scripts/site_local_design_system.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("the linked server derives its sandbox from the watch task", () => {
  const args = serverArgs(
    "/tmp/link/deno.json",
    "/tmp/future-component-system",
    "deno run --watch --allow-read --allow-run --allow-env=PORT,EXAMPLE site/dev.ts --watch",
  );
  const entryIndex = args.findIndex((argument) =>
    argument.endsWith("site/dev.ts")
  );
  assertEquals(entryIndex > 0, true, args.join(" "));
  const sandbox = args.slice(0, entryIndex);
  assertEquals(sandbox.includes("--allow-env=PORT,EXAMPLE"), true);
  assertEquals(sandbox.includes("--allow-read"), true);
  assertEquals(sandbox.includes("--allow-run"), true);
  assertEquals(sandbox.includes("--allow-write"), true);
  assertEquals(
    args.slice(entryIndex + 1),
    [
      "--watch",
      "--build-config",
      "/tmp/link/deno.json",
      "--watch-input",
      join("/tmp/future-component-system", "src"),
      "--watch-input",
      join("/tmp/future-component-system", "deno.json"),
    ],
  );

  assertThrows(
    () => serverArgs("/tmp/link/deno.json", "/tmp/pkg", "deno fmt"),
    Error,
    "watch task",
  );
  assertThrows(
    () =>
      serverArgs(
        "/tmp/link/deno.json",
        "/tmp/pkg",
        "deno run --allow-read site/main.ts",
      ),
    Error,
    "site/dev.ts",
  );

  assertEquals(
    watchTaskCommand({ tasks: { watch: "deno run site/dev.ts" } }),
    "deno run site/dev.ts",
  );
  assertThrows(() => watchTaskCommand({}), Error, "watch task");
});

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
    localDesignSystemConfig(
      base,
      "/tmp/future-component-system",
      "91.2.3",
    ),
    {
      ...base,
      imports: {
        ...base.imports,
        "discern-design-system": "jsr:@discern-sh/design-system@91.2.3",
      },
      links: ["/tmp/future-component-system"],
      lock: false,
      nodeModulesDir: "none",
    },
  );
  assertEquals(base, snapshot);
});

Deno.test("the temporary link resolves an unrelated local version without changing the consumer pin", async () => {
  await withTempDir(async (temporaryRoot) => {
    const packageRoot = join(temporaryRoot, "future-layout-kit");
    const sourceRoot = join(packageRoot, "source");
    const configPath = join(temporaryRoot, "deno.json");
    const consumer = {
      imports: {
        "discern-design-system": "jsr:@discern-sh/design-system@4.5.6",
      },
    };
    const snapshot = structuredClone(consumer);

    await Deno.mkdir(sourceRoot, { recursive: true });
    await Deno.writeTextFile(
      join(packageRoot, "deno.json"),
      `${
        JSON.stringify(
          {
            name: "@discern-sh/design-system",
            version: "91.2.3",
            exports: {
              ".": "./source/mod.ts",
              "./react": "./source/react.ts",
              "./runtime": "./source/runtime.ts",
            },
          },
          null,
          2,
        )
      }\n`,
    );
    for (const name of ["mod", "react", "runtime"]) {
      await Deno.writeTextFile(
        join(sourceRoot, `${name}.ts`),
        `export const source = "local-${name}";\n`,
      );
    }

    const temporaryConfig = localDesignSystemConfig(
      consumer,
      packageRoot,
      "91.2.3",
    );
    await Deno.writeTextFile(
      configPath,
      `${JSON.stringify(temporaryConfig, null, 2)}\n`,
    );

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
    const resolution = new TextDecoder().decode(probe.stdout).trim();
    assertEquals(
      probe.success,
      true,
      new TextDecoder().decode(probe.stderr),
    );
    assertEquals(isLocalPackageResolution(resolution, packageRoot), true);
    assertEquals(
      (temporaryConfig.imports as Record<string, string>)[
        "discern-design-system"
      ],
      "jsr:@discern-sh/design-system@91.2.3",
    );
    assertEquals(consumer, snapshot);
  }, { prefix: "discern-local-package-guard-" });
});

Deno.test("local design-system arguments resolve overrides before the conventional sibling checkout", async () => {
  let mainCheckoutQueries = 0;
  const mainCheckout = (): Promise<string> => {
    mainCheckoutQueries += 1;
    return Promise.resolve("/srv/nebula-client");
  };

  assertEquals(
    await resolveLocalDesignSystemArgs(
      ["--", "--build-only", "/tmp/component-worktree"],
      undefined,
      mainCheckout,
    ),
    { buildOnly: true, packageRoot: "/tmp/component-worktree" },
  );
  assertEquals(
    await resolveLocalDesignSystemArgs(
      [],
      "/tmp/environment-worktree",
      mainCheckout,
    ),
    { buildOnly: false, packageRoot: "/tmp/environment-worktree" },
  );
  assertEquals(
    await resolveLocalDesignSystemArgs([], undefined, mainCheckout),
    { buildOnly: false, packageRoot: "/srv/discern-design-system" },
  );
  assertEquals(mainCheckoutQueries, 1);

  await assertRejects(
    () =>
      resolveLocalDesignSystemArgs(
        [],
        undefined,
        () => Promise.resolve(undefined),
      ),
    Error,
    "could not locate discern's main checkout",
  );
  await assertRejects(
    () =>
      resolveLocalDesignSystemArgs(
        ["/tmp/one", "/tmp/two"],
        undefined,
        mainCheckout,
      ),
    Error,
    "one design-system checkout",
  );
});

Deno.test("the package guard rejects a freshly named non-package sibling", () => {
  const valid = {
    name: "@discern-sh/design-system",
    version: "91.2.3",
    exports: {
      ".": "./src/mod.ts",
      "./react": "./src/react.ts",
      "./runtime": "./src/runtime.ts",
    },
  };
  assertLocalDesignSystemPackage(valid, "/tmp/design-system");
  assertThrows(
    () =>
      assertLocalDesignSystemPackage(
        { ...valid, version: "future" },
        "/tmp/unversioned-kit",
      ),
    Error,
    "semantic version",
  );
  assertThrows(
    () =>
      assertLocalDesignSystemPackage(
        { ...valid, name: "@example/future-kit" },
        "/tmp/future-kit",
      ),
    Error,
    "@discern-sh/design-system",
  );
  assertThrows(
    () =>
      assertLocalDesignSystemPackage(
        { ...valid, exports: { ".": "./mod.ts" } },
        "/tmp/incomplete-kit",
      ),
    Error,
    "must export",
  );
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
