/**
 * Engine coverage for CONTAINED worktrees — the spent early stages of a
 * `start --from` train, whose committed work travels inside a live descendant
 * branch. The behaviour under test:
 *
 *  - the containment predicate: strict ancestry (equal-tip twins never
 *    qualify), a clean tree (each of staged, unstaged, and untracked work
 *    disqualifies), idleness (a fresh unmatched logbook begin disqualifies;
 *    with the logbook off, the git-derived quiet period holds), and the
 *    main checkout / the scanning checkout never qualifying;
 *  - the nearest live descendant is the container reported (A → B → C flags
 *    A as contained in B, not C);
 *  - `worktree prune` OFFERS the group but its default apply skips it — only
 *    the explicit `--contained` opt-in (plus the ordinary confirmation)
 *    reclaims, tearing resources down through the lifecycle path and NEVER
 *    deleting the branch ref;
 *  - after a reclaim, the train's remaining stages still gate and update
 *    normally.
 *
 * The predicate cases drive `scanContainedWorktrees` in-process (fast, with
 * time injectable); the prune paths shell out to the installed `agent` in a
 * hermetic git repo, so the bytes under test are the bytes an install runs.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  worktreePath,
} from "./engine_helpers.ts";
import {
  CONTAINED_QUIET_PERIOD_MS,
  type ContainedWorktree,
  containmentIdleCheck,
  scanContainedWorktrees,
} from "../src/engine/worktree/containment.ts";
import {
  lifecycleContext,
  WorktreeGitError,
  worktreeReclaimContained,
} from "../src/engine/worktree/lifecycle.ts";
import { LOGBOOK_SCHEMA_VERSION } from "../src/engine/logbook/schema.ts";
import { Logger } from "../src/lib/log.ts";

/** Commit one file in `dir` (add-all, no signing). */
async function commitFile(
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await Deno.writeTextFile(join(dir, file), content);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message, "--no-gpg-sign");
}

/** Add a worktree on a NEW branch forked from `from` (the `start --from`
 * composition shape engine_helpers' trunk-forking `addWorktree` cannot make). */
async function addWorktreeFrom(
  dir: string,
  name: string,
  from: string,
): Promise<string> {
  const path = worktreePath(dir, name);
  await git(dir, "worktree", "add", path, "-b", `agent/${name}`, from);
  return path;
}

/**
 * The `--from` train fixture: a scaffolded main repo and three staged
 * worktrees, `agent/a` forked from the trunk, `agent/b` from `agent/a`,
 * `agent/c` from `agent/b`, each one commit ahead of its parent. A and B are
 * the spent stages; C is the live tip.
 */
async function chainFixture(
  dir: string,
): Promise<{ a: string; b: string; c: string }> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  const a = await addWorktree(dir, "a");
  await commitFile(a, "a.txt", "a\n", "stage a");
  const b = await addWorktreeFrom(dir, "b", "agent/a");
  await commitFile(b, "b.txt", "b\n", "stage b");
  const c = await addWorktreeFrom(dir, "c", "agent/b");
  await commitFile(c, "c.txt", "c\n", "stage c");
  return { a, b, c };
}

/** In-process containment scan rooted at the main checkout; `idle` defaults
 * to "everything is idle" so the ancestry/cleanliness clauses test alone. */
async function scan(
  dir: string,
  opts: {
    currentPath?: string;
    idle?: (branch: string, lastActivity: number | undefined) => boolean;
  } = {},
): Promise<ContainedWorktree[]> {
  const root = await Deno.realPath(dir);
  return await scanContainedWorktrees(root, {
    mainBranch: "main",
    currentPath: opts.currentPath ?? root,
    idle: opts.idle ?? (() => true),
  });
}

/** The facts keyed by branch, for order-free assertions. */
function byBranch(
  facts: ContainedWorktree[],
): Map<string, ContainedWorktree> {
  return new Map(facts.map((f) => [f.branch, f]));
}

/** Append raw logbook lines under the main checkout's common git dir. */
async function appendLogbookLines(
  dir: string,
  lines: readonly unknown[],
): Promise<void> {
  const logDir = join(dir, ".git", "discern", "logbook");
  await Deno.mkdir(logDir, { recursive: true });
  const month = `${new Date().toISOString().slice(0, 7)}.jsonl`;
  await Deno.writeTextFile(
    join(logDir, month),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    { append: true },
  );
}

/** A fresh unmatched begin event for `branch` — in-flight work, per the
 * paired-events model. */
function beginEvent(branch: string): unknown {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: new Date(Date.now() - 60_000).toISOString(),
    kind: "begin",
    invocation: `inv-${branch}`,
    verb: "done",
    surface: "cli",
    driver: {},
    branch,
    head: null,
    epoch: null,
  };
}

/** The repo's local branch names via a hermetic git call. */
async function branchList(dir: string): Promise<string> {
  return await gitOut(
    dir,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  );
}

// ── the containment predicate ────────────────────────────────────────────────

Deno.test("containment: spent train stages are flagged with their NEAREST descendant; the tip and the checkouts outside the train are not", async () => {
  await withTempDir(async (dir) => {
    await chainFixture(dir);
    const facts = byBranch(await scan(dir));

    // A and B are contained; each reports the nearest live descendant.
    assertEquals([...facts.keys()].sort(), ["agent/a", "agent/b"]);
    assertEquals(facts.get("agent/a")?.containingBranch, "agent/b");
    assertEquals(facts.get("agent/b")?.containingBranch, "agent/c");
    // The evidence carries the shas and the container's lead, so a human
    // confirms against facts rather than a bare name.
    assertEquals(facts.get("agent/a")?.containerAhead, 1);
    const tipA = await gitOut(dir, "rev-parse", "refs/heads/agent/a");
    assertEquals(facts.get("agent/a")?.tip, tipA);
    // The main checkout never appears — even though `main`'s tip IS a strict
    // ancestor of every stage's tip.
    assert(!facts.has("main"), "the main checkout must never be a candidate");
  });
});

// Each kind of uncommitted work must disqualify on its own: uncommitted work
// is not contained anywhere.
const DIRTY_CASES: Record<string, (wt: string) => Promise<void>> = {
  "staged work disqualifies": async (wt) => {
    await Deno.writeTextFile(join(wt, "staged.txt"), "staged\n");
    await git(wt, "add", "-A");
  },
  "unstaged tracked changes disqualify": async (wt) => {
    await Deno.writeTextFile(join(wt, "a.txt"), "edited\n");
  },
  "untracked files disqualify": async (wt) => {
    await Deno.writeTextFile(join(wt, "scratch.txt"), "notes\n");
  },
};

for (const [name, dirty] of Object.entries(DIRTY_CASES)) {
  Deno.test(`containment: ${name}`, async () => {
    await withTempDir(async (dir) => {
      const { a } = await chainFixture(dir);
      await dirty(a);
      const facts = byBranch(await scan(dir));
      assert(
        !facts.has("agent/a"),
        "a dirty stage must not be offered — uncommitted work is not contained",
      );
      assert(facts.has("agent/b"), "the clean sibling stage is still flagged");
    });
  });
}

Deno.test("containment: an equal-tip twin is ambiguous, never contained", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const a = await addWorktree(dir, "a");
    await commitFile(a, "a.txt", "a\n", "stage a");
    // A second worktree parked at exactly A's tip: neither is strictly ahead,
    // so neither can prove the other redundant.
    await addWorktreeFrom(dir, "twin", "agent/a");
    assertEquals(await scan(dir), []);
  });
});

Deno.test("containment: the scanning checkout is never a candidate", async () => {
  await withTempDir(async (dir) => {
    const { a } = await chainFixture(dir);
    const facts = byBranch(
      await scan(dir, { currentPath: await Deno.realPath(a) }),
    );
    assert(
      !facts.has("agent/a"),
      "the checkout running the scan must never offer itself",
    );
    assert(facts.has("agent/b"), "other stages are still flagged");
  });
});

Deno.test("containment: with the logbook off, the git-derived quiet period gates the offer", async () => {
  await withTempDir(async (dir) => {
    await chainFixture(dir);
    // Fresh commits: the checkouts are active within the quiet period, so a
    // logbook-off install offers nothing yet…
    const active = await scan(dir, {
      idle: containmentIdleCheck(undefined, Date.now()),
    });
    assertEquals(
      active,
      [],
      "activity within the quiet period must withhold the offer",
    );
    // …and the same fleet is offered once the quiet period has passed.
    const later = Date.now() + CONTAINED_QUIET_PERIOD_MS + 60_000;
    const quiet = byBranch(
      await scan(dir, { idle: containmentIdleCheck(undefined, later) }),
    );
    assertEquals([...quiet.keys()].sort(), ["agent/a", "agent/b"]);
  });
});

Deno.test("containment: an in-flight verb (a fresh unmatched begin) withholds the stage from the prune offer", async () => {
  await withTempDir(async (dir) => {
    await chainFixture(dir);
    // Stage A is mid-verb: its begin event has no paired completion, so the
    // offer's conservatism keeps it out while stage B is still flagged. The
    // logbook only narrows the OFFER — the human confirmation stays the only
    // thing that ever authorizes a reclaim.
    await appendLogbookLines(dir, [beginEvent("agent/a")]);
    const r = await runAgent(dir, ["worktree", "prune", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const plan = JSON.parse(r.stdout.trim()) as {
      plan: {
        steps: Array<{ label: string; group?: string; disposition: string }>;
      };
    };
    const contained = plan.plan.steps.filter(
      (s) => s.group === "Contained worktrees",
    );
    assertEquals(
      contained.map((s) => basename(s.label)).sort(),
      ["b"],
      `an in-flight stage must not be offered\n${r.stdout}`,
    );
    assert(
      contained.every((s) => s.disposition === "skip"),
      "without --contained the group is an offer, never a change",
    );
  });
});

// ── the prune offer and the explicit reclaim ─────────────────────────────────

Deno.test("worktree prune leaves contained worktrees untouched by default and keeps the offer visible", async () => {
  await withTempDir(async (dir) => {
    const { a, b, c } = await chainFixture(dir);

    const human = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(human.code, 0, human.output);
    assert(
      await exists(a),
      "the default apply must not touch a contained checkout",
    );
    assert(
      await exists(b),
      "the default apply must not touch a contained checkout",
    );
    assert(await exists(c));
    assertStringIncludes(human.output, "Contained worktrees (kept)");
    assertStringIncludes(human.output, "--contained");

    const json = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(json.code, 0, json.output);
    const result = JSON.parse(json.stdout.trim()) as {
      steps: Array<{ label: string; group?: string; outcome: string }>;
    };
    const contained = result.steps.filter(
      (s) => s.group === "Contained worktrees",
    );
    assertEquals(
      contained.map((s) => basename(s.label)).sort(),
      ["a", "b"],
      json.stdout,
    );
    assert(
      contained.every((s) => s.outcome === "skipped"),
      "the machine result reports the offer as explicit skips",
    );
    const branches = await branchList(dir);
    for (const kept of ["agent/a", "agent/b", "agent/c", "main"]) {
      assert(branches.includes(kept), `${kept} must survive\n${branches}`);
    }
  });
});

Deno.test("worktree prune --contained still requires the explicit confirmation off-TTY", async () => {
  await withTempDir(async (dir) => {
    const { a } = await chainFixture(dir);
    const r = await runAgent(dir, ["worktree", "prune", "--contained"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Confirmation required");
    assert(
      await exists(a),
      `the flag alone must never reclaim — a fresh confirmation does\n${r.output}`,
    );
  });
});

Deno.test("worktree prune --contained reclaims the checkout through the resource lifecycle and keeps the branch ref; the train stays healthy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const markers = join(dir, "markers");

    // Stage A declares an external resource (committed so the tree stays
    // clean), and worktree setup provisions it — the ledger entry the reclaim
    // must destroy through the lifecycle path, never a raw removal.
    const a = await addWorktree(dir, "a");
    const cfg = await Deno.readTextFile(join(a, "discern.toml"));
    await Deno.writeTextFile(
      join(a, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live && touch ${markers}/@resource@.gone"\n`,
    );
    // Normalize the appended section to the tidy format first, so the train's
    // later gate run doesn't flag the fixture's own formatting as drift.
    const tidy = await runAgent(a, ["tidy"]);
    assertEquals(tidy.code, 0, tidy.output);
    await git(a, "add", "-A");
    await git(a, "commit", "-q", "-m", "declare resource", "--no-gpg-sign");
    const setup = await runAgent(a, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    const handle = (await runAgent(a, ["identity", "--resource", "thing"]))
      .stdout.trim();
    assert(
      await exists(join(markers, `${handle}.live`)),
      `setup must create the resource\n${setup.output}`,
    );
    // Setup materializes agent files the hermetic scaffold does not gitignore
    // (a real install ignores them); commit them so the stage is clean, the
    // way containment demands.
    await git(a, "add", "-A");
    await git(a, "commit", "-q", "-m", "materialized files", "--no-gpg-sign");
    assertEquals(
      (await gitOut(a, "status", "--porcelain")).trim(),
      "",
      "the fixture stage must be clean for containment to hold",
    );

    // Stage B builds on A — the tip that carries A's work.
    const b = await addWorktreeFrom(dir, "b", "agent/a");
    await commitFile(b, "b.txt", "b\n", "stage b");

    const r = await runAgent(dir, [
      "worktree",
      "prune",
      "--contained",
      "--yes",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout.trim()) as {
      steps: Array<
        { label: string; group?: string; note?: string; outcome: string }
      >;
    };
    const reclaimed = result.steps.filter(
      (s) => s.group === "Contained worktrees" && s.outcome === "ok",
    );
    assertEquals(reclaimed.length, 1, r.stdout);
    assertStringIncludes(reclaimed[0]?.note ?? "", "kept branch agent/a");

    // The checkout is gone; the resource was destroyed via its ledger command.
    assertEquals(await exists(a), false, "the checkout must be reclaimed");
    assert(
      await exists(join(markers, `${handle}.gone`)),
      "the resource must be destroyed through the lifecycle path",
    );
    assert(
      !(await exists(join(markers, `${handle}.live`))),
      "the live marker must be gone",
    );

    // The branch ref SURVIVES, still reachable and still contained in B.
    const branches = await branchList(dir);
    assert(branches.includes("agent/a"), `the ref must be kept\n${branches}`);
    const stillContained = await gitOut(
      dir,
      "merge-base",
      "--is-ancestor",
      "agent/a",
      "agent/b",
    ).then(() => true, () => false);
    assert(stillContained, "agent/a must remain an ancestor of agent/b");
    const lead = await gitOut(dir, "rev-list", "--count", "agent/a..agent/b");
    assertEquals(lead.trim(), "1", "B still carries A's work plus its own");

    // The train's remaining stage still updates and gates normally.
    const update = await runAgent(b, ["update"]);
    assertEquals(update.code, 0, update.output);
    const done = await runAgent(b, ["done"]);
    assertEquals(done.code, 0, done.output);
  });
});

// ── the per-worktree core the desk action runs ───────────────────────────────

Deno.test("worktreeReclaimContained reclaims one validated stage and refuses a non-candidate", async () => {
  await withTempDir(async (dir) => {
    const { a, b } = await chainFixture(dir);
    const root = await Deno.realPath(dir);
    const ctx = await lifecycleContext(
      root,
      new Logger({ json: true, noColor: true }),
    );

    // A non-candidate refuses with the predicate named: B is dirty now.
    await Deno.writeTextFile(join(b, "wip.txt"), "in flight\n");
    let refused: unknown;
    try {
      await worktreeReclaimContained(ctx, basename(b));
    } catch (e) {
      refused = e;
    }
    assert(
      refused instanceof WorktreeGitError,
      "a dirty stage must refuse, never reclaim",
    );
    assert(await exists(b), "a refused target is left untouched");

    // The validated stage reclaims: checkout gone, ref kept.
    const fact = await worktreeReclaimContained(ctx, basename(a));
    assertEquals(fact.branch, "agent/a");
    assertEquals(fact.containingBranch, "agent/b");
    assertEquals(await exists(a), false);
    assert((await branchList(dir)).includes("agent/a"), "the ref must be kept");
  });
});
