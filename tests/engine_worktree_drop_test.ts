/**
 * `discern worktree drop <id|path>` — the sanctioned removal for abandoned work.
 * Before this verb the only path was raw `rm -rf` + prune (`worktree prune`
 * deliberately keeps anything unmerged or dirty). Drop tears down resources,
 * removes the worktree, and deletes its branch — refusing anything a drop would
 * DISCARD (uncommitted changes, unmerged commits) unless `--force` consents.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { exists } from "@std/fs";
import {
  deleteDropBranchAtCommit,
  DROP_RECOVERY_REF_LIMIT,
  DROP_RECOVERY_REF_PREFIX,
  preserveDropRecoveryRef,
} from "../src/engine/worktree/recovery_refs.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Whether the branch still exists in the repo at `dir`. */
async function branchExists(dir: string, branch: string): Promise<boolean> {
  return (await gitOut(dir, "branch", "--list", branch)) !== "";
}

/** Recovery refs and their target commits, newest name first. */
async function recoveryRefs(
  dir: string,
): Promise<Array<{ ref: string; commit: string }>> {
  const output = await gitOut(
    dir,
    "for-each-ref",
    "--sort=-refname",
    "--format=%(refname) %(objectname)",
    `${DROP_RECOVERY_REF_PREFIX}/`,
  );
  return output === "" ? [] : output.split("\n").map((line) => {
    const [ref = "", commit = ""] = line.split(" ");
    return { ref, commit };
  });
}

Deno.test("worktree drop <id>: removes a clean, merged worktree and deletes its branch", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "abandoned");
    const branchTip = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(dir, ["worktree", "drop", "abandoned"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, `worktree removed\n${r.output}`);
    assertEquals(
      await branchExists(dir, "agent/abandoned"),
      false,
      `branch deleted\n${r.output}`,
    );
    const refs = await recoveryRefs(dir);
    assertEquals(
      refs.length,
      1,
      `the dropped branch keeps one ref\n${r.output}`,
    );
    assertEquals(refs[0]?.commit, branchTip);
    assertStringIncludes(refs[0]?.ref ?? "", "abandoned");
    assertStringIncludes(r.output, refs[0]?.ref ?? "missing recovery ref");
    assertStringIncludes(r.output, "dropped");
  });
});

Deno.test("worktree drop <path>: resolves the target by path too", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "by-path");
    const r = await runAgent(dir, ["worktree", "drop", wt]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, r.output);
  });
});

Deno.test("worktree drop: refuses an ambiguous basename and requires a path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Git permits linked worktrees in unrelated roots with the same directory
    // basename. A bare `dup` names both registrations; neither fleet order nor
    // the default worktree root may decide which checkout is destroyed.
    const first = await addWorktree(dir, "dup");
    const second = join(`${dir}.worktrees`, "alt", "dup");
    await git(
      dir,
      "worktree",
      "add",
      second,
      "-b",
      "agent/alt-dup",
    );
    const firstPath = await Deno.realPath(first);
    const secondPath = await Deno.realPath(second);

    const refused = await runAgent(dir, ["worktree", "drop", "dup"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(
      refused.output,
      "`discern worktree drop` can't resolve 'dup'",
    );
    assertStringIncludes(refused.output, firstPath);
    assertStringIncludes(refused.output, secondPath);
    assertStringIncludes(refused.output, "Pass one of these paths");
    assert(await exists(first), "the first candidate must survive");
    assert(await exists(second), "the second candidate must survive");
    assert(await branchExists(dir, "agent/dup"), refused.output);
    assert(await branchExists(dir, "agent/alt-dup"), refused.output);

    // The listed path selects one registration without touching its
    // same-basename sibling.
    const selected = await runAgent(dir, [
      "worktree",
      "drop",
      secondPath,
    ]);
    assertEquals(selected.code, 0, selected.output);
    assert(await exists(first), "the unselected candidate must survive");
    assertEquals(await exists(second), false, selected.output);
  });
});

Deno.test("worktree drop: refuses an id shared by different worktree paths", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Recorded identity overrides can give differently named registrations the
    // same worktree id. That is the same destructive first-match mechanism as
    // a basename collision, reached through the other accepted alias source.
    const first = await addWorktree(dir, "first-path");
    const second = await addWorktree(dir, "second-path");
    await Deno.writeTextFile(
      join(first, ".env.local"),
      "DISCERN_WORKTREE_ID=shared-id\n",
    );
    await Deno.writeTextFile(
      join(second, ".env.local"),
      "DISCERN_WORKTREE_ID=shared-id\n",
    );
    const firstPath = await Deno.realPath(first);
    const secondPath = await Deno.realPath(second);

    const refused = await runAgent(dir, [
      "worktree",
      "drop",
      "shared-id",
      "--force",
    ]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(
      refused.output,
      "`discern worktree drop` can't resolve 'shared-id'",
    );
    assertStringIncludes(refused.output, firstPath);
    assertStringIncludes(refused.output, secondPath);
    assert(await exists(first), "the first candidate must survive");
    assert(await exists(second), "the second candidate must survive");
  });
});

Deno.test("worktree drop: a DISCERN_WORKTREE_ID in the environment cannot redirect the match", async () => {
  await withTempDir(async (dir) => {
    // Two worktrees; the caller's environment carries an id override naming the
    // SECOND. Matching resolves each row's OWN identity, so the override must
    // not make every row answer to 'foo-target' — the poisoned matcher deleted
    // whichever row it met first ('bar-bystander') with exit 0.
    const bystander = await mainWithWorktree(dir, "bar-bystander");
    const target = await addWorktree(dir, "foo-target");

    const r = await runAgent(dir, ["worktree", "drop", "foo-target"], {
      env: { DISCERN_WORKTREE_ID: "foo-target" },
    });
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(target),
      false,
      `the named worktree is dropped\n${r.output}`,
    );
    assert(
      await exists(bystander),
      `the bystander must survive an env-override drop\n${r.output}`,
    );
    assert(await branchExists(dir, "agent/bar-bystander"), r.output);
  });
});

Deno.test("worktree drop: a worktree holding the TRUNK loses its checkout, never the branch", async () => {
  await withTempDir(async (dir) => {
    // The legacy accept-to-branch layouts leave exactly this: main parked on a
    // review branch, a linked worktree holding `main`. Dropping that worktree
    // must remove the checkout and KEEP the trunk — deleting it left the repo
    // with no landing target at all (reproduced in review, exit 0).
    await scaffoldEngine(dir);
    await gitInit(dir);
    await git(dir, "switch", "-q", "-c", "reviewing");
    const wt = join(`${dir}.worktrees`, "trunk-holder");
    await git(dir, "worktree", "add", wt, "main");

    const r = await runAgent(dir, ["worktree", "drop", "trunk-holder"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, `checkout removed\n${r.output}`);
    assert(
      await branchExists(dir, "main"),
      `the trunk must survive a drop\n${r.output}`,
    );
    assertStringIncludes(r.output, "the trunk is never deleted");
  });
});

Deno.test("worktree drop: a relative path resolves like the error text promises", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "rel-target");
    // The docs and the no-match error offer "a worktree id or its path" — a
    // relative path is a path.
    const rel = `../${basename(`${dir}.worktrees`)}/rel-target`;
    const r = await runAgent(dir, ["worktree", "drop", rel]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await exists(wt), false, r.output);
  });
});

Deno.test("worktree drop: refuses uncommitted changes without --force, discards with it", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "dirty-drop");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");

    const refused = await runAgent(dir, ["worktree", "drop", "dirty-drop"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "uncommitted change");
    assertStringIncludes(refused.output, "--force");
    assertEquals(await exists(wt), true, "a refusal must not remove anything");

    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "dirty-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await exists(wt), false, forced.output);
  });
});

Deno.test("worktree drop: refuses unmerged commits without --force, discards with it", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "unmerged-drop");
    await Deno.writeTextFile(join(wt, "real-work.txt"), "not landed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "unlanded work", "--no-gpg-sign");
    const unlandedTip = await gitOut(wt, "rev-parse", "HEAD");

    const refused = await runAgent(dir, ["worktree", "drop", "unmerged-drop"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "not on main");
    assertEquals(await exists(wt), true, "a refusal must not remove anything");
    assert(await branchExists(dir, "agent/unmerged-drop"));

    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "unmerged-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await exists(wt), false, forced.output);
    assertEquals(
      await branchExists(dir, "agent/unmerged-drop"),
      false,
      `the unmerged branch goes with the forced drop\n${forced.output}`,
    );
    const refs = await recoveryRefs(dir);
    assertEquals(refs.length, 1, forced.output);
    assertEquals(refs[0]?.commit, unlandedTip);

    // The ref is ordinary Git recovery evidence: recreating a branch from it
    // restores the committed file even though the original branch reflog died.
    const ref = refs[0]?.ref ?? "";
    await git(dir, "branch", "recovered-unmerged", ref);
    assertEquals(
      await gitOut(dir, "show", "recovered-unmerged:real-work.txt"),
      "not landed",
    );
  });
});

Deno.test("drop recovery refs retain the newest bounded set", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await git(dir, "branch", "agent/recovery-source");

    const written: string[] = [];
    for (let i = 0; i < DROP_RECOVERY_REF_LIMIT + 3; i++) {
      written.push(
        (await preserveDropRecoveryRef(
          dir,
          "agent/recovery-source",
          `drop-${i}`,
        ))
          .ref,
      );
    }

    const refs = await recoveryRefs(dir);
    assertEquals(refs.length, DROP_RECOVERY_REF_LIMIT);
    assert(
      refs.some((entry) => entry.ref === written.at(-1)),
      "the newest recovery ref must survive the cap",
    );
    assert(
      !refs.some((entry) => entry.ref === written[0]),
      "the oldest recovery ref must be evicted",
    );
  });
});

Deno.test("drop recovery branch deletion keeps a branch that moved after preservation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await git(dir, "branch", "agent/recovery-race");
    const preserved = await preserveDropRecoveryRef(
      dir,
      "agent/recovery-race",
      "recovery-race",
    );
    await git(dir, "switch", "agent/recovery-race");
    await Deno.writeTextFile(join(dir, "newer.txt"), "newer commit\n");
    await git(dir, "add", "newer.txt");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "move preserved branch",
      "--no-gpg-sign",
    );
    const movedTip = await gitOut(dir, "rev-parse", "agent/recovery-race");
    await git(dir, "switch", "main");

    const deletion = await deleteDropBranchAtCommit(
      dir,
      "agent/recovery-race",
      preserved.commit,
    );
    assertEquals(deletion.deleted, false);
    assertEquals(
      await gitOut(dir, "rev-parse", "agent/recovery-race"),
      movedTip,
      "a ref move after preservation must keep the newer branch tip",
    );
  });
});

Deno.test("worktree drop: an unreadable worktree is a blocker, never a silent clean", async () => {
  await withTempDir(async (dir) => {
    // The fail-open class: git cannot run inside the worktree (corrupted
    // gitlink here; dubious ownership and permission refusals are the same
    // shape), so its state is UNKNOWN — which must read as a blocker, not as
    // "clean, 0 ahead" letting drop destroy unverifiable work without consent.
    const wt = await mainWithWorktree(dir, "unreadable-drop");
    await Deno.writeTextFile(join(wt, "real-work.txt"), "not landed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "unlanded work", "--no-gpg-sign");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");
    await Deno.writeTextFile(join(wt, ".git"), "gitdir: /nonexistent/gone\n");

    const refused = await runAgent(dir, [
      "worktree",
      "drop",
      "unreadable-drop",
    ]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "could not be read");
    assertStringIncludes(refused.output, "not on main");
    assertEquals(await exists(wt), true, "a refusal must not remove anything");
    assert(
      await branchExists(dir, "agent/unreadable-drop"),
      `the unmerged branch must survive an unreadable-state drop\n${refused.output}`,
    );

    // --force is the explicit consent to discard the unverifiable state.
    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "unreadable-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await exists(wt), false, forced.output);
    assertEquals(await branchExists(dir, "agent/unreadable-drop"), false);
  });
});

Deno.test("worktree drop: a failed status read blocks even with no other blocker", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "status-failed-drop");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");

    // Leave rev-parse working while status alone fails. The branch has no
    // unlanded commits, so this unreadable status is the only possible blocker.
    const index = join(dir, ".git", "worktrees", basename(wt), "index");
    await Deno.chmod(index, 0o000);
    let refused;
    try {
      refused = await runAgent(dir, [
        "worktree",
        "drop",
        "status-failed-drop",
      ]);
    } finally {
      await Deno.chmod(index, 0o644).catch(() => undefined);
    }

    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "could not be read");
    assertEquals(
      await exists(wt),
      true,
      "unknown cleanliness must require --force before removal",
    );
  });
});

Deno.test("worktree drop: an out-of-band-deleted checkout never silently deletes an unmerged branch", async () => {
  await withTempDir(async (dir) => {
    // The user rm -rf'd the checkout to free disk; the branch keeps unlanded
    // commits and the registration is prunable. Drop without --force must
    // refuse — the fail-open snapshot default reported this as clean/0-ahead
    // and deleted the branch.
    const wt = await mainWithWorktree(dir, "vanished-drop");
    await Deno.writeTextFile(join(wt, "real-work.txt"), "not landed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "unlanded work", "--no-gpg-sign");
    await Deno.remove(wt, { recursive: true });

    const refused = await runAgent(dir, ["worktree", "drop", "vanished-drop"]);
    assertEquals(refused.code, 1, refused.output);
    assertStringIncludes(refused.output, "not on main");
    assert(
      await branchExists(dir, "agent/vanished-drop"),
      `the unmerged branch must survive\n${refused.output}`,
    );

    // Forced, the drop reclaims the stale registration and the branch.
    const forced = await runAgent(dir, [
      "worktree",
      "drop",
      "vanished-drop",
      "--force",
    ]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(await branchExists(dir, "agent/vanished-drop"), false);
  });
});

Deno.test("worktree drop: honors git worktree lock — refused even with --force", async () => {
  await withTempDir(async (dir) => {
    // `git worktree lock` protects checkouts on removable/network media (and
    // their ignored files). A locked worktree must never be bulldozed: git
    // refuses the removal, and escalating that refusal to rm -rf destroyed the
    // protected files AND stranded a permanent phantom registration (prune
    // skips locked entries).
    const wt = await mainWithWorktree(dir, "locked-drop");
    await git(dir, "worktree", "lock", wt, "--reason", "portable drive");

    for (
      const args of [
        ["worktree", "drop", "locked-drop"],
        ["worktree", "drop", "locked-drop", "--force"],
      ]
    ) {
      const r = await runAgent(dir, args);
      assertEquals(r.code, 1, r.output);
      assertStringIncludes(r.output, "locked");
      assertStringIncludes(r.output, "git worktree unlock");
      assertEquals(
        await exists(wt),
        true,
        `a locked worktree must survive\n${r.output}`,
      );
    }
    // The registration is intact too — no phantom entry pointing at a gone path.
    assertStringIncludes(await gitOut(dir, "worktree", "list"), "locked-drop");
    assert(await branchExists(dir, "agent/locked-drop"));
  });
});

Deno.test("remove-worktree-safely: the shared removal core refuses a locked worktree", async () => {
  await withTempDir(async (dir) => {
    // Every removal path (drop, accept, prune, discard) funnels through this
    // helper — the refusal here is the class guard for all of them.
    const wt = await mainWithWorktree(dir, "locked-core");
    await git(dir, "worktree", "lock", wt);

    const r = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "locked");
    assertStringIncludes(r.output, "git worktree unlock");
    assertEquals(await exists(wt), true, r.output);
    assertStringIncludes(await gitOut(dir, "worktree", "list"), "locked-core");
  });
});

Deno.test("worktree drop: tears down the worktree's recorded resources", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n' +
        "[worktree.resources.probe]\n" +
        'create = "true"\n' +
        `destroy = "touch ${dir}/destroyed.marker"\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "with-res");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    // Setup leaves generated scratch in the worktree; this test is about the
    // resource teardown, so consent to the discard explicitly.
    const r = await runAgent(dir, [
      "worktree",
      "drop",
      "with-res",
      "--force",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, "destroyed.marker")),
      `the resource destroy must run\n${r.output}`,
    );
    const result = JSON.parse(r.stdout) as {
      steps: { kind: string; label: string; outcome: string }[];
    };
    const destroy = result.steps.find((s) => s.kind === "resource-destroy");
    assertEquals(destroy?.outcome, "ok", r.stdout);
  });
});

Deno.test("worktree drop: refuses an unknown target, listing the known worktrees", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "the-only-one");
    const r = await runAgent(dir, ["worktree", "drop", "no-such-worktree"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "No worktree matches 'no-such-worktree'");
    assertStringIncludes(r.output, "the-only-one");
  });
});

Deno.test("worktree drop: refuses from inside a worktree (main-checkout-only)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "self-drop");
    const r = await runAgent(wt, ["worktree", "drop", "self-drop"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
    assertEquals(await exists(wt), true);
  });
});

Deno.test("worktree drop --dry-run: shows what a drop would discard and touches nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "preview-drop");
    await Deno.writeTextFile(join(wt, "wip.txt"), "unsaved\n");

    const r = await runAgent(dir, [
      "worktree",
      "drop",
      "preview-drop",
      "--dry-run",
    ]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Drop plan");
    assertStringIncludes(r.output, "uncommitted change");
    assertEquals(await exists(wt), true, "a dry-run must not remove anything");
    assert(await branchExists(dir, "agent/preview-drop"));
    assertEquals(await recoveryRefs(dir), [], "a dry-run must not create refs");
  });
});
