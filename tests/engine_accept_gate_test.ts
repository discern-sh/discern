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
 * released-environment refresh and refusal of uncompleted authored sources.
 *
 * Guards: boundary:local-git-landing
 */

import { recordCompleteGateFixture } from "./complete_gate_fixture.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
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
  type AdminStateWriteAuthority,
  gateProofHonored,
  inspectGateProof,
  pinValidatedTree,
  preflightAdminStateWrites,
  type recordGateOutcome,
} from "../src/engine/gate/proof.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import type { Proof } from "../src/shared/result_schemas.ts";
import { z } from "@zod/zod";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import { declarationEvidenceIdentity } from "../src/engine/checkpoints/evidence.ts";

type AcceptWireData = Exclude<
  NonNullable<CliResultForCommand<"accept">["data"]>,
  { issues: unknown }
>;

type AppliedAcceptEnvelope = Omit<CliResultForCommand<"accept">, "data"> & {
  data: AcceptWireData & {
    root: string;
    consent: NonNullable<AcceptWireData["consent"]>;
    landing: NonNullable<AcceptWireData["landing"]>;
  };
};

const MCP_SETTINGS_SCHEMA = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({ command: z.string() }).passthrough(),
  ),
}).passthrough();

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

/** Plant an incomplete pre-cutover marker to verify that it cannot bypass validation. */
async function recordTreeMarkerNow(dir: string): Promise<void> {
  const path = await gitAdminStatePath(dir, "gateProof");
  assert(path !== undefined);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      version: ON_DISK_FORMATS.gateProof.version,
      head: (await pinValidatedTree(dir)).head,
      mode: "strict",
    }),
  );
}

/** Record a complete green Proof with a pin captured now. */
async function recordGreenNow(
  dir: string,
): ReturnType<typeof recordGateOutcome> {
  const pin = await pinValidatedTree(dir);
  assert(pin.head !== undefined);
  const proof: Proof = {
    branch: "agent/proof-fixture",
    trunk: "main",
    head: pin.head.slice(0, 12),
    files_total: 1,
    insertions: 1,
    deletions: 0,
    line: "> **Proof:** complete fixture",
    markdown: "### Proof — complete fixture",
  };
  const evidence = await declarationEvidenceIdentity(dir);
  assert(evidence.status === "ok");
  return await recordCompleteGateFixture(
    dir,
    await proofAuthority(dir),
    true,
    pin,
    proof,
    evidence.identity,
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
  "printf x >> .check-count",
  "test ! -e taboo.txt",
  "",
].join("\n");

/** Decode an acceptance that crossed the landing boundary. */
function parseAppliedAcceptJson(stdout: string): AppliedAcceptEnvelope {
  const result = decodeCliResult(stdout, "accept");
  assertResultDataKey(result, "root");
  assert(typeof result.data.root === "string");
  const { consent, landing } = result.data;
  assert(consent !== undefined && landing !== undefined, stdout);
  assert(landing.trunk_landed, stdout);
  return {
    ...result,
    data: { ...result.data, root: result.data.root, consent, landing },
  };
}

/** Every successful acceptance path carries the bounded line an agent relays. */
function assertLandingProofRelay(
  obj: AppliedAcceptEnvelope,
  branch: string,
): void {
  assertEquals("proof" in obj.data, false);
  assertEquals(typeof obj.data.proof_line, "string");
  assertExists(obj.data.proof_line);
  assertStringIncludes(
    obj.data.proof_line,
    `> **Proof:** Gate passed for \`agent/${branch}\` at `,
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
  await Deno.writeTextFile(join(dir, ".gitignore"), "\n.check-count\n", {
    append: true,
  });
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

    const recorded = await recordCompleteGateFixture(
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

    const proof = await recordCompleteGateFixture(
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
    await recordCompleteGateFixture(
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
    const rec = await recordCompleteGateFixture(
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
    const rec = await recordCompleteGateFixture(
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
    const rec = await recordCompleteGateFixture(
      dir,
      await proofAuthority(dir),
      true,
      pin,
    );
    assertEquals(rec.status, "skipped_dirty");
    assertEquals(await gateProofHonored(dir), false);
  });
});

// Current acceptance selects complete candidates and never adopts a new authored source.

Deno.test("accept: a fresh complete candidate lands without running a producer twice", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "epsilon");
    await commitBranchWork(wt);
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(await Deno.readTextFile(join(wt, ".check-count")), "x");
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = parseAppliedAcceptJson(accepted.stdout);
    assertEquals(result.data.consent, { source: "conversation" });
    assertEquals(result.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
    // The landing reused the honored Proof: the check never ran again at the
    // boundary (no counter appears in the landed checkout).
    assertEquals(await targetExists(join(dir, ".check-count")), false);
    assertLandingProofRelay(result, "epsilon");
    assertEquals(await targetExists(wt), false);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "branch work\n",
    );
  });
});

for (const legacy of [false, true]) {
  Deno.test(`accept: ${legacy ? "incomplete pre-launch evidence" : "no completion"} cannot enroll or land work`, async () => {
    await withTempDir(async (dir) => {
      await mainWithCheck(dir);
      const wt = await addWorktree(dir, "not-complete");
      await commitBranchWork(wt);
      if (legacy) {
        await recordTreeMarkerNow(wt);
        assertEquals((await inspectGateProof(wt)).status, "stale");
      }
      for (const preview of [true, false]) {
        const accepted = await runAgent(wt, [
          "accept",
          "--confirmed",
          "--json",
          ...(preview ? ["--dry-run"] : []),
        ]);
        assertEquals(accepted.code, 1, accepted.output);
        const result = decodeCliResult(accepted.stdout, "accept");
        assertEquals(result.error, "precondition_failed", accepted.output);
        assertStringIncludes(
          result.message ?? "",
          "has no honored Proof at HEAD, so there is nothing proven to land. " +
            "Run discern done, then discern accept.",
        );
        // accept never runs the gate: the check never executed here.
        assertEquals(await targetExists(join(wt, ".check-count")), false);
        assertEquals(await targetExists(join(dir, "feature.txt")), false);
        assertEquals(await targetExists(wt), true);
      }
    });
  });
}

Deno.test("accept: a trunk that moved after the Proof refuses in one sentence and never reruns the gate", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "unavailable");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    await advanceMain(dir, "notes.txt");
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assertEquals(result.error, "precondition_failed", accepted.output);
    assertStringIncludes(
      result.message ?? "",
      "The trunk moved after agent/unavailable's Proof; run discern update, " +
        "discern done, then discern accept.",
    );
    // accept never recomposes or revalidates: the check ran once, in done.
    assertEquals(await Deno.readTextFile(join(wt, ".check-count")), "x");
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
    assertEquals(await targetExists(wt), true);
  });
});

Deno.test("accept: a new authored commit stales the Proof and routes back to done", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "moved-on");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    await Deno.writeTextFile(join(wt, "more.txt"), "more\n");
    await commitCurrentWorktree(wt);
    const refused = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    assertEquals(
      decodeCliResult(refused.stdout, "accept").error,
      "precondition_failed",
    );
    assertEquals(await targetExists(join(dir, "more.txt")), false);
    assertEquals(await Deno.readTextFile(join(wt, ".check-count")), "x");

    // A fresh done over the new tip restores the landing path end to end.
    const completed = await runAgent(wt, ["done", "--json"]);
    assertEquals(completed.code, 0, completed.output);
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(await Deno.readTextFile(join(dir, "more.txt")), "more\n");
    assertEquals(await targetExists(join(dir, "feature.txt")), true);
  });
});

Deno.test("accept: the stale-finish hole stays closed — a gate-breaking merge cannot land without a green done over the merged tree", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "composed");
    await commitBranchWork(wt);
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    // A semantically breaking line of work lands on main beneath the branch.
    await advanceMain(dir, "taboo.txt");
    // The proven-but-stale Proof cannot land the merged future.
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    assertStringIncludes(
      decodeCliResult(accepted.stdout, "accept").message ?? "",
      "The trunk moved after agent/composed's Proof",
    );
    // The route the refusal names: update merges the trunk in, done fails on
    // the merged tree, and acceptance stays closed — nothing lands.
    const updated = await runAgent(wt, ["update", "--json"]);
    assertEquals(updated.code, 0, updated.output);
    const merged = await runAgent(wt, ["done", "--json"]);
    assertEquals(merged.code, 1, merged.output);
    const retried = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(retried.code, 1, retried.output);
    assertEquals(await targetExists(wt), true);
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
  });
});

Deno.test("accept: completion refuses a committed stale refresh artifact before queue admission", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "stale-refresh");
    await commitBranchWork(wt);
    assertEquals((await runAgent(wt, ["refresh", "--json"])).code, 0);
    await commitCurrentWorktree(wt);
    const mcpPath = join(wt, ".mcp.json");
    const mcp = decodeWith(
      MCP_SETTINGS_SCHEMA,
      await Deno.readTextFile(mcpPath),
    );
    assert(mcp.mcpServers.discern !== undefined);
    mcp.mcpServers.discern.command = "wrong-discern";
    await Deno.writeTextFile(mcpPath, JSON.stringify(mcp));
    await commitCurrentWorktree(wt);
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    assertStringIncludes(done.output, ".mcp.json");
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
  });
});

Deno.test("accept: a producer committing during completion cannot supply landing Proof", async () => {
  await withTempDir(async (dir) => {
    await mainWithCheck(dir);
    const wt = await addWorktree(dir, "mid-run-commit");
    await commitBranchWork(wt);
    await writeExecutable(
      join(wt, "check.sh"),
      "#!/bin/sh\nprintf sneak > sneaky.txt\ngit add sneaky.txt\ngit commit -qm sneak --no-gpg-sign\n",
    );
    await commitCurrentWorktree(wt);
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 1, accepted.output);
    assertEquals(await targetExists(join(dir, "sneaky.txt")), false);
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
    assertEquals(await targetExists(wt), true);
  });
});
