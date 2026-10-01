/**
 * Tier-two evidence for the settled selection: at most three Git reads with
 * their own failures, the retained failure record, the facts that key each
 * part of the cache, and a cache that keeps the most recently used items.
 */

import { assert, assertEquals } from "@std/assert";
import {
  branchEvidenceSubject,
  cachedEvidence,
  DESK_EVIDENCE_CACHE_SIZE,
  DESK_EVIDENCE_COMMITS,
  DESK_EVIDENCE_FILES,
  type DeskEvidenceRead,
  type DeskEvidenceReader,
  type DeskEvidenceSubject,
  emptyEvidenceCache,
  evidenceKeys,
  evidenceToRead,
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
    committed: {
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
  const evidence: DeskEvidenceRead = await readSelectedEvidence(
    {
      cwd: "/worktrees/alpha",
      ref: "HEAD",
      trunk: "main",
      dirty: "2@2026-07-11T11:00:00Z",
      failed: {
        branch: "agent/alpha",
        verb: "done",
        at: "2026-07-11T10:00:00Z",
      },
    },
    git,
    new AbortController().signal,
  );
  assertEquals(evidence.committed?.commits, {
    state: "failed",
    error: "fatal: bad revision",
  });
  assertEquals(evidence.committed?.files, {
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
      failed: {
        branch: "agent/alpha",
        verb: "done",
        at: "2026-07-11T10:00:00Z",
      },
    },
    reader({}, () => Promise.reject(new Error("journal unreadable"))),
    new AbortController().signal,
  );
  assertEquals(thrown.committed?.commits.state, "failed");
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
    failed: {
      branch: "agent/alpha",
      verb: "done",
      at: "2026-07-11T10:00:00Z",
    },
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
  // Each part is keyed by exactly the facts that change it.
  const committed = (subject: DeskEvidenceSubject) =>
    evidenceKeys(subject).committed;
  assertEquals(
    new Set([
      committed(task),
      committed({ ...task, head: "d".repeat(40) }),
      committed({ ...task, trunkHead: "e".repeat(40) }),
      committed(branch),
    ]).size,
    4,
  );
  const edited = { ...task, dirty: "3@2026-07-11T11:30:00Z" };
  assertEquals(
    committed(edited),
    committed(task),
    "an edit in the checkout keeps its committed evidence",
  );
  assert(evidenceKeys(edited).uncommitted !== evidenceKeys(task).uncommitted);
  const failedAgain = {
    ...task,
    failed: {
      branch: "agent/alpha",
      verb: "done",
      at: "2026-07-11T11:30:00Z",
    },
  };
  assert(
    evidenceKeys(failedAgain).failure !== evidenceKeys(task).failure,
    "a second failure of the same verb is a new record",
  );
  assertEquals(evidenceKeys(branch).uncommitted, undefined);
});

/** A complete read of every part, its commit named `sha`. */
function readOf(sha: string): DeskEvidenceRead {
  return {
    committed: {
      commits: { state: "ready", value: [{ sha, subject: sha }] },
      files: { state: "ready", value: [] },
    },
    uncommitted: { state: "ready", value: [{ path: sha, status: "added" }] },
  };
}

/** A dirty task subject whose checkout path is `index`. */
function item(index: number): DeskEvidenceSubject {
  return {
    cwd: `/worktrees/${index}`,
    ref: "HEAD",
    trunk: "main",
    head: "a".repeat(40),
    dirty: "1@2026-07-11T11:00:00Z",
  };
}

Deno.test("the evidence cache keeps the most recently used items", () => {
  let cache = emptyEvidenceCache();
  for (let index = 0; index <= DESK_EVIDENCE_CACHE_SIZE; index += 1) {
    cache = rememberEvidence(cache, item(index), readOf(`${index}`));
  }
  assertEquals(cache.parts.committed.length, DESK_EVIDENCE_CACHE_SIZE);
  assertEquals(
    cachedEvidence(cache, item(0)),
    {},
    "the oldest goes",
  );
  assertEquals(
    cachedEvidence(cache, item(1)).commits,
    { state: "ready", value: [{ sha: "1", subject: "1" }] },
  );
  // A read that finds an item kept makes it the newest without a new read.
  cache = rememberEvidence(cache, item(1), {});
  cache = rememberEvidence(cache, item(99), readOf("99"));
  assert(
    cachedEvidence(cache, item(1)).commits !== undefined,
    "a reuse is the newest, so a new item evicts another",
  );
  assertEquals(cachedEvidence(cache, item(2)), {}, "the least used goes");
  assertEquals(evidenceToRead(cache, item(1)), [], "nothing left to read");
  const partial = rememberEvidence(emptyEvidenceCache(), item(1), {
    committed: {
      commits: { state: "ready", value: [] },
      files: { state: "failed", error: "git failed" },
    },
  });
  assertEquals(
    evidenceToRead(partial, item(1)),
    ["committed", "uncommitted"],
    "a failed section is read again when its item settles",
  );
});

Deno.test("an edit in a checkout reads only its uncommitted files again", () => {
  const cache = rememberEvidence(emptyEvidenceCache(), item(1), readOf("1"));
  const edited = { ...item(1), dirty: "2@2026-07-11T11:05:00Z" };
  assertEquals(evidenceToRead(cache, edited), ["uncommitted"]);
  const shown = cachedEvidence(cache, edited);
  assert(shown.commits !== undefined, "the commits never blink to Reading…");
  assertEquals(
    shown.uncommitted,
    { state: "ready", value: [{ path: "1", status: "added" }] },
    "the last uncommitted files show while the new ones are read",
  );
});
