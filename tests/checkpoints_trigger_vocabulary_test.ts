/**
 * Closed-menu guard for checkpoint trigger vocabulary.
 *
 * Predicate: every public trigger field declared by the config schema is
 * enrolled in one canonical registry and has a pure evaluator case. A future
 * field therefore fails this suite before it can parse yet disappear during
 * resolution, hashing, summary, or evaluation.
 */

import { assert, assertEquals } from "@std/assert";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import {
  CHECKPOINT_TRIGGER_FIELDS,
  type TriggerVeto,
} from "../src/shared/checkpoints.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";

const REVIEW_FIELDS = new Set(["mode", "question", "teach"]);

function file(
  path: string,
  over: Partial<EffortFileChange> = {},
): EffortFileChange {
  return {
    path,
    generated: false,
    kind: "modified",
    insertions: 1,
    deletions: 0,
    binary: false,
    content: { status: "available", added: [], removed: [] },
    ...over,
  } as EffortFileChange;
}

function definition(
  over: Record<string, unknown> = {},
): ResolvedCheckpoint {
  return {
    id: "probe",
    mode: "stop",
    question: "The change is judged.",
    includeGenerated: false,
    excludePaths: [],
    unlessChanged: [],
    kinds: [],
    addsMatching: [],
    removesMatching: [],
    newDirectory: false,
    deletionDominant: false,
    similarNewFile: false,
    ...over,
  } as unknown as ResolvedCheckpoint;
}

function effort(files: EffortFileChange[]): EffortDiff {
  return {
    files,
    baseFiles: [
      { path: "src/existing.ts", generated: false },
      { path: "docs/page.md", generated: false },
    ],
    history: {
      status: "available",
      count: 2,
      commits: ["a", "b"],
      fingerprint: "history-ab",
    },
  } as unknown as EffortDiff;
}

Deno.test("every checkpoint trigger schema field belongs to the canonical registry", () => {
  const schemaFields = Object.keys(RECORD_ENTRY_SCHEMAS.checkpoints.shape)
    .filter((field) => !REVIEW_FIELDS.has(field))
    .sort();
  assertEquals([...CHECKPOINT_TRIGGER_FIELDS].sort(), schemaFields);
});

const CASES: readonly {
  name: string;
  field: Record<string, unknown>;
  files: EffortFileChange[];
  veto: TriggerVeto;
}[] = [
  {
    name: "kinds",
    field: { kinds: ["added"] },
    files: [file("src/a.ts", { kind: "modified" })],
    veto: "kinds",
  },
  {
    name: "adds_matching",
    field: { addsMatching: ["skip("] },
    files: [file("src/a.ts")],
    veto: "adds_matching",
  },
  {
    name: "removes_matching",
    field: { removesMatching: ["legacy"] },
    files: [file("src/a.ts")],
    veto: "removes_matching",
  },
  {
    name: "new_directory",
    field: { newDirectory: true },
    files: [file("src/a.ts", { kind: "added" })],
    veto: "new_directory",
  },
  {
    name: "binary true",
    field: { binary: true },
    files: [file("src/a.ts")],
    veto: "binary",
  },
  {
    name: "min_changed_lines",
    field: { minChangedLines: 3 },
    files: [file("src/a.ts", { insertions: 1, deletions: 1 })],
    veto: "min_changed_lines",
  },
  {
    name: "min_commits",
    field: { minCommits: 3 },
    files: [file("src/a.ts")],
    veto: "min_commits",
  },
];

for (const test of CASES) {
  Deno.test(`closed trigger field: ${test.name} vetoes truthfully`, () => {
    assertEquals(
      evaluateStructuralTrigger(definition(test.field), effort(test.files)),
      { holds: false, vetoedBy: test.veto },
    );
  });
}

Deno.test("content predicates are literal, conjunctive, and narrow before thresholds", () => {
  const matched = file("src/test.ts", {
    insertions: 1,
    deletions: 1,
    content: {
      status: "available",
      added: ['test.skip("slow")'],
      removed: ["legacy dependency"],
    },
  } as Partial<EffortFileChange>);
  const other = file("src/other.ts", {
    insertions: 50,
    content: {
      status: "available",
      added: ["TEST.SKIP is differently cased"],
      removed: [],
    },
  } as Partial<EffortFileChange>);
  const out = evaluateStructuralTrigger(
    definition({
      addsMatching: ["test.skip("],
      removesMatching: ["legacy"],
      minChangedFiles: 2,
    }),
    effort([matched, other]),
  );
  assertEquals(out, { holds: false, vetoedBy: "min_changed_files" });
});

Deno.test("new_directory uses admitted base paths and root additions never qualify", () => {
  const nested = evaluateStructuralTrigger(
    definition({ newDirectory: true }),
    effort([file("feature/new.ts", { kind: "added" })]),
  );
  assert(nested.holds);
  assertEquals(nested.matched, ["feature/new.ts"]);
  assertEquals(
    evaluateStructuralTrigger(
      definition({ newDirectory: true }),
      effort([file("root.ts", { kind: "added" })]),
    ),
    { holds: false, vetoedBy: "new_directory" },
  );
});

Deno.test("binary false deliberately narrows to text", () => {
  const out = evaluateStructuralTrigger(
    definition({ binary: false }),
    effort([
      file("asset.bin", { binary: true }),
      file("src/a.ts", { binary: false }),
    ]),
  );
  assert(out.holds);
  assertEquals(out.matched, ["src/a.ts"]);
});
