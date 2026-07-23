/**
 * SSOT-CLAIM sweep — the claim itself is the enrolment trigger (ADR 0181),
 * extending the canonical-sets contract (ADR 0176). A module that announces
 * itself as a
 * single source of truth can no longer exist outside the meta-registry
 * unseen: it must be some entry's `source.module`, or a recorded, reasoned
 * absence in `UNAFFILIATED_SETS` — exactly one of the two.
 *
 * The convention sweeps only see the pattern's footprint (guard-test
 * suffixes, codegen targets); a registry whose class test is named outside
 * the convention was invisible to them — eight sets escaped that way before
 * the July 2026 audit enrolled them. The codebase already announces its
 * registries in doc comments, so this sweep reads the announcement.
 *
 * MATCHER RULES — conservative by design; a comment referencing another
 * module's SSOT must never fire:
 *
 * Where it looks: the authored-TypeScript universe (`AUTHORED_TS_FILES`),
 * minus `*_test.ts` files — a test's prose describes the set it guards,
 * never one it owns; non-test registry modules under `tests/` (like
 * `spawn_surfaces.ts`) stay scanned. Only doc-comment blocks count, in two
 * positions: the module-level block (first in the file, nothing but
 * whitespace or line comments before it) and blocks attached to an `export`
 * declaration. Line comments, inner comments, and string literals never
 * fire.
 *
 * What counts as a claim — "single source of truth", or word-bounded "SSOT",
 * case-insensitive, in one of three shapes:
 *   - predicative: the phrase followed by "for", "of", or ":" — "the SSOT
 *     for the mode vocabulary";
 *   - appositive: the phrase directly after an em-dash, an optional article
 *     between — "The kit version — single source of truth.";
 *   - copular: "is/are the" directly before the phrase — "This table is the
 *     single source of truth.".
 *
 * What never fires (vetoes, applied per match):
 *   - a parenthetical aside — "iterates KNOWN_JOBS (the SSOT)" cites a set
 *     defined elsewhere;
 *   - a possessive holder — "the config's single source of truth" names the
 *     config schema, not the module at hand;
 *   - a sentence naming another module (a `.ts`/`.tsx`/`.tmpl` token) —
 *     "defined once as GateDataSchema in `result_schemas.ts` (the SSOT ...)"
 *     points away from the file making the comment.
 *
 * The residual is named, in the ADR 0176 spirit: a claim phrased outside the
 * three shapes, or made in a line comment or a test file, evades the sweep —
 * enrolment at authoring time remains the discipline this guard backs up.
 * The sweep reads claim text only; it never imports or executes a scanned
 * module, and the meta-layer stays an observer, not an enrolment engine.
 */

import { assert, assertEquals } from "@std/assert";
import { basename, join } from "@std/path";
import {
  CANONICAL_SETS,
  type CanonicalSetEntry,
  UNAFFILIATED_SETS,
} from "../scripts/canonical_sets.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const REGISTRY_MODULE = "scripts/canonical_sets.ts";

// --- The matcher, pure over (path, text) so the controls can inject fixtures.

/** Doc-comment prose eligible to carry a claim: the module-level block plus
 * every export-attached block, comment furniture stripped, one line each. */
function claimableDocProse(text: string): string[] {
  const prose: string[] = [];
  for (const match of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const block = match[0];
    const before = text.slice(0, match.index);
    const moduleLevel = /^(?:\s|\/\/[^\n]*\n?)*$/.test(before);
    const after = text.slice(match.index + block.length);
    const exportAttached = /^\s*export\s/.test(after);
    if (!moduleLevel && !exportAttached) continue;
    prose.push(
      block
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, ""))
        .join(" "),
    );
  }
  return prose;
}

/** The sentence-ish segment around `index`: between boundary punctuation
 * (`.` `;` `:`) that ends a token — the dot inside a filename is not a
 * boundary, so a cited module stays in its sentence. */
function segmentAt(prose: string, index: number): string {
  let start = 0;
  for (const match of prose.matchAll(/[.;:](?=\s|$)/g)) {
    if (match.index >= index) return prose.slice(start, match.index);
    start = match.index + 1;
  }
  return prose.slice(start);
}

/** A token naming a TypeScript module or a template file. */
const MODULE_TOKEN = /[\w@][\w./@-]*\.(?:ts|tsx|tmpl)\b/g;

/** Leading tokens that carry no meaning for form detection: articles and
 * Markdown bold/italic markers. */
function isSkippableToken(token: string): boolean {
  return /^(?:the|a|an)$/i.test(token) || /^\*+$/.test(token);
}

/** Every SSOT claim the file's eligible doc blocks make, as sentence
 * excerpts. Empty for test files and for files making no anchored claim. */
function ssotClaims(rel: string, text: string): string[] {
  if (rel.endsWith("_test.ts")) return [];
  const claims: string[] = [];
  for (const prose of claimableDocProse(text)) {
    const phrase =
      /single\s+source\s+of\s+truth|(?<![0-9A-Za-z_])ssot(?![0-9A-Za-z_])/gi;
    for (const match of prose.matchAll(phrase)) {
      const start = match.index;
      const end = start + match[0].length;

      // Veto: a parenthetical aside cites a set defined elsewhere.
      const open = prose.lastIndexOf("(", start);
      const close = prose.lastIndexOf(")", start);
      if (open > close && prose.indexOf(")", end) !== -1) continue;

      // The token leading into the phrase, skipping articles and bold marks.
      const tokens = prose.slice(0, start).trimEnd().split(/\s+/);
      let cursor = tokens.length - 1;
      while (cursor >= 0 && isSkippableToken(tokens[cursor] ?? "")) cursor--;
      const prev = tokens[cursor] ?? "";

      // Veto: a possessive holder names whose SSOT this is — someone else's.
      if (/['’]s$/.test(prev)) continue;

      const follow = prose.slice(end).replace(/^[\s*]+/, "");
      const predicative = /^(?:for|of)\b/i.test(follow) ||
        follow.startsWith(":");
      const appositive = prev.endsWith("—");
      const copular = /^(?:is|are)$/i.test(prev);
      if (!predicative && !appositive && !copular) continue;

      // Veto: the sentence names another module — a reference, not a claim.
      const segment = segmentAt(prose, start);
      const cited = segment.match(MODULE_TOKEN) ?? [];
      if (cited.some((token) => basename(token) !== basename(rel))) continue;

      claims.push(segment.trim());
    }
  }
  return claims;
}

// --- Predicates, pure over their inputs so the controls can inject fixtures.

interface ScannedModule {
  readonly rel: string;
  readonly claims: readonly string[];
}

/** The module a ledger key covers (`path#EXPORT` → `path`). */
function recordModule(key: string): string {
  return key.split("#")[0] ?? key;
}

/** Sweep offenders: claiming modules neither enrolled nor recorded — or both. */
function claimSweepOffenders(
  modules: readonly ScannedModule[],
  entries: readonly CanonicalSetEntry[],
  unaffiliated: Readonly<Record<string, string>>,
): string[] {
  const enrolled = new Set(
    entries.flatMap((entry) =>
      entry.source.kind === "module" ? [entry.source.module] : []
    ),
  );
  const recorded = new Set(Object.keys(unaffiliated).map(recordModule));
  const offenders: string[] = [];
  for (const { rel, claims } of modules) {
    const first = claims[0];
    if (first === undefined) continue;
    const isEnrolled = enrolled.has(rel);
    const isRecorded = recorded.has(rel);
    if (!isEnrolled && !isRecorded) {
      offenders.push(
        `${rel} claims to be a single source of truth ("${first}") but ` +
          "anchors no declared canonical set — declare it as an entry's " +
          `source in ${REGISTRY_MODULE}, or record it in UNAFFILIATED_SETS ` +
          "with the reason",
      );
    }
    if (isEnrolled && isRecorded) {
      offenders.push(
        `${rel} is recorded in UNAFFILIATED_SETS, but an entry already ` +
          "declares it as a source — delete the stale record",
      );
    }
  }
  return offenders;
}

interface LedgerTarget {
  /** undefined marks a module missing from the authored universe. */
  readonly text: string | undefined;
  readonly claims: readonly string[];
}

/** Ledger offenders: records that went stale against the live tree. */
function ledgerOffenders(
  unaffiliated: Readonly<Record<string, string>>,
  targets: ReadonlyMap<string, LedgerTarget>,
): string[] {
  const offenders: string[] = [];
  for (const [key, reason] of Object.entries(unaffiliated)) {
    if (reason.trim().length === 0) {
      offenders.push(`${key}: an unaffiliated-set record carries its reason`);
    }
    const rel = recordModule(key);
    const target = targets.get(rel);
    if (target === undefined || target.text === undefined) {
      offenders.push(
        `${key} is recorded in UNAFFILIATED_SETS but ${rel} is not an ` +
          "authored module — delete the stale record",
      );
      continue;
    }
    if (target.claims.length === 0) {
      offenders.push(
        `${key} is recorded in UNAFFILIATED_SETS but ${rel} no longer ` +
          "claims single-source-of-truth status — delete the stale record",
      );
    }
    const exportName = key.includes("#") ? key.split("#")[1] : undefined;
    if (
      exportName !== undefined && exportName.length > 0 &&
      !target.text.includes(exportName)
    ) {
      offenders.push(
        `${key}: ${rel} no longer mentions ${exportName} — re-point or ` +
          "delete the stale record",
      );
    }
  }
  return offenders;
}

// --- The real-tree sweep over the authored universe.

const UNIVERSE: ReadonlyMap<string, LedgerTarget> = await (async () => {
  const targets = new Map<string, LedgerTarget>();
  for (const rel of AUTHORED_TS_FILES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    targets.set(rel, { text, claims: ssotClaims(rel, text) });
  }
  return targets;
})();

const SCANNED: readonly ScannedModule[] = [...UNIVERSE.entries()].map((
  [rel, target],
) => ({ rel, claims: target.claims }));

Deno.test("every SSOT-claiming module is a declared source or a recorded absence", () => {
  const offenders = claimSweepOffenders(
    SCANNED,
    CANONICAL_SETS,
    UNAFFILIATED_SETS,
  );
  assertEquals(
    offenders,
    [],
    `the SSOT-claim sweep found strays:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("every UNAFFILIATED_SETS record is live against the tree", () => {
  const offenders = ledgerOffenders(UNAFFILIATED_SETS, UNIVERSE);
  assertEquals(
    offenders,
    [],
    `stale UNAFFILIATED_SETS records:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the sweep sees the enrolled registries' own claims (it cannot go blind)", () => {
  const enrolled = new Set(
    CANONICAL_SETS.flatMap((entry) =>
      entry.source.kind === "module" ? [entry.source.module] : []
    ),
  );
  const enrolledClaimants = SCANNED.filter(
    (module) => module.claims.length > 0 && enrolled.has(module.rel),
  );
  assert(
    enrolledClaimants.length >= 5,
    "the enrolled registries announce themselves as single sources of truth " +
      "in their doc comments; the matcher no longer sees those claims — it " +
      `has gone blind (saw ${enrolledClaimants.length})`,
  );
});

// --- Positive controls: prove the matcher and predicates discriminate, so
// the guard cannot rot into a sweep that passes because nothing looks like a
// claim.

Deno.test("control: each claim shape fires on a fixture module", () => {
  const shapes: Readonly<Record<string, string>> = {
    predicative: "/** The SSOT for the widget vocabulary. */\n" +
      "export const W = 1;\n",
    appositive: "/** The widget table — single source of truth. */\n" +
      "export const W = 1;\n",
    copular: "/** This table is the single source of truth. */\n" +
      "export const W = 1;\n",
  };
  for (const [shape, text] of Object.entries(shapes)) {
    assertEquals(
      ssotClaims("src/w.ts", text).length,
      1,
      `the ${shape} claim shape must fire`,
    );
  }
});

Deno.test("control: reference forms never fire", () => {
  const references: Readonly<Record<string, string>> = {
    "parenthetical aside":
      "/** Iterates KNOWN_W (the SSOT), so a member auto-enrols. */\n" +
      "export const W = 1;\n",
    "possessive holder":
      "/** Reads the schema's single source of truth for the shape. */\n" +
      "export const W = 1;\n",
    "another module named":
      "/** The shape lives as WSchema in `other_schemas.ts`, the SSOT for " +
      "every result. */\nexport const W = 1;\n",
    "noun compound": "/** Reconciled against the widget SSOT. */\n" +
      "export const W = 1;\n",
    "line comment": "// the single source of truth for widget kinds\n" +
      "export const W = 1;\n",
    "unattached inner block": "export const X = 2;\n\n" +
      "/** The SSOT for widget kinds. */\nconst W = 1;\n",
  };
  for (const [form, text] of Object.entries(references)) {
    assertEquals(
      ssotClaims("src/w.ts", text),
      [],
      `a ${form} must not fire`,
    );
  }
  assertEquals(
    ssotClaims(
      "tests/w_test.ts",
      "/** The SSOT for widget kinds. */\nexport const W = 1;\n",
    ),
    [],
    "a test file's prose must not fire",
  );
});

Deno.test("control: an own-module mention does not veto the claim", () => {
  const text = "/** The SSOT for widget kinds; `w.ts` is imported by every " +
    "consumer. */\nexport const W = 1;\n";
  assertEquals(ssotClaims("src/w.ts", text).length, 1);
});

const CONTROL_ENTRY: CanonicalSetEntry = {
  id: "control",
  title: "Control",
  what: "A fixture.",
  source: { kind: "module", module: "src/w.ts", exportName: "W" },
  guards: ["tests/control_parity_test.ts"],
  artifacts: [],
  enrolledIn: {
    glossary: { absent: "a fixture" },
    featureCanon: { absent: "a fixture" },
  },
};

Deno.test("control: a claiming module must be enrolled or recorded — never neither, never both", () => {
  const scanned: ScannedModule[] = [
    { rel: "src/w.ts", claims: ["The SSOT for widget kinds"] },
  ];
  assertEquals(
    claimSweepOffenders(scanned, [], {}).length,
    1,
    "an unenrolled, unrecorded claimant must offend",
  );
  assertEquals(
    claimSweepOffenders(scanned, [CONTROL_ENTRY], {}),
    [],
    "an enrolled source passes",
  );
  assertEquals(
    claimSweepOffenders(scanned, [], { "src/w.ts": "a fixture reason" }),
    [],
    "a recorded absence passes",
  );
  assertEquals(
    claimSweepOffenders(scanned, [], { "src/w.ts#W": "a fixture reason" }),
    [],
    "a path#export record covers its module",
  );
  assertEquals(
    claimSweepOffenders(scanned, [CONTROL_ENTRY], { "src/w.ts": "also" })
      .length,
    1,
    "enrolled-and-recorded must offend",
  );
});

Deno.test("control: a stale ledger record fails the sweep", () => {
  const targets = new Map<string, LedgerTarget>([
    ["src/live.ts", {
      text: "/** The SSOT for widget kinds. */\nexport const W = 1;\n",
      claims: ["The SSOT for widget kinds"],
    }],
    ["src/quiet.ts", { text: "export const X = 1;\n", claims: [] }],
  ]);
  assertEquals(
    ledgerOffenders({ "src/live.ts": "a reason" }, targets),
    [],
    "a live record passes",
  );
  assertEquals(
    ledgerOffenders({ "src/gone.ts": "a reason" }, targets).length,
    1,
    "a record for a missing module must offend",
  );
  assertEquals(
    ledgerOffenders({ "src/quiet.ts": "a reason" }, targets).length,
    1,
    "a record for a module that no longer claims must offend",
  );
  assertEquals(
    ledgerOffenders({ "src/live.ts": "" }, targets).length,
    1,
    "an empty reason must offend",
  );
  assertEquals(
    ledgerOffenders({ "src/live.ts#GONE_EXPORT": "a reason" }, targets).length,
    1,
    "a record pinned to a vanished export must offend",
  );
});
