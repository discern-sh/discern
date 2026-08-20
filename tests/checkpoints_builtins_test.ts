/**
 * The shipped built-in checkpoint set (`src/shared/checkpoints.ts`), proven
 * end to end: every seed resolves through the real resolver against a
 * representative NON-DEFAULT config (so selectors demonstrably track
 * configuration, not defaults), and every trigger fires — and refuses to fire
 * — where the tuned thresholds say. The false-positive guards are the point:
 * a rename is not a deletion-heavy change, a moved file is not a parallel
 * implementation, and regenerated agent files alone never read as docs drift.
 *
 * The composition tests pin the shipped contract deliberately (double-entry
 * against the registry): changing an id, a mode, or a threshold must fail
 * here so it happens as a conscious decision, never as drift.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";
import { questionById } from "../src/shared/questions.ts";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortChangeKind,
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";

// ── fixtures ────────────────────────────────────────────────────────────────

/** One changed file with small, non-dominant line churn unless stated. */
function file(
  path: string,
  kind: EffortChangeKind = "modified",
  insertions = 5,
  deletions = 2,
): EffortFileChange {
  return { path, kind, insertions, deletions, binary: false };
}

/** An effort diff over `files`, with an optional merge-base tree listing. */
function diff(
  files: readonly EffortFileChange[],
  baseFiles: readonly string[] = [],
): EffortDiff {
  return { files: [...files], baseFiles: [...baseFiles] };
}

/** `count` modified source files, `src/mod0.ext` … — whole-diff filler. */
function sourceFiles(count: number): EffortFileChange[] {
  return Array.from({ length: count }, (_, i) => file(`src/mod${i}.ext`));
}

/** A representative project pointing every consulted path AWAY from the
 * defaults, with all nine built-ins enabled by bare reference — the exact
 * spelling a fresh `[checkpoints]` table uses. */
const CONFIG = parseConfigOrThrow([
  "[project]",
  'gotchas_doc = "notes/gate-traps.md"',
  "",
  "[map]",
  'dir = "guide/"',
  "",
  "[skills]",
  'dir = "playbooks"',
  "",
  "[scopes.instructions]",
  'paths = ["agent-instructions.md"]',
  "",
  ...Object.keys(BUILT_IN_CHECKPOINTS).map((id) => `[checkpoints.${id}]`),
  "",
].join("\n"));

const RESOLUTION = resolveCheckpoints(CONFIG);

/** The resolved definition for one shipped id, or a loud broken-test error. */
function resolved(id: string): ResolvedCheckpoint {
  const def = RESOLUTION.checkpoints.find((c) => c.id === id);
  if (def === undefined) {
    throw new Error(`built-in '${id}' did not resolve against the fixture`);
  }
  return def;
}

// ── composition: the shipped contract, pinned ───────────────────────────────

Deno.test("the shipped set is four stop members on the knowledge surfaces and five advise members on the change", () => {
  const stop = RESOLUTION.checkpoints.filter((c) => c.mode === "stop")
    .map((c) => c.id).sort();
  const advise = RESOLUTION.checkpoints.filter((c) => c.mode === "advise")
    .map((c) => c.id).sort();
  assertEquals(stop, [
    "gotchas-playbook",
    "instruction-economy",
    "map-focus",
    "skills-playbook",
  ]);
  assertEquals(advise, [
    "commit-story",
    "deletion-heavy-change",
    "docs-drift",
    "effort-sprawl",
    "parallel-implementation",
  ]);
});

Deno.test("every built-in resolves by bare reference and serves its canonical question verbatim", () => {
  assertEquals(RESOLUTION.drops, []);
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    const def = resolved(id);
    const canonical = questionById(seed.question);
    assert(canonical !== undefined, id);
    assertEquals(def.question, canonical.question, id);
    assertEquals(def.teach, canonical.teach, id);
  }
});

// ── map-focus ───────────────────────────────────────────────────────────────

Deno.test("map-focus fires on a broad documentation change under the CONFIGURED map dir", () => {
  const pages = [
    file("guide/a.md"),
    file("guide/b.md"),
    file("guide/sub/c.md"),
  ];
  const outcome = evaluateStructuralTrigger(resolved("map-focus"), diff(pages));
  assert(outcome.holds);
  assertEquals(outcome.matched, ["guide/a.md", "guide/b.md", "guide/sub/c.md"]);
});

Deno.test("map-focus stays quiet for a touch-up, and off-map files never count toward its threshold", () => {
  const touchUp = evaluateStructuralTrigger(
    resolved("map-focus"),
    diff([file("guide/a.md"), file("guide/b.md")]),
  );
  assertEquals(touchUp, { holds: false, vetoedBy: "min_changed_files" });
  const padded = evaluateStructuralTrigger(
    resolved("map-focus"),
    diff([file("guide/a.md"), file("guide/b.md"), ...sourceFiles(5)]),
  );
  assertEquals(padded, { holds: false, vetoedBy: "min_changed_files" });
});

// ── instruction-economy ─────────────────────────────────────────────────────

Deno.test("instruction-economy fires on one instruction-surface change", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("instruction-economy"),
    diff([file("agent-instructions.md")]),
  );
  assert(outcome.holds);
  assertEquals(outcome.matched, ["agent-instructions.md"]);
});

Deno.test("instruction-economy fails open, with an advisory, where no instructions scope exists", () => {
  const bare = parseConfigOrThrow("[checkpoints.instruction-economy]\n");
  const { checkpoints, drops } = resolveCheckpoints(bare);
  assertEquals(checkpoints, []);
  assertEquals(drops.length, 1);
  assertStringIncludes(drops[0]?.account ?? "", "unknown scope 'instructions'");
});

// ── skills-playbook ─────────────────────────────────────────────────────────

Deno.test("skills-playbook fires on a change under the CONFIGURED skills dir", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("skills-playbook"),
    diff([file("playbooks/release-dance/SKILL.md", "added")]),
  );
  assert(outcome.holds);
  assertEquals(outcome.matched, ["playbooks/release-dance/SKILL.md"]);
});

// ── gotchas-playbook ────────────────────────────────────────────────────────

Deno.test("gotchas-playbook fires on the CONFIGURED gotchas doc and nothing else", () => {
  const onDoc = evaluateStructuralTrigger(
    resolved("gotchas-playbook"),
    diff([file("notes/gate-traps.md")]),
  );
  assert(onDoc.holds);
  assertEquals(onDoc.matched, ["notes/gate-traps.md"]);
  const elsewhere = evaluateStructuralTrigger(
    resolved("gotchas-playbook"),
    diff([file("notes/other.md"), ...sourceFiles(3)]),
  );
  assertEquals(elsewhere, { holds: false, vetoedBy: "empty_matched_set" });
});

Deno.test("gotchas-playbook stays quiet in a project that never configured a gotchas doc", () => {
  const noDoc = parseConfigOrThrow("[checkpoints.gotchas-playbook]\n");
  const { checkpoints, drops } = resolveCheckpoints(noDoc);
  assertEquals(drops, []);
  const def = checkpoints[0];
  assert(
    def !== undefined,
    "the checkpoint still governs — it just never fires",
  );
  assertEquals(def.selector?.globs, [""]);
  const outcome = evaluateStructuralTrigger(
    def,
    diff([file("anything.md"), ...sourceFiles(10)]),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "empty_matched_set" });
});

// ── deletion-heavy-change ───────────────────────────────────────────────────

Deno.test("deletion-heavy-change fires on a substantial, deletion-dominant cut", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("deletion-heavy-change"),
    diff([file("src/legacy.ext", "deleted", 0, 110), file("src/mod.ext")]),
  );
  assert(outcome.holds);
});

Deno.test("a rename is not a deletion-heavy change: balanced churn fails the ratio", () => {
  // Rename detection is off, so a rename reads as one deletion plus one
  // addition of similar size — deletions ≈ insertions, nowhere near 2×.
  const outcome = evaluateStructuralTrigger(
    resolved("deletion-heavy-change"),
    diff([
      file("src/old-name.ext", "deleted", 0, 80),
      file("src/new-name.ext", "added", 80, 0),
    ]),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "deletion_dominant" });
});

Deno.test("a small cleanup is not a deletion-heavy change: the absolute floor holds", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("deletion-heavy-change"),
    diff([file("src/tidy.ext", "modified", 3, 40)]),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "deletion_dominant" });
});

// ── parallel-implementation ─────────────────────────────────────────────────

Deno.test("parallel-implementation fires when a decorated sibling grows beside a surviving original", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("parallel-implementation"),
    diff(
      [file("src/service_v2.ext", "added", 120, 0)],
      ["src/service.ext", "src/other.ext"],
    ),
  );
  assert(outcome.holds);
  assertEquals(outcome.similar, [
    { added: "src/service_v2.ext", existing: "src/service.ext" },
  ]);
});

Deno.test("a moved file is not a parallel implementation: a different directory is no sibling", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("parallel-implementation"),
    diff(
      [
        file("lib/service.ext", "added", 80, 0),
        file("src/service.ext", "deleted", 0, 80),
      ],
      ["src/service.ext"],
    ),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "similar_new_file" });
});

Deno.test("a rename in place is not a parallel implementation: the vanished original is no sibling", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("parallel-implementation"),
    diff(
      [
        file("src/service_v2.ext", "added", 80, 0),
        file("src/service.ext", "deleted", 0, 80),
      ],
      ["src/service.ext"],
    ),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "similar_new_file" });
});

// ── effort-sprawl ───────────────────────────────────────────────────────────

Deno.test("effort-sprawl advises at 25 changed files and not at 24", () => {
  const wide = evaluateStructuralTrigger(
    resolved("effort-sprawl"),
    diff(sourceFiles(25)),
  );
  assert(wide.holds);
  const narrower = evaluateStructuralTrigger(
    resolved("effort-sprawl"),
    diff(sourceFiles(24)),
  );
  assertEquals(narrower, { holds: false, vetoedBy: "min_changed_files" });
});

// ── docs-drift ──────────────────────────────────────────────────────────────

Deno.test("docs-drift advises when a substantial change moved nothing in the map", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("docs-drift"),
    diff(sourceFiles(5)),
  );
  assert(outcome.holds);
});

Deno.test("any map edit vetoes docs-drift: the counterpart moved too", () => {
  const outcome = evaluateStructuralTrigger(
    resolved("docs-drift"),
    diff([...sourceFiles(5), file("guide/page.md")]),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "unless_changed" });
});

Deno.test("regenerated agent files alone stay under the docs-drift threshold", () => {
  // The closed menu cannot name 'generated files'; the threshold is the
  // guard — a compile of every agent file plus a small touch never reaches
  // five changed files on its own.
  const outcome = evaluateStructuralTrigger(
    resolved("docs-drift"),
    diff([
      file("CLAUDE.md"),
      file("AGENTS.md"),
      file("GEMINI.md"),
      file("src/mod.ext"),
    ]),
  );
  assertEquals(outcome, { holds: false, vetoedBy: "min_changed_files" });
});

// ── commit-story ────────────────────────────────────────────────────────────

Deno.test("commit-story advises at 15 changed files and not at 14", () => {
  const wide = evaluateStructuralTrigger(
    resolved("commit-story"),
    diff(sourceFiles(15)),
  );
  assert(wide.holds);
  const narrower = evaluateStructuralTrigger(
    resolved("commit-story"),
    diff(sourceFiles(14)),
  );
  assertEquals(narrower, { holds: false, vetoedBy: "min_changed_files" });
});

// ── the completeness forcing function ───────────────────────────────────────

/** One firing and one quiet diff per built-in, keyed by the registry: a new
 * seed fails the table-completeness assertion below until it proves both
 * halves of its trigger here. */
const TRIGGER_FIXTURES: Readonly<
  Record<string, { firing: EffortDiff; quiet: EffortDiff }>
> = {
  "map-focus": {
    firing: diff([file("guide/a.md"), file("guide/b.md"), file("guide/c.md")]),
    quiet: diff([file("guide/a.md")]),
  },
  "instruction-economy": {
    firing: diff([file("agent-instructions.md")]),
    quiet: diff([file("src/mod0.ext")]),
  },
  "skills-playbook": {
    firing: diff([file("playbooks/review/SKILL.md")]),
    quiet: diff([file("src/mod0.ext")]),
  },
  "gotchas-playbook": {
    firing: diff([file("notes/gate-traps.md")]),
    quiet: diff([file("notes/other.md")]),
  },
  "deletion-heavy-change": {
    firing: diff([file("src/dead.ext", "deleted", 0, 400)]),
    quiet: diff([file("src/mod0.ext")]),
  },
  "parallel-implementation": {
    firing: diff(
      [file("src/service_v2.ext", "added")],
      ["src/service.ext"],
    ),
    quiet: diff([file("src/service.ext")], ["src/service.ext"]),
  },
  "effort-sprawl": {
    firing: diff(sourceFiles(25)),
    quiet: diff(sourceFiles(24)),
  },
  "docs-drift": {
    firing: diff(sourceFiles(5)),
    quiet: diff([...sourceFiles(5), file("guide/a.md")]),
  },
  "commit-story": {
    firing: diff(sourceFiles(15)),
    quiet: diff(sourceFiles(14)),
  },
};

Deno.test("every built-in proves it fires and stays quiet — a new seed fails until its fixtures exist", () => {
  assertEquals(
    Object.keys(TRIGGER_FIXTURES).sort(),
    Object.keys(BUILT_IN_CHECKPOINTS).sort(),
    "the fixture table must cover exactly the registry",
  );
  const { checkpoints, drops } = resolveCheckpoints(CONFIG);
  assertEquals(drops, []);
  assertEquals(checkpoints.length, Object.keys(BUILT_IN_CHECKPOINTS).length);
  for (const def of checkpoints) {
    const fixtures = TRIGGER_FIXTURES[def.id];
    assert(fixtures !== undefined, def.id);
    assertEquals(
      evaluateStructuralTrigger(def, fixtures.firing).holds,
      true,
      `${def.id} must fire on its firing fixture`,
    );
    assertEquals(
      evaluateStructuralTrigger(def, fixtures.quiet).holds,
      false,
      `${def.id} must stay quiet on its quiet fixture`,
    );
  }
});
