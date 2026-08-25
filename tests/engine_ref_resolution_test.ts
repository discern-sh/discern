/**
 * The shared ref resolver behind `start --from` and `update --from`
 * (`resolveCommitRef`) — the ONE vocabulary both pull verbs accept. The
 * parameterized table drives every ref KIND a user can hand it (branch, tags
 * lightweight and annotated, SHAs, revision expressions), so a new kind
 * enrols by adding a row; the refusal cases prove an ambiguous short name is
 * refused by enumerating refs (never by grepping git's locale-dependent,
 * `--quiet`-suppressed warning — the regression that let an ambiguous name
 * silently resolve to the tag) and an unknown name is refused in plain
 * language. The end-to-end case proves the refusal actually reaches an
 * `update --from` caller instead of merging the wrong object.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import {
  resolveCommitRef,
  WorktreeGitError,
} from "../src/engine/worktree/git.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

/** A scratch repo with: main (2 commits), branch `feature` (1 more commit),
 * lightweight tag `light` and annotated tag `annot` on main's first commit. */
async function refZoo(dir: string): Promise<{ first: string; tip: string }> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  const first = await gitOut(dir, "rev-parse", "HEAD");
  await git(dir, "tag", "light");
  await git(dir, "tag", "-a", "annot", "-m", "annotated");
  await git(dir, "switch", "-q", "-c", "feature");
  await Deno.writeTextFile(join(dir, "feature.txt"), "feature\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "feature work", "--no-gpg-sign");
  await git(dir, "switch", "-q", "main");
  await Deno.writeTextFile(join(dir, "second.txt"), "second\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "second", "--no-gpg-sign");
  const tip = await gitOut(dir, "rev-parse", "HEAD");
  return { first, tip };
}

Deno.test("resolveCommitRef: every ref kind resolves to its peeled commit", async () => {
  await withTempDir(async (dir) => {
    const { first, tip } = await refZoo(dir);
    const featureTip = await gitOut(dir, "rev-parse", "feature");
    // One row per ref KIND the resolver accepts; `expected` is always a commit
    // SHA — an annotated tag must peel to the commit it tags, never the tag object.
    const kinds: { kind: string; ref: string; expected: string }[] = [
      { kind: "branch", ref: "feature", expected: featureTip },
      { kind: "lightweight tag", ref: "light", expected: first },
      { kind: "annotated tag", ref: "annot", expected: first },
      { kind: "full SHA", ref: tip, expected: tip },
      { kind: "short SHA", ref: tip.slice(0, 10), expected: tip },
      { kind: "revision expression", ref: "main~1", expected: first },
      {
        kind: "fully qualified branch",
        ref: "refs/heads/feature",
        expected: featureTip,
      },
      { kind: "fully qualified tag", ref: "refs/tags/annot", expected: first },
    ];
    for (const row of kinds) {
      assertEquals(
        await resolveCommitRef(dir, row.ref),
        row.expected,
        `a ${row.kind} ('${row.ref}') must resolve to its commit`,
      );
      // The annotated tag's OBJECT sha differs from its commit — prove the peel.
      if (row.kind === "annotated tag") {
        const tagObject = await gitOut(dir, "rev-parse", "annot");
        assert(
          tagObject !== first,
          "test premise: annotated tag has its own object",
        );
      }
    }
  });
});

Deno.test("resolveCommitRef: a name matching both a branch and a tag is refused, naming both", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    // `dual` is simultaneously a branch (at feature's tip) and a tag (at first).
    await git(dir, "branch", "dual", "feature");
    await git(dir, "tag", "dual", "main~1");
    const err = await assertRejects(
      () => resolveCommitRef(dir, "dual"),
      WorktreeGitError,
      "ambiguous",
    );
    assertStringIncludes(err.message, "refs/heads/dual");
    assertStringIncludes(err.message, "refs/tags/dual");
    // The full names it suggests both resolve.
    assertEquals(
      await resolveCommitRef(dir, "refs/heads/dual"),
      await gitOut(dir, "rev-parse", "feature"),
    );
    assertEquals(
      await resolveCommitRef(dir, "refs/tags/dual"),
      await gitOut(dir, "rev-parse", "main~1"),
    );
  });
});

Deno.test("resolveCommitRef: a branch under a name's path is NOT ambiguity for that name", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    // Tag `topic` and branch `topic/sub` coexist (git forbids a branch `topic`
    // next to `topic/sub`, so the collision is always cross-kind). The short
    // name `topic` denotes exactly one ref — for-each-ref's whole-component
    // prefix matching must not count `refs/heads/topic/sub` against it.
    await git(dir, "branch", "topic/sub", "main");
    await git(dir, "tag", "topic", "main~1");
    assertEquals(
      await resolveCommitRef(dir, "topic"),
      await gitOut(dir, "rev-parse", "main~1"),
    );
  });
});

Deno.test("resolveCommitRef: unknown and empty names are refused in plain language", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    await assertRejects(
      () => resolveCommitRef(dir, "no-such-thing"),
      WorktreeGitError,
      "Unknown ref 'no-such-thing'",
    );
    await assertRejects(
      () => resolveCommitRef(dir, "  "),
      WorktreeGitError,
      "A ref name is required",
    );
  });
});

Deno.test("update --from an ambiguous name refuses — it must not merge the tag by precedence", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    const wt = await addWorktree(dir, "ambiguous-pull");
    // A tag `dual` parked at the fork point and a branch `dual` carrying new
    // work: git's own precedence picks the TAG, which silently pulls nothing.
    await git(dir, "tag", "dual", "main~1");
    await git(dir, "branch", "dual", "feature");

    const r = await runAgent(wt, ["update", "--json", "--from", "dual"]);
    assertEquals(r.code, 1, r.output);
    const result = decodeCliResult(r.stdout, "update");
    assertEquals(result.error, "precondition_failed");
    assertExists(result.message);
    assertStringIncludes(result.message, "ambiguous");
    assertStringIncludes(result.message, "refs/heads/dual");
    // Nothing merged, nothing broken: the branch's file never arrived.
    assertEquals(await targetExists(join(wt, "feature.txt")), false);
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
  });
});

Deno.test("start --from an ambiguous name refuses cleanly — no worktree debris", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    await git(dir, "tag", "dual", "main~1");
    await git(dir, "branch", "dual", "feature");

    const r = await runAgent(dir, ["start", "--json", "--from", "dual"]);
    assertEquals(r.code, 1, r.output);
    const result = decodeCliResult(r.stdout, "start");
    assertEquals(result.error, "precondition_failed");
    assertExists(result.message);
    assertStringIncludes(result.message, "ambiguous");
    // No debris: nothing registered, no stray agent branch beyond the zoo's.
    const worktrees = await gitOut(dir, "worktree", "list", "--porcelain");
    assert(
      !worktrees.includes(".worktrees"),
      `an ambiguous start must not leave a worktree:\n${worktrees}`,
    );
    const branches = await gitOut(dir, "branch", "--list", "agent/*");
    assertEquals(branches.trim(), "", branches);
  });
});

Deno.test("update --from an annotated tag anchors range.main at the peeled commit", async () => {
  await withTempDir(async (dir) => {
    await refZoo(dir);
    const wt = await addWorktree(dir, "tag-pull");
    // Annotated tag on main's tip — ahead of the worktree's fork point.
    await Deno.writeTextFile(join(dir, "phase.txt"), "phase\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "phase tip", "--no-gpg-sign");
    await git(dir, "tag", "-a", "phase-1", "-m", "phase one");

    const r = await runAgent(wt, ["update", "--json", "--from", "phase-1"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "update");
    assertResultDataKey(result, "range");
    assertEquals(
      result.data.range.main,
      await gitOut(dir, "rev-parse", "phase-1^{commit}"),
      `range.main must be the peeled commit, not the tag object\n${r.stdout}`,
    );
  });
});
