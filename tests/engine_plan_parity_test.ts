/**
 * The ARCHITECTURAL guard for the plan/apply class (ADR 0027): for every effectful
 * verb, **every effect the apply path produces must have been listed in the
 * dry-run plan**. This is the invariant whose violation was the catastrophic bug —
 * `worktree:prune --dry-run` reported "nothing to do" while the real run removed
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

import { assert, assertEquals } from "@std/assert";
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

Deno.test("parity: worktree:prune apply removes nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    // A live, clean, fully-merged worktree → a real removal candidate.
    const wt = await mainWithWorktree(dir, "parityvictim");
    await Deno.writeTextFile(join(wt, "m.txt"), "m\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge", "agent/parityvictim");

    const dry = await runAgent(dir, ["worktree:prune", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(dir, ["worktree:prune", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    // The fixture has real work, so the applied set is non-empty — which, under the
    // subset invariant, forces the plan to have listed it (the original bug fails here).
    assert(appliedSet(apply.stdout).size > 0, "fixture produced no removals");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "prune");
  });
});

Deno.test("parity: worktree:teardown apply destroys nothing the dry-run didn't list", async () => {
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
    assertEquals((await runAgent(wt, ["worktree"])).code, 0);

    const dry = await runAgent(wt, [
      "worktree:teardown",
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["worktree:teardown", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture destroyed nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "teardown");
  });
});

Deno.test("parity: graduate apply does nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "paritygrad");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const dry = await runAgent(wt, ["graduate", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["graduate", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture graduated nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "graduate");
  });
});

Deno.test("parity: worktree setup apply runs nothing the dry-run didn't list", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "paritysetup");

    const dry = await runAgent(wt, ["worktree", "--dry-run", "--json"]);
    assertEquals(dry.code, 0, dry.output);
    const apply = await runAgent(wt, ["worktree", "--json"]);
    assertEquals(apply.code, 0, apply.output);

    assert(appliedSet(apply.stdout).size > 0, "fixture set up nothing");
    assertAppliedSubsetOfPlanned(dry.stdout, apply.stdout, "setup");
  });
});
