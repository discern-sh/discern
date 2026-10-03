/**
 * Git-ignored directory roots stay out of Deno's file discovery.
 *
 * `deno fmt` and `deno lint` skip Git-ignored paths on their own, but
 * `deno check` and `deno test` walk everything under the project root. Ignored
 * scratch TypeScript — agent probes, capture tools — would otherwise fail the
 * gate's typecheck and test stages with errors unrelated to the change. The
 * top-level `exclude` in deno.json therefore names exactly the directory roots
 * `.gitignore` ignores, less the reasoned `DENO_VISIBLE_IGNORED_ROOTS`.
 *
 * The roots derive from `.gitignore`, so a newly ignored directory fails here
 * until it is excluded or registered. The reverse direction keeps the
 * top-level list, which hides paths from every Deno command at once, from
 * ever naming authored source. A behavioral check plants broken TypeScript
 * under every hidden root and runs Deno's own discovery commands against the
 * repository's real exclusion list.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  DENO_DISCOVERY_COMMANDS,
  type DenoDiscoveryCommand,
  type DenoExclusions,
  readDenoExclusions,
} from "../scripts/deno_exclusions.ts";
import { DENO_VISIBLE_IGNORED_ROOTS } from "../scripts/repository_files.ts";
import { GENERATED_SITE_OUTPUTS } from "../site/build.ts";
import { assertNamedCases } from "./assert_cases.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { withTempDir } from "./temp_dir.ts";

/**
 * The directory roots one `.gitignore` text ignores, in Deno exclude form.
 * Only directory-only patterns (a trailing slash) qualify: negations re-include
 * rather than ignore, and file patterns name no tree of modules. A pattern with
 * no inner slash matches at any depth, so it maps to a `**` glob.
 */
function gitignoredDirectoryRoots(text: string): string[] {
  const roots: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trimEnd();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    if (!line.endsWith("/")) continue;
    const body = line.slice(0, -1);
    roots.push(
      body.includes("/") ? `${body.replace(/^\//u, "")}/` : `**/${line}`,
    );
  }
  return roots;
}

/** Compare a Deno exclude entry with a root: no `./` prefix, one trailing slash. */
function normalizedRoot(entry: string): string {
  return entry.replace(/^\.\//u, "").replace(/\/?$/u, "/");
}

/** The repository's ignored directory roots and its decoded Deno exclusions. */
async function repositoryDiscoveryInputs(): Promise<{
  roots: string[];
  exclusions: DenoExclusions;
}> {
  const roots = gitignoredDirectoryRoots(
    await Deno.readTextFile(join(REPO_ROOT, ".gitignore")),
  );
  return { roots, exclusions: await readDenoExclusions(REPO_ROOT) };
}

Deno.test("gitignore directory roots: parser cases", () => {
  assertNamedCases({
    "anchored, nested, and unanchored directory patterns become roots": () => {
      assertEquals(
        gitignoredDirectoryRoots("/dist/\n/.claude/worktrees/\nbuild/\r\n"),
        ["dist/", ".claude/worktrees/", "**/build/"],
      );
    },
    "comments, negations, and file patterns name no root": () => {
      assertEquals(
        gitignoredDirectoryRoots(
          "# /dist/\n!/.vale/config/\n/.vale/*\n*.log\n.DS_Store\n/a/b.html\n\n",
        ),
        [],
      );
    },
  });
});

Deno.test("deno.json's top-level exclude names exactly the Git-ignored directory roots", async () => {
  const { roots, exclusions } = await repositoryDiscoveryInputs();
  assert(roots.length > 0, ".gitignore must yield directory roots");
  const visible = new Set(DENO_VISIBLE_IGNORED_ROOTS.map((root) => root.path));
  const stale = [...visible].filter((path) => !roots.includes(path));
  assertEquals(
    stale,
    [],
    `DENO_VISIBLE_IGNORED_ROOTS registers ${stale.join(", ")}, which ` +
      ".gitignore no longer ignores as a directory; remove the entry",
  );
  const excluded = new Set(exclusions.workspace.map(normalizedRoot));
  const missing = roots.filter((root) =>
    !visible.has(root) && !excluded.has(root)
  );
  assertEquals(
    missing,
    [],
    `.gitignore ignores ${missing.join(", ")}, which deno check and ` +
      "deno test would still discover. Add each to the top-level " +
      '"exclude" in deno.json, or register it in DENO_VISIBLE_IGNORED_ROOTS ' +
      "(scripts/repository_files.ts) with the reason it must stay visible",
  );
  const unexpected = [...excluded].filter((entry) =>
    !roots.includes(entry) || visible.has(entry)
  );
  assertEquals(
    unexpected,
    [],
    `deno.json's top-level "exclude" names ${unexpected.join(", ")}; ` +
      "each entry must be a Git-ignored directory root outside " +
      "DENO_VISIBLE_IGNORED_ROOTS. That list hides paths from every Deno " +
      "command at once, so it holds ignored roots only; put any other " +
      "exclusion in the fmt, lint, or test section that needs it",
  );
});

Deno.test("no deno.json section repeats a top-level exclusion", async () => {
  const { exclusions } = await repositoryDiscoveryInputs();
  const shared = new Set(exclusions.workspace.map(normalizedRoot));
  for (const [section, entries] of Object.entries(exclusions.sections)) {
    const repeated = entries.filter((entry) =>
      shared.has(normalizedRoot(entry))
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
  const unowned = DENO_VISIBLE_IGNORED_ROOTS.filter((root) =>
    root.discovery === "rebuilt" && !wiped.has(root.path)
  ).map((root) => root.path);
  assertEquals(
    unowned,
    [],
    `DENO_VISIBLE_IGNORED_ROOTS marks ${unowned.join(", ")} rebuilt, but ` +
      "the site build (GENERATED_SITE_OUTPUTS in site/build.ts) does not " +
      "delete it before regenerating, so stray modules there would reach " +
      "deno check and deno test. Exclude the root in deno.json instead",
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

Deno.test("Deno's discovery commands skip every hidden Git-ignored root", async () => {
  const { roots, exclusions } = await repositoryDiscoveryInputs();
  const rebuilt = new Set(
    DENO_VISIBLE_IGNORED_ROOTS.filter((root) => root.discovery === "rebuilt")
      .map((root) => root.path),
  );
  const hidden = roots.filter((root) => !rebuilt.has(root)).map((
    root,
  ) => root.replace(/^\*\*\//u, "nested/"));
  assert(hidden.length > 0, ".gitignore must yield hidden roots");
  await withTempDir(async (fixture) => {
    // Only the real top-level list: no section exclusion and no Git
    // repository, so neither can hide a probe on the list's behalf.
    await Deno.writeTextFile(
      join(fixture, "deno.json"),
      JSON.stringify({ exclude: exclusions.workspace }),
    );
    const control = "visible/probe_test.ts";
    for (
      const path of [control, ...hidden.map((root) => `${root}probe_test.ts`)]
    ) {
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
      for (const root of hidden) {
        assert(
          !text.includes(`${root}probe_test.ts`),
          `${command} discovered ${root}, which deno.json's top-level ` +
            `"exclude" or Deno's own discovery must hide:\n${text}`,
        );
      }
    }
  });
});
