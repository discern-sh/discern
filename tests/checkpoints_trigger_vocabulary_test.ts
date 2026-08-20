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
} from "../src/shared/checkpoints.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import { triggerSummary } from "../src/engine/checkpoints/report.ts";
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
  };
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

/** One exact summary perturbation per trigger field. This second total table
 * keeps the presentation enrollment independent of the evaluator probes: a
 * future field cannot compile until its one-line public account is observable. */
const SUMMARY_CASES = {
  include_generated: {
    field: { includeGenerated: true },
    expected: "any change · including generated",
  },
  exclude_paths: {
    field: { excludePaths: ["vendor/**"] },
    expected: "any change · authored only · excluding vendor/**",
  },
  unless_changed: {
    field: { unlessChanged: ["docs/**"] },
    expected: "any change · authored only · unless docs/** changed",
  },
  kinds: {
    field: { kinds: ["added", "deleted"] },
    expected: "any change · authored only · kinds added, deleted",
  },
  adds_matching: {
    field: { addsMatching: ["needle"] },
    expected: "any change · authored only · added-line literals 1",
  },
  removes_matching: {
    field: { removesMatching: ["needle"] },
    expected: "any change · authored only · removed-line literals 1",
  },
  new_directory: {
    field: { newDirectory: true },
    expected: "any change · authored only · new directory",
  },
  binary: {
    field: { binary: false },
    expected: "any change · authored only · text files",
  },
  min_changed_files: {
    field: { minChangedFiles: 3 },
    expected: "any change · authored only · ≥3 files",
  },
  min_changed_lines: {
    field: { minChangedLines: 20 },
    expected: "any change · authored only · ≥20 changed lines",
  },
  deletion_dominant: {
    field: { deletionDominant: true },
    expected: "any change · authored only · deletion-dominant",
  },
  similar_new_file: {
    field: { similarNewFile: true },
    expected: "any change · authored only · similar new file",
  },
  min_commits: {
    field: { minCommits: 2 },
    expected: "any change · authored only · ≥2 commits",
  },
  when: {
    field: { when: "scripts/check.sh" },
    expected: "any change · authored only · when: scripts/check.sh",
  },
} satisfies Record<
  TriggerField,
  { field: Partial<ResolvedCheckpoint>; expected: string }
>;

Deno.test("every checkpoint trigger schema field belongs to the canonical registry", () => {
  const schemaFields = Object.keys(RECORD_ENTRY_SCHEMAS.checkpoints.shape)
    .sort();
  assertEquals(Object.keys(CHECKPOINT_FIELD_ROLES).sort(), schemaFields);
  assertEquals(
    Object.keys(FIELD_PROBES).sort(),
    [...CHECKPOINT_TRIGGER_FIELDS].sort(),
    "a new trigger field must name its evaluator coverage",
  );
  assertEquals(
    Object.keys(SUMMARY_CASES).sort(),
    [...CHECKPOINT_TRIGGER_FIELDS].sort(),
    "a new trigger field must name its one-line summary coverage",
  );
});

for (const [field, probe] of Object.entries(FIELD_PROBES)) {
  Deno.test(`trigger field enrollment: ${field}`, () => {
    assertEquals(probe(), FIELD_PROBE_EXPECTATIONS[field as TriggerField]);
  });
}

for (const [field, test] of Object.entries(SUMMARY_CASES)) {
  Deno.test(`trigger summary enrollment: ${field}`, () => {
    assertEquals(triggerSummary(definition(test.field)), test.expected);
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
