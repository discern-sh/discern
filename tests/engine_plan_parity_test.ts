/**
 * The ARCHITECTURAL guard for the plan/apply class (ADR 0027): for every effectful
 * verb, **every effect the apply path produces must have been listed in the
 * dry-run plan**. This is the invariant whose violation was the catastrophic bug —
 * `worktree prune --dry-run` reported "nothing to do" while the real run removed
 * worktrees and branches. Here it is a GATE FAILURE, not a code comment.
 *
 * The check is `applied ⊆ planned` (by `kind:label`), the safety direction: apply
 * may never act outside the preview. It is disposition-agnostic (a planned step
 * marked `skip` is still in the plan, so an apply that runs it does not violate the
 * subset) and it catches the original bug head-on: an empty/under-populated plan
 * with non-empty applied effects fails the subset.
 *
 * Each verb runs `--dry-run --json` first (which mutates nothing), then `--json`
 * (apply) on the SAME fixture, so the two see identical state.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

function parse(stdout: string): Json {
  return JSON.parse(stdout.trim());
}

/** Every step listed in a `--dry-run --json` plan, as a `kind:label` set. */
function plannedSet(dryStdout: string): Set<string> {
  const obj = parse(dryStdout);
  const steps: Json[] = obj.plan?.steps ?? [];
  return new Set(steps.map((s) => `${s.kind}:${s.label}`));
}

/** Every step the apply `--json` actually executed (outcome ≠ skipped), as `kind:label`. */
function appliedSet(applyStdout: string): Set<string> {
  const obj = parse(applyStdout);
  const steps: Json[] = obj.steps ?? [];
  return new Set(
    steps.filter((s) => s.outcome !== "skipped").map((s) =>
      `${s.kind}:${s.label}`
    ),
  );
}

/** Assert the apply executed nothing the dry-run plan did not list. */
function assertAppliedSubsetOfPlanned(
  dryStdout: string,
  applyStdout: string,
  label: string,
): void {
  const planned = plannedSet(dryStdout);
  const applied = appliedSet(applyStdout);
  const escaped = [...applied].filter((s) => !planned.has(s));
  assertEquals(
    escaped,
    [],
    `${label}: apply executed steps the dry-run plan never listed (preview lied by omission): ` +
      `${JSON.stringify(escaped)}\nplanned=${
        JSON.stringify([...planned])
      }\napplied=${JSON.stringify([...applied])}`,
  );
}

async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

Deno.test("parity: worktree prune apply removes nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    // A live, clean, fully-merged worktree → a real removal candidate.
    const wt = await mainWithWorktree(dir, "parityvictim");
    await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge", "agent/parityvictim");

    const dry = await runAgent(dir, [
      "worktree",
      "prune",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    // The fixture has real work, so the applied set is non-empty — which, under the
    // subset invariant, forces the plan to have listed it (the original bug fails here).
    assert(appliedSet(apply.stdout).size > 0, "fixture produced no removals");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "prune");
  });
});

Deno.test("parity: worktree prune apply consumes the built scan instead of re-scanning", async () => {
  const lifecycle = await Deno.readTextFile("src/engine/worktree/lifecycle.ts");
  assertStringIncludes(
    lifecycle,
    "pruneGitWorktrees(plan.gitScan",
    "prune apply must consume the git scan stored in its plan",
  );
  assertStringIncludes(
    lifecycle,
    "sweepOrphanWorktrees(plan.orphanScan",
    "prune apply must consume the orphan scan stored in its plan",
  );
  assertStringIncludes(
    lifecycle,
    "plan.resourceReclaims",
    "prune apply must consume the resource reclaim entries stored in its plan",
  );
  assert(
    !lifecycle.includes("pruneGitWorktrees({"),
    "prune apply must not rebuild git prune options and re-scan",
  );
  assert(
    !lifecycle.includes("sweepOrphanWorktrees({"),
    "prune apply must not rebuild orphan sweep options and re-scan",
  );

  const gitLayer = await Deno.readTextFile("src/engine/worktree/git.ts");
  assertStringIncludes(gitLayer, "scanGitWorktreesForPrune");
  assertStringIncludes(gitLayer, "scanOrphanWorktreesForSweep");
  assert(
    !gitLayer.includes("dryRun?: boolean"),
    "git prune/sweep helpers should not have dry/wet branches to keep in sync",
  );
});

Deno.test("parity: every destructive scan-consuming apply re-validates candidates at apply time", async () => {
  // The prune plan can sit at a confirmation prompt for minutes while agents
  // keep working in the candidate worktrees, so a scan-consuming apply that
  // trusts its scan's eligibility verdict destroys work created in the window
  // (the original bug: pruneGitWorktrees force-removed a worktree that gained
  // uncommitted edits after the scan). The discipline: every destructive
  // primitive in a scan-consuming apply pairs with an apply-time re-check of
  // the condition the scan judged. This guard enumerates the scan-consuming
  // functions from the source itself — a NEW apply auto-enrols — and requires
  // the pairing per destructive primitive. It proves presence of the re-check,
  // not its placement; the behavioral race tests in
  // engine_worktree_prune_test.ts pin what the re-check must actually do.
  const source = await Deno.readTextFile("src/engine/worktree/git.ts");

  // Every top-level function whose first parameter is one of the scan shapes.
  const declRe =
    /(?:export )?(?:async )?function (\w+)\(\s*scan: (?:GitWorktreePruneScan|OrphanWorktreeSweepScan)\b/g;
  const nextDeclRe = /\n(?:export )?(?:async )?function |\n\/\*\*/g;
  const bodies = new Map<string, string>();
  for (const m of source.matchAll(declRe)) {
    const start = (m.index ?? 0) + m[0].length;
    nextDeclRe.lastIndex = start;
    const next = nextDeclRe.exec(source);
    bodies.set(m[1] ?? "", source.slice(start, next?.index ?? source.length));
  }
  for (
    const expected of [
      "pruneGitWorktrees",
      "sweepOrphanWorktrees",
      "pruneStaleWorktreeMetadata",
    ]
  ) {
    assert(
      bodies.has(expected),
      `scan-consuming apply enumeration lost ${expected} — fix the guard's regex`,
    );
  }

  // destructive primitive → the apply-time re-check that must accompany it.
  const pairings: [needle: string, recheck: RegExp, rule: string][] = [
    [
      "removeWorktreeSafely(",
      /CandidateChanged\(/,
      "a worktree/orphan removal must re-check the candidate against live state",
    ],
    [
      '"-D"',
      /branchIsMerged\(/,
      "a branch deletion must re-check merged-ness at apply time",
    ],
    [
      "Deno.remove(",
      /StillMatches\(/,
      "a metadata prune must re-read the admin entry at apply time",
    ],
  ];
  for (const [name, body] of bodies) {
    for (const [needle, recheck, rule] of pairings) {
      if (!body.includes(needle)) {
        continue;
      }
      assert(
        recheck.test(body),
        `${name} uses ${needle} without an apply-time re-check: ${rule}`,
      );
    }
  }
});

Deno.test("parity: worktree teardown apply destroys nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "parityteardown");
    const markers = join(dir, "markers");
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "rm -f ${markers}/@resource@.live"\n`,
    );
    assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);

    const dry = await runAgent(wt, [
      "worktree",
      "teardown",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["worktree", "teardown", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture destroyed nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "teardown");
  });
});

Deno.test("parity: accept apply does nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "paritygrad");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const dry = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["accept", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture landed nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "accept");
  });
});

Deno.test("parity: worktree setup apply runs nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "paritysetup");

    const dry = await runAgent(wt, [
      "worktree",
      "setup",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture set up nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "setup");
  });
});

Deno.test("parity: integrate apply merges nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "parityintegrate");
    // Advance main after the branch forked → the worktree is behind, so integrate
    // has real work (a fast-forward/merge) and a non-empty applied set.
    await Deno.writeTextFile(join(dir, "up.txt"), "up\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const dry = await runAgent(wt, ["integrate", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["integrate", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture integrated nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "integrate");
  });
});

Deno.test("parity: start apply creates nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    // start runs from the MAIN checkout and mints a fresh worktree — a full apply.
    await scaffoldEngine(dir);
    await gitInit(dir);

    const dry = await runAgent(dir, ["start", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(dir, ["start", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture started nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "start");
  });
});
