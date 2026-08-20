/**
 * Real-Git guards for the expanded checkpoint trigger collector. The pure
 * trigger matrix proves predicate order; this module proves the facts supplied
 * to it remain literal, bounded, deterministic, and scoped to definitions that
 * actually need them.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import {
  collectEffortDiff,
  trackedEnumerationAgrees,
} from "../src/engine/checkpoints/diff.ts";
import { checkpointWhenInput } from "../src/engine/checkpoints/preflight.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import { CHECKPOINT_PATTERN_LIMITS } from "../src/shared/checkpoints.ts";
import type {
  EffortFileChange,
  ResolvedCheckpoint,
  StructuralTriggerOutcome,
} from "../src/engine/checkpoints/types.ts";

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

Deno.test("tracked name-status and numstat enumerations must agree", () => {
  assert(trackedEnumerationAgrees("M\0src/a.ts\0", "1\t0\tsrc/a.ts\0"));
  assert(!trackedEnumerationAgrees("M\0src/a.ts\0", "1\t0\tsrc/b.ts\0"));
  assert(!trackedEnumerationAgrees("M\0src/a.ts\0", ""));
});

Deno.test("path-only definitions do not inspect irrelevant untracked bytes", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.mkdir(join(dir, "src"));
    await Deno.writeTextFile(join(dir, "src", "small.ts"), "export {};\n");
    await Deno.writeFile(
      join(dir, "hostile.bin"),
      new Uint8Array(3 * 1024 * 1024),
    );

    const diff = await collectEffortDiff(
      dir,
      base,
      [],
      [definition({ selector: { globs: ["src/**"] } })],
    );
    assert(diff !== undefined);
    const hostile = diff.files.find((file) => file.path === "hostile.bin");
    assert(hostile !== undefined);
    assertEquals(hostile.binary, "unknown");
    assertEquals(hostile.insertions, 0);
    assertEquals(hostile.content, undefined);
  });
});

Deno.test("untracked symlink bytes are never followed into checkpoint facts", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "secret needle\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.symlink(join(dir, "seed.txt"), join(dir, "linked.txt"));
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    const linked = diff.files.find((file) => file.path === "linked.txt");
    assert(linked !== undefined);
    assertEquals(linked.binary, "unknown");
    assertEquals(linked.content, {
      status: "unavailable",
      reason: "unreadable",
    });
  });
});

Deno.test("one huge untracked file stops at the per-file content boundary", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeFile(
      join(dir, "huge.txt"),
      new Uint8Array(16 * 1024 * 1024).fill(0x61),
    );
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    assertEquals(diff.files[0]?.content, {
      status: "unavailable",
      reason: "file_limit",
    });
  });
});

Deno.test("repeated overlimit untracked files debit one shared attempted-byte budget", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const over = new Uint8Array(
      CHECKPOINT_PATTERN_LIMITS.maxFileBytes + 1,
    ).fill(0x61);
    const count = Math.ceil(
      CHECKPOINT_PATTERN_LIMITS.maxTotalBytes / over.length,
    ) + 1;
    for (let index = 0; index < count; index++) {
      await Deno.writeFile(join(dir, `a-${index}.txt`), over);
    }
    await Deno.writeTextFile(join(dir, "z-final.txt"), "needle\n");
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    assertEquals(
      diff.files.find((file) => file.path === "z-final.txt")?.content,
      { status: "unavailable", reason: "total_bytes" },
    );
  });
});

Deno.test("repeated overlimit tracked patches debit the same shared attempted-byte budget", async () => {
  await withTempDir(async (dir) => {
    const over = new Uint8Array(
      CHECKPOINT_PATTERN_LIMITS.maxFileBytes + 1,
    ).fill(0x61);
    const count = Math.ceil(
      CHECKPOINT_PATTERN_LIMITS.maxTotalBytes / over.length,
    ) + 1;
    for (let index = 0; index < count; index++) {
      await Deno.writeTextFile(join(dir, `a-${index}.txt`), "old\n");
    }
    await Deno.writeTextFile(join(dir, "z-final.txt"), "old\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    for (let index = 0; index < count; index++) {
      await Deno.writeFile(join(dir, `a-${index}.txt`), over);
    }
    await Deno.writeTextFile(join(dir, "z-final.txt"), "needle\n");
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    assertEquals(
      diff.files.find((file) => file.path === "z-final.txt")?.content,
      { status: "unavailable", reason: "total_bytes" },
    );
  });
});

Deno.test("literal changed-line facts and subjects preserve hostile Git paths", async () => {
  await withTempDir(async (dir) => {
    const path = "odd/[literal]* ? name-雪.txt";
    await Deno.mkdir(join(dir, "odd"));
    await Deno.writeTextFile(join(dir, path), "old needle\nkept\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeTextFile(join(dir, path), "new needle\nkept\n");
    const def = definition({
      addsMatching: ["new needle"],
      removesMatching: ["old needle"],
      minChangedLines: 2,
    });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    const outcome = evaluateStructuralTrigger(def, diff);
    assert(outcome.holds);
    assertEquals(outcome.matched, [path]);

    const hash = await checkpointDefinitionHash(def);
    const subject = await computeSubject(dir, hash, [path], base);
    assert(
      "subject" in subject,
      "error" in subject ? subject.error : "subject",
    );
    assertEquals(subject.subject.paths.map((entry) => entry.path), [path]);
    assert(subject.subject.paths[0]?.base !== undefined);
    assert(subject.subject.paths[0]?.current !== undefined);
  });
});

Deno.test("the v1 when input sorts changed files independently of collector order", () => {
  const changed = [
    {
      path: "z.ts",
      generated: false,
      kind: "modified",
      insertions: 1,
      deletions: 0,
      binary: false,
    },
    {
      path: "a.ts",
      generated: false,
      kind: "added",
      insertions: 2,
      deletions: 0,
      binary: false,
    },
  ] satisfies EffortFileChange[];
  const structural = {
    holds: true,
    matched: ["a.ts", "z.ts"],
    related: [],
    changed,
    whenPending: true,
  } satisfies StructuralTriggerOutcome;
  assertEquals(
    checkpointWhenInput(definition({ when: "true" }), "base", structural)
      .changed_files.map((file: { path: string }) => file.path),
    ["a.ts", "z.ts"],
  );
});
