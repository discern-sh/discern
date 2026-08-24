/**
 * Proof-gated accept (ADR 0067). `accept` lands only a tree that passes the WHOLE
 * gate — closing the stale-finish hole: an agent finishes green, main advances beneath it
 * while it waits for review, it `update`s (a clean merge), then accepts — landing a
 * MERGED tree its earlier `done` never saw. The merge can break the gate semantically
 * (a clean textual merge that still fails a check), and a local `accept`
 * fast-forwards it onto the trunk where CI never runs.
 *
 * Two layers: the gate proof primitive (the per-worktree marker `done` stamps and
 * `accept` honors), then the wired behaviour — the regression itself (a gate-breaking
 * update is refused), the proof FAST PATH (a fresh `done` lets accept skip the
 * re-run — the perf property that makes running the gate at the boundary affordable), and
 * the airtight SLOW PATH (no/stale proof → accept runs the gate itself).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { HINTS } from "../src/shared/hints.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  type AdminStateWriteAuthority,
  gateProofHonored,
  inspectGateProof,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
} from "../src/engine/gate/proof.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import type { Proof } from "../src/shared/result_schemas.ts";

/** Run the real admin-state preflight and expose its proven write capability to proof tests. */
async function proofAuthority(
  dir: string,
): Promise<AdminStateWriteAuthority> {
  const preflight = await preflightAdminStateWrites(dir);
  assert(
    preflight.ok,
    `proof preflight failed: ${JSON.stringify(preflight)}`,
  );
  return preflight.authority;
}

/** Record a green outcome with a pin captured NOW — the "nothing raced the gate"
 * shorthand the proof-primitive tests below use. */
async function recordGreenNow(
  dir: string,
): ReturnType<typeof recordGateOutcome> {
  return await recordGateOutcome(
    dir,
    await proofAuthority(dir),
    true,
    await pinValidatedTree(dir),
  );
}

/** A check-stage gate that fails iff `taboo.txt` exists — a deterministic stand-in for
 * "the merged tree breaks a check". instructions/skills off so the check is the only gate. */
const CONFIG_CHECK = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
].join("\n");

/** The check command: exit non-zero iff a `taboo.txt` is present in the tree. */
const CHECK_NO_TABOO = [
  "#!/usr/bin/env sh",
  "test ! -e taboo.txt",
  "",
].join("\n");

/** Decode acceptance or gate output for proof and refusal assertions. */
// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

/** Every successful acceptance path carries the bounded line an agent relays. */
// deno-lint-ignore no-explicit-any
function assertLandingProofRelay(obj: any, branch: string): void {
  assertEquals(obj.data.proof, undefined);
  assertEquals(typeof obj.data.proof_line, "string");
  assertStringIncludes(
    obj.data.proof_line,
    `Proof: gate passed on agent/${branch} @ `,
  );
  const relayHint = assertHasHint(
    obj,
    HINTS["accept-relay-landing-proof"],
  );
  assertStringIncludes(relayHint, "Proof line");
  assertStringIncludes(relayHint, "verbatim");
}

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

/** Commit all current fixture state, allowing an empty commit to establish a new accepted HEAD. */
async function commitCurrentWorktree(
  wt: string,
  message = "chore: clean updated tree",
): Promise<void> {
  await git(wt, "add", "-A");
  await git(
    wt,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
    "--no-gpg-sign",
  );
}

/** Commit a file onto `main` directly — another line of work landing beneath the branch. */
async function advanceMain(dir: string, file: string): Promise<void> {
  await Deno.writeTextFile(join(dir, file), "landed elsewhere\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `chore: add ${file}`, "--no-gpg-sign");
}

// ── the proof primitive ───────────────────────────────────────────────────────

Deno.test("proof: a green+clean finish stamps HEAD, and gateProofHonored confirms it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    assertEquals(await gateProofHonored(dir), false); // nothing stamped yet
    assertEquals((await recordGreenNow(dir)).status, "recorded");
    assertEquals(await gateProofHonored(dir), true);
  });
});

Deno.test("proof: a pre-correction marker drops runtime telemetry", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const pin = await pinValidatedTree(dir);
    assert(pin.head !== undefined);
    const proof: Proof = {
      branch: "agent/legacy-marker",
      trunk: "main",
      head: pin.head.slice(0, 12),
      files_total: 1,
      insertions: 1,
      deletions: 0,
      line: "Proof for agent/legacy-marker",
      markdown: "### Proof for agent/legacy-marker",
    };
    const preCorrection = {
      ...proof,
      waited_ms: 70_000,
      orbit_delay: 42,
    } as Proof & { waited_ms: number; orbit_delay: number };

    const recorded = await recordGateOutcome(
      dir,
      await proofAuthority(dir),
      true,
      pin,
      preCorrection,
    );
    assertEquals(recorded.status, "recorded");
    assertEquals((await inspectGateProof(dir)).proof_data, proof);
  });
});

Deno.test("proof: a failed stamp is visible to the caller", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const proofPath = await gitAdminStatePath(dir, "gateProof");
    assert(proofPath !== undefined, "expected a Git repository");
    // Authority was available at workflow start; the path changes afterwards to
    // exercise the writer's best-effort TOCTOU fallback.
    const authority = await proofAuthority(dir);
    await Deno.mkdir(proofPath);

    const proof = await recordGateOutcome(
      dir,
      authority,
      true,
      await pinValidatedTree(dir),
    );
    assertEquals(proof.status, "record_failed");
    assertEquals(proof.path, proofPath);
    assert(
      proof.reason !== undefined && proof.reason.length > 0,
      `expected a useful failure reason: ${JSON.stringify(proof)}`,
    );
    assertEquals(await gateProofHonored(dir), false);
  });
});

Deno.test("proof: a new commit invalidates a stamped proof (the update case, isolated)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGreenNow(dir);
    assertEquals(await gateProofHonored(dir), true);
    // A later commit moves HEAD past the validated sha — exactly what update's merge does.
    await Deno.writeTextFile(join(dir, "x.txt"), "x\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "x", "--no-gpg-sign");
    assertEquals(await gateProofHonored(dir), false);
  });
});

Deno.test("proof: an uncommitted change invalidates a stamped proof", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGreenNow(dir);
    assertEquals(await gateProofHonored(dir), true);
    await Deno.writeTextFile(join(dir, "dirty.txt"), "dirty\n"); // untracked → not clean
    assertEquals(await gateProofHonored(dir), false);
  });
});

Deno.test("proof: a failed finish clears an existing proof (fail-closed)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGreenNow(dir);
    assertEquals(await gateProofHonored(dir), true);
    await recordGateOutcome(
      dir,
      await proofAuthority(dir),
      false,
      await pinValidatedTree(dir),
    ); // a later failing gate revokes the vouch
    assertEquals(await gateProofHonored(dir), false);
  });
});

Deno.test("proof: a green-but-dirty finish leaves a prior clean proof intact", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGreenNow(dir); // stamped at clean HEAD C
    await Deno.writeTextFile(join(dir, "wip.txt"), "wip\n"); // tree now dirty
    await recordGreenNow(dir); // green+dirty → must NOT overwrite/clear the vouch
    assertEquals(await gateProofHonored(dir), false); // dirty → not honored right now
    await Deno.remove(join(dir, "wip.txt")); // back to clean C
    assertEquals(await gateProofHonored(dir), true); // the prior clean vouch still holds
  });
});

Deno.test("proof: a commit made while the gate ran is never stamped (the pin catches it)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The gate pins the tree at run start…
    const pin = await pinValidatedTree(dir);
    // …then a commit lands mid-run (an agent or its user in another terminal).
    await Deno.writeTextFile(join(dir, "mid.txt"), "mid-run commit\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "mid-run", "--no-gpg-sign");
    // The green outcome describes the PINNED tree, not the new HEAD — no vouch.
    const rec = await recordGateOutcome(
      dir,
      await proofAuthority(dir),
      true,
      pin,
    );
    assertEquals(rec.status, "skipped_head_moved");
    assert(
      rec.reason !== undefined && rec.reason.includes("HEAD moved"),
      `expected a HEAD-moved reason: ${JSON.stringify(rec)}`,
    );
    assertEquals(await gateProofHonored(dir), false);
    assertEquals((await inspectGateProof(dir)).status, "missing");
  });
});

Deno.test("proof: a mid-run commit leaves a prior clean vouch intact (still truthful at its sha)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await recordGreenNow(dir); // vouch at clean HEAD C
    const pin = await pinValidatedTree(dir); // a gate re-run pins C…
    await git(dir, "commit", "-q", "--allow-empty", "-m", "D", "--no-gpg-sign");
    // …and a mid-run commit D refuses the stamp, WITHOUT clearing C's vouch.
    const rec = await recordGateOutcome(
      dir,
      await proofAuthority(dir),
      true,
      pin,
    );
    assertEquals(rec.status, "skipped_head_moved");
    assertEquals((await inspectGateProof(dir)).status, "stale"); // still names C
    await git(dir, "reset", "-q", "--hard", "HEAD~1"); // back at clean C
    assertEquals(await gateProofHonored(dir), true); // the truthful vouch holds
  });
});

Deno.test("proof: a tree that was dirty when the gate began is not stamped even if clean at record time", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "wip.txt"), "wip\n"); // dirty at gate start
    const pin = await pinValidatedTree(dir);
    await Deno.remove(join(dir, "wip.txt")); // cleaned mid-run (checkout/stash)
    // The gate read the dirty tree, which is NOT the tree HEAD names — no vouch.
    const rec = await recordGateOutcome(
      dir,
      await proofAuthority(dir),
      true,
      pin,
    );
    assertEquals(rec.status, "skipped_dirty");
    assertEquals(await gateProofHonored(dir), false);
  });
});

// ── the regression: a gate-breaking update cannot land ────────────────────────

Deno.test("accept: refuses an update that merges cleanly but breaks the gate (the stale-finish hole)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "gamma");
    await commitBranchWork(wt);

    // The agent finishes green as the branch stands (records a proof at this HEAD).
    const green = await runAgent(wt, ["done", "--json"]);
    assertEquals(green.code, 0, green.output);

    // Meanwhile main advances with a change that breaks the branch's gate but merges
    // cleanly — a brand-new file the branch never touched (no textual conflict).
    await advanceMain(dir, "taboo.txt");

    // The agent updates: a clean merge, but the proof is now stale (new merge commit).
    const integ = await runAgent(wt, ["update"]);
    assertEquals(integ.code, 0, integ.output);
    await commitCurrentWorktree(wt);

    // Accepting MUST refuse — the merged tree was never validated, and it fails the gate.
    const grad = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(grad.code, 1, grad.output);
    assertTerminalTextIncludes(grad.output, "does not pass");
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

Deno.test("accept: an update that still passes the gate lands normally", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "delta");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // Main advances with a BENIGN file — the merged tree still passes the gate.
    await advanceMain(dir, "notes.txt");
    assertEquals((await runAgent(wt, ["update"])).code, 0);
    await commitCurrentWorktree(wt);

    const grad = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(grad.code, 0, grad.output);
    // The proof was stale (merge commit), so accept validated the merged tree itself…
    assertTerminalTextIncludes(
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

Deno.test("accept TTY: a proofless validation shows the full gate moving live", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "visible-validation");
    await commitBranchWork(wt);
    await writeConfig(
      wt,
      CONFIG_CHECK.replace(
        'lint = "sh check.sh"',
        'format = "sleep 1"\ntest = "true"',
      ),
    );
    await commitCurrentWorktree(wt, "Wire a delayed validation gate");

    const accepted = await runAgentPty(wt, ["accept", "--confirmed"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
    });
    assertEquals(accepted.code, 0, accepted.output);

    const validation = accepted.stdout.indexOf(
      "Validating the branch against the full gate",
    );
    const initialFrame = accepted.stdout.indexOf("\x1b[?25l", validation);
    const firstRedraw = accepted.stdout.indexOf("\x1b[1G", initialFrame);
    const restored = accepted.stdout.indexOf("\x1b[?25h", firstRedraw);
    const passed = accepted.stdout.indexOf(
      "Gate passed against the tree to be landed",
    );
    assert(
      validation >= 0 && initialFrame > validation &&
        firstRedraw > initialFrame && restored > firstRedraw &&
        passed > restored,
      accepted.output,
    );
    const frame = accepted.stdout.slice(initialFrame, restored);
    assertTerminalTextIncludes(frame, "format started");
    assertTerminalTextIncludes(frame, "format passed");
    assertTerminalTextIncludes(frame, "test started");
    assertTerminalTextIncludes(frame, "test passed");
    assertEquals(frame.includes("Gate progress"), false);
  });
});

// ── the fast path: a fresh finish makes accept cheap ───────────────────────────

Deno.test("accept: a fresh `done` lets accept skip the gate re-run (proof fast path)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "epsilon");
    await commitBranchWork(wt);

    // The agent finishes (records a proof at this exact, clean HEAD)…
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // …so accept trusts it and does NOT re-run the gate (the no-double-run guarantee).
    const grad = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(grad.code, 0, grad.output);
    const obj = parseJson(grad.stdout);
    assertEquals(obj.data.gate_validation.mode, "proof");
    assertEquals(obj.data.gate_validation.proof.status, "honored");
    assertEquals(
      grad.output.includes("Validating the branch against the full gate"),
      false,
      `the gate must NOT re-run when the proof is valid\n${grad.output}`,
    );
    // The landing record: both forms from the honored marker ride the envelope,
    // with the verbatim relay instruction beside them.
    assertLandingProofRelay(obj, "epsilon");
    assertEquals(await exists(wt), false, `should have landed\n${grad.output}`);
  });
});

Deno.test("accept: a legacy proof cannot bypass tracked refresh convergence", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "legacy-refresh-proof");
    await commitBranchWork(wt);
    const refreshed = await runAgent(wt, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitCurrentWorktree(wt, "adopt tracked refresh artifacts");
    const mcpPath = join(wt, ".mcp.json");
    const mcp = JSON.parse(await Deno.readTextFile(mcpPath));
    mcp.mcpServers.discern.command = "wrong-discern";
    await Deno.writeTextFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
    await commitCurrentWorktree(wt, "make a tracked refresh artifact stale");

    // Simulate a proof issued by an older gate that did not know this
    // convergence predicate. The proof primitive deliberately does not run a
    // gate; acceptance must apply current cheap preconditions before landing.
    assertEquals((await recordGreenNow(wt)).status, "recorded");
    assertEquals((await inspectGateProof(wt)).status, "honored");

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 1, preview.output);
    assertStringIncludes(preview.output, ".mcp.json");
    assertEquals(
      await exists(join(dir, "feature.txt")),
      false,
      "the read-only plan refusal must not touch the trunk",
    );

    const accepted = await runAgent(wt, ["accept", "--confirmed"]);

    assertEquals(accepted.code, 1, accepted.output);
    assertStringIncludes(accepted.output, ".mcp.json");
    assertTerminalTextIncludes(accepted.output, "discern refresh");
    assertEquals(await exists(wt), true, "the refused worktree must survive");
    assertEquals(
      await exists(join(dir, "feature.txt")),
      false,
      "the stale tree must not reach the trunk",
    );
  });
});

Deno.test("accept: with no prior `done`, accept runs the gate itself before landing", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "zeta");
    await commitBranchWork(wt); // committed, but the agent never ran `done` → no proof

    const grad = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(grad.code, 0, grad.output);
    const obj = parseJson(grad.stdout);
    assertEquals(obj.data.gate_validation.mode, "rerun");
    assertEquals(obj.data.gate_validation.proof.status, "missing");
    assertEquals(grad.output.includes("JOB"), false);
    // The slow path's fresh gate run rendered both proof forms — accept still
    // carries the same landing contract as the fast path.
    assertLandingProofRelay(obj, "zeta");
    assertEquals(await exists(wt), false, `should have landed\n${grad.output}`);
  });
});

// ── the pin: a commit made DURING validation can never land unvalidated ─────────

Deno.test("accept: refuses to land a commit that appeared while its validation gate ran", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "theta");
    await commitBranchWork(wt);

    // Sabotage the check so it COMMITS a new file mid-gate — a deterministic
    // stand-in for "someone commits in another terminal while the suite runs".
    // The gate itself stays green (the script exits 0).
    await writeExecutable(
      join(wt, "check.sh"),
      [
        "#!/usr/bin/env sh",
        "if [ ! -f sneaky.txt ]; then",
        "  echo sneak > sneaky.txt",
        "  git add sneaky.txt",
        "  git commit -q -m 'sneak: committed mid-gate' --no-gpg-sign",
        "fi",
        "",
      ].join("\n"),
    );
    await commitCurrentWorktree(wt, "chore: wire the mid-gate committer");

    // No proof exists, so accept re-runs the gate (slow path). The gate is
    // green, but HEAD moved beneath it — landing must refuse, because the tree
    // at the branch tip is not the tree the gate read.
    const grad = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(grad.code, 1, grad.output);
    assertTerminalTextIncludes(grad.output, "moved while this acceptance");
    // Non-destructive: the worktree survives and nothing reached the trunk.
    assertEquals(
      await exists(wt),
      true,
      `worktree must survive\n${grad.output}`,
    );
    assertEquals(
      await exists(join(dir, "feature.txt")),
      false,
      "no commit may fast-forward onto the trunk unvalidated",
    );
    assertEquals(
      await exists(join(dir, "sneaky.txt")),
      false,
      "the mid-gate commit must not land",
    );
  });
});

Deno.test("accept: a commit made after `done` invalidates the proof (gate re-runs)", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "eta");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0); // proof at C

    // A further commit moves HEAD past the proof — accept must re-validate, not trust it.
    await Deno.writeTextFile(join(wt, "more.txt"), "more\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "more", "--no-gpg-sign");

    const grad = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(grad.code, 0, grad.output);
    assertTerminalTextIncludes(
      grad.output,
      "Validating the branch against the full gate",
    );
    assertEquals(
      grad.output.includes("already passed the gate at this commit"),
      false,
      `a stale proof must not be honored\n${grad.output}`,
    );
  });
});
