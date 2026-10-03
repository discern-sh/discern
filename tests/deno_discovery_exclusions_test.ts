/**
 * Git-ignored paths stay out of Deno's file discovery.
 *
 * `deno fmt` and `deno lint` skip Git-ignored paths on their own, but
 * `deno check` and `deno test` walk everything under the project root. Ignored
 * scratch modules — agent probes, capture tools, an interrupted build's
 * bundle — would otherwise fail the gate's typecheck and test stages with
 * errors unrelated to the change. The top-level `exclude` in deno.json
 * therefore names every pattern a tracked `.gitignore` ignores, less the
 * reasoned `DENO_VISIBLE_IGNORE_PATTERNS`.
 *
 * Every pattern counts, whatever its spelling: a slashless name or a `dir/*`
 * glob ignores directories as surely as a trailing-slash root does, and a
 * nested `.gitignore` ignores paths beneath its own directory. A newly ignored
 * pattern therefore fails here until it is excluded or registered. The
 * reverse direction keeps the top-level list, which hides paths from every
 * Deno command at once, from ever naming authored source. A behavioral check
 * plants broken modules under every hidden pattern and runs Deno's own
 * discovery commands against the repository's real exclusion list.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { basename, dirname, globToRegExp, join } from "@std/path";
import {
  DENO_DISCOVERY_COMMANDS,
  type DenoDiscoveryCommand,
  type DenoExclusions,
  readDenoExclusions,
} from "../scripts/deno_exclusions.ts";
import {
  DENO_VISIBLE_IGNORE_PATTERNS,
  type DenoVisibleIgnorePattern,
} from "../scripts/repository_files.ts";
import { GENERATED_SITE_OUTPUTS } from "../site/build.ts";
import { assertNamedCases } from "./assert_cases.ts";
import { DENO_MODULE_EXTENSIONS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./temp_dir.ts";

/** One `.gitignore` pattern, translated to the form deno.json's `exclude` takes. */
interface IgnorePattern {
  /**
   * Relative to the repository root. An unanchored pattern gains a `**\/`
   * prefix, and a directory-only pattern keeps its trailing slash.
   */
  readonly pattern: string;
  /** A `!` pattern re-includes what an earlier pattern ignored. */
  readonly negated: boolean;
  /** `<.gitignore path>:<line>`, for diagnostics. */
  readonly source: string;
}

/**
 * Translate one `.gitignore` file's patterns, in order, to Deno exclude form.
 * A pattern with a slash before its end is anchored to the file's directory;
 * any other pattern matches at every depth beneath it. A trailing slash keeps
 * its directory-only meaning, and the absence of one ignores files and
 * directories alike.
 */
function gitignorePatterns(file: string, text: string): IgnorePattern[] {
  const directory = dirname(file);
  const base = directory === "." ? "" : `${directory}/`;
  const patterns: IgnorePattern[] = [];
  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("#")) return;
    const source = `${file}:${index + 1}`;
    if (line.includes("\\")) {
      throw new Error(
        `${source} escapes a character, which gitignorePatterns does not ` +
          "translate yet; teach it the escape before relying on the pattern",
      );
    }
    const negated = line.startsWith("!");
    const body = negated ? line.slice(1) : line;
    const directoryOnly = body.endsWith("/");
    const name = directoryOnly ? body.slice(0, -1) : body;
    const path = name.includes("/") ? name.replace(/^\//u, "") : `**/${name}`;
    patterns.push({
      pattern: `${base}${path}${directoryOnly ? "/" : ""}`,
      negated,
      source,
    });
  });
  return patterns;
}

/** Whether `pattern` matches `path` or one of its ancestor directories. */
function covers(pattern: string, path: string): boolean {
  const matcher = globToRegExp(pattern.replace(/\/$/u, ""), {
    globstar: true,
  });
  const parts = path.replace(/\/$/u, "").split("/");
  return parts.some((_, index) =>
    matcher.test(parts.slice(0, index + 1).join("/"))
  );
}

/** The later negations that re-include a path beneath `patterns[index]`. */
function reincluding(
  patterns: readonly IgnorePattern[],
  index: number,
): IgnorePattern[] {
  const ignored = patterns[index];
  if (ignored === undefined) return [];
  return patterns.slice(index + 1).filter((later) =>
    later.negated && covers(ignored.pattern, later.pattern)
  );
}

/**
 * Whether a pattern's final segment could name a JavaScript or TypeScript
 * module. A glob decides the name's extension only when a dot follows its
 * last wildcard.
 */
function couldNameModule(pattern: string): boolean {
  const segment = pattern.split("/").at(-1) ?? "";
  const wildcard = Math.max(
    ...["*", "?", "[", "]"].map((glob) => segment.lastIndexOf(glob)),
  );
  const literal = segment.slice(wildcard + 1);
  if (wildcard >= 0 && !literal.includes(".")) return true;
  return DENO_MODULE_EXTENSIONS.some((extension) =>
    literal.endsWith(extension)
  );
}

/** A concrete module path beneath one hidden pattern, where a probe goes. */
function probePath(pattern: string): string {
  if (/[[\]]/u.test(pattern)) {
    throw new Error(
      `${pattern}: teach probePath to plant under a bracket glob`,
    );
  }
  const concrete = pattern.replace(/(^|\/)\*\*\//gu, "$1nested/")
    .replaceAll("*", "probe").replaceAll("?", "p");
  if (concrete.endsWith("/")) return `${concrete}probe_test.ts`;
  return couldNameModule(concrete) ? concrete : `${concrete}/probe_test.ts`;
}

/** Compare a Deno exclude entry with a translated pattern: no `./` prefix. */
function normalizedEntry(entry: string): string {
  return entry.replace(/^\.\//u, "");
}

/** Every tracked `.gitignore`'s patterns: the root file first, then by path. */
async function repositoryIgnorePatterns(): Promise<IgnorePattern[]> {
  const files = await structuralGuardScope({
    guard: "tests/deno_discovery_exclusions_test.ts#gitignore-patterns",
    universe: "authored-text",
    narrow: {
      reason: "Git reads ignore rules only from files named .gitignore",
      include: (path) => basename(path) === ".gitignore",
    },
  });
  const ordered = [...files].sort((a, b) =>
    a.split("/").length - b.split("/").length || a.localeCompare(b)
  );
  const patterns: IgnorePattern[] = [];
  for (const file of ordered) {
    patterns.push(
      ...gitignorePatterns(
        file,
        await Deno.readTextFile(join(REPO_ROOT, file)),
      ),
    );
  }
  return patterns;
}

/** The repository's ignore patterns and its decoded Deno exclusions. */
async function repositoryDiscoveryInputs(): Promise<{
  patterns: IgnorePattern[];
  exclusions: DenoExclusions;
}> {
  return {
    patterns: await repositoryIgnorePatterns(),
    exclusions: await readDenoExclusions(REPO_ROOT),
  };
}

/** The registered visible patterns of one discovery kind. */
function visibleOfKind(
  discovery: DenoVisibleIgnorePattern["discovery"],
): string[] {
  return DENO_VISIBLE_IGNORE_PATTERNS.filter((entry) =>
    entry.discovery === discovery
  ).map((entry) => entry.pattern);
}

/** Render patterns with their `.gitignore` lines for a failure message. */
function described(patterns: readonly IgnorePattern[]): string {
  return patterns.map((entry) => `${entry.pattern} (${entry.source})`).join(
    ", ",
  );
}

Deno.test("gitignore patterns: translation cases", () => {
  assertNamedCases({
    "every spelling translates, slashless names and globs included": () => {
      assertEquals(
        gitignorePatterns(
          ".gitignore",
          "/dist/\n/.claude/worktrees/\nbuild/\r\n/tmp\nnode_modules\n" +
            "*.log\n/.vale/*\n/a/b.html\n",
        ).map((entry) => entry.pattern),
        [
          "dist/",
          ".claude/worktrees/",
          "**/build/",
          "tmp",
          "**/node_modules",
          "**/*.log",
          ".vale/*",
          "a/b.html",
        ],
      );
    },
    "a nested .gitignore resolves against its own directory": () => {
      assertEquals(
        gitignorePatterns(".idea/.gitignore", "/shelf/\nworkspace.xml\n"),
        [
          {
            pattern: ".idea/shelf/",
            negated: false,
            source: ".idea/.gitignore:1",
          },
          {
            pattern: ".idea/**/workspace.xml",
            negated: false,
            source: ".idea/.gitignore:2",
          },
        ],
      );
    },
    "comments and blanks name nothing, and negations stay marked": () => {
      assertEquals(
        gitignorePatterns(".gitignore", "# /dist/\n\n!/.vale/config/\n"),
        [{ pattern: ".vale/config/", negated: true, source: ".gitignore:3" }],
      );
    },
    "an escaped pattern is refused rather than mistranslated": () => {
      assertThrows(() => gitignorePatterns(".gitignore", "\\#literal\n"));
    },
    "a negation re-includes beneath a glob but not beside it": () => {
      const patterns = gitignorePatterns(
        ".gitignore",
        "/.vale/*\n/dist/\n!/.vale/config/\n!/distant/\n",
      );
      assertEquals(reincluding(patterns, 0).map((entry) => entry.source), [
        ".gitignore:3",
      ]);
      assertEquals(reincluding(patterns, 1), []);
    },
    "only a pattern that cannot end in a module extension names non-modules":
      () => {
        for (
          const pattern of [
            "**/.DS_Store",
            "**/*.log",
            "site/pages/index.html",
            "tmp",
          ]
        ) assertEquals(couldNameModule(pattern), false, pattern);
        for (
          const pattern of [
            ".deno_compile_bundle_*.mjs",
            ".vale/*",
            "**/*s",
            "scratch.ts",
          ]
        ) assertEquals(couldNameModule(pattern), true, pattern);
      },
    "probes land beneath directories and on module globs": () => {
      assertEquals(probePath("**/build/"), "nested/build/probe_test.ts");
      assertEquals(
        probePath(".deno_compile_bundle_*.mjs"),
        ".deno_compile_bundle_probe.mjs",
      );
      assertEquals(
        probePath("project/map/_private"),
        "project/map/_private/probe_test.ts",
      );
    },
  });
});

Deno.test("every Git-ignored pattern is excluded from Deno discovery or registered visible", async () => {
  const { patterns, exclusions } = await repositoryDiscoveryInputs();
  const ignored = patterns.filter((entry) => !entry.negated);
  assert(ignored.length > 0, ".gitignore must yield ignore patterns");
  const excluded = new Set(exclusions.workspace.map(normalizedEntry));
  const visible = new Set(
    DENO_VISIBLE_IGNORE_PATTERNS.map((entry) => entry.pattern),
  );
  const missing = ignored.filter((entry) =>
    !excluded.has(entry.pattern) && !visible.has(entry.pattern)
  );
  assertEquals(
    described(missing),
    "",
    `.gitignore ignores ${described(missing)}, which deno check and ` +
      "deno test would still discover. A slashless name or a glob such as " +
      "dir/* ignores directories as surely as a trailing-slash root. Add " +
      'each pattern as shown to the top-level "exclude" in deno.json, or ' +
      "register it in DENO_VISIBLE_IGNORE_PATTERNS " +
      "(scripts/repository_files.ts) with the reason it may stay visible",
  );
  const ignoredPatterns = new Set(ignored.map((entry) => entry.pattern));
  const stale = [...visible].filter((pattern) => !ignoredPatterns.has(pattern));
  assertEquals(
    stale,
    [],
    `DENO_VISIBLE_IGNORE_PATTERNS registers ${stale.join(", ")}, which no ` +
      ".gitignore ignores any more; remove the entry",
  );
});

Deno.test("deno.json's top-level exclude names only Git-ignored patterns", async () => {
  const { patterns, exclusions } = await repositoryDiscoveryInputs();
  const ignored = new Set(
    patterns.filter((entry) => !entry.negated).map((entry) => entry.pattern),
  );
  const visible = new Set(
    DENO_VISIBLE_IGNORE_PATTERNS.map((entry) => entry.pattern),
  );
  const unexpected = exclusions.workspace.filter((entry) =>
    !ignored.has(normalizedEntry(entry)) || visible.has(normalizedEntry(entry))
  );
  assertEquals(
    unexpected,
    [],
    `deno.json's top-level "exclude" names ${unexpected.join(", ")}; ` +
      "each entry must be a non-negated .gitignore pattern in Deno form " +
      "and outside DENO_VISIBLE_IGNORE_PATTERNS. That list hides paths " +
      "from every Deno command at once, so it holds ignored paths only; " +
      "put any other exclusion in the fmt, lint, or test section that " +
      "needs it",
  );
});

Deno.test("no top-level exclusion hides what a .gitignore negation re-includes", async () => {
  const { patterns, exclusions } = await repositoryDiscoveryInputs();
  const excluded = new Set(exclusions.workspace.map(normalizedEntry));
  const hiding = patterns.flatMap((entry, index) =>
    !entry.negated && excluded.has(entry.pattern)
      ? reincluding(patterns, index)
      : []
  );
  assertEquals(
    described(hiding),
    "",
    `.gitignore re-includes ${described(hiding)} beneath a pattern ` +
      'deno.json\'s top-level "exclude" names, so deno fmt would stop ' +
      "formatting those tracked files, and test priority's native --ignore " +
      "cannot carry the negation. Register the pattern as re-included in " +
      "DENO_VISIBLE_IGNORE_PATTERNS instead",
  );
  for (const pattern of visibleOfKind("re-included")) {
    assert(
      patterns.some((entry, index) =>
        !entry.negated && entry.pattern === pattern &&
        reincluding(patterns, index).length > 0
      ),
      `DENO_VISIBLE_IGNORE_PATTERNS marks ${pattern} re-included, but no ` +
        "later .gitignore negation re-includes anything beneath it; add it " +
        'to the top-level "exclude" in deno.json instead',
    );
  }
});

Deno.test("no deno.json section repeats a top-level exclusion", async () => {
  const { exclusions } = await repositoryDiscoveryInputs();
  const shared = new Set(exclusions.workspace.map(normalizedEntry));
  for (const [section, entries] of Object.entries(exclusions.sections)) {
    const repeated = entries.filter((entry) =>
      shared.has(normalizedEntry(entry))
    );
    assertEquals(
      repeated,
      [],
      `deno.json ${section}.exclude repeats ${repeated.join(", ")}; ` +
        `the top-level "exclude" already applies to deno ${section}`,
    );
  }
});

Deno.test("every rebuilt ignored root is deleted and regenerated by the gate's build", () => {
  const wiped = new Set(GENERATED_SITE_OUTPUTS.map((path) => `site/${path}`));
  const unowned = visibleOfKind("rebuilt").filter((pattern) =>
    !wiped.has(pattern)
  );
  assertEquals(
    unowned,
    [],
    `DENO_VISIBLE_IGNORE_PATTERNS marks ${unowned.join(", ")} rebuilt, but ` +
      "the site build (GENERATED_SITE_OUTPUTS in site/build.ts) does not " +
      "delete it before regenerating, so stray modules there would reach " +
      "deno check and deno test. Exclude the root in deno.json instead",
  );
});

Deno.test("every non-module-files pattern names files no Deno command loads", () => {
  const modular = visibleOfKind("non-module-files").filter((pattern) =>
    pattern.endsWith("/") || couldNameModule(pattern)
  );
  assertEquals(
    modular,
    [],
    `DENO_VISIBLE_IGNORE_PATTERNS marks ${modular.join(", ")} ` +
      "non-module-files, but each is a directory or could name a " +
      'JavaScript or TypeScript module. Add it to the top-level "exclude" ' +
      "in deno.json instead",
  );
});

/** A module every Deno discovery command rejects: a type error, lint, and format. */
const BROKEN_PROBE = [
  'const probe: number = "ignored root";',
  "var  unused = probe;;",
  'Deno.test("probe", () => {});',
  "",
].join("\n");

/** Each discovering command's invocation: it walks the tree without running it. */
const DISCOVERY_ARGS: Readonly<
  Record<DenoDiscoveryCommand, readonly string[]>
> = {
  check: ["check"],
  fmt: ["fmt", "--check"],
  lint: ["lint"],
  test: ["test", "--no-run"],
};

/** Run one Deno command in `cwd`, returning its exit and uncolored output. */
async function denoOutput(
  cwd: string,
  args: readonly string[],
): Promise<{ success: boolean; text: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd,
    env: { NO_COLOR: "1" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    success: output.success,
    text: decoder.decode(output.stdout) + decoder.decode(output.stderr),
  };
}

Deno.test("Deno's discovery commands skip every hidden Git-ignored pattern", async () => {
  const { exclusions } = await repositoryDiscoveryInputs();
  const probes = [
    ...exclusions.workspace.map(normalizedEntry),
    ...visibleOfKind("deno-skips"),
  ].map(probePath);
  assert(probes.length > 0, "deno.json must hide ignored patterns");
  await withTempDir(async (fixture) => {
    // Only the real top-level list: no section exclusion and no Git
    // repository, so neither can hide a probe on the list's behalf.
    await Deno.writeTextFile(
      join(fixture, "deno.json"),
      JSON.stringify({ exclude: exclusions.workspace }),
    );
    const control = "visible/probe_test.ts";
    for (const path of [control, ...probes]) {
      await Deno.mkdir(join(fixture, dirname(path)), { recursive: true });
      await Deno.writeTextFile(join(fixture, path), BROKEN_PROBE);
    }
    for (
      const args of DENO_DISCOVERY_COMMANDS.map((id) => DISCOVERY_ARGS[id])
    ) {
      const command = `deno ${args.join(" ")}`;
      const { success, text } = await denoOutput(fixture, args);
      assert(
        !success && text.includes(control),
        `${command} must reject the visible control probe:\n${text}`,
      );
      for (const probe of probes) {
        assert(
          !text.includes(probe),
          `${command} discovered ${probe}, which deno.json's top-level ` +
            `"exclude" or Deno's own discovery must hide:\n${text}`,
        );
      }
    }
  });
});
