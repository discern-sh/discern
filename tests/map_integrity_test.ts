/**
 * Map & instructions integrity — the SHIPPED preflight core applied to this
 * repository, plus proof each rule bites.
 *
 * The application logic lives in src/lib/map_integrity.ts and runs inside
 * every project's gate; these tests are a thin layer over that one core:
 *
 *  1. the LIVE-CORPUS run — this repo's configured map and instruction sources
 *     must be clean, exactly as `discern done` will demand of any project;
 *  2. per-rule BITE proofs over scaffolded fixture projects, including the
 *     deliberate escapes (root-relative links, `publish: false`, non-exact
 *     citation spans, project-script verbs) that keep the rules honest on
 *     arbitrary user prose.
 *
 * The scanners' extraction semantics are proven separately in
 * tests/docs_integrity_test.ts; the repo-only strict frontmatter schema in
 * tests/map_frontmatter_test.ts.
 *
 * Guards: boundary:map-understanding, claim:map-mechanically-checked
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import {
  checkDocsIntegrity,
  DOCS_INTEGRITY_REMEDIES,
  DOCS_INTEGRITY_RULES,
  type DocsIntegrityFinding,
} from "../src/lib/map_integrity.ts";
import { loadConfig, parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const model = cliCommandModel(buildCli(false) as unknown as Command);

Deno.test("the live corpus is clean: this repo's map and instructions pass the shipped preflight", async () => {
  const findings = await checkDocsIntegrity(
    REPO_ROOT,
    await loadConfig(REPO_ROOT),
    model,
  );
  assertEquals(
    findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.detail}`),
    [],
    "the map and instructions must satisfy the same integrity preflight every " +
      "project's gate runs — fix the reference (or the registry it names)",
  );
});

Deno.test("every rule has a remedy (the diagnostic can always say the fix)", () => {
  for (const rule of DOCS_INTEGRITY_RULES) {
    assert(
      DOCS_INTEGRITY_REMEDIES[rule].length > 0,
      `rule ${rule} needs a remedy`,
    );
  }
});

// ── bite proofs over fixture projects ────────────────────────────────────────

/** The default map dir, from the paths registry (mirrors a fresh install). */
const MAP = SOURCE_PATHS.map.defaultPath.replace(/\/$/, "");

/** Scaffold `files` under a temp project root and run the shipped check.
 * `toml` seeds the config; `executables` are project scripts to make runnable. */
async function fixtureFindings(
  files: Record<string, string>,
  opts: { toml?: string; executables?: Record<string, string> } = {},
): Promise<DocsIntegrityFinding[]> {
  let findings: DocsIntegrityFinding[] = [];
  await withTempDir(async (dir) => {
    for (const [rel, content] of Object.entries(files)) {
      await ensureDir(join(dir, dirname(rel)));
      await Deno.writeTextFile(join(dir, rel), content);
    }
    for (const [rel, content] of Object.entries(opts.executables ?? {})) {
      await ensureDir(join(dir, dirname(rel)));
      await Deno.writeTextFile(join(dir, rel), content);
      await Deno.chmod(join(dir, rel), 0o755);
    }
    findings = await checkDocsIntegrity(
      dir,
      parseConfigOrThrow(opts.toml ?? ""),
      model,
    );
  });
  return findings;
}

/** The `rule` findings only, as `file:line detail` strings for asserts. */
function ruleFindings(
  findings: DocsIntegrityFinding[],
  rule: DocsIntegrityFinding["rule"],
): string[] {
  return findings
    .filter((f) => f.rule === rule)
    .map((f) => `${f.file}:${f.line} ${f.detail}`);
}

Deno.test("bites: a dead link and a dead anchor fail; sound ones pass", async () => {
  const findings = await fixtureFindings({
    [`${MAP}/README.md`]: [
      "# Map",
      "",
      "A [dead link](missing.md) and a [dead anchor](guide.md#nowhere).",
      "A [sound link](guide.md) and a [sound anchor](guide.md#setup).",
    ].join("\n"),
    [`${MAP}/guide.md`]: "# Guide\n\n## Setup\n\nText.\n",
  });
  const dead = ruleFindings(findings, "dead-link");
  assertEquals(dead.length, 1);
  assert(dead[0]?.includes("missing.md"), dead[0]);
  assert(dead[0]?.startsWith(`${MAP}/README.md:3`), dead[0]);
  const anchors = ruleFindings(findings, "dead-anchor");
  assertEquals(anchors.length, 1);
  assert(anchors[0]?.includes("nowhere"), anchors[0]);
  assertEquals(findings.length, 2);
});

Deno.test("bites: root-relative and external link targets are out of scope", async () => {
  const findings = await fixtureFindings({
    [`${MAP}/README.md`]: [
      "# Map",
      "",
      "A [site-absolute route](/docs/elsewhere), an",
      "[external page](https://example.com/x), and a",
      "[protocol-relative one](//example.com/y).",
    ].join("\n"),
  });
  assertEquals(findings, []);
});

Deno.test("bites: a broken or mis-shaped metadata block fails; third-party keys pass", async () => {
  const bad = await fixtureFindings({
    [`${MAP}/broken.md`]: "---\ntitle: Never closed\n\n# Broken\n",
    [`${MAP}/shape.md`]: "---\npublish: 0\n---\n\n# Shape\n",
  });
  const frontmatter = ruleFindings(bad, "frontmatter");
  assertEquals(frontmatter.length, 2);
  assert(
    frontmatter.some((f) => f.includes("never closes")),
    frontmatter.join("; "),
  );
  assert(
    frontmatter.some((f) => f.includes("publish: must be exactly")),
    frontmatter.join("; "),
  );

  // Unknown keys are legitimate third-party frontmatter, not a defect.
  const tolerant = await fixtureFindings({
    [`${MAP}/page.md`]: "---\nlayout: post\nsidebar_position: 4\n---\n\n# P\n",
  });
  assertEquals(tolerant, []);
});

Deno.test("bites: a stale fenced command fails; a project-script verb passes", async () => {
  const stale = await fixtureFindings({
    [`${MAP}/howto.md`]: "# Howto\n\n```sh\ndiscern frobnicate\n```\n",
  });
  const commands = ruleFindings(stale, "stale-command");
  assertEquals(commands.length, 1);
  assert(commands[0]?.includes("frobnicate"), commands[0]);

  // A Project Script dispatches as a first-class verb, so quoting it is sound.
  const scripted = await fixtureFindings({
    [`${MAP}/howto.md`]: "# Howto\n\n```sh\ndiscern deploy\n```\n",
  }, {
    executables: {
      [`${SOURCE_PATHS.scripts.defaultPath}/deploy`]: "#!/bin/sh\n",
    },
  });
  assertEquals(scripted, []);
});

Deno.test("local supporting pages need no publication metadata and retain integrity checks", async () => {
  const sound = await fixtureFindings({
    [`${MAP}/_internal/notes.md`]: "# Notes\n\nA current project constraint.\n",
    [`${MAP}/README.md`]: "# Map\n\nSee [notes](_internal/notes.md).\n",
  });
  assertEquals(sound, []);
  const broken = await fixtureFindings({
    [`${MAP}/_internal/notes.md`]: "# Notes\n\n[Missing](missing.md)\n",
    [`${MAP}/_support/guide.md`]: "# Guide\n\n[Missing](missing.md)\n",
    [`${MAP}/_adr/0001-history.md`]: "# History\n\n[Former](removed.md)\n",
    [`${MAP}/_private/draft.md`]: "# Draft\n\n[Future](planned.md)\n",
  });
  assertEquals(ruleFindings(broken, "dead-link").length, 2);
});

Deno.test("bites: a citation of a missing or excluded skill fails; non-citation spellings pass", async () => {
  const unknown = await fixtureFindings({
    [`${MAP}/README.md`]:
      "# Map\n\nUse the `discern-made-up-name` skill for this.\n",
  });
  const citations = ruleFindings(unknown, "skill-citation");
  assertEquals(citations.length, 1);
  assert(citations[0]?.includes("discern-made-up-name"), citations[0]);

  // The exclusion footgun: `[skills].exclude` removes the skill everywhere,
  // so prose still recommending it now cites something that does not exist.
  const excluded = await fixtureFindings({
    [`${MAP}/README.md`]: "# Map\n\nReach for `discern-cure-a-bug` here.\n",
  }, { toml: '[skills]\nexclude = ["discern-cure-a-bug"]' });
  assertEquals(ruleFindings(excluded, "skill-citation").length, 1);
  // …and without the exclusion the same citation is sound.
  const included = await fixtureFindings({
    [`${MAP}/README.md`]: "# Map\n\nReach for `discern-cure-a-bug` here.\n",
  });
  assertEquals(included, []);

  // Escapes: fenced tokens, spans carrying more than the token, bare prose,
  // and single-segment names are spellings, not citations.
  const spellings = await fixtureFindings({
    [`${MAP}/README.md`]: [
      "# Map",
      "",
      "```json",
      '"discern-made-up-name": "jsr:@example/pkg@1.0.0"',
      "```",
      "",
      "Mark it `discern-made-up-name: <reason>` in the comment.",
      "Plain prose mentioning discern-made-up-name is left alone.",
      "A single-segment `discern-results` is a filename.",
    ].join("\n"),
  });
  assertEquals(spellings, []);
});

Deno.test("bites: instruction sources get the command and citation checks, nothing page-shaped", async () => {
  const instructions = SOURCE_PATHS.instructions.defaultPath;
  const findings = await fixtureFindings({
    [instructions]: [
      "---", // an unterminated fence — instructions are prose, not a map page,
      "so this must NOT be read as a broken metadata block.",
      "",
      "Run:",
      "",
      "```sh",
      "discern frobnicate",
      "```",
      "",
      "Then use the `discern-made-up-name` skill.",
      "And a [dead link](missing.md) is fine here too.",
    ].join("\n"),
  });
  assertEquals(ruleFindings(findings, "stale-command").length, 1);
  assertEquals(ruleFindings(findings, "skill-citation").length, 1);
  assertEquals(findings.length, 2, JSON.stringify(findings));
  assert(
    findings.every((f) => f.file === instructions),
    "instructions findings must name the source file",
  );
});

Deno.test("a project with no map and no instructions has nothing to check", async () => {
  assertEquals(await fixtureFindings({}), []);
});
