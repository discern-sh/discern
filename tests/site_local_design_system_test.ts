/** Local design-system development keeps the published consumer pin untouched. */

import { assertEquals, assertThrows } from "@std/assert";
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
    localDesignSystemConfig(base, "/tmp/future-component-system"),
    {
      ...base,
      links: ["/tmp/future-component-system"],
      lock: false,
      nodeModulesDir: "none",
    },
  );
  assertEquals(base, snapshot);
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
