/** Real-browser accessibility audits sample colours only once motion settles. */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const TEST_MODULES = await structuralGuardScope({
  guard: "tests/browser_axe_settling_guard_test.ts#axe-in-a-real-page",
  universe: "authored-ts",
  narrow: {
    reason:
      "Browser accessibility audits run only from test code; production sources never inject axe.",
    include: (rel) => rel.startsWith("tests/"),
  },
});

Deno.test("a real-page axe audit goes through the helper that waits for transitions", async () => {
  const bypasses: string[] = [];
  for (const rel of TEST_MODULES) {
    if (rel === "tests/browser_helpers.ts") continue;
    const source = await Deno.readTextFile(join(ROOT, rel));
    if (/\.evaluate\(\s*axe\.source\b/.test(source)) bypasses.push(rel);
  }
  assertEquals(
    bypasses,
    [],
    "audit a Playwright page with axeFindings(), which settles transitions first",
  );
});
