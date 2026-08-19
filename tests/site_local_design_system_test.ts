/** Local design-system development keeps the published consumer pin untouched. */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  assertLocalDesignSystemPackage,
  isLocalPackageResolution,
  localDesignSystemConfig,
  parseLocalDesignSystemArgs,
} from "../scripts/site_local_design_system.ts";

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
  const temporaryRoot = await Deno.makeTempDir({
    prefix: "discern-local-package-guard-",
  });
  const packageRoot = join(temporaryRoot, "future-layout-kit");
  const sourceRoot = join(packageRoot, "source");
  const configPath = join(temporaryRoot, "deno.json");
  const consumer = {
    imports: {
      "discern-design-system": "jsr:@discern-sh/design-system@4.5.6",
    },
  };
  const snapshot = structuredClone(consumer);

  try {
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
  } finally {
    await Deno.remove(temporaryRoot, { recursive: true });
  }
});

Deno.test("local design-system arguments accept an explicit checkout or the dedicated environment fallback", () => {
  assertEquals(
    parseLocalDesignSystemArgs(
      ["--", "--build-only", "/tmp/component-worktree"],
      undefined,
    ),
    { buildOnly: true, packageRoot: "/tmp/component-worktree" },
  );
  assertEquals(
    parseLocalDesignSystemArgs([], "/tmp/environment-worktree"),
    { buildOnly: false, packageRoot: "/tmp/environment-worktree" },
  );
  assertThrows(
    () => parseLocalDesignSystemArgs([], undefined),
    Error,
    "design-system checkout",
  );
  assertThrows(
    () =>
      parseLocalDesignSystemArgs(
        ["/tmp/one", "/tmp/two"],
        undefined,
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
