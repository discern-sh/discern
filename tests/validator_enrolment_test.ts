/**
 * Artifact-validator ENROLMENT guard (ADR 0201) — dogfood-only enforcement,
 * cured as a class. A `src/lib` validator of a config-resolved authored
 * artifact must be applied by a SHIPPED surface — code reachable from
 * `src/main.ts`, `src/engine/**`, or `src/commands/**` — or carry a recorded,
 * reasoned exemption in the registry (`tests/validator_registry.ts`). Without
 * this, a validator written for every project can quietly end up applied only
 * by this repository's tests, holding discern's own artifacts to standards
 * end-user projects never get.
 *
 * Forward: every registry row is proven against the live import graph. A
 * `shipped` row must have a shipped use; a `repo-local` row must carry its
 * reason, must still be UNSHIPPED (an exemption retires loudly the moment the
 * validator gains a shipped caller), and must still be dogfood-applied
 * (an exemption for a validator nothing runs is a dead export, not policy).
 *
 * Reverse — the auto-enrolment sweep: a DOGFOOD TEST is a test importing
 * `tests/repo_authored_paths.ts`, the one registry of this repository's
 * configured authored artifacts; a `src/lib` function such a test
 * value-imports is presumptively a validator being dogfooded. If it has no
 * shipped use it must be enrolled in `ARTIFACT_VALIDATORS` or recorded in
 * `NON_VALIDATOR_IMPORTS` — exactly one of the two — so the next validator
 * someone writes and forgets to wire fails here, with the remedy in the
 * message.
 *
 * SHIPPED USE, mechanically: a value import from a module in the shipped
 * closure (type-only imports are erased and never count) — a static
 * `import … from` clause, or a literal-specifier dynamic `import("…")` (the
 * dispatcher's lazy verb bodies; the loaded namespace exposes every export,
 * so it carries `*` semantics) — or, because a shipped wrapper often applies
 * a sibling export of its own module, a comment-stripped intra-module
 * reference outside the export's declaration when the module itself is
 * shipped. The residual, named: the graph reader misses side-effect imports
 * and computed dynamic specifiers, and the intra-module rule over-credits a
 * reference made by an unshipped sibling. The matcher stays conservative;
 * enrolment at authoring time remains the discipline this guard backs up.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import {
  ARTIFACT_VALIDATORS,
  type EnrolledValidator,
  NON_VALIDATOR_IMPORTS,
} from "./validator_registry.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const REGISTRY_MODULE = "tests/validator_registry.ts";
const DOGFOOD_ANCHOR = "tests/repo_authored_paths.ts";
const LIB_PREFIX = "src/lib/";

// --- The import-graph model, pure over an injected (path → text) universe so
// the controls can inject fixtures.

type Universe = ReadonlyMap<string, string>;

interface ImportEdge {
  readonly to: string;
  /** Imported names carrying VALUE semantics (`type` specifiers excluded);
   * `*` marks a namespace import, `default` a default import. */
  readonly valueNames: readonly string[];
}

const IMPORT_CLAUSE =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:([\w$]+)\s*,\s*)?(?:\*\s+as\s+([\w$]+)|\{([^}]*)\}|([\w$]+))?\s*from\s*["']([^"']+)["']/g;

/** Dynamic `import("…")` with a literal specifier — the lazy verb-body form
 * the dispatcher uses. The awaited module namespace exposes every export, so
 * the edge carries `*` value semantics; a computed specifier stays invisible
 * (the named residual). */
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Relative-import edges of one module — static clauses and literal dynamic
 * `import("…")` — with value names resolved. */
function importEdges(rel: string, text: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const match of text.matchAll(IMPORT_CLAUSE)) {
    const [, typeOnly, defaultName, nsName, braces, bareDefault, spec] = match;
    if (spec === undefined || !spec.startsWith(".")) continue;
    const to = normalize(join(dirname(rel), spec));
    const valueNames: string[] = [];
    if (braces !== undefined && typeOnly === undefined) {
      for (const part of braces.split(",")) {
        const specifier = part.trim();
        if (specifier.length === 0 || /^type\s/.test(specifier)) continue;
        const name = (specifier.split(/\s+as\s+/)[0] ?? "").trim();
        if (name.length > 0) valueNames.push(name);
      }
    }
    if ((defaultName ?? bareDefault) !== undefined && typeOnly === undefined) {
      valueNames.push("default");
    }
    if (nsName !== undefined && typeOnly === undefined) valueNames.push("*");
    edges.push({ to, valueNames });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    const spec = match[1];
    if (spec === undefined || !spec.startsWith(".")) continue;
    edges.push({ to: normalize(join(dirname(rel), spec)), valueNames: ["*"] });
  }
  return edges;
}

/** Whether a module belongs to the binary's shipped trees by construction. */
function isShippedRoot(rel: string): boolean {
  return rel === "src/main.ts" || rel.startsWith("src/engine/") ||
    rel.startsWith("src/commands/");
}

/** The shipped closure: every module value-reachable from a shipped root. */
function shippedClosure(universe: Universe): Set<string> {
  const shipped = new Set<string>();
  const queue: string[] = [];
  for (const rel of universe.keys()) {
    if (isShippedRoot(rel)) {
      shipped.add(rel);
      queue.push(rel);
    }
  }
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    for (const edge of importEdges(current, universe.get(current) ?? "")) {
      if (edge.valueNames.length === 0) continue;
      if (universe.has(edge.to) && !shipped.has(edge.to)) {
        shipped.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return shipped;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Every exported function of the universe's `src/lib` modules, as
 * `module#name` keys. */
function libFunctionExports(universe: Universe): Set<string> {
  const exports = new Set<string>();
  const declaration = /(?:^|\n)export\s+(?:async\s+)?function\s+([\w$]+)/g;
  for (const [rel, text] of universe) {
    if (!rel.startsWith(LIB_PREFIX)) continue;
    for (const match of text.matchAll(declaration)) {
      const name = match[1];
      if (name !== undefined) exports.add(`${rel}#${name}`);
    }
  }
  return exports;
}

/** Shipped uses of one `module#name` export: shipped modules value-importing
 * it, plus its own module when that module is shipped and its code references
 * the name outside the declaration. */
function shippedUses(
  universe: Universe,
  shipped: ReadonlySet<string>,
  key: string,
): string[] {
  const [module, name] = key.split("#");
  if (module === undefined || name === undefined || name.length === 0) {
    return [];
  }
  const uses: string[] = [];
  for (const [rel, text] of universe) {
    if (!shipped.has(rel) || rel === module) continue;
    for (const edge of importEdges(rel, text)) {
      if (
        edge.to === module &&
        (edge.valueNames.includes(name) || edge.valueNames.includes("*"))
      ) {
        uses.push(rel);
      }
    }
  }
  const own = universe.get(module);
  if (own !== undefined && shipped.has(module)) {
    const code = stripComments(own);
    const mention = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g");
    const declared = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${name}(?![\\w$])`,
      "g",
    );
    const mentions = [...code.matchAll(mention)].length;
    const declarations = [...code.matchAll(declared)].length;
    if (mentions > declarations) uses.push(`${module} (intra-module)`);
  }
  return uses;
}

/** Dogfood tests: test files importing the authored-paths registry. */
function dogfoodTests(universe: Universe): string[] {
  const tests: string[] = [];
  for (const [rel, text] of universe) {
    if (!rel.startsWith("tests/") || !rel.endsWith("_test.ts")) continue;
    if (importEdges(rel, text).some((edge) => edge.to === DOGFOOD_ANCHOR)) {
      tests.push(rel);
    }
  }
  return tests.sort();
}

/** `src/lib` function exports value-imported by dogfood tests, with the
 * importing tests. */
function dogfoodCandidates(universe: Universe): Map<string, string[]> {
  const functions = libFunctionExports(universe);
  const candidates = new Map<string, string[]>();
  for (const rel of dogfoodTests(universe)) {
    for (const edge of importEdges(rel, universe.get(rel) ?? "")) {
      if (!edge.to.startsWith(LIB_PREFIX)) continue;
      for (const name of edge.valueNames) {
        const key = `${edge.to}#${name}`;
        if (functions.has(key)) {
          candidates.set(key, [...(candidates.get(key) ?? []), rel]);
        }
      }
    }
  }
  return candidates;
}

// --- Predicates, pure over their inputs so the controls can inject fixtures.

interface GraphFacts {
  readonly functions: ReadonlySet<string>;
  readonly candidates: ReadonlyMap<string, readonly string[]>;
  /** Shipped uses per export key; a key absent here has none. */
  readonly uses: ReadonlyMap<string, readonly string[]>;
}

function keyOf(row: EnrolledValidator): string {
  return `${row.module}#${row.exportName}`;
}

/** Forward offenders: registry rows that no longer hold against the tree. */
function registryOffenders(
  registry: readonly EnrolledValidator[],
  facts: GraphFacts,
): string[] {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const row of registry) {
    const key = keyOf(row);
    if (seen.has(key)) {
      offenders.push(`${key}: enrolled twice — delete the duplicate row`);
      continue;
    }
    seen.add(key);
    if (!row.module.startsWith(LIB_PREFIX)) {
      offenders.push(
        `${key}: enrolment covers ${LIB_PREFIX} — shipped trees are shipped ` +
          "by construction and need no row",
      );
      continue;
    }
    if (!facts.functions.has(key)) {
      offenders.push(
        `${key}: not an exported function of ${row.module} — re-point or ` +
          "delete the stale row",
      );
      continue;
    }
    if (row.subjects.length === 0) {
      offenders.push(`${key}: a validator names its artifact subject(s)`);
    }
    const uses = facts.uses.get(key) ?? [];
    if (row.enforcement.kind === "shipped" && uses.length === 0) {
      offenders.push(
        `${key}: enrolled as shipped, but nothing reachable from the ` +
          "binary's shipped trees applies it — wire it back into a shipped " +
          "surface (the gate, refresh, status, a verb), or re-record it " +
          "repo-local with the reason",
      );
    }
    if (row.enforcement.kind === "repo-local") {
      if (row.enforcement.reason.trim().length === 0) {
        offenders.push(`${key}: a repo-local row carries its reason`);
      }
      if (uses.length > 0) {
        offenders.push(
          `${key}: recorded repo-local, but the binary now applies it ` +
            `(${uses.join(", ")}) — the exemption is stale; re-record the ` +
            "row as shipped",
        );
      }
      if (!facts.candidates.has(key)) {
        offenders.push(
          `${key}: recorded repo-local, but no dogfood test applies it — ` +
            "nothing enforces this validator anywhere; wire it, dogfood it, " +
            "or delete the export and its row",
        );
      }
    }
  }
  return offenders;
}

/** Reverse offenders: unshipped dogfooded functions outside the contract. */
function sweepOffenders(
  registry: readonly EnrolledValidator[],
  ledger: Readonly<Record<string, string>>,
  facts: GraphFacts,
): string[] {
  const enrolled = new Set(registry.map(keyOf));
  const offenders: string[] = [];
  for (const [key, tests] of [...facts.candidates.entries()].sort()) {
    if ((facts.uses.get(key) ?? []).length > 0) continue;
    const isEnrolled = enrolled.has(key);
    const isRecorded = Object.hasOwn(ledger, key);
    if (isEnrolled && isRecorded) {
      offenders.push(
        `${key}: both enrolled in ARTIFACT_VALIDATORS and recorded in ` +
          "NON_VALIDATOR_IMPORTS — delete one",
      );
    }
    if (!isEnrolled && !isRecorded) {
      offenders.push(
        `${key} is applied to this repository's authored artifacts by ` +
          `${tests.join(", ")}, but nothing shipped applies it — end-user ` +
          "projects never get this check. Wire it into a shipped surface " +
          `and enrol it in ARTIFACT_VALIDATORS (${REGISTRY_MODULE}) as ` +
          "shipped; or enrol it repo-local with the reason; or, if it is " +
          "not a validator, record it in NON_VALIDATOR_IMPORTS with the " +
          "reason",
      );
    }
  }
  return offenders;
}

/** Ledger offenders: non-validator records that went stale. */
function ledgerOffenders(
  ledger: Readonly<Record<string, string>>,
  facts: GraphFacts,
): string[] {
  const offenders: string[] = [];
  for (const [key, reason] of Object.entries(ledger)) {
    if (reason.trim().length === 0) {
      offenders.push(`${key}: a non-validator record carries its reason`);
    }
    if (!facts.functions.has(key)) {
      offenders.push(
        `${key}: not an exported src/lib function — delete the stale record`,
      );
      continue;
    }
    if (!facts.candidates.has(key)) {
      offenders.push(
        `${key}: no dogfood test imports it any more — delete the stale ` +
          "record",
      );
    }
    if ((facts.uses.get(key) ?? []).length > 0) {
      offenders.push(
        `${key}: the binary now applies it — the record is stale; delete it`,
      );
    }
  }
  return offenders;
}

// --- The real-tree sweep over the authored universe.

const UNIVERSE: Universe = await (async () => {
  const files = new Map<string, string>();
  for (const rel of AUTHORED_TS_FILES) {
    files.set(rel, await Deno.readTextFile(join(REPO_ROOT, rel)));
  }
  return files;
})();

const FACTS: GraphFacts = (() => {
  const shipped = shippedClosure(UNIVERSE);
  const functions = libFunctionExports(UNIVERSE);
  const candidates = dogfoodCandidates(UNIVERSE);
  const uses = new Map<string, readonly string[]>();
  const keys = new Set<string>([
    ...candidates.keys(),
    ...ARTIFACT_VALIDATORS.map(keyOf),
    ...Object.keys(NON_VALIDATOR_IMPORTS),
  ]);
  for (const key of keys) {
    uses.set(key, shippedUses(UNIVERSE, shipped, key));
  }
  return { functions, candidates, uses };
})();

Deno.test("every enrolled validator row holds against the live import graph", () => {
  const offenders = registryOffenders(ARTIFACT_VALIDATORS, FACTS);
  assertEquals(
    offenders,
    [],
    `registry rows out of step with the tree:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every unshipped dogfooded library function is enrolled or recorded", () => {
  const offenders = sweepOffenders(
    ARTIFACT_VALIDATORS,
    NON_VALIDATOR_IMPORTS,
    FACTS,
  );
  assertEquals(
    offenders,
    [],
    `the dogfood sweep found strays:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every non-validator record is live against the tree", () => {
  const offenders = ledgerOffenders(NON_VALIDATOR_IMPORTS, FACTS);
  assertEquals(
    offenders,
    [],
    `stale NON_VALIDATOR_IMPORTS records:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the sweep sees the real wiring (it cannot go blind)", () => {
  const shipped = shippedClosure(UNIVERSE);
  assert(
    shipped.has("src/engine/gate/finish.ts"),
    "the shipped closure no longer covers the gate — the graph reader broke",
  );
  assert(
    shipped.size >= 100,
    `the shipped closure collapsed (${shipped.size} modules) — the graph ` +
      "reader broke",
  );
  assert(
    dogfoodTests(UNIVERSE).length >= 10,
    "the dogfood-test detector sees almost nothing — the anchor import " +
      `moved, or the matcher broke (${dogfoodTests(UNIVERSE).length} tests)`,
  );
  assert(
    FACTS.candidates.size >= 5,
    `the candidate sweep sees almost nothing (${FACTS.candidates.size} ` +
      "exports) — the matcher has gone blind",
  );
  const shippedRows = ARTIFACT_VALIDATORS.filter(
    (row) => row.enforcement.kind === "shipped",
  );
  assert(
    shippedRows.length >= 3,
    "the registry no longer declares the shipped preflights — rows were " +
      "deleted without retiring their validators",
  );
});

// --- Positive controls: prove the graph reader and predicates discriminate,
// so the guard cannot rot into a sweep that passes because nothing looks
// unwired. Fixture universes, never the live tree.

/** A fixture universe: one validator module, an optional shipped caller, one
 * dogfood test applying the validator to the authored artifacts. */
function fixtureUniverse(options: { wired: boolean }): Universe {
  const files = new Map<string, string>();
  files.set(
    "src/lib/widget_check.ts",
    "export function checkWidgets(root: string): string[] {\n" +
      "  return [root];\n}\n",
  );
  files.set(
    "src/engine/gate/fixture.ts",
    options.wired
      ? 'import { checkWidgets } from "../../lib/widget_check.ts";\n' +
        "export const wired = checkWidgets;\n"
      : "export const wired = undefined;\n",
  );
  files.set(
    "tests/widget_dogfood_test.ts",
    'import { REPO_ROOT } from "./repo_authored_paths.ts";\n' +
      'import { checkWidgets } from "../src/lib/widget_check.ts";\n' +
      'Deno.test("widgets", () => void checkWidgets(REPO_ROOT));\n',
  );
  return files;
}

function fixtureFacts(universe: Universe): GraphFacts {
  const shipped = shippedClosure(universe);
  const functions = libFunctionExports(universe);
  const candidates = dogfoodCandidates(universe);
  const uses = new Map<string, readonly string[]>();
  for (const key of [...candidates.keys(), ...functions]) {
    uses.set(key, shippedUses(universe, shipped, key));
  }
  return { functions, candidates, uses };
}

const FIXTURE_KEY = "src/lib/widget_check.ts#checkWidgets";

const FIXTURE_SHIPPED_ROW: EnrolledValidator = {
  module: "src/lib/widget_check.ts",
  exportName: "checkWidgets",
  subjects: ["map"],
  enforcement: { kind: "shipped", via: "a fixture surface" },
};

const FIXTURE_LOCAL_ROW: EnrolledValidator = {
  module: "src/lib/widget_check.ts",
  exportName: "checkWidgets",
  subjects: ["map"],
  enforcement: { kind: "repo-local", reason: "a fixture reason" },
};

Deno.test("control: a lazily-imported shipped wiring still counts (dynamic import edges are seen)", () => {
  // The dispatcher's verb bodies load via literal `await import(…)`; the graph
  // reader must credit that wiring or every lazified module's validators would
  // read as strays.
  const files = new Map(fixtureUniverse({ wired: false }));
  files.set(
    "src/engine/gate/fixture.ts",
    "export async function wired(root: string): Promise<string[]> {\n" +
      '  const { checkWidgets } = await import("../../lib/widget_check.ts");\n' +
      "  return checkWidgets(root);\n}\n",
  );
  const offenders = registryOffenders(
    [FIXTURE_SHIPPED_ROW],
    fixtureFacts(files),
  );
  assertEquals(
    offenders,
    [],
    "a literal dynamic import from a shipped module must count as shipped use",
  );
});

Deno.test("control: an unwired enrolled validator fails the forward check", () => {
  const facts = fixtureFacts(fixtureUniverse({ wired: false }));
  const offenders = registryOffenders([FIXTURE_SHIPPED_ROW], facts);
  assertEquals(offenders.length, 1, "an unwired shipped row must offend");
  assert(
    (offenders[0] ?? "").includes("wire it back into a shipped surface"),
    "the failure teaches the remedy",
  );
  assertEquals(
    registryOffenders(
      [FIXTURE_SHIPPED_ROW],
      fixtureFacts(
        fixtureUniverse({ wired: true }),
      ),
    ),
    [],
    "the same row passes once a shipped module imports the validator",
  );
});

Deno.test("control: an unregistered unshipped dogfood candidate fails the sweep", () => {
  const facts = fixtureFacts(fixtureUniverse({ wired: false }));
  const offenders = sweepOffenders([], {}, facts);
  assertEquals(offenders.length, 1, "an unregistered candidate must offend");
  assert(
    (offenders[0] ?? "").includes("end-user projects never get this check"),
    "the failure names the class",
  );
  assertEquals(
    sweepOffenders([FIXTURE_LOCAL_ROW], {}, facts),
    [],
    "a repo-local enrolment satisfies the sweep",
  );
  assertEquals(
    sweepOffenders([], { [FIXTURE_KEY]: "a fixture reason" }, facts),
    [],
    "a non-validator record satisfies the sweep",
  );
  assertEquals(
    sweepOffenders(
      [FIXTURE_LOCAL_ROW],
      { [FIXTURE_KEY]: "also recorded" },
      facts,
    ).length,
    1,
    "enrolled-and-recorded must offend",
  );
  assertEquals(
    sweepOffenders([], {}, fixtureFacts(fixtureUniverse({ wired: true }))),
    [],
    "a shipped candidate needs no record",
  );
});

Deno.test("control: exemptions retire loudly", () => {
  const wired = fixtureFacts(fixtureUniverse({ wired: true }));
  const nowShipped = registryOffenders([FIXTURE_LOCAL_ROW], wired);
  assertEquals(
    nowShipped.length,
    1,
    "a repo-local row for a shipped validator must offend",
  );
  assert(
    (nowShipped[0] ?? "").includes("the exemption is stale"),
    "the failure says the exemption retired",
  );
  const unwired = fixtureFacts(fixtureUniverse({ wired: false }));
  assertEquals(
    registryOffenders([FIXTURE_LOCAL_ROW], unwired),
    [],
    "a live repo-local row passes",
  );
  assertEquals(
    registryOffenders(
      [{
        ...FIXTURE_LOCAL_ROW,
        enforcement: { kind: "repo-local", reason: " " },
      }],
      unwired,
    ).length,
    1,
    "an empty reason must offend",
  );
  assertEquals(
    registryOffenders(
      [{ ...FIXTURE_LOCAL_ROW, exportName: "vanished" }],
      unwired,
    ).length,
    1,
    "a row pinned to a vanished export must offend",
  );
  assertEquals(
    ledgerOffenders({ [FIXTURE_KEY]: "a fixture reason" }, wired).length,
    1,
    "a non-validator record for a shipped export must offend",
  );
  assertEquals(
    ledgerOffenders({ "src/lib/gone.ts#gone": "a reason" }, unwired).length,
    1,
    "a record for a missing export must offend",
  );
  assertEquals(
    ledgerOffenders({ [FIXTURE_KEY]: "" }, unwired).length,
    1,
    "an empty ledger reason must offend",
  );
  assertEquals(
    ledgerOffenders({ [FIXTURE_KEY]: "a fixture reason" }, unwired),
    [],
    "a live non-validator record passes",
  );
});

Deno.test("control: the graph reader sees value imports, not type imports", () => {
  const files = new Map(fixtureUniverse({ wired: false }));
  files.set(
    "src/engine/gate/fixture.ts",
    'import type { checkWidgets } from "../../lib/widget_check.ts";\n' +
      "export type Wired = typeof checkWidgets;\n",
  );
  const facts = fixtureFacts(files);
  assertEquals(
    facts.uses.get(FIXTURE_KEY) ?? [],
    [],
    "a type-only import is erased at runtime and must not count as shipped",
  );
  const intra = new Map(files);
  intra.set(
    "src/lib/widget_check.ts",
    "export function checkWidgets(root: string): string[] {\n" +
      "  return [root];\n}\n" +
      "export function checkAll(root: string): string[] {\n" +
      "  return checkWidgets(root);\n}\n",
  );
  intra.set(
    "src/engine/gate/fixture.ts",
    'import { checkAll } from "../../lib/widget_check.ts";\n' +
      "export const wired = checkAll;\n",
  );
  const intraFacts = fixtureFacts(intra);
  assertEquals(
    intraFacts.uses.get(FIXTURE_KEY)?.length ?? 0,
    1,
    "an intra-module call from a shipped wrapper counts as shipped",
  );
  const commentOnly = new Map(files);
  commentOnly.set(
    "src/lib/widget_check.ts",
    "/** See {@link checkWidgets} and checkWidgets again. */\n" +
      "export function checkWidgets(root: string): string[] {\n" +
      "  return [root];\n}\n",
  );
  commentOnly.set(
    "src/engine/gate/fixture.ts",
    'import { checkWidgets as aliased } from "../../lib/widget_check.ts";\n' +
      "export const wired = aliased;\n",
  );
  const commentFacts = fixtureFacts(commentOnly);
  assertEquals(
    commentFacts.uses.get(FIXTURE_KEY)?.length ?? 0,
    1,
    "doc-comment mentions must not count; the aliased value import must",
  );
});
