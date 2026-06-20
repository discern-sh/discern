import { assertEquals } from "@std/assert";
import { pathMatchesPattern } from "../src/engine/scopes/glob.ts";

Deno.test("prefix kinds: src/** and src/", () => {
  assertEquals(pathMatchesPattern("src/a/b.ts", "src/**"), true);
  assertEquals(pathMatchesPattern("src/a", "src/**"), true);
  assertEquals(pathMatchesPattern("srcx/a", "src/**"), false);
  assertEquals(pathMatchesPattern("src/a", "src/"), true);
  assertEquals(pathMatchesPattern("other/a", "src/"), false);
});

Deno.test("segment is tested before the trailing-slash prefix (branch order)", () => {
  assertEquals(pathMatchesPattern("app/ui/x", "/ui/"), true);
  assertEquals(pathMatchesPattern("app/ux/x", "/ui/"), false);
  // a deep path under app/ui must still match the segment, not be swallowed.
  assertEquals(pathMatchesPattern("app/ui/deep/nested.ts", "/ui/"), true);
});

Deno.test("suffix and exact", () => {
  assertEquals(pathMatchesPattern("a/b.view", "*.view"), true);
  assertEquals(pathMatchesPattern("a/b.viewx", "*.view"), false);
  assertEquals(pathMatchesPattern("routes/web.php", "routes/web.php"), true);
  assertEquals(pathMatchesPattern("routes/web.phpx", "routes/web.php"), false);
});

Deno.test("empty pattern matches nothing", () => {
  assertEquals(pathMatchesPattern("anything", ""), false);
});
