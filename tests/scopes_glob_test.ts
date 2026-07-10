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

Deno.test("standard glob syntax matches — it never silently degrades to exact match", () => {
  // Any pattern carrying a glob metacharacter (* ? [ ] { }) that no legacy kind
  // claims must be interpreted as a standard glob. Before this table existed,
  // every one of these fell through to literal equality and matched nothing —
  // a scope so configured was permanently dead and its gate never ran.
  const cases: [path: string, pat: string, expected: boolean][] = [
    // any-depth star-star with a suffix
    ["src/app/main.ts", "src/**/*.ts", true],
    ["src/a.ts", "src/**/*.ts", true], // ** spans zero segments too
    ["lib/a.ts", "src/**/*.ts", false],
    ["src/app/main.css", "src/**/*.ts", false],
    // single-segment star
    ["src/a.ts", "src/*", true],
    ["src/app/main.ts", "src/*", false],
    // rooted any-depth
    ["a.ts", "**/*.ts", true],
    ["a/b/c.ts", "**/*.ts", true],
    ["a/b/c.tsx", "**/*.ts", false],
    // match-everything
    ["any/thing.md", "**", true],
    ["any/thing.md", "/**", true],
    // alternation
    ["src/a/b.ts", "{src,lib}/**", true],
    ["lib/a.ts", "{src,lib}/**", true],
    ["docs/a.md", "{src,lib}/**", false],
    // single-character wildcard
    ["cat.ts", "?at.ts", true],
    ["chat.ts", "?at.ts", false],
    // directory-scoped single segment
    ["docs/a.md", "docs/*.md", true],
    ["docs/x/a.md", "docs/*.md", false],
  ];
  for (const [path, pat, expected] of cases) {
    assertEquals(
      pathMatchesPattern(path, pat),
      expected,
      `pathMatchesPattern(${JSON.stringify(path)}, ${JSON.stringify(pat)})`,
    );
  }
});

Deno.test("legacy kinds keep their documented semantics next to standard globs", () => {
  // "*.ext" is the legacy suffix kind: any depth, where a standard glob would
  // stop at the first slash. The legacy kinds win their exact shapes; standard
  // semantics apply only to shapes no legacy kind claims.
  assertEquals(pathMatchesPattern("deep/nested/a.view", "*.view"), true);
  assertEquals(
    pathMatchesPattern("deep/nested/a.view", "*.{view,part}"),
    false,
  );
  assertEquals(pathMatchesPattern("a.view", "*.{view,part}"), true);
  assertEquals(pathMatchesPattern("app/ui/x", "/ui/"), true); // segment kind
  assertEquals(pathMatchesPattern("src/a", "src/**"), true); // prefix kind
});
