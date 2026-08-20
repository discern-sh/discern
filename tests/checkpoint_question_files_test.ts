/**
 * Repository-backed checkpoint questions: strict live authoring validation,
 * immutable governing-tree reads, byte and encoding bounds, and definition
 * identity across branch edits and merge-base updates.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  ConfigValidationError,
  loadConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  CHECKPOINT_QUESTION_FILE_MAX_BYTES,
  readCheckpointQuestionFileAtCommit,
  readLiveCheckpointQuestionFile,
} from "../src/shared/checkpoint_question_files.ts";
import { loadGoverningPolicy } from "../src/engine/checkpoints/policy.ts";
import {
  checkpointDefinitionHash,
  computeSubject,
} from "../src/engine/checkpoints/subject.ts";
import { reconcileOpenQuestion } from "../src/engine/checkpoints/open_questions.ts";

const LIVE = parseConfigOrThrow("");

/** Create a byte fixture, including its parent directories. */
async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeFile(path, bytes);
}

/** One file-backed checkpoint config with an optional display pointer. */
function fileConfig(path: string, reference?: string): string {
  return [
    "[checkpoints.review]",
    'paths = ["docs/**"]',
    `question_file = ${JSON.stringify(path)}`,
    ...(reference === undefined
      ? []
      : [`reference = ${JSON.stringify(reference)}`]),
    "",
  ].join("\n");
}

/** Commit one file-backed policy and a path its trigger can match. */
async function scaffoldFilePolicy(
  dir: string,
  path: string,
  question: string,
): Promise<void> {
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(join(dir, "docs", "page.md"), "page\n");
  await Deno.writeTextFile(
    join(dir, "discern.toml"),
    fileConfig(
      path,
      "project/map/review-pointer.md#rubric",
    ),
  );
  await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
  await Deno.writeTextFile(join(dir, path), question);
  await gitInit(dir);
}

Deno.test("question blobs accept 0, 1, and 64 KiB exactly and retain authored bytes", async () => {
  await withTempDir(async (dir) => {
    const encoder = new TextEncoder();
    const paths = {
      zero: "policy/zero.md",
      one: "policy/one.md",
      exact: "policy/exact.md",
      over: "policy/over.md",
      invalid: "policy/invalid.md",
      lineEndings: "policy/line endings.md",
      hostile: "policy/$ [review].md",
    } as const;
    await writeBytes(join(dir, paths.zero), new Uint8Array());
    await writeBytes(join(dir, paths.one), encoder.encode("x"));
    await writeBytes(
      join(dir, paths.exact),
      new Uint8Array(CHECKPOINT_QUESTION_FILE_MAX_BYTES).fill(0x61),
    );
    await writeBytes(
      join(dir, paths.over),
      new Uint8Array(CHECKPOINT_QUESTION_FILE_MAX_BYTES + 1).fill(0x61),
    );
    await writeBytes(join(dir, paths.invalid), new Uint8Array([0xff]));
    await writeBytes(
      join(dir, paths.lineEndings),
      encoder.encode("first\r\nsecond\rthird\n"),
    );
    await writeBytes(join(dir, paths.hostile), encoder.encode("Hostile path."));
    await Deno.mkdir(join(dir, "policy", "tree"), { recursive: true });
    await Deno.writeTextFile(join(dir, "policy", "tree", "inside.md"), "x");
    await Deno.symlink("one.md", join(dir, "policy", "link.md"));
    await gitInit(dir);
    const commit = await gitOut(dir, "rev-parse", "HEAD");

    const zero = await readCheckpointQuestionFileAtCommit(
      dir,
      commit,
      paths.zero,
    );
    assert(zero.ok);
    assertEquals(zero.question, "");
    const one = await readCheckpointQuestionFileAtCommit(
      dir,
      commit,
      paths.one,
    );
    assert(one.ok);
    assertEquals(one.question, "x");
    const exact = await readCheckpointQuestionFileAtCommit(
      dir,
      commit,
      paths.exact,
    );
    assert(exact.ok);
    assertEquals(
      new TextEncoder().encode(exact.question).length,
      CHECKPOINT_QUESTION_FILE_MAX_BYTES,
    );
    const lineEndings = await readCheckpointQuestionFileAtCommit(
      dir,
      commit,
      paths.lineEndings,
    );
    assert(lineEndings.ok);
    assertEquals(lineEndings.question, "first\r\nsecond\rthird\n");
    const hostile = await readCheckpointQuestionFileAtCommit(
      dir,
      commit,
      paths.hostile,
    );
    assert(hostile.ok);
    assertEquals(hostile.question, "Hostile path.");

    for (
      const [path, reason] of [
        [paths.over, "oversized"],
        [paths.invalid, "invalid_utf8"],
        ["policy/missing.md", "missing"],
        ["policy/link.md", "not_regular_blob"],
        ["policy/tree", "not_regular_blob"],
      ] as const
    ) {
      const read = await readCheckpointQuestionFileAtCommit(dir, commit, path);
      assert(!read.ok, path);
      assertEquals(read.reason, reason, path);
    }

    await git(dir, "rm", paths.one);
    await git(dir, "commit", "-q", "-m", "delete question", "--no-gpg-sign");
    const deletedCommit = await gitOut(dir, "rev-parse", "HEAD");
    const deleted = await readCheckpointQuestionFileAtCommit(
      dir,
      deletedCommit,
      paths.one,
    );
    assert(!deleted.ok);
    assertEquals(deleted.reason, "missing");
  });
});

Deno.test("live question files must be regular tracked UTF-8 files within the byte limit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldFilePolicy(dir, "policy/question.md", "Tracked question.");
    const config = await loadConfig(dir);
    assertEquals(
      config.checkpoints.review?.question_file,
      "policy/question.md",
    );

    await Deno.writeTextFile(join(dir, "policy", "untracked.md"), "Untracked.");
    const untracked = await readLiveCheckpointQuestionFile(
      dir,
      "policy/untracked.md",
    );
    assert(!untracked.ok);
    assertEquals(untracked.reason, "not_tracked");

    await Deno.remove(join(dir, "policy", "question.md"));
    const error = await assertRejects(
      () => loadConfig(dir),
      ConfigValidationError,
    );
    assertStringIncludes(error.message, "checkpoints.review.question_file");
    assertStringIncludes(error.message, "missing from the live configuration");
    assertStringIncludes(error.message, "or use `question`");
  });
});

Deno.test("the governing tree supplies prose, source path, and reference despite a candidate rewrite", async () => {
  await withTempDir(async (dir) => {
    const path = "policy/$ [review].md";
    await scaffoldFilePolicy(
      dir,
      path,
      "## Governing rubric\n\nJudge this text.\n",
    );
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "checkout", "-q", "-b", "agent/probe");
    await Deno.writeTextFile(join(dir, path), "Weakened candidate text.\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "rewrite candidate copy",
      "--no-gpg-sign",
    );

    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.policyCommit, base);
    assertEquals(policy.drops, []);
    const def = policy.checkpoints[0];
    assert(def !== undefined);
    assertEquals(def.question, "## Governing rubric\n\nJudge this text.\n");
    assertEquals(def.questionFile, path);
    assertEquals(def.reference, "project/map/review-pointer.md#rubric");
  });
});

Deno.test("governing question content and path changes reopen; unrelated merge-base moves do not", async () => {
  await withTempDir(async (dir) => {
    const firstPath = "policy/question.md";
    await scaffoldFilePolicy(dir, firstPath, "First governing question.\n");
    await git(dir, "checkout", "-q", "-b", "agent/probe");
    await Deno.writeTextFile(join(dir, "docs", "page.md"), "branch change\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "change docs", "--no-gpg-sign");

    const before = await loadGoverningPolicy(dir, LIVE);
    const beforeDef = before.checkpoints[0];
    assert(beforeDef !== undefined && before.policyCommit !== undefined);
    const beforeHash = await checkpointDefinitionHash(beforeDef);
    const beforeSubject = await computeSubject(
      dir,
      beforeHash,
      ["docs/page.md"],
      before.policyCommit,
    );
    assert("subject" in beforeSubject);
    const opened = await reconcileOpenQuestion(dir, {
      checkpoint: beforeDef.id,
      definitionHash: beforeHash,
      subject: beforeSubject.subject.fingerprint,
      matchedPaths: ["docs/page.md"],
      relatedPaths: [],
    }, "2026-01-01T00:00:00.000Z");
    assert(opened.ok);
    assertEquals(opened.outcome, "opened");

    await git(dir, "checkout", "-q", "main");
    await Deno.writeTextFile(
      join(dir, firstPath),
      "Second governing question.\n",
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "change question", "--no-gpg-sign");
    await git(dir, "checkout", "-q", "agent/probe");
    await git(dir, "merge", "-q", "--no-edit", "main");

    const contentChanged = await loadGoverningPolicy(dir, LIVE);
    const contentDef = contentChanged.checkpoints[0];
    assert(
      contentDef !== undefined && contentChanged.policyCommit !== undefined,
    );
    const contentHash = await checkpointDefinitionHash(contentDef);
    assertNotEquals(contentHash, beforeHash);
    const contentSubject = await computeSubject(
      dir,
      contentHash,
      ["docs/page.md"],
      contentChanged.policyCommit,
    );
    assert("subject" in contentSubject);
    const reopened = await reconcileOpenQuestion(dir, {
      checkpoint: contentDef.id,
      definitionHash: contentHash,
      subject: contentSubject.subject.fingerprint,
      matchedPaths: ["docs/page.md"],
      relatedPaths: [],
    }, "2026-01-01T01:00:00.000Z");
    assert(reopened.ok);
    assertEquals(reopened.outcome, "reopened");

    await git(dir, "checkout", "-q", "main");
    await Deno.writeTextFile(join(dir, "unrelated.txt"), "unrelated\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "unrelated move", "--no-gpg-sign");
    await git(dir, "checkout", "-q", "agent/probe");
    await git(dir, "merge", "-q", "--no-edit", "main");
    const unrelated = await loadGoverningPolicy(dir, LIVE);
    const unrelatedDef = unrelated.checkpoints[0];
    assert(unrelatedDef !== undefined);
    assertEquals(await checkpointDefinitionHash(unrelatedDef), contentHash);

    const secondPath = "policy/renamed question.md";
    await git(dir, "checkout", "-q", "main");
    await git(dir, "mv", firstPath, secondPath);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      fileConfig(secondPath, "project/map/review-pointer.md#rubric"),
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "move question source",
      "--no-gpg-sign",
    );
    await git(dir, "checkout", "-q", "agent/probe");
    await git(dir, "merge", "-q", "--no-edit", "main");
    const pathChanged = await loadGoverningPolicy(dir, LIVE);
    const pathDef = pathChanged.checkpoints[0];
    assert(pathDef !== undefined);
    assertEquals(pathDef.question, contentDef.question);
    assertEquals(pathDef.questionFile, secondPath);
    assertNotEquals(await checkpointDefinitionHash(pathDef), contentHash);
  });
});

Deno.test("historical source failures drop only their checkpoints with typed evidence", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "policy", "tree"), { recursive: true });
    await Deno.writeTextFile(join(dir, "policy", "good.md"), "Good question.");
    await writeBytes(join(dir, "policy", "invalid.md"), new Uint8Array([0xff]));
    await writeBytes(
      join(dir, "policy", "large.md"),
      new Uint8Array(CHECKPOINT_QUESTION_FILE_MAX_BYTES + 1).fill(0x61),
    );
    await Deno.writeTextFile(join(dir, "policy", "tree", "inside.md"), "x");
    await Deno.symlink("good.md", join(dir, "policy", "link.md"));
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        '[checkpoints.good]\nquestion_file = "policy/good.md"',
        '[checkpoints.missing]\nquestion_file = "policy/missing.md"',
        '[checkpoints.invalid]\nquestion_file = "policy/invalid.md"',
        '[checkpoints.large]\nquestion_file = "policy/large.md"',
        '[checkpoints.link]\nquestion_file = "policy/link.md"',
        '[checkpoints.tree]\nquestion_file = "policy/tree"',
        '[checkpoints.invalid-path]\nquestion_file = "../outside.md"',
        "",
      ].join("\n\n"),
    );
    await gitInit(dir);
    const policy = await loadGoverningPolicy(dir, LIVE);
    assertEquals(policy.checkpoints.map((entry) => entry.id), ["good"]);
    assertEquals(
      policy.drops.map((drop) => [drop.checkpoint, drop.reason]),
      [
        ["missing", "checkpoint_question_file_missing"],
        ["invalid", "checkpoint_question_file_invalid_utf8"],
        ["large", "checkpoint_question_file_oversized"],
        ["link", "checkpoint_question_file_not_regular"],
        ["tree", "checkpoint_question_file_not_regular"],
        ["invalid-path", "checkpoint_question_file_invalid_path"],
      ],
    );
    for (const drop of policy.drops) {
      assertEquals(drop.scope, "checkpoint");
      assertEquals(drop.mode, "stop");
      assertEquals(drop.policy_commit, policy.policyCommit);
      assertStringIncludes(drop.account, "does not govern this run");
    }
  });
});
