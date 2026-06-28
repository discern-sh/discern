/**
 * Receipt-gated graduate (ADR 0067). `graduate` lands only a tree that passes the WHOLE
 * gate — closing the stale-finish hole: an agent finishes green, main advances beneath it
 * while it waits for review, it `integrate`s (a clean merge), then graduates — landing a
 * MERGED tree its earlier `finish` never saw. The merge can break the gate semantically
 * (a clean textual merge that still fails a check), and a local `graduate --to trunk`
 * fast-forwards it onto the trunk where CI never runs.
 *
 * Two layers: the gate-pass RECEIPT primitive (the per-worktree marker `finish` stamps and
 * `graduate` honors), then the wired behaviour — the regression itself (a gate-breaking
 * integrate is refused), the receipt FAST PATH (a fresh `finish` lets graduate skip the
 * re-run — the perf property that makes running the gate at the boundary affordable), and
 * the airtight SLOW PATH (no/stale receipt → graduate runs the gate itself).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  gateReceiptHonored,
  recordGateOutcome,
} from "../src/engine/gate/receipt.ts";

/** A check-stage gate that fails iff `taboo.txt` exists — a deterministic stand-in for
 * "the merged tree breaks a check". guidance/skills off so the check is the only gate. */
const CONFIG_CHECK = [
  "[project]",
  'slug = "engine-test"',
  'main_branch = "main"',
  "",
  "[features]",
  "guidance = false",
  "skills = false",
  "",
  "[capabilities]",
  'lint = "sh check.sh"',
  "",
].join("\n");

/** The check command: exit non-zero iff a `taboo.txt` is present in the tree. */
const CHECK_NO_TABOO = [
  "#!/usr/bin/env sh",
  "test ! -e taboo.txt",
  "",
].join("\n");

/** Scaffold a main repo wired with the taboo check, committed clean (gate green). */
async function mainWithCheck(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG_CHECK);
  await writeExecutable(join(dir, "check.sh"), CHECK_NO_TABOO);
  await gitInit(dir);
}

/** Commit `feature.txt` onto the worktree branch — the branch's own (gate-passing) work. */
async function commitBranchWork(wt: string): Promise<void> {
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
}

/** Commit a file onto `main` directly — another line of work landing beneath the branch. */
async function advanceMain(dir: string, file: string): Promise<void> {
  await Deno.writeTextFile(join(dir, file), "landed elsewhere\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `chore: add ${file}`, "--no-gpg-sign");
}

// ── the receipt primitive ───────────────────────────────────────────────────────

Deno.test("receipt: a green+clean finish stamps HEAD, and gateReceiptHonored confirms it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    assertEquals(await gateReceiptHonored(dir), false); // nothing stamped yet
    await recordGateOutcome(dir, true);
    assertEquals(await gateReceiptHonored(dir), true);
  });
});

Deno.test("receipt: a new commit invalidates a stamped receipt (the integrate case, isolated)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGateOutcome(dir, true);
    assertEquals(await gateReceiptHonored(dir), true);
    // A later commit moves HEAD past the validated sha — exactly what integrate's merge does.
    await Deno.writeTextFile(join(dir, "x.txt"), "x\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "x", "--no-gpg-sign");
    assertEquals(await gateReceiptHonored(dir), false);
  });
});

Deno.test("receipt: an uncommitted change invalidates a stamped receipt", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGateOutcome(dir, true);
    assertEquals(await gateReceiptHonored(dir), true);
    await Deno.writeTextFile(join(dir, "dirty.txt"), "dirty\n"); // untracked → not clean
    assertEquals(await gateReceiptHonored(dir), false);
  });
});

Deno.test("receipt: a failed finish clears an existing receipt (fail-closed)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGateOutcome(dir, true);
    assertEquals(await gateReceiptHonored(dir), true);
    await recordGateOutcome(dir, false); // a later failing gate revokes the vouch
    assertEquals(await gateReceiptHonored(dir), false);
  });
});

Deno.test("receipt: a green-but-dirty finish leaves a prior clean receipt intact", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGateOutcome(dir, true); // stamped at clean HEAD C
    await Deno.writeTextFile(join(dir, "wip.txt"), "wip\n"); // tree now dirty
    await recordGateOutcome(dir, true); // green+dirty → must NOT overwrite/clear the vouch
    assertEquals(await gateReceiptHonored(dir), false); // dirty → not honored right now
    await Deno.remove(join(dir, "wip.txt")); // back to clean C
    assertEquals(await gateReceiptHonored(dir), true); // the prior clean vouch still holds
  });
});

// ── the regression: a gate-breaking integrate cannot land ────────────────────────

Deno.test("graduate: refuses an integrate that merges cleanly but breaks the gate (the stale-finish hole)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "gamma");
    await commitBranchWork(wt);

    // The agent finishes green as the branch stands (records a receipt at this HEAD).
    const green = await runAgent(wt, ["finish", "--json"]);
    assertEquals(green.code, 0, green.output);

    // Meanwhile main advances with a change that breaks the branch's gate but merges
    // cleanly — a brand-new file the branch never touched (no textual conflict).
    await advanceMain(dir, "taboo.txt");

    // The agent integrates: a clean merge, but the receipt is now stale (new merge commit).
    const integ = await runAgent(wt, ["integrate"]);
    assertEquals(integ.code, 0, integ.output);

    // Graduating MUST refuse — the merged tree was never validated, and it fails the gate.
    const grad = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(grad.code, 1, grad.output);
    assertStringIncludes(grad.output, "does not pass");
    // Non-destructive: the worktree survives and the branch's work never reached the trunk.
    assertEquals(
      await exists(wt),
      true,
      `worktree must survive\n${grad.output}`,
    );
    assertEquals(
      await exists(join(dir, "feature.txt")),
      false,
      "the branch's work must not fast-forward onto the trunk unvalidated",
    );
  });
});

Deno.test("graduate: an integrate that still passes the gate lands normally", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "delta");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["finish", "--json"])).code, 0);

    // Main advances with a BENIGN file — the merged tree still passes the gate.
    await advanceMain(dir, "notes.txt");
    assertEquals((await runAgent(wt, ["integrate"])).code, 0);

    const grad = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(grad.code, 0, grad.output);
    // The receipt was stale (merge commit), so graduate validated the merged tree itself…
    assertStringIncludes(
      grad.output,
      "Validating the branch against the full gate",
    );
    // …and, green, landed it: the worktree is gone and the branch's work is on the trunk.
    assertEquals(await exists(wt), false, `should have landed\n${grad.output}`);
    assert(
      await exists(join(dir, "feature.txt")),
      "branch work should be on the trunk",
    );
  });
});

// ── the fast path: a fresh finish makes graduate cheap ───────────────────────────

Deno.test("graduate: a fresh `finish` lets graduate skip the gate re-run (receipt fast path)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "epsilon");
    await commitBranchWork(wt);

    // The agent finishes (records a receipt at this exact, clean HEAD)…
    assertEquals((await runAgent(wt, ["finish", "--json"])).code, 0);

    // …so graduate trusts it and does NOT re-run the gate (the no-double-run guarantee).
    const grad = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(grad.code, 0, grad.output);
    assertStringIncludes(grad.output, "already passed the gate at this commit");
    assertEquals(
      grad.output.includes("Validating the branch against the full gate"),
      false,
      `the gate must NOT re-run when the receipt is valid\n${grad.output}`,
    );
    assertEquals(await exists(wt), false, `should have landed\n${grad.output}`);
  });
});

Deno.test("graduate: with no prior `finish`, graduate runs the gate itself before landing", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "zeta");
    await commitBranchWork(wt); // committed, but the agent never ran `finish` → no receipt

    const grad = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(grad.code, 0, grad.output);
    assertStringIncludes(
      grad.output,
      "Validating the branch against the full gate",
    );
    assertEquals(await exists(wt), false, `should have landed\n${grad.output}`);
  });
});

Deno.test("graduate: a commit made after `finish` invalidates the receipt (gate re-runs)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "eta");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["finish", "--json"])).code, 0); // receipt at C

    // A further commit moves HEAD past the receipt — graduate must re-validate, not trust it.
    await Deno.writeTextFile(join(wt, "more.txt"), "more\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "more", "--no-gpg-sign");

    const grad = await runAgent(wt, ["graduate", "--to", "trunk"]);
    assertEquals(grad.code, 0, grad.output);
    assertStringIncludes(
      grad.output,
      "Validating the branch against the full gate",
    );
    assertEquals(
      grad.output.includes("already passed the gate at this commit"),
      false,
      `a stale receipt must not be honored\n${grad.output}`,
    );
  });
});
