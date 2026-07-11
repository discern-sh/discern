import { assert, assertEquals } from "@std/assert";
import {
  classifyPattern,
  pathMatchesPattern,
  PATTERN_KINDS,
} from "../src/engine/scopes/glob.ts";

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

// The CLASS guard for B26: "a pattern kind whose matcher disagrees with its
// documented contract for some legal path shape". Every kind in the registry
// (the single source of truth) is exercised at every path POSITION — a
// first-segment (root) directory, a nested directory, and, for kinds that
// accept a leading slash, the slash present vs. absent. The regression that
// prompted this: the segment kind `/ui/` matched a nested `app/ui/x` but NOT a
// root-level `ui/x`, because it was `path.includes("/ui/")` and root-relative
// paths carry no leading slash. Driven off PATTERN_KINDS so a new kind can't
// ship without declaring its position contract here (the completeness check
// below fails until it does).
Deno.test("every pattern kind matches its contract at every path position", () => {
  // For each kind: an example pattern of that shape, plus paths that MUST match
  // and paths that MUST NOT — chosen to cover the root (first-segment) position
  // explicitly, the position the pre-fix segment matcher got wrong.
  const contract: Record<
    string,
    { pattern: string; match: string[]; noMatch: string[] }[]
  > = {
    "prefix-globstar": [
      {
        pattern: "ui/**",
        // root-anchored prefix: first-segment directory and deeper both match.
        match: ["ui/button.ts", "ui/deep/nested.ts"],
        // "ui/**" means "inside ui/": a bare "ui" with no children is not under
        // the prefix, and a partial or nested "ui" is unrelated.
        noMatch: ["ui", "uix/a", "app/ui/x", "other/a"],
      },
      {
        pattern: "/**", // leading slash → the whole tree
        match: ["ui/button.ts", "anything", "a/b/c"],
        noMatch: [],
      },
    ],
    "segment": [
      {
        pattern: "/ui/",
        // "ui" as a directory segment at ANY depth — INCLUDING the repo root.
        match: ["ui/button.ts", "app/ui/x", "b/ui/deep/z", "ui/"],
        // not a partial segment, and not a leaf file named "ui".
        noMatch: ["uix/y", "app/uix/b", "a/xui/b", "ui", "a/ui"],
      },
    ],
    "prefix": [
      {
        pattern: "src/",
        // trailing-slash prefix: first-segment directory anchored at root.
        match: ["src/a", "src/deep/b.ts"],
        noMatch: ["srcx/a", "app/src/a", "other/a"],
      },
    ],
    "suffix": [
      {
        pattern: "*.view",
        // suffix at ANY depth: root-level leaf and nested both match.
        match: ["a.view", "deep/nested/a.view"],
        noMatch: ["a.viewx", "a.views", "view"],
      },
    ],
    "standard-glob": [
      {
        pattern: "ui/*.ts",
        // a single-segment star anchored at a root directory.
        match: ["ui/button.ts"],
        noMatch: ["ui/deep/x.ts", "app/ui/button.ts"],
      },
      {
        pattern: "**/*.ts",
        // any depth, root-level file included.
        match: ["a.ts", "a/b/c.ts"],
        noMatch: ["a.tsx"],
      },
    ],
    "exact": [
      {
        pattern: "routes/web.php",
        match: ["routes/web.php"],
        // a nested copy of the same tail is NOT the exact path.
        noMatch: ["app/routes/web.php", "routes/web.phpx"],
      },
      {
        pattern: "main.ts", // a root-level exact path (no slash)
        match: ["main.ts"],
        noMatch: ["src/main.ts", "main.tsx"],
      },
    ],
  };

  for (const kind of PATTERN_KINDS) {
    const rows = contract[kind.name];
    // Completeness: every registered kind must be covered, so a newly added
    // kind can't ship without a position contract. This is what makes the guard
    // enrol new members off the single source of truth.
    assert(
      rows !== undefined && rows.length > 0,
      `pattern kind "${kind.name}" has no contract cases — add root/nested ` +
        `position cases so its matcher is guarded at every path position`,
    );
    for (const { pattern, match, noMatch } of rows) {
      // The example pattern really is the kind under test (recognizers ordered).
      assertEquals(
        classifyPattern(pattern)?.name,
        kind.name,
        `example ${JSON.stringify(pattern)} should classify as "${kind.name}"`,
      );
      for (const path of match) {
        assertEquals(
          pathMatchesPattern(path, pattern),
          true,
          `[${kind.name}] ${JSON.stringify(path)} must match ` +
            `${JSON.stringify(pattern)}`,
        );
      }
      for (const path of noMatch) {
        assertEquals(
          pathMatchesPattern(path, pattern),
          false,
          `[${kind.name}] ${JSON.stringify(path)} must NOT match ` +
            `${JSON.stringify(pattern)}`,
        );
      }
    }
  }
});
