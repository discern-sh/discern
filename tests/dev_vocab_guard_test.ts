/**
 * Distribution-vocabulary guards — the net that keeps engine-developer commands
 * out of anything an end user sees.
 *
 * `discern` is both a product and a self-hosting repo, so two command
 * vocabularies coexist: the user's (`discern …`) and the kit's own Deno-task
 * aliases (`deno task <task>`). The latter must never reach a user — not in
 * shipped `templates/` (every project receives it verbatim), and not in any
 * user-facing output the binary prints. These tests fail the gate if the
 * vocabulary leaks, so a future command can't quietly reintroduce the regression.
 *
 * Since the managed-file machinery (and its `selfsync`/`selfcheck` aliases) was
 * removed, those alias names should no longer appear anywhere under `src/`.
 */

import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { configSectionNames } from "../src/shared/config_codegen.ts";
import { settableConfigValueKind } from "../src/shared/config_schema.ts";
import {
  isRepoMapPath,
  REPO_AUTHORED_PATHS,
  REPO_ROOT,
} from "./repo_authored_paths.ts";
import { withoutRegistryAtlasMembers } from "./registry_atlas_scan.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { stringLiterals } from "./vocab_scan.ts";

/** The retired Deno-task alias names that should no longer exist anywhere. */
const RETIRED_TOKENS = ["selfsync", "selfcheck"];

/** Read declared repository-relative text files with their stable labels. */
async function textFiles(
  files: readonly string[],
): Promise<Array<[string, string]>> {
  return await Promise.all(
    files.map(async (rel): Promise<[string, string]> => [
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ]),
  );
}

Deno.test("the retired self-host aliases appear nowhere under src/", async () => {
  const offenders: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#retired-source-aliases",
    universe: "authored-text",
    narrow: {
      reason:
        "The retired self-host aliases were implementation vocabulary, so their absence contract is confined to production src files.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
  for (const [rel, text] of await textFiles(files)) {
    for (const token of RETIRED_TOKENS) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `retired self-host vocabulary still present under src/:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("shipped templates and manual never name engine-developer commands", async () => {
  const banned = ["deno task", ...RETIRED_TOKENS];
  const offenders: string[] = [];
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#shipped-template-commands",
    universe: "authored-text",
    narrow: {
      reason:
        "This invariant protects the templates and bundled manual that every installed project can read.",
      include: (rel) =>
        rel.startsWith("templates/") || rel.startsWith("project/manual/"),
    },
  });
  for (const [rel, text] of await textFiles(files)) {
    for (const token of banned) {
      if (text.includes(token)) offenders.push(`${rel} contains "${token}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    `engine-developer vocabulary leaked into the shipped surface:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

interface ScopedLiteralException {
  readonly path: string;
  readonly token: string;
  readonly count: number;
  readonly reason: string;
}

/** Repository-only implementation strings that production source must retain. */
const INTERNAL_LITERAL_EXCEPTIONS: readonly ScopedLiteralException[] = [
  {
    path: "src/shared/first_party_license_codegen.ts",
    token: "deno task",
    count: 1,
    reason:
      "This generator writes a repository-internal TypeScript bundle and its banner never enters product copy.",
  },
  {
    path: "src/commands/doctor.ts",
    token: "deno task",
    count: 1,
    reason:
      "Doctor recognizes discern's own source-development wrapper so self-hosting does not report a false provider error.",
  },
  {
    path: "src/commands/docs.ts",
    token: `${REPO_AUTHORED_PATHS.mapRel}/`,
    count: 1,
    reason:
      "The installed decision-record redirect links to discern's source repository when those records are not bundled.",
  },
];

/** Count non-overlapping occurrences without relying on regex escaping. */
function occurrenceCount(text: string, token: string): number {
  return text.split(token).length - 1;
}

Deno.test("production string literals do not leak repository build metadata", async () => {
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#source-build-metadata",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only production source string literals can compile repository implementation vocabulary into the binary.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
  const exceptionCounts = new Map<string, number>();
  const offenders: string[] = [];
  const banned = [
    "deno task",
    `${REPO_AUTHORED_PATHS.mapRel}/`,
    `${REPO_AUTHORED_PATHS.scriptsRel}/`,
  ];
  for (const [rel, source] of await textFiles(files)) {
    for (const literal of stringLiterals(source)) {
      for (const token of banned) {
        const count = occurrenceCount(literal.text, token);
        if (count === 0) continue;
        const exception = INTERNAL_LITERAL_EXCEPTIONS.find((candidate) =>
          candidate.path === rel && candidate.token === token
        );
        if (exception === undefined) {
          offenders.push(
            `${rel}:${literal.line} contains ${JSON.stringify(token)}`,
          );
          continue;
        }
        const key = `${exception.path}\0${exception.token}`;
        exceptionCounts.set(key, (exceptionCounts.get(key) ?? 0) + count);
      }
    }
  }
  for (const exception of INTERNAL_LITERAL_EXCEPTIONS) {
    const key = `${exception.path}\0${exception.token}`;
    const actual = exceptionCounts.get(key) ?? 0;
    if (exception.reason.trim() === "" || actual !== exception.count) {
      offenders.push(
        `${exception.path}: exception for ${JSON.stringify(exception.token)} ` +
          `expected ${exception.count}, found ${actual}; reason=${
            JSON.stringify(exception.reason)
          }`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `repository build metadata entered production copy:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

const PRIVATE_CONTEXT_ATTRIBUTION = /\([A-Z][a-z]+,\s+20\d{2}-\d{2}-\d{2}:/u;

Deno.test("authored code and tests carry no private conversation attributions", async () => {
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#private-context-attribution",
    universe: "authored-ts",
  });
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(files)) {
    const hit = text.match(PRIVATE_CONTEXT_ATTRIBUTION);
    if (hit !== null) {
      offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
    }
  }
  assertEquals(offenders, []);
});

Deno.test("the private-context detector rejects a named dated aside", () => {
  const fixture = "(Someone, " + "2026-09-04: decided this.)";
  assertEquals(
    PRIVATE_CONTEXT_ATTRIBUTION.test(fixture),
    true,
  );
});

const DEBT_REGISTRY_FILES = [
  "scripts/module_coverage_exceptions.ts",
  "scripts/complexity_hotspots.ts",
  "scripts/complexity.ts",
] as const;

Deno.test("current debt registries describe present structure without legacy framing", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(DEBT_REGISTRY_FILES)) {
    if (/legacy/iu.test(text)) offenders.push(rel);
  }
  assertEquals(offenders, []);
});

/** Compatibility identifiers that retain the term as precise implementation data. */
const LEGACY_IDENTIFIER_EXCEPTIONS: readonly ScopedLiteralException[] = [
  {
    path: "src/engine/gate/standard_limits.ts",
    token: "legacy-table",
    count: 2,
    reason:
      "The private normalization sentinel distinguishes an older unrecognized denominator table from current metric and extent shapes.",
  },
  {
    path: "src/engine/gate/standard_limits.ts",
    token: "legacyValue",
    count: 1,
    reason:
      "The private comparison sentinel preserves an unrecognized older scalar shape without changing a public contract.",
  },
  {
    path: "src/engine/gate/standard_limits.ts",
    token: "legacyFields",
    count: 3,
    reason:
      "The local variable names fields recovered from the same older denominator-table shape.",
  },
  {
    path: "src/lib/config_reconcile.ts",
    token: "LEGACY_CONFIG_PROVENANCE_MARKER",
    count: 2,
    reason:
      "Upgrade must recognize the exact earlier provenance banner before replacing it with the current marker.",
  },
  {
    path: "src/lib/agent_gitignore.ts",
    token: "isLegacyBlockOwnedLine",
    count: 2,
    reason:
      "Upgrade uses this private predicate only to bound cleanup of an earlier marked gitignore block.",
  },
];

Deno.test("legacy vocabulary is confined to counted compatibility identifiers", async () => {
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#legacy-implementation-identifiers",
    universe: "authored-ts",
    narrow: {
      reason:
        "The launch cleanup applies to production implementation vocabulary; tests and scripts may name the guard itself.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
  const offenders: string[] = [];
  for (const [rel, original] of await textFiles(files)) {
    let remaining = original;
    for (
      const exception of LEGACY_IDENTIFIER_EXCEPTIONS.filter((candidate) =>
        candidate.path === rel
      )
    ) {
      const count = occurrenceCount(remaining, exception.token);
      if (exception.reason.trim() === "" || count !== exception.count) {
        offenders.push(
          `${rel}: ${
            JSON.stringify(exception.token)
          } expected ${exception.count}, found ${count}`,
        );
      }
      remaining = remaining.split(exception.token).join("");
    }
    if (/legacy/iu.test(remaining)) {
      offenders.push(`${rel}: unregistered legacy term`);
    }
  }
  assertEquals(
    offenders,
    [],
    `replace stale framing or register an exact compatibility identifier and reason:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

/**
 * discern's one update channel is the install script (`src/lib/version.ts`
 * defines the sentence every surface cites). Naming any other channel — a
 * package manager, a self-update — promises distribution the product doesn't
 * have. The scan covers everything a user or their agent reads: the binary's
 * source, the shipped templates, and the public map (`discern docs` serves it).
 * Excluded: `_`-prefixed internal map trees and the configured map's
 * `80-development` subtree (contributor docs, where the repo's own dev Brewfile
 * is legitimately named).
 */
Deno.test("no shipped surface invents an update channel", async () => {
  const banned = [/\bbrew\b/i, /\bself-update\b/i];
  const offenders: string[] = [];
  const shippedFiles = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#shipped-update-channels",
    universe: "authored-text",
    narrow: {
      reason:
        "Update-channel promises can ship from production source, templates, or public map pages; private and contributor records are not product promises.",
      include: (rel) =>
        rel.startsWith("src/") || rel.startsWith("templates/") ||
        (rel.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/`) &&
          !rel.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/_`) &&
          !isRepoMapPath(rel, "80-development")),
    },
  });
  const files = await textFiles(shippedFiles);
  for (const [rel, text] of files) {
    for (const pattern of banned) {
      const hit = text.match(pattern);
      if (hit !== null) {
        offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "a shipped surface names an update channel discern doesn't have — cite " +
      `UPDATE_CHANNEL (src/lib/version.ts) instead:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

const RETIRED_COMMAND_ALLOWLIST = new Set([
  "tests/dev_vocab_guard_test.ts",
  join(
    REPO_AUTHORED_PATHS.mapRel,
    "_adr",
    "0095-prelaunch-cli-vocabulary.md",
  ),
  join(
    REPO_AUTHORED_PATHS.mapRel,
    "_adr",
    "0365-the-v1-cli-has-one-command-model-and-one-spelling.md",
  ),
]);

const RETIRED_COMMAND_TOKENS = [
  "changed-scopes",
  "worktree-name",
  "add-overlay",
  "discern migrate",
  "discern init",
  "discern bootstrap",
  "migrate --check",
  "`migrate`",
  "`init`",
  "`bootstrap`",
  "src/commands/migrate.ts",
  "src/commands/init.ts",
  "src/commands/bootstrap.ts",
  "tests/migrate_test.ts",
  "tests/engine_changed_scopes_test.ts",
  "tests/init_config_test.ts",
  "tests/init_edge_test.ts",
  "src/engine/scopes/changed.ts",
  "worktree:setup",
  "worktree:ensure",
  "worktree:create",
  "worktree:remove",
  "worktree:teardown",
  "worktree:prune",
  "`worktree:*`",
];

interface ForbiddenLaunchVocabulary {
  kind: "command" | "config-key";
  spelling: string;
}

/** Private-era launch spellings retained only so the structural guard can
 * prevent them returning to executable or published positions. */
const PRELAUNCH_FORBIDDEN_LAUNCH_VOCABULARY = [
  { kind: "command", spelling: "graduate" },
  { kind: "command", spelling: "setup land" },
  { kind: "command", spelling: "config set-capability" },
  { kind: "command", spelling: "config set-check" },
  { kind: "command", spelling: "finish" },
  { kind: "command", spelling: "scopes" },
  { kind: "command", spelling: "ratchets" },
  { kind: "command", spelling: "config set-ratchet" },
  { kind: "command", spelling: "integrate" },
  { kind: "config-key", spelling: "capabilities" },
  { kind: "config-key", spelling: "checks" },
  { kind: "config-key", spelling: "coupling.in_gate" },
  { kind: "config-key", spelling: "gate.stream" },
  { kind: "config-key", spelling: "guidance" },
  { kind: "config-key", spelling: "project.logbook" },
  { kind: "config-key", spelling: "docs" },
  { kind: "config-key", spelling: "recipes" },
  { kind: "config-key", spelling: "repository.proof_notes" },
  { kind: "config-key", spelling: "ratchets" },
  { kind: "config-key", spelling: "worktree.port" },
  { kind: "config-key", spelling: "worktree.ignored_file_drift" },
  { kind: "config-key", spelling: "worktree.resources.*.gc" },
] as const satisfies readonly ForbiddenLaunchVocabulary[];

/** Operational and product-text trees where command/config vocabulary is executable. */
const COMMAND_SURFACE_TREES = [
  "src",
  "tests",
  REPO_AUTHORED_PATHS.mapRel,
  "templates",
  "scripts",
  relative(REPO_ROOT, REPO_AUTHORED_PATHS.scripts),
  relative(REPO_ROOT, REPO_AUTHORED_PATHS.skills),
  ".github",
];
const COMMAND_SURFACE_FILES = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "deno.json",
  "discern.toml",
  ...REPO_AUTHORED_PATHS.instructions.map((path) => relative(REPO_ROOT, path)),
  relative(REPO_ROOT, REPO_AUTHORED_PATHS.todo),
]);

/** Assemble every authored, generated, and configured text surface that can publish command vocabulary. */
async function commandSurfaceFiles(): Promise<Array<[string, string]>> {
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#live-command-vocabulary",
    universe: "authored-text",
    narrow: {
      reason:
        "Callable and config vocabulary governs operational code, tests, shipped copy, project instructions, and contributor automation.",
      include: (rel) =>
        COMMAND_SURFACE_TREES.some((tree) =>
          rel === tree || rel.startsWith(`${tree}/`)
        ) || COMMAND_SURFACE_FILES.has(rel),
    },
  });
  return (await textFiles(files)).filter(([rel]) =>
    !RETIRED_COMMAND_ALLOWLIST.has(rel)
  ).map(
    ([rel, text]): [string, string] => [
      rel,
      withoutRegistryAtlasMembers(rel, text),
    ],
  );
}

/** Structural forms of the retired agent-instructions vocabulary. The glossary
 * guard owns ordinary prose; this catches the forms prose scanning deliberately
 * cannot see: identifiers, config positions, feature ids, and file paths. */
const RETIRED_INSTRUCTION_STRUCTURE =
  /\bguid(?:ance|elines?)(?=[A-Z_]|\.sources\b|\.md\b|\/|-(?:check|compile|conditionals|corpus|parity|render|source|template)\b)/iu;

/** Dated and declaration surfaces where the retired spelling is evidence, not a
 * live contract. */
function isInstructionVocabularyRecord(rel: string): boolean {
  return isRepoMapPath(rel, "_adr") ||
    isRepoMapPath(rel, "_private") ||
    new Set([
      "scripts/glossary_registry.ts",
      "src/shared/vocabulary.ts",
      "tests/dev_vocab_guard_test.ts",
    ]).has(rel);
}

Deno.test("the retired Guidance/Guidelines structure stays out of live surfaces", async () => {
  const offenders: string[] = [];
  for (const [rel, source] of await commandSurfaceFiles()) {
    if (isInstructionVocabularyRecord(rel)) continue;
    if (RETIRED_INSTRUCTION_STRUCTURE.test(rel)) {
      offenders.push(`${rel}: retired vocabulary in path`);
    }
    if (
      (rel.startsWith("src/") || rel.startsWith("scripts/")) &&
      RETIRED_INSTRUCTION_STRUCTURE.test(source)
    ) {
      const hit = source.match(RETIRED_INSTRUCTION_STRUCTURE)?.[0] ?? "unknown";
      offenders.push(`${rel}: retired structural token ${JSON.stringify(hit)}`);
    }
  }
  assertEquals(
    offenders,
    [],
    "the agent-instructions rename regressed — use instructions/instruction " +
      `throughout live paths and symbols:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the retired agent-instructions detector bites on every structural form", () => {
  for (
    const value of [
      "guidanceFile",
      "guidance_sources",
      "guidance.sources",
      "guidance.md",
      "templates/guidance/",
      "guidance-compile",
      "guidelines.ts",
    ]
  ) {
    assertEquals(
      RETIRED_INSTRUCTION_STRUCTURE.test(value),
      true,
      `detector missed ${JSON.stringify(value)}`,
    );
  }
});

Deno.test("retired prelaunch command vocabulary does not reappear", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await commandSurfaceFiles()) {
    for (const token of RETIRED_COMMAND_TOKENS) {
      if (text.includes(token)) {
        offenders.push(`${rel} contains ${JSON.stringify(token)}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired command vocabulary is still present:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the public manual uses settled v1 compatibility language", async () => {
  const banned = [
    /\bbefore the tag\b/iu,
    /\bpre-?release\b/iu,
    /\bbefore the first release\b/iu,
    /\bfirst release tag\b/iu,
    /\bcompatibility projections?\b/iu,
  ];
  const files = await structuralGuardScope({
    guard: "tests/dev_vocab_guard_test.ts#settled-v1-manual-language",
    universe: "authored-text",
    narrow: {
      reason:
        "The settled-v1 wording contract applies to the shipped public manual.",
      include: (rel) => rel.startsWith("project/manual/"),
    },
  });
  const offenders: string[] = [];
  for (const [rel, text] of await textFiles(files)) {
    for (const pattern of banned) {
      const hit = text.match(pattern);
      if (hit !== null) offenders.push(`${rel}: ${JSON.stringify(hit[0])}`);
    }
  }
  assertEquals(offenders, []);
});

/**
 * ADR 0120 renamed the tree discern maintains to THE MAP, and ADR 0131 retired
 * the old concept phrase outright: "docs tree" on an authored surface either
 * misnames the map or conflates it with a project's own documentation (a
 * literal `docs/` directory stays describable — the slash keeps it out of this
 * pattern). Frozen ADRs and archived planning briefs keep their wording.
 */
Deno.test("the retired 'docs tree' concept phrase does not reappear", async () => {
  const pattern = /\bdocs[ -]tree/i;
  const frozen = (rel: string): boolean =>
    isRepoMapPath(rel, "_adr") ||
    rel.includes("/_done/");
  const offenders: string[] = [];
  for (const [rel, text] of await commandSurfaceFiles()) {
    if (frozen(rel)) continue;
    const hit = text.match(pattern);
    if (hit !== null) {
      offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `the retired "docs tree" phrase returned — the tree is the map:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

/** Escape one canonical token for interpolation into a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Private planning and this test-owned denylist are the only non-ADR surfaces
 * allowed to spell private-era launch vocabulary.
 */
function isLaunchVocabularyRecord(rel: string): boolean {
  return isRepoMapPath(rel, "_adr") ||
    isRepoMapPath(rel, "_private") ||
    rel.endsWith("/3a-vocabulary-and-rename-sweep.md") ||
    rel === "tests/dev_vocab_guard_test.ts";
}

/** Compatibility records allowed to retain the retired Project Recipe contract. */
function isProjectScriptMigrationRecord(rel: string): boolean {
  return isLaunchVocabularyRecord(rel) ||
    rel.includes("/_done/") ||
    new Set([
      "src/shared/paths_registry.ts",
      "tests/paths_registry_test.ts",
    ]).has(rel);
}

/**
 * Structural remnants of the retired Project Recipe surface. Ordinary English
 * such as a "CI recipe" remains legal; old config positions are covered by the
 * table-driven launch-vocabulary guard below.
 */
const RETIRED_PROJECT_SCRIPT_SURFACE = [
  /\bDISCERN_RECIPES(?:_DIR)?\b/u,
  /\{\{recipes_dir\}\}/u,
  /\bproject recipes?\b/iu,
  /\bENGINE_RECIPE_NAMES\b/u,
  /\bresolveRecipesDir\b/u,
  /\brecipeEnvVars\b/u,
  /\bRecipeEnv\b/u,
  /\bdiscern\/recipes\b/u,
];

Deno.test("the retired Project Recipe surface stays out of live surfaces", async () => {
  const offenders: string[] = [];
  for (const [rel, source] of await commandSurfaceFiles()) {
    if (isProjectScriptMigrationRecord(rel)) continue;
    for (const pattern of RETIRED_PROJECT_SCRIPT_SURFACE) {
      const hit = source.match(pattern);
      if (hit !== null) {
        offenders.push(`${rel} contains ${JSON.stringify(hit[0])}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired Project Recipe contract returned outside frozen records:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

interface ForbiddenPosition {
  retired: string;
  kind: string;
  pattern: RegExp;
}

/**
 * Structural patterns only: invocations, MCP identifiers, command registrations,
 * result verbs, and config keys. Ordinary English remains outside this guard —
 * words such as “finishing” and “docs” are legitimate prose.
 */
function retiredLaunchPositions(): ForbiddenPosition[] {
  const positions: ForbiddenPosition[] = [];
  for (
    const { spelling: retired } of PRELAUNCH_FORBIDDEN_LAUNCH_VOCABULARY.filter(
      (entry) => entry.kind === "command",
    )
  ) {
    const words = retired.split(" ");
    const cli = words.map(escapeRegExp).join("\\s+");
    const mcp = words.map(escapeRegExp).join("_");
    const leaf = escapeRegExp(words.at(-1) ?? retired);
    positions.push(
      {
        retired,
        kind: "CLI invocation",
        pattern: new RegExp(`\\bdiscern\\s+${cli}(?=[\\s\x60'\".,):]|$)`, "mu"),
      },
      {
        retired,
        kind: "MCP tool name",
        pattern: new RegExp(`\\bdiscern_${mcp}\\b`, "u"),
      },
      {
        retired,
        kind: "source dev invocation",
        pattern: new RegExp(
          `\\bdeno\\s+task\\s+dev\\s+${cli}(?=[\\s\x60'\".,):]|$)`,
          "mu",
        ),
      },
      {
        retired,
        kind: "command registration",
        pattern: new RegExp(`\\.command\\(\\s*[\"']${leaf}[\"']`, "u"),
      },
      {
        retired,
        kind: "CLI argv",
        pattern: new RegExp(
          `\\b(?:(?:runCli|resolveInvocation)\\s*\\(\\s*\\[|runAgent\\s*\\(\\s*[^,\\n]+,\\s*\\[)\\s*[\"']${leaf}[\"']`,
          "u",
        ),
      },
    );
    if (words.length === 1) {
      positions.push({
        retired,
        kind: "result verb",
        pattern: new RegExp(`\\bverb\\s*:\\s*[\"']${leaf}[\"']`, "u"),
      });
    }
  }

  for (
    const { spelling: retired } of PRELAUNCH_FORBIDDEN_LAUNCH_VOCABULARY.filter(
      (entry) => entry.kind === "config-key",
    )
  ) {
    if (retired.includes(".")) {
      const segments = retired.split(".");
      const segmentPattern = (segment: string): string =>
        segment === "*" ? "[A-Za-z0-9_-]+" : escapeRegExp(segment);
      const dotted = segments.map(segmentPattern).join("\\s*\\.\\s*");
      const parent = segments.slice(0, -1).map(segmentPattern).join(
        "\\s*\\.\\s*",
      );
      const leaf = segmentPattern(segments.at(-1) ?? retired);
      positions.push(
        {
          retired,
          kind: "dotted config key",
          pattern: new RegExp(
            `(?:\\bconfig(?:\\?\\.|\\.)|["'\\x60])${dotted}\\b`,
            "u",
          ),
        },
        {
          retired,
          kind: "bracketed config key",
          pattern: new RegExp(
            `\\[\\s*${parent}\\s*\\]\\s*\\.\\s*${leaf}\\b`,
            "u",
          ),
        },
        {
          retired,
          kind: "config interpolation",
          pattern: new RegExp(`\\$\\{${dotted}(?:\\.|\\})`, "u"),
        },
      );
      continue;
    }
    const key = escapeRegExp(retired);
    const spelling = `(?:${key}|\"${key}\"|'${key}')`;
    const dottedTail = retired === "docs" ? "dir" : "[A-Za-z0-9_-]+";
    positions.push(
      {
        retired,
        kind: "config table",
        pattern: new RegExp(`\\[\\s*${key}(?=\\s*(?:\\.|\\]))`, "mu"),
      },
      {
        retired,
        kind: "dotted config key",
        pattern: new RegExp(
          `(?:^\\s*${spelling}|[\"']${key})\\s*\\.\\s*${dottedTail}\\b(?=[\\s=\\x60'\"\\],)]|$)`,
          "mu",
        ),
      },
      {
        retired,
        kind: "config interpolation",
        pattern: new RegExp(`\\$\\{${key}\\.`, "u"),
      },
    );
  }
  return positions;
}

Deno.test("retired launch vocabulary stays out of callable and config positions", async () => {
  const offenders: string[] = [];
  const liveConfigSections = new Set(configSectionNames());
  for (
    const { spelling: retired } of PRELAUNCH_FORBIDDEN_LAUNCH_VOCABULARY.filter(
      (entry) => entry.kind === "config-key",
    )
  ) {
    const probe = retired.replaceAll("*", "fixture");
    const isLive = retired.includes(".")
      ? settableConfigValueKind(probe) !== undefined
      : liveConfigSections.has(retired);
    if (isLive) {
      offenders.push(
        `config schema: retired ${JSON.stringify(retired)} remains a live key`,
      );
    }
  }
  const patterns = retiredLaunchPositions();
  for (const [rel, text] of await commandSurfaceFiles()) {
    if (isLaunchVocabularyRecord(rel)) continue;
    for (const { retired, kind, pattern } of patterns) {
      if (pattern.test(text)) {
        offenders.push(`${rel}: retired ${JSON.stringify(retired)} in ${kind}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired launch vocabulary returned in a public contract position:\n  ${
      offenders.join("\n  ")
    }`,
  );
});
