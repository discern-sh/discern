/**
 * Tier-two evidence for the settled selection: at most three Git reads with
 * their own failures, the retained failure record, the subject facts that key
 * the cache, and a cache that keeps the most recently used items.
 */

import { assert, assertEquals } from "@std/assert";
import {
  branchEvidenceSubject,
  cachedEvidence,
  DESK_EVIDENCE_CACHE_SIZE,
  DESK_EVIDENCE_COMMITS,
  DESK_EVIDENCE_FILES,
  type DeskEvidence,
  type DeskEvidenceReader,
  emptyEvidenceCache,
  evidenceComplete,
  evidenceKey,
  parseCommits,
  parseFileStats,
  readSelectedEvidence,
  rememberEvidence,
  taskEvidenceSubject,
} from "../src/engine/desk/evidence.ts";
import { buildDeskRows } from "../src/engine/desk/model.ts";
import { productSurvey } from "./fixtures/desk_product.ts";
import { mainFleetEntry, taskFleetEntry } from "./status_fleet.ts";

/** A reader that answers each Git verb from `answers` and records the call. */
function reader(
  answers: Readonly<
    Record<string, { success: boolean; stdout: string; stderr: string }>
  >,
  failures: DeskEvidenceReader["failures"] = () => Promise.resolve(undefined),
): DeskEvidenceReader & { readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    git: (args) => {
      calls.push([...args]);
      const answer = answers[args[0] ?? ""];
      return answer === undefined
        ? Promise.reject(new Error(`unexpected git ${args.join(" ")}`))
        : Promise.resolve(answer);
    },
    failures,
  };
}

Deno.test("commit and file parsers read Git's exact forms", () => {
  assertEquals(
    parseCommits(
      "abc1234\u0000First change\u00002026-07-11T11:00:00+00:00\n" +
        "def5678\u0000Second change\u0000\n\n",
    ),
    [
      {
        sha: "abc1234",
        subject: "First change",
        at: "2026-07-11T11:00:00+00:00",
      },
      { sha: "def5678", subject: "Second change" },
    ],
  );
  const raw = [
    ":100644 100644 aaa bbb M",
    "src/small.ts",
    ":000000 100644 000 ccc A",
    "src/added file.ts",
    ":100644 000000 ddd 000 D",
    "docs/old.md",
    ":100644 100644 eee fff M",
    "assets/logo.png",
    "1\t1\tsrc/small.ts",
    "40\t0\tsrc/added file.ts",
    "0\t12\tdocs/old.md",
    "-\t-\tassets/logo.png",
    "",
  ].join("\u0000");
  assertEquals(parseFileStats(raw), [
    { path: "src/added file.ts", status: "added", added: 40, removed: 0 },
    { path: "docs/old.md", status: "removed", added: 0, removed: 12 },
    { path: "src/small.ts", status: "updated", added: 1, removed: 1 },
    { path: "assets/logo.png", status: "updated" },
  ]);
  const many = Array.from(
    { length: DESK_EVIDENCE_FILES + 5 },
    (_, index) => [`:100644 100644 a b M`, `file-${index}`],
  ).flat().join("\u0000");
  assertEquals(parseFileStats(many).length, DESK_EVIDENCE_FILES);
});

Deno.test("a clean task reads its commits and files in two bounded Git reads", async () => {
  const git = reader({
    log: {
      success: true,
      stdout: "abc1234\u0000Change\u00002026-07-11T11:00:00Z\n",
      stderr: "",
    },
    diff: {
      success: true,
      stdout: ":100644 100644 a b M\u0000a.ts\u00002\t1\ta.ts\u0000",
      stderr: "",
    },
  });
  const evidence = await readSelectedEvidence(
    { cwd: "/worktrees/alpha", ref: "HEAD", trunk: "main" },
    git,
    new AbortController().signal,
  );
  assertEquals(evidence, {
    commits: {
      state: "ready",
      value: [{
        sha: "abc1234",
        subject: "Change",
        at: "2026-07-11T11:00:00Z",
      }],
    },
    files: {
      state: "ready",
      value: [{ path: "a.ts", status: "updated", added: 2, removed: 1 }],
    },
  });
  assertEquals(git.calls, [
    [
      "log",
      "--format=%h%x00%s%x00%cI",
      "-n",
      String(DESK_EVIDENCE_COMMITS),
      "main..HEAD",
    ],
    ["diff", "--raw", "--numstat", "-z", "--no-renames", "main...HEAD"],
  ]);
});

Deno.test("each evidence section fails on its own, and a dirty failed task reads at most three Git commands", async () => {
  const git = reader({
    log: { success: false, stdout: "", stderr: "fatal: bad revision\n" },
    diff: { success: false, stdout: "", stderr: "" },
    status: {
      success: true,
      stdout: " M a.ts\u0000?? notes.txt\u0000",
      stderr: "",
    },
  }, (branch, verb) => {
    assertEquals([branch, verb], ["agent/alpha", "done"]);
    return Promise.resolve([{ name: "lint", message: "Unused import" }]);
  });
  const evidence: DeskEvidence = await readSelectedEvidence(
    {
      cwd: "/worktrees/alpha",
      ref: "HEAD",
      trunk: "main",
      dirty: "2@2026-07-11T11:00:00Z",
      failed: { branch: "agent/alpha", verb: "done" },
    },
    git,
    new AbortController().signal,
  );
  assertEquals(evidence.commits, {
    state: "failed",
    error: "fatal: bad revision",
  });
  assertEquals(evidence.files, {
    state: "failed",
    error: "Git returned a non-zero status.",
  });
  assertEquals(evidence.uncommitted, {
    state: "ready",
    value: [
      { path: "a.ts", status: "updated" },
      { path: "notes.txt", status: "added" },
    ],
  });
  assertEquals(evidence.failure, {
    state: "ready",
    value: [{ name: "lint", message: "Unused import" }],
  });
  assert(git.calls.length <= 3, JSON.stringify(git.calls));

  const thrown = await readSelectedEvidence(
    {
      cwd: "/worktrees/alpha",
      ref: "HEAD",
      trunk: "main",
      failed: { branch: "agent/alpha", verb: "done" },
    },
    reader({}, () => Promise.reject(new Error("journal unreadable"))),
    new AbortController().signal,
  );
  assertEquals(thrown.commits.state, "failed");
  assertEquals(thrown.failure, {
    state: "failed",
    error: "journal unreadable",
  });
});

Deno.test("an evidence subject is keyed by everything that would change it", () => {
  const data = productSurvey([
    taskFleetEntry("alpha", {
      clean: false,
      changed_files: 2,
      last_activity: "2026-07-11T11:00:00Z",
      registration: { head: "a".repeat(40), locked: false, prunable: false },
      last_action: {
        verb: "done",
        outcome: "failed",
        at: "2026-07-11T10:00:00Z",
      },
    }),
  ], {
    parked_tasks: [{
      id: "spike",
      branch: "agent/spike",
      head: "b".repeat(40),
      parked_at: "2026-07-11T09:00:00Z",
      task: {
        id: "spike",
        branch: "agent/spike",
        title: "Spike",
        title_source: "recorded",
      },
    }],
  });
  const withTrunk = {
    ...data,
    fleet: [
      mainFleetEntry("/project", {
        registration: {
          head: "c".repeat(40),
          locked: false,
          prunable: false,
        },
      }),
      ...(data.fleet ?? []).filter((entry) => !entry.is_main),
    ],
  };
  const [row] = buildDeskRows(
    (withTrunk.fleet ?? []).filter((entry) => !entry.is_main),
    new Map(),
    new Map(),
    { trunk: "main", nowMs: Date.parse("2026-07-11T12:00:00Z") },
  );
  assert(row !== undefined);
  const task = taskEvidenceSubject(row, withTrunk, "main");
  assertEquals(task, {
    cwd: "/worktrees/alpha",
    ref: "HEAD",
    trunk: "main",
    head: "a".repeat(40),
    trunkHead: "c".repeat(40),
    dirty: "2@2026-07-11T11:00:00Z",
    failed: { branch: "agent/alpha", verb: "done" },
  });
  const branch = branchEvidenceSubject(
    "agent/spike",
    "/project",
    withTrunk,
    "main",
  );
  assertEquals(branch, {
    cwd: "/project",
    ref: "agent/spike",
    trunk: "main",
    head: "b".repeat(40),
    trunkHead: "c".repeat(40),
  });
  const keys = new Set([
    evidenceKey(task),
    evidenceKey({ ...task, head: "d".repeat(40) }),
    evidenceKey({ ...task, trunkHead: "e".repeat(40) }),
    evidenceKey({ ...task, dirty: "3@2026-07-11T11:30:00Z" }),
    evidenceKey(branch),
  ]);
  assertEquals(keys.size, 5);
});

Deno.test("the evidence cache keeps the most recently used items", () => {
  const evidence = (sha: string): DeskEvidence => ({
    commits: { state: "ready", value: [{ sha, subject: sha }] },
    files: { state: "ready", value: [] },
  });
  let cache = emptyEvidenceCache();
  for (let index = 0; index <= DESK_EVIDENCE_CACHE_SIZE; index += 1) {
    cache = rememberEvidence(cache, `key-${index}`, evidence(`${index}`));
  }
  assertEquals(cache.entries.length, DESK_EVIDENCE_CACHE_SIZE);
  assertEquals(cachedEvidence(cache, "key-0"), undefined, "the oldest goes");
  cache = rememberEvidence(cache, "key-1", evidence("again"));
  assertEquals(cache.entries.at(-1)?.[0], "key-1", "a reuse is the newest");
  assertEquals(cache.entries.length, DESK_EVIDENCE_CACHE_SIZE);
  assertEquals(
    cachedEvidence(cache, "key-1")?.commits,
    { state: "ready", value: [{ sha: "again", subject: "again" }] },
  );
  assertEquals(evidenceComplete(evidence("whole")), true);
  assertEquals(
    evidenceComplete({
      ...evidence("partial"),
      failure: { state: "failed", error: "journal unreadable" },
    }),
    false,
    "a failed section is read again when its item settles",
  );
});
