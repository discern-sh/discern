/**
 * The checkpoint trigger engine (`src/engine/checkpoints/triggers.ts`): every
 * predicate in the closed menu, its false-positive guards, and the composition
 * of the structural half with a `when` outcome — all pure, so each case is a
 * literal diff in, a verdict out.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DELETION_DOMINANT_MIN_DELETED_LINES,
  DELETION_DOMINANT_RATIO,
  evaluateStructuralTrigger,
  normalizeStem,
  resolveTriggerOutcome,
  similarNewFiles,
} from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";

/** A file change with quiet defaults. */
function change(
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
    ...over,
  };
}

/** A diff over `files` with an optional base-tree listing. */
function diff(
  files: EffortFileChange[],
  baseFiles: string[] = [],
): EffortDiff {
  return {
    files,
    baseFiles: baseFiles.map((path) => ({ path, generated: false })),
  };
}

/** A resolved checkpoint with quiet defaults. */
function def(over: Partial<ResolvedCheckpoint> = {}): ResolvedCheckpoint {
  return {
    id: "probe",
    mode: "stop",
    question: "The change is judged.",
    includeGenerated: false,
    excludePaths: [],
    unlessChanged: [],
    deletionDominant: false,
    similarNewFile: false,
    ...over,
  };
}

// ── selectors and the matched set ───────────────────────────────────────────

Deno.test("no selector: the whole diff is the matched set, sorted", () => {
  const out = evaluateStructuralTrigger(
    def(),
    diff([change("b.txt"), change("a.txt")]),
  );
  assert(out.holds);
  assertEquals(out.matched, ["a.txt", "b.txt"]);
  assertEquals(out.whenPending, false);
});

Deno.test("a selector narrows the matched set through the shared glob dialect", () => {
  const out = evaluateStructuralTrigger(
    def({ selector: { globs: ["src/**"] } }),
    diff([change("src/a.ts"), change("docs/readme.md")]),
  );
  assert(out.holds);
  assertEquals(out.matched, ["src/a.ts"]);
});

Deno.test("an empty diff, or a selector matching nothing, never fires", () => {
  assertEquals(
    evaluateStructuralTrigger(def(), diff([])),
    { holds: false, vetoedBy: "empty_matched_set" },
  );
  assertEquals(
    evaluateStructuralTrigger(
      def({ selector: { globs: ["src/**"] } }),
      diff([change("docs/readme.md")]),
    ),
    { holds: false, vetoedBy: "empty_matched_set" },
  );
});

// ── unless_changed ──────────────────────────────────────────────────────────

Deno.test("unless_changed vetoes on ANY changed path, matched or not", () => {
  const d = diff([change("src/api/a.ts"), change("docs/api/a.md")]);
  assertEquals(
    evaluateStructuralTrigger(
      def({
        selector: { globs: ["src/api/**"] },
        unlessChanged: ["docs/api/**"],
      }),
      d,
    ),
    { holds: false, vetoedBy: "unless_changed" },
  );
  // Without the counterpart change, the same trigger fires.
  const fired = evaluateStructuralTrigger(
    def({
      selector: { globs: ["src/api/**"] },
      unlessChanged: ["docs/api/**"],
    }),
    diff([change("src/api/a.ts")]),
  );
  assert(fired.holds);
});

// ── min_changed_files ───────────────────────────────────────────────────────

Deno.test("min_changed_files counts the MATCHED set, not the whole diff", () => {
  const d = diff([
    change("src/a.ts"),
    change("src/b.ts"),
    change("docs/x.md"),
    change("docs/y.md"),
  ]);
  assertEquals(
    evaluateStructuralTrigger(
      def({ selector: { globs: ["src/**"] }, minChangedFiles: 3 }),
      d,
    ),
    { holds: false, vetoedBy: "min_changed_files" },
  );
  const fired = evaluateStructuralTrigger(
    def({ selector: { globs: ["src/**"] }, minChangedFiles: 2 }),
    d,
  );
  assert(fired.holds);
});

// ── deletion_dominant ───────────────────────────────────────────────────────

Deno.test("deletion_dominant fires on a large, lopsided cut", () => {
  const out = evaluateStructuralTrigger(
    def({ deletionDominant: true }),
    diff([
      change("src/old.ts", { kind: "deleted", insertions: 0, deletions: 120 }),
      change("src/kept.ts", { insertions: 10, deletions: 20 }),
    ]),
  );
  assert(out.holds);
});

Deno.test("deletion_dominant false-positive guards: small cuts and balanced refactors stay quiet", () => {
  // Below the absolute floor: a lopsided but small deletion.
  assertEquals(
    evaluateStructuralTrigger(
      def({ deletionDominant: true }),
      diff([change("a.ts", {
        insertions: 0,
        deletions: DELETION_DOMINANT_MIN_DELETED_LINES - 1,
      })]),
    ),
    { holds: false, vetoedBy: "deletion_dominant" },
  );
  // Above the floor but balanced: a rewrite, not a cut.
  assertEquals(
    evaluateStructuralTrigger(
      def({ deletionDominant: true }),
      diff([change("a.ts", { insertions: 90, deletions: 100 })]),
    ),
    { holds: false, vetoedBy: "deletion_dominant" },
  );
  // Exactly at both thresholds fires: the constants are the contract.
  const atThreshold = evaluateStructuralTrigger(
    def({ deletionDominant: true }),
    diff([change("a.ts", {
      insertions: DELETION_DOMINANT_MIN_DELETED_LINES /
        DELETION_DOMINANT_RATIO,
      deletions: DELETION_DOMINANT_MIN_DELETED_LINES,
    })]),
  );
  assert(atThreshold.holds);
});

Deno.test("deletion_dominant measures the matched set only", () => {
  // The big cut sits outside the selector, so the trigger stays quiet.
  assertEquals(
    evaluateStructuralTrigger(
      def({ selector: { globs: ["src/**"] }, deletionDominant: true }),
      diff([
        change("src/a.ts", { insertions: 5, deletions: 0 }),
        change("vendor/blob.js", { insertions: 0, deletions: 500 }),
      ]),
    ),
    { holds: false, vetoedBy: "deletion_dominant" },
  );
});

// ── similar_new_file ────────────────────────────────────────────────────────

Deno.test("normalizeStem strips version, copy, and single-digit decorations", () => {
  assertEquals(normalizeStem("service_v2"), "service");
  assertEquals(normalizeStem("service copy"), "service");
  assertEquals(normalizeStem("service-2"), "service");
  assertEquals(normalizeStem("utils2"), "utils");
  assertEquals(normalizeStem("Service_OLD"), "service");
  assertEquals(normalizeStem("thing_v2_copy"), "thing");
  // Real names keep their digits: multi-digit runs are identity, not decoration.
  assertEquals(normalizeStem("base64"), "base64");
  assertEquals(normalizeStem("sha256"), "sha256");
  // Underscore-only or token-only stems survive (nothing to strip them to).
  assertEquals(normalizeStem("copy"), "copy");
});

Deno.test("similar_new_file fires on a parallel sibling and names the pair", () => {
  const d = diff(
    [change("src/service_v2.ts", { kind: "added" })],
    ["src/service.ts", "src/other.ts"],
  );
  const out = evaluateStructuralTrigger(def({ similarNewFile: true }), d);
  assert(out.holds);
  assertEquals(out.related, [{
    kind: "similar_existing",
    forPath: "src/service_v2.ts",
    path: "src/service.ts",
  }]);
});

Deno.test("similar_new_file false-positive guards", () => {
  const quiet = (files: EffortFileChange[], base: string[]): void => {
    assertEquals(
      evaluateStructuralTrigger(
        def({ similarNewFile: true }),
        diff(files, base),
      ),
      { holds: false, vetoedBy: "similar_new_file" },
    );
  };
  // A test file beside its subject is not a parallel implementation.
  quiet([change("src/service_test.ts", { kind: "added" })], [
    "src/service.ts",
  ]);
  // A different directory is a different thing.
  quiet([change("src/v2/service.ts", { kind: "added" })], ["src/service.ts"]);
  // A different extension is a companion, not a sibling.
  quiet([change("src/service.css", { kind: "added" })], ["src/service.ts"]);
  // A rename: the original is deleted in the same diff.
  quiet(
    [
      change("src/service_v2.ts", { kind: "added" }),
      change("src/service.ts", { kind: "deleted" }),
    ],
    ["src/service.ts"],
  );
  // Multi-digit stems are identities, not versions.
  quiet([change("src/base64.ts", { kind: "added" })], ["src/base.ts"]);
  // A modified (not added) file never reads as a new sibling.
  quiet([change("src/service_v2.ts")], ["src/service.ts", "src/service_v2.ts"]);
});

Deno.test("similarNewFiles compares only ADDED files inside the matched set", () => {
  const d = diff(
    [
      change("src/a_v2.ts", { kind: "added" }),
      change("docs/b_v2.md", { kind: "added" }),
    ],
    ["src/a.ts", "docs/b.md"],
  );
  const out = evaluateStructuralTrigger(
    def({ selector: { globs: ["src/**"] }, similarNewFile: true }),
    d,
  );
  assert(out.holds);
  assertEquals(out.related, [{
    kind: "similar_existing",
    forPath: "src/a_v2.ts",
    path: "src/a.ts",
  }]);
  // Direct helper access for the docs pair, proving the scoping came from the
  // selector, not the matcher.
  assertEquals(similarNewFiles(["docs/b_v2.md"], d), [{
    added: "docs/b_v2.md",
    existing: "docs/b.md",
  }]);
});

// ── predicate conjunction ───────────────────────────────────────────────────

Deno.test("configured predicates compose after evidence narrowing", () => {
  const d = diff(
    [
      change("src/service_v2.ts", { kind: "added", insertions: 10 }),
      change("src/service.ts", { insertions: 0, deletions: 100 }),
    ],
    ["src/service.ts"],
  );
  const both = def({
    selector: { globs: ["src/**"] },
    deletionDominant: true,
    similarNewFile: true,
  });
  assertEquals(
    evaluateStructuralTrigger(both, d),
    { holds: false, vetoedBy: "deletion_dominant" },
  );
  // Similarity narrowed the changed evidence to one suspicious addition before
  // the condition ran; the related existing path never supplies deletions.
  const threshold = def({
    selector: { globs: ["src/**"] },
    similarNewFile: true,
    minChangedFiles: 2,
  });
  assertEquals(evaluateStructuralTrigger(threshold, d), {
    holds: false,
    vetoedBy: "min_changed_files",
  });
  const holding = evaluateStructuralTrigger(
    { ...threshold, minChangedFiles: 1 },
    d,
  );
  assert(holding.holds);
  assertEquals(holding.matched, ["src/service_v2.ts"]);
});

// ── composing with `when` ───────────────────────────────────────────────────

Deno.test("resolveTriggerOutcome: structural verdicts pass through", () => {
  assertEquals(
    resolveTriggerOutcome({ holds: false, vetoedBy: "unless_changed" }),
    { fired: false, vetoedBy: "unless_changed" },
  );
  assertEquals(
    resolveTriggerOutcome({
      holds: true,
      matched: ["a.ts"],
      whenPending: false,
      related: [],
    }),
    { fired: true, matched: ["a.ts"], related: [] },
  );
});

Deno.test("resolveTriggerOutcome: `when` decides a pending trigger", () => {
  const pending = {
    holds: true,
    matched: ["a.ts", "b.ts"],
    whenPending: true,
    related: [],
  } as const;
  // Declared matches can narrow only within the structural matched set.
  assertEquals(
    resolveTriggerOutcome(pending, { kind: "fire", matches: ["b.ts"] }),
    { fired: true, matched: ["b.ts"], related: [] },
  );
  // Mixed output keeps the valid subset and drops paths outside the selector.
  assertEquals(
    resolveTriggerOutcome(pending, {
      kind: "fire",
      matches: ["outside.txt", "a.ts"],
    }),
    { fired: true, matched: ["a.ts"], related: [] },
  );
  // With no valid declared match, the structural set stands.
  assertEquals(
    resolveTriggerOutcome(pending, {
      kind: "fire",
      matches: ["outside.txt"],
    }),
    { fired: true, matched: ["a.ts", "b.ts"], related: [] },
  );
  // Fire without matches: the structural matched set stands.
  assertEquals(
    resolveTriggerOutcome(pending, { kind: "fire", matches: [] }),
    { fired: true, matched: ["a.ts", "b.ts"], related: [] },
  );
  // Pass: no fire.
  assertEquals(
    resolveTriggerOutcome(pending, { kind: "pass" }),
    { fired: false },
  );
  // Error: FAIL OPEN with the advisory attached.
  assertEquals(
    resolveTriggerOutcome(pending, {
      kind: "error",
      reason: "when_timeout",
      advisory: "timed out",
    }),
    { fired: false, advisory: "timed out" },
  );
});

Deno.test("resolveTriggerOutcome refuses a pending `when` with no outcome", () => {
  assertThrows(
    () =>
      resolveTriggerOutcome({
        holds: true,
        matched: ["a.ts"],
        whenPending: true,
        related: [],
      }),
    Error,
    "pending",
  );
});
