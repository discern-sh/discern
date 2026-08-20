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
  CHECKPOINT_FIELD_ROLES,
  CHECKPOINT_TRIGGER_FIELDS,
  type TriggerVeto,
} from "../src/shared/checkpoints.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";

const ENCODER = new TextEncoder();
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
  over: Partial<ResolvedCheckpoint> = {},
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
  };
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
  };
}

type TriggerField = {
  [Field in keyof typeof CHECKPOINT_FIELD_ROLES]:
    (typeof CHECKPOINT_FIELD_ROLES)[Field] extends "trigger" ? Field : never;
}[keyof typeof CHECKPOINT_FIELD_ROLES];

function verdict(
  field: Partial<ResolvedCheckpoint>,
  files: EffortFileChange[],
): string {
  const out = evaluateStructuralTrigger(definition(field), effort(files));
  return out.holds
    ? `holds:${out.whenPending}:${out.matched.join(",")}`
    : `veto:${out.vetoedBy}`;
}

/** One executable probe per trigger field. `satisfies Record` is the compiler
 * forcing step; the schema/role equality below is the runtime forcing step. */
const FIELD_PROBES = {
  include_generated: () =>
    verdict(
      { includeGenerated: true, selector: { globs: ["generated/**"] } },
      [file("generated/a.ts", { generated: true })],
    ),
  exclude_paths: () =>
    verdict({ excludePaths: ["src/**"] }, [file("src/a.ts")]),
  unless_changed: () =>
    verdict({ unlessChanged: ["docs/**"] }, [file("docs/page.md")]),
  kinds: () => verdict({ kinds: ["added"] }, [file("src/a.ts")]),
  adds_matching: () =>
    verdict({ addsMatching: ["needle"] }, [file("src/a.ts")]),
  removes_matching: () =>
    verdict({ removesMatching: ["needle"] }, [file("src/a.ts")]),
  new_directory: () =>
    verdict(
      { newDirectory: true },
      [file("feature/a.ts", { kind: "added" })],
    ),
  binary: () => verdict({ binary: true }, [file("asset.bin")]),
  min_changed_files: () => verdict({ minChangedFiles: 2 }, [file("src/a.ts")]),
  min_changed_lines: () => verdict({ minChangedLines: 2 }, [file("src/a.ts")]),
  deletion_dominant: () =>
    verdict({ deletionDominant: true }, [file("src/a.ts")]),
  similar_new_file: () =>
    verdict(
      { similarNewFile: true },
      [file("src/existing_v2.ts", { kind: "added" })],
    ),
  min_commits: () => verdict({ minCommits: 3 }, [file("src/a.ts")]),
  when: () => verdict({ when: "true" }, [file("src/a.ts")]),
} satisfies Record<TriggerField, () => string>;

const FIELD_PROBE_EXPECTATIONS: Record<TriggerField, string> = {
  include_generated: "holds:false:generated/a.ts",
  exclude_paths: "veto:excluded_only",
  unless_changed: "veto:unless_changed",
  kinds: "veto:kinds",
  adds_matching: "veto:adds_matching",
  removes_matching: "veto:removes_matching",
  new_directory: "holds:false:feature/a.ts",
  binary: "veto:binary",
  min_changed_files: "veto:min_changed_files",
  min_changed_lines: "veto:min_changed_lines",
  deletion_dominant: "veto:deletion_dominant",
  similar_new_file: "holds:false:src/existing_v2.ts",
  min_commits: "veto:min_commits",
  when: "holds:true:src/a.ts",
};

Deno.test("every checkpoint trigger schema field belongs to the canonical registry", () => {
  const schemaFields = Object.keys(RECORD_ENTRY_SCHEMAS.checkpoints.shape)
    .sort();
  assertEquals(Object.keys(CHECKPOINT_FIELD_ROLES).sort(), schemaFields);
  assertEquals(
    Object.keys(FIELD_PROBES).sort(),
    [...CHECKPOINT_TRIGGER_FIELDS].sort(),
    "a new trigger field must name its evaluator/hash/summary coverage",
  );
});

for (const [field, probe] of Object.entries(FIELD_PROBES)) {
  Deno.test(`trigger field enrollment: ${field}`, () => {
    assertEquals(probe(), FIELD_PROBE_EXPECTATIONS[field as TriggerField]);
  });
}

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
      added: [ENCODER.encode('test.skip("slow")')],
      removed: [ENCODER.encode("legacy dependency")],
    },
  });
  const other = file("src/other.ts", {
    insertions: 50,
    content: {
      status: "available",
      added: [ENCODER.encode("TEST.SKIP is differently cased")],
      removed: [],
    },
  });
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
