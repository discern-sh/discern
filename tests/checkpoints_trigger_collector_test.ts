/**
 * Real-Git guards for the expanded checkpoint trigger collector. The pure
 * trigger matrix proves predicate order; this module proves the facts supplied
 * to it remain literal, bounded, deterministic, and scoped to definitions that
 * actually need them.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { constants as FS_CONSTANTS } from "fs";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  collectEffortDiff,
  openUntrackedRegularNoFollow,
  trackedEnumerationAgrees,
  UNTRACKED_OPEN_FLAGS,
} from "../src/engine/checkpoints/diff.ts";
import { checkpointWhenInput } from "../src/engine/checkpoints/preflight.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import {
  evaluateStructuralTrigger,
  evaluateStructuralTriggerFacts,
} from "../src/engine/checkpoints/triggers.ts";
import { CHECKPOINT_PATTERN_LIMITS } from "../src/shared/checkpoints.ts";
import type {
  EffortFileChange,
  ResolvedCheckpoint,
  StructuralTriggerOutcome,
} from "../src/engine/checkpoints/types.ts";

/** One resolved checkpoint with quiet defaults for collector cases. */
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

Deno.test("untracked binary content has exact empty changed-line facts", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeFile(
      join(dir, "image.bin"),
      new Uint8Array([0x61, 0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]),
    );
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    const binary = diff.files.find((file) => file.path === "image.bin");
    assert(binary !== undefined);
    assertEquals(binary.binary, true);
    assertEquals(binary.content, {
      status: "available",
      added: [],
      removed: [],
    });
    assertEquals(evaluateStructuralTrigger(def, diff), {
      holds: false,
      vetoedBy: "adds_matching",
    });
  });
});

Deno.test("untracked opens atomically refuse symlinks and blocking special files", () => {
  assert(
    (UNTRACKED_OPEN_FLAGS & FS_CONSTANTS.O_NOFOLLOW) !== 0,
    "a symlink replacement must fail at open time",
  );
  assert(
    (UNTRACKED_OPEN_FLAGS & FS_CONSTANTS.O_NONBLOCK) !== 0,
    "a FIFO or device replacement must never block open",
  );
});

Deno.test("the no-follow open boundary rejects a symlink semantically", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "target.txt"), "external bytes\n");
    const linked = join(dir, "linked.txt");
    await Deno.symlink(join(dir, "target.txt"), linked);
    assertEquals(await openUntrackedRegularNoFollow(linked), undefined);
  });
});

Deno.test("untracked changed lines accept 8 KiB exactly and reject one byte over", async () => {
  await withTempDir(async (dir) => {
    const limit = CHECKPOINT_PATTERN_LIMITS.maxLineBytes;
    assertEquals(limit, 8 * 1024);
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const marker = new TextEncoder().encode("needle");
    const cases = [
      {
        path: "a-exact-line.txt",
        lineBytes: limit,
        expected: "available" as const,
      },
      {
        path: "b-over-line.txt",
        lineBytes: limit + 1,
        expected: "line_limit" as const,
      },
    ];
    for (const test of cases) {
      const bytes = new Uint8Array(test.lineBytes + 1).fill(0x61);
      bytes.set(marker);
      bytes[test.lineBytes] = 0x0a;
      await Deno.writeFile(join(dir, test.path), bytes);
    }

    const diff = await collectEffortDiff(
      dir,
      base,
      [],
      [definition({ addsMatching: ["needle"] })],
    );
    assert(diff !== undefined);
    for (const test of cases) {
      const content = diff.files.find((file) => file.path === test.path)
        ?.content;
      if (test.expected === "available") {
        assert(content?.status === "available");
        assertEquals(content.added[0]?.length, limit);
      } else {
        assertEquals(content, {
          status: "unavailable",
          reason: test.expected,
        });
      }
    }
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

Deno.test("untracked content admits maxFileBytes exactly and rejects one byte over", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const line = new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxLineBytes);
    line.fill(0x61);
    line[line.length - 1] = 0x0a;
    const exact = new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxFileBytes);
    for (let offset = 0; offset < exact.length; offset += line.length) {
      exact.set(line, offset);
    }
    const over = new Uint8Array(exact.length + 1);
    over.set(exact);
    over[over.length - 1] = 0x62;
    await Deno.writeFile(join(dir, "a-exact.txt"), exact);
    await Deno.writeFile(join(dir, "b-over.txt"), over);

    const diff = await collectEffortDiff(
      dir,
      base,
      [],
      [definition({ addsMatching: ["never present"] })],
    );
    assert(diff !== undefined);
    const exactContent = diff.files.find((file) => file.path === "a-exact.txt")
      ?.content;
    assert(exactContent?.status === "available");
    assertEquals(exactContent.added.length, exact.length / line.length);
    assertEquals(
      diff.files.find((file) => file.path === "b-over.txt")?.content,
      { status: "unavailable", reason: "file_limit" },
    );
  });
});

Deno.test("untracked content admits maxTotalBytes exactly and rejects the first later byte", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const line = new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxLineBytes);
    line.fill(0x61);
    line.set(new TextEncoder().encode("needle"));
    line[line.length - 1] = 0x0a;
    const fileBytes = new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxFileBytes);
    for (let offset = 0; offset < fileBytes.length; offset += line.length) {
      fileBytes.set(line, offset);
    }
    const exactFileCount = CHECKPOINT_PATTERN_LIMITS.maxTotalBytes /
      CHECKPOINT_PATTERN_LIMITS.maxFileBytes;
    assertEquals(Number.isInteger(exactFileCount), true);
    for (let index = 0; index < exactFileCount; index++) {
      await Deno.writeFile(join(dir, `a-${index}.txt`), fileBytes);
    }
    await Deno.writeTextFile(join(dir, "z-over.txt"), "n");

    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    for (let index = 0; index < exactFileCount; index++) {
      assertEquals(
        diff.files.find((file) => file.path === `a-${index}.txt`)?.content
          ?.status,
        "available",
      );
    }
    assertEquals(
      diff.files.find((file) => file.path === "z-over.txt")?.content,
      { status: "unavailable", reason: "total_bytes" },
    );
    assertEquals(evaluateStructuralTriggerFacts(def, diff), {
      issue: { fact: "content", reason: "total_bytes" },
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
    await Deno.symlink(join(dir, "seed.txt"), join(dir, "z-final.txt"));
    const def = definition({ addsMatching: ["needle"] });
    const diff = await collectEffortDiff(dir, base, [], [def]);
    assert(diff !== undefined);
    assertEquals(
      diff.files.find((file) => file.path === "z-final.txt")?.content,
      { status: "unavailable", reason: "total_bytes" },
    );
  });
});

Deno.test("a partial binary sniff at the shared boundary stays unknown", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const full = new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxFileBytes).fill(
      0x61,
    );
    for (let index = 0; index < 7; index++) {
      await Deno.writeFile(join(dir, `a-${index}.txt`), full);
    }
    await Deno.writeFile(
      join(dir, "a-7.txt"),
      new Uint8Array(CHECKPOINT_PATTERN_LIMITS.maxFileBytes - 4096).fill(0x61),
    );
    const binary = new Uint8Array(6000).fill(0x61);
    binary[5000] = 0;
    await Deno.writeFile(join(dir, "z.bin"), binary);
    const diff = await collectEffortDiff(dir, base, [], [
      definition({
        id: "stats",
        selector: { globs: ["a-*.txt"] },
        minChangedLines: 1,
      }),
      definition({
        id: "binary",
        selector: { globs: ["z.bin"] },
        binary: true,
      }),
    ]);
    assert(diff !== undefined);
    assertEquals(
      diff.files.find((file) => file.path === "z.bin")?.binary,
      "unknown",
    );
  });
});

Deno.test("gitlinks stay unknown and cannot produce an absent current subject", async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, "source");
    const repo = join(dir, "repo");
    await Deno.mkdir(source);
    await Deno.mkdir(repo);
    await Deno.writeTextFile(join(source, "module.txt"), "module\n");
    await gitInit(source);
    await Deno.writeTextFile(join(repo, "seed.txt"), "seed\n");
    await gitInit(repo);
    const base = await gitOut(repo, "rev-parse", "HEAD");
    await git(
      repo,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      source,
      "vendor/module",
    );
    const def = definition({
      selector: { globs: ["vendor/**"] },
      addsMatching: ["needle"],
    });
    const diff = await collectEffortDiff(repo, base, [], [def]);
    assert(diff !== undefined);
    const link = diff.files.find((file) => file.path === "vendor/module");
    assert(link !== undefined);
    assertEquals(link.binary, "unknown");
    assertEquals(link.content, {
      status: "unavailable",
      reason: "unreadable",
    });
    const subject = await computeSubject(
      repo,
      await checkpointDefinitionHash(def),
      ["vendor/module"],
      base,
    );
    assert("error" in subject, JSON.stringify(subject));
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
