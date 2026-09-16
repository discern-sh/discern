/**
 * Subject fingerprints (`src/engine/checkpoints/subject.ts`) hold the
 * relevance-sensitivity contract against real repositories:
 *
 *   - stable across unrelated branch edits and unrelated trunk updates (the
 *     policy identity may move while every declaration stands);
 *   - moved by any current or base change to a matched path, by a change to
 *     the matched set, and by a change to the definition;
 *   - dirty and untracked content is hashed; a rename reads as delete + add.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import { CHECKPOINT_QUESTION_SOURCE_BINDINGS } from "../src/engine/checkpoints/policy.ts";
import type { CheckpointSubject } from "../src/engine/checkpoints/subject.ts";
import type { ResolvedCheckpoint } from "../src/engine/checkpoints/types.ts";

/** A resolved checkpoint with quiet defaults. */
function def(over: Partial<ResolvedCheckpoint> = {}): ResolvedCheckpoint {
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

/** Compute a subject, asserting the computation succeeded. */
async function subject(
  root: string,
  definitionHash: string,
  matched: string[],
  base: string,
): Promise<CheckpointSubject> {
  const out = await computeSubject(root, definitionHash, matched, base);
  assert("subject" in out, "error" in out ? out.error : "expected a subject");
  return out.subject;
}

/** A repo with a matched file, an unmatched file, and one baseline commit. */
async function scaffold(dir: string): Promise<string> {
  await Deno.writeTextFile(join(dir, "matched.txt"), "matched v1\n");
  await Deno.writeTextFile(join(dir, "other.txt"), "other v1\n");
  await gitInit(dir);
  return await gitOut(dir, "rev-parse", "HEAD");
}

Deno.test("a subject is deterministic and binds its definition hash", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const a = await subject(dir, hash, ["matched.txt"], base);
    const b = await subject(dir, hash, ["matched.txt"], base);
    assertEquals(a.fingerprint, b.fingerprint);
    assertEquals(a.definitionHash, hash);
    assertEquals(a.paths.length, 1);
    assertEquals(a.paths[0]?.base?.mode, "100644");
    // An untouched tracked file carries the SAME blob id on both sides — git's
    // content addressing, not a parallel identity.
    assertEquals(a.paths[0]?.base?.blob, a.paths[0]?.current?.blob);
  });
});

Deno.test("unrelated branch edits leave a subject stable; matched edits move it", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const before = await subject(dir, hash, ["matched.txt"], base);

    // Unrelated: edit the OTHER file (uncommitted).
    await Deno.writeTextFile(join(dir, "other.txt"), "other v2\n");
    const afterUnrelated = await subject(dir, hash, ["matched.txt"], base);
    assertEquals(afterUnrelated.fingerprint, before.fingerprint);

    // Matched, dirty and uncommitted: the fingerprint must move.
    await Deno.writeTextFile(join(dir, "matched.txt"), "matched v2\n");
    const afterMatched = await subject(dir, hash, ["matched.txt"], base);
    assertNotEquals(afterMatched.fingerprint, before.fingerprint);

    // Reverting the content restores the identical subject.
    await Deno.writeTextFile(join(dir, "matched.txt"), "matched v1\n");
    const reverted = await subject(dir, hash, ["matched.txt"], base);
    assertEquals(reverted.fingerprint, before.fingerprint);
  });
});

Deno.test("an unrelated trunk update moves the policy identity but not the subject", async () => {
  await withTempDir(async (dir) => {
    const base0 = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const before = await subject(dir, hash, ["matched.txt"], base0);

    // The trunk advances with a commit that touches only the other file — a
    // NEW merge-base whose matched entries are identical.
    await Deno.writeTextFile(join(dir, "other.txt"), "other v2\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "unrelated", "--no-gpg-sign");
    const base1 = await gitOut(dir, "rev-parse", "HEAD");
    assertNotEquals(base0, base1); // the policy identity moved…
    const after = await subject(dir, hash, ["matched.txt"], base1);
    assertEquals(after.fingerprint, before.fingerprint); // …the subject did not
  });
});

Deno.test("history identity moves only a history-sensitive subject", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = "history-sensitive-definition";
    const first = await computeSubject(
      dir,
      hash,
      ["matched.txt"],
      base,
      [],
      "ordered-history-a",
    );
    const amended = await computeSubject(
      dir,
      hash,
      ["matched.txt"],
      base,
      [],
      "ordered-history-b",
    );
    const ordinary = await computeSubject(
      dir,
      hash,
      ["matched.txt"],
      base,
    );
    assert("subject" in first);
    assert("subject" in amended);
    assert("subject" in ordinary);
    assertNotEquals(first.subject.fingerprint, amended.subject.fingerprint);
    assertNotEquals(first.subject.fingerprint, ordinary.subject.fingerprint);
  });
});

Deno.test("a trunk update that changes a matched base path reopens the subject", async () => {
  await withTempDir(async (dir) => {
    const base0 = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const before = await subject(dir, hash, ["matched.txt"], base0);

    await Deno.writeTextFile(join(dir, "matched.txt"), "matched v2\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "matched moved", "--no-gpg-sign");
    const base1 = await gitOut(dir, "rev-parse", "HEAD");
    const after = await subject(dir, hash, ["matched.txt"], base1);
    assertNotEquals(after.fingerprint, before.fingerprint);
  });
});

Deno.test("matched-set and definition changes each move the fingerprint", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const one = await subject(dir, hash, ["matched.txt"], base);
    const wider = await subject(
      dir,
      hash,
      ["matched.txt", "other.txt"],
      base,
    );
    assertNotEquals(wider.fingerprint, one.fingerprint);

    const otherHash = await checkpointDefinitionHash(
      def({ question: "A different judgment." }),
    );
    assertNotEquals(otherHash, hash);
    const otherSubject = await subject(dir, otherHash, ["matched.txt"], base);
    assertNotEquals(otherSubject.fingerprint, one.fingerprint);
  });
});

/** One perturbation per resolved field the definition hash must cover —
 * shared by the moves-the-hash test and the completeness guard below. */
const HASH_VARIANTS: Partial<ResolvedCheckpoint>[] = [
  { mode: "advise" },
  { question: "Other prose." },
  { questionFile: "policy/questions/review.md" },
  { mapReview: { kind: "focus", directory: "guide" } },
  { mapReview: { kind: "drift", directory: "other-map" } },
  { teach: "A lesson." },
  { reference: "a-pointer" },
  { selector: { globs: ["src/**"] } },
  { selector: { scope: "code", globs: ["src/**"] } },
  { includeGenerated: true },
  { excludePaths: ["vendor/**"] },
  { unlessChanged: ["docs/**"] },
  { kinds: ["added"] },
  { addsMatching: ["new literal"] },
  { removesMatching: ["old literal"] },
  { newDirectory: true },
  { binary: false },
  { minChangedFiles: 3 },
  { minChangedLines: 20 },
  { deletionDominant: true },
  { similarNewFile: true },
  { minCommits: 2 },
  { when: "scripts/probe.sh" },
];

Deno.test("a new resolved-definition field cannot dodge the hash", () => {
  // Two forcing steps, both named: the fixture is compiler-forced complete
  // (a field added to ResolvedCheckpoint fails the Required<> satisfaction
  // until populated here), and every fixture key must then be perturbed by
  // some hash variant — so a trigger or review field the hash material
  // misses fails this guard before it can silently stop reopening open questions.
  const complete = {
    id: "probe",
    mode: "stop",
    question: "The change is judged.",
    questionFile: "policy/questions/review.md",
    mapReview: { kind: "focus", directory: "guide" },
    teach: "A lesson.",
    reference: "a-pointer",
    selector: { scope: "code", globs: ["src/**"] },
    includeGenerated: true,
    excludePaths: ["vendor/**"],
    unlessChanged: ["docs/**"],
    kinds: ["added"],
    addsMatching: ["new literal"],
    removesMatching: ["old literal"],
    newDirectory: true,
    binary: false,
    minChangedFiles: 3,
    minChangedLines: 20,
    deletionDominant: true,
    similarNewFile: true,
    minCommits: 2,
    when: "scripts/probe.sh",
  } satisfies Required<ResolvedCheckpoint>;
  const perturbed = new Set(HASH_VARIANTS.flatMap((over) => Object.keys(over)));
  for (const key of Object.keys(complete)) {
    if (key === "id") {
      continue; // open questions key by id; the hash answers "did the MEANING change"
    }
    assert(perturbed.has(key), `no hash variant perturbs '${key}'`);
  }
  for (const fields of Object.values(CHECKPOINT_QUESTION_SOURCE_BINDINGS)) {
    for (const field of fields) {
      assert(
        perturbed.has(field),
        `question source does not perturb resolved identity '${field}'`,
      );
    }
  }
});

Deno.test("the definition hash covers every resolved trigger and review field", async () => {
  const baseline = await checkpointDefinitionHash(def());
  const variants = HASH_VARIANTS;
  const hashes = await Promise.all(
    variants.map((over) => checkpointDefinitionHash(def(over))),
  );
  for (const [i, hash] of hashes.entries()) {
    const over = variants[i] ?? {};
    // The scope NAME is presentation; the resolved globs are the meaning — so
    // that one variant alone matches its glob-only sibling.
    if (Object.hasOwn(over, "selector") && over.selector?.scope !== undefined) {
      assertEquals(
        hash,
        hashes[
          variants.findIndex((v) =>
            v.selector !== undefined && v.selector.scope === undefined
          )
        ],
      );
      continue;
    }
    assertNotEquals(hash, baseline, JSON.stringify(over));
  }
  // And the id stays out: open questions key by id already.
  assertEquals(await checkpointDefinitionHash(def({ id: "other" })), baseline);
});

Deno.test("untracked matched content is hashed; deletion reads as an absent side", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());

    // Untracked file enters the subject with real content identity.
    await Deno.writeTextFile(join(dir, "fresh.txt"), "fresh v1\n");
    const withFresh = await subject(
      dir,
      hash,
      ["matched.txt", "fresh.txt"],
      base,
    );
    const fresh = withFresh.paths.find((p) => p.path === "fresh.txt");
    assertEquals(fresh?.base, undefined);
    assert(fresh?.current !== undefined);
    await Deno.writeTextFile(join(dir, "fresh.txt"), "fresh v2\n");
    const editedFresh = await subject(
      dir,
      hash,
      ["matched.txt", "fresh.txt"],
      base,
    );
    assertNotEquals(editedFresh.fingerprint, withFresh.fingerprint);

    // Deleting a matched file empties its current side and moves the print.
    await Deno.remove(join(dir, "matched.txt"));
    const afterDelete = await subject(
      dir,
      hash,
      ["matched.txt", "fresh.txt"],
      base,
    );
    const deleted = afterDelete.paths.find((p) => p.path === "matched.txt");
    assert(deleted?.base !== undefined);
    assertEquals(deleted?.current, undefined);
    assertNotEquals(afterDelete.fingerprint, editedFresh.fingerprint);
  });
});

Deno.test("a rename is a deletion plus an addition across two path states", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    await git(dir, "mv", "matched.txt", "renamed.txt");
    const out = await subject(
      dir,
      hash,
      ["matched.txt", "renamed.txt"],
      base,
    );
    const old = out.paths.find((p) => p.path === "matched.txt");
    const renamed = out.paths.find((p) => p.path === "renamed.txt");
    assert(old?.base !== undefined && old?.current === undefined);
    assert(renamed?.base === undefined && renamed?.current !== undefined);
    // Content survived the rename: the blob id carried over.
    assertEquals(renamed?.current?.blob, old?.base?.blob);
  });
});

Deno.test("the executable bit is part of the current state", async () => {
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const before = await subject(dir, hash, ["matched.txt"], base);
    await Deno.chmod(join(dir, "matched.txt"), 0o755);
    const after = await subject(dir, hash, ["matched.txt"], base);
    assertEquals(
      after.paths[0]?.current?.mode,
      "100755",
    );
    assertNotEquals(after.fingerprint, before.fingerprint);
  });
});

Deno.test("unreadable state is an error, never a guessed subject", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const out = await computeSubject(
      dir,
      hash,
      ["matched.txt"],
      "0000000000000000000000000000000000000000",
    );
    assert("error" in out);
    // A matched directory may be a gitlink worktree. Treating it as absent
    // would bind a declaration to false current state, so it fails open.
    await Deno.mkdir(join(dir, "adir"));
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const withDir = await computeSubject(dir, hash, ["adir"], base);
    assert("error" in withDir);
    assertStringIncludes(withDir.error, "adir");
    assertStringIncludes(withDir.error, "directory");
  });
});

Deno.test("a special file among the matched paths is a subject error, never a hang", async () => {
  // `git hash-object` on a FIFO blocks forever; the engine has no honest
  // content identity for a non-regular file, so the computation returns an
  // error naming the path and the caller fails open (invariant: a refusal
  // must never wedge an effort).
  await withTempDir(async (dir) => {
    const base = await scaffold(dir);
    const hash = await checkpointDefinitionHash(def());
    const fifo = new Deno.Command("mkfifo", {
      args: [join(dir, "pipe.fifo")],
    });
    assertEquals((await fifo.output()).success, true);
    const out = await computeSubject(
      dir,
      hash,
      ["matched.txt", "pipe.fifo"],
      base,
    );
    assert("error" in out, JSON.stringify(out));
    assertStringIncludes(out.error, "pipe.fifo");
    assertStringIncludes(out.error, "not a regular file");
  });
});
