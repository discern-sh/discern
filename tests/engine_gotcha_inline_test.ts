/**
 * Inlining a matched gotchas trap into gate failure output (ADR 0189), end to
 * end through the CLI: a failure whose evidence matches a seeded matcher
 * carries the trap's own prose in the result envelope's hints AND on the human
 * stderr tail; an unmatched failure keeps the generic pointer; a malformed
 * matcher warns by entry name without blocking a later valid one; a missing
 * doc degrades to the pointer with no warnings. The matched fixture drives the
 * REAL shipped template (with its seeded matchers) against a REAL exit-127
 * failure, so the whole pipeline — seed, parse, match, deliver — is exercised
 * as an installed project would hit it.
 */

import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const TEMPLATE_GOTCHAS = join(
  REPO_ROOT,
  "templates",
  "setup",
  "skeleton",
  "docs",
  "80-development",
  "done-gate-gotchas.md",
);

/** The exit-127 trap's title in the shipped template. */
const EXIT_127_TITLE = "A gate command fails with exit 127 (command not found)";

/** A scaffolded project whose gotchas doc is the REAL shipped template. */
async function scaffoldWithSeededDoc(
  dir: string,
  lintCommand: string,
): Promise<void> {
  await scaffoldEngine(dir);
  const docRel = "docs/80-development/done-gate-gotchas.md";
  await Deno.mkdir(join(dir, "docs", "80-development"), { recursive: true });
  await Deno.copyFile(TEMPLATE_GOTCHAS, join(dir, docRel));
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      `gotchas_doc = "${docRel}"`,
      "",
      "[map]",
      'dir = "docs/"',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[jobs]",
      `lint = "${lintCommand}"`,
      "",
    ].join("\n"),
  );
  await gitInit(dir);
}

/** The envelope's hints, parsed from a --json run. */
function hintsOf(stdout: string): string[] {
  const obj = JSON.parse(stdout.trim()) as { hints?: string[] };
  return obj.hints ?? [];
}

Deno.test("a real exit-127 failure inlines the seeded trap on the envelope and the human tail", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithSeededDoc(dir, "definitely-missing-command-x");

    const json = await runAgent(dir, ["done", "--json"]);
    assertEquals(json.code, 1, json.output);
    const hints = hintsOf(json.stdout);
    const matched = hints.find((h) =>
      h.includes(`This failure matches "${EXIT_127_TITLE}"`)
    );
    assert(matched !== undefined, `expected the inlined trap in ${json.stdout}`);
    // The entry's own fix arrived with the failure…
    assertStringIncludes(matched, "[repository].ensure");
    // …with the doc reference kept as the route to the full page…
    assertStringIncludes(matched, "Read the full page with `discern map ");
    // …and the generic pointer relegated (it prints only when nothing matches).
    assert(
      !hints.some((h) => h.includes("known gate failures and their fixes")),
      `matched failure must not also carry the generic pointer: ${json.stdout}`,
    );

    // prepare fails on the same evidence and must carry the same inlined trap.
    const prepare = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepare.code, 1, prepare.output);
    assertEquals(
      hintsOf(prepare.stdout).find((h) => h.includes("This failure matches")),
      matched,
      "prepare's inlined trap must match done's",
    );

    // The human tail prints the same fired hint verbatim on stderr. This exact
    // tree was just judged red, so the rerun carries the required attestation.
    const human = await runAgent(dir, ["done", "--confirmed"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stderr, matched);
  });
});

Deno.test("an unmatched failure keeps the generic pointer", async () => {
  await withTempDir(async (dir) => {
    await scaffoldWithSeededDoc(dir, "echo LINT-BROKE; exit 7");

    const json = await runAgent(dir, ["done", "--json"]);
    assertEquals(json.code, 1, json.output);
    const hints = hintsOf(json.stdout);
    assert(
      hints.some((h) => h.includes("known gate failures and their fixes")),
      `expected the generic pointer in ${json.stdout}`,
    );
    assert(
      !hints.some((h) => h.includes("This failure matches")),
      `no seeded matcher covers exit 7, so nothing may inline: ${json.stdout}`,
    );
  });
});

Deno.test("a malformed matcher warns by entry name and a later valid matcher still inlines", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const docRel = "docs/g.md";
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, docRel),
      [
        "# Gate gotchas",
        "",
        "### Broken matcher",
        "",
        "Prose.",
        "",
        "```gotcha-match",
        'stage = "timeout"',
        "```",
        "",
        "### Matching trap",
        "",
        "**Fix.** Do the recorded fix.",
        "",
        "```gotcha-match",
        "evidence = 'LINT-BROKE'",
        "```",
        "",
      ].join("\n"),
    );
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        `gotchas_doc = "${docRel}"`,
        "",
        "[map]",
        'dir = "docs/"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "echo LINT-BROKE; exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const json = await runAgent(dir, ["done", "--json"]);
    assertEquals(json.code, 1, json.output);
    const hints = hintsOf(json.stdout);
    const warning = hints.find((h) =>
      h.includes('Fix the `gotcha-match` block in the gotchas entry "Broken matcher"')
    );
    assert(warning !== undefined, `expected a named warning in ${json.stdout}`);
    assertStringIncludes(warning, '"timeout"');
    const matched = hints.find((h) =>
      h.includes('This failure matches "Matching trap"')
    );
    assert(matched !== undefined, `the valid matcher must still inline: ${json.stdout}`);
    assertStringIncludes(matched, "Do the recorded fix.");

    // Both surface on the human tail too.
    const human = await runAgent(dir, ["done", "--confirmed"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stderr, warning);
    assertStringIncludes(human.stderr, "Do the recorded fix.");
  });
});

Deno.test("a missing gotchas doc keeps the pointer, with no matcher warnings", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "docs/never-written.md"',
        "",
        "[map]",
        'dir = "docs/"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "exit 7"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const json = await runAgent(dir, ["done", "--json"]);
    assertEquals(json.code, 1, json.output);
    const hints = hintsOf(json.stdout);
    assert(
      hints.some((h) => h.includes("known gate failures and their fixes")),
      `expected the generic pointer in ${json.stdout}`,
    );
    assert(
      !hints.some((h) => h.includes("gotcha-match")),
      `a missing doc must not produce matcher warnings: ${json.stdout}`,
    );
  });
});
