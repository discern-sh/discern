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
  CHECKPOINT_PATTERN_LIMITS,
  CHECKPOINT_TRIGGER_FIELDS,
} from "../src/shared/checkpoints.ts";
import {
  evaluateStructuralTrigger,
  evaluateStructuralTriggerFacts,
} from "../src/engine/checkpoints/triggers.ts";
import { triggerSummary } from "../src/engine/checkpoints/report.ts";
import type {
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";

const ENCODER = new TextEncoder();

/** One changed file with complete quiet facts unless a case overrides them. */
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

/** One resolved checkpoint with inert defaults around the fields under test. */
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

/** One effort carrying the supplied changed files and stable base/history facts. */
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

/** Compact one field's pure outcome for the closed-menu enrollment table. */
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

Deno.test("content pattern arrays are literal ORs and distinct fields are ANDed", () => {
  const regexLooking = "^Needle.*[0-9]+?$";
  const matched = file("src/matched.ts", {
    insertions: 1,
    deletions: 1,
    content: {
      status: "available",
      added: [ENCODER.encode(`prefix ${regexLooking} suffix`)],
      removed: [ENCODER.encode("removed a+b? literally")],
    },
  });
  const both = definition({
    addsMatching: ["missing added", regexLooking],
    removesMatching: ["missing removed", "a+b?"],
  });
  const positive = evaluateStructuralTrigger(both, effort([matched]));
  assert(positive.holds);
  assertEquals(positive.matched, ["src/matched.ts"]);

  const removedOnly = file("src/removed-only.ts", {
    content: {
      status: "available",
      added: [],
      removed: [ENCODER.encode("removed a+b? literally")],
    },
  });
  const split = evaluateStructuralTrigger(
    both,
    effort([
      file("src/added-only.ts", {
        content: {
          status: "available",
          added: [ENCODER.encode(`prefix ${regexLooking} suffix`)],
          removed: [],
        },
      }),
      removedOnly,
    ]),
  );
  assertEquals(split, { holds: false, vetoedBy: "removes_matching" });

  assertEquals(
    evaluateStructuralTrigger(
      definition({ addsMatching: [regexLooking] }),
      effort([file("src/lower.ts", {
        content: {
          status: "available",
          added: [
            ENCODER.encode(`prefix ${regexLooking.toLowerCase()} suffix`),
          ],
          removed: [],
        },
      })]),
    ),
    { holds: false, vetoedBy: "adds_matching" },
  );
});

Deno.test("content narrowing precedes changed-file and changed-line thresholds", () => {
  const matched = file("src/test.ts", {
    insertions: 7,
    deletions: 3,
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
  assertEquals(
    evaluateStructuralTrigger(
      definition({
        addsMatching: ["test.skip("],
        removesMatching: ["legacy"],
        minChangedLines: 11,
      }),
      effort([matched, other]),
    ),
    { holds: false, vetoedBy: "min_changed_lines" },
  );
});

Deno.test("content comparison work admits the exact ceiling and rejects one byte over", () => {
  const patternsPerSide = CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField;
  const patternCount = patternsPerSide * 2;
  assertEquals(
    CHECKPOINT_PATTERN_LIMITS.maxTotalBytes * patternCount,
    CHECKPOINT_PATTERN_LIMITS.maxComparisonBytes,
  );
  const lineCount = CHECKPOINT_PATTERN_LIMITS.maxTotalBytes /
    CHECKPOINT_PATTERN_LIMITS.maxLineBytes;
  assertEquals(Number.isInteger(lineCount), true);
  const added = Array.from(
    { length: lineCount / 2 },
    () => new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxLineBytes).fill(0x61),
  );
  const removed = Array.from(
    { length: lineCount / 2 },
    () => new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxLineBytes).fill(0x62),
  );
  const def = definition({
    addsMatching: [
      "a",
      ...Array.from(
        { length: patternsPerSide - 1 },
        (_, index) => `added-${index}`,
      ),
    ],
    removesMatching: [
      "b",
      ...Array.from(
        { length: patternsPerSide - 1 },
        (_, index) => `removed-${index}`,
      ),
    ],
  });
  const exactFile = file("src/exact.ts", {
    insertions: added.length,
    deletions: removed.length,
    content: { status: "available", added, removed },
  });
  const exact = evaluateStructuralTriggerFacts(def, effort([exactFile]));
  assert(exact.outcome?.holds, JSON.stringify(exact));

  const overFile = file("src/over.ts", {
    insertions: added.length + 1,
    deletions: removed.length,
    content: {
      status: "available",
      added: [...added, new Uint8Array([0x61])],
      removed,
    },
  });
  assertEquals(evaluateStructuralTriggerFacts(def, effort([overFile])), {
    issue: { fact: "content", reason: "comparison_work" },
  });
});

Deno.test("content facts admit the total line ceiling and reject a newline storm", () => {
  const exactLines = Array.from(
    { length: CHECKPOINT_PATTERN_LIMITS.maxContentLines },
    () => new Uint8Array(),
  );
  const def = definition({ addsMatching: ["needle"] });
  assertEquals(
    evaluateStructuralTriggerFacts(
      def,
      effort([
        file("src/exact.ts", {
          insertions: exactLines.length,
          content: {
            status: "available",
            added: exactLines,
            removed: [],
          },
        }),
      ]),
    ),
    { outcome: { holds: false, vetoedBy: "adds_matching" } },
  );
  assertEquals(
    evaluateStructuralTriggerFacts(
      def,
      effort([
        file("src/over.ts", {
          insertions: exactLines.length + 1,
          content: {
            status: "available",
            added: [...exactLines, new Uint8Array()],
            removed: [],
          },
        }),
      ]),
    ),
    { issue: { fact: "content", reason: "line_count" } },
  );
});

Deno.test("new_directory recognizes only a genuinely new admitted parent", () => {
  const cases: readonly {
    name: string;
    includeGenerated?: boolean;
    files: EffortFileChange[];
    baseFiles: EffortDiff["baseFiles"];
    expected: string[] | "veto";
  }[] = [
    {
      name: "a genuinely new parent keeps every addition",
      files: [
        file("feature/a.ts", { kind: "added" }),
        file("feature/b.ts", { kind: "added" }),
      ],
      baseFiles: [{ path: "src/existing.ts", generated: false }],
      expected: ["feature/a.ts", "feature/b.ts"],
    },
    {
      name: "an authored base file makes its parent existing",
      files: [file("src/new.ts", { kind: "added" })],
      baseFiles: [{ path: "src/existing.ts", generated: false }],
      expected: "veto",
    },
    {
      name: "a generated-only base parent is absent by default",
      files: [file("generated-parent/new.ts", { kind: "added" })],
      baseFiles: [
        { path: "generated-parent/output.ts", generated: true },
      ],
      expected: ["generated-parent/new.ts"],
    },
    {
      name: "generated opt-in makes its base parent existing",
      includeGenerated: true,
      files: [file("generated-parent/new.ts", { kind: "added" })],
      baseFiles: [
        { path: "generated-parent/output.ts", generated: true },
      ],
      expected: "veto",
    },
    {
      name: "deleting the last base file does not make its parent new",
      files: [
        file("legacy/old.ts", { kind: "deleted" }),
        file("legacy/new.ts", { kind: "added" }),
      ],
      baseFiles: [{ path: "legacy/old.ts", generated: false }],
      expected: "veto",
    },
    {
      name: "a root addition never manufactures a directory",
      files: [file("root.ts", { kind: "added" })],
      baseFiles: [],
      expected: "veto",
    },
  ];
  for (const test of cases) {
    const out = evaluateStructuralTrigger(
      definition({
        newDirectory: true,
        includeGenerated: test.includeGenerated ?? false,
      }),
      { ...effort(test.files), baseFiles: test.baseFiles },
    );
    if (test.expected === "veto") {
      assertEquals(
        out,
        { holds: false, vetoedBy: "new_directory" },
        test.name,
      );
    } else {
      assert(out.holds, test.name);
      assertEquals(out.matched, test.expected, test.name);
    }
  }
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
