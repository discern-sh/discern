/**
 * The emergency subject is observed read-only before any exchange: each
 * precondition — the repair's checkout, its containment of actual trunk, the
 * main checkout's state, policy limits, and the existence of anything to
 * except — refuses with its own recovery sentence, and nothing lands.
 */

import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { emergencyData } from "./completion_emergency_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** A gate whose one check passes while `taboo.txt` is absent. */
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

/** The refusal for a repair whose `hotspots` ceiling rose with no current
 * recorded proposal. */
const LOOSENED_HOTSPOTS =
  "The repair loosens, redefines, or deletes a standard without a current limit proposal: `hotspots`.";

/** The refusal for an owner decision passed outside the confirmation. */
const CONFIRMATION_DECISIONS_ONLY =
  "The owner's variances and limit approvals belong to the emergency confirmation, beside --confirmed and --approval-token. Preparation and recovery take none.";

/** Run `accept emergency` and return the refusal message. */
async function refusal(cwd: string, ...args: string[]): Promise<string> {
  const run = await runAgent(cwd, ["accept", "emergency", ...args, "--json"]);
  assertEquals(run.code, 1, run.output);
  return decodeCliResult(run.stdout, "accept").message ?? "";
}

Deno.test("each emergency precondition refuses with its own recovery sentence and lands nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_CHECK);
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);

    // The exchange runs only from the repair's recorded worktree.
    assertStringIncludes(
      await refusal(dir, "--reason", "Restore service"),
      "Prepare this emergency in the repair's recorded worktree. Use --recover from a surviving checkout for an interrupted landing.",
    );

    const wt = await addWorktree(dir, "repair");
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "fix: repair", "--no-gpg-sign");

    // The owner needs a concrete reason before anything is observed.
    assertStringIncludes(
      await refusal(wt),
      "Give the owner a concrete emergency reason with --reason.",
    );

    // Uncommitted work in the repair is preserved, never integrated blind.
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "uncommitted edit\n");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "The repair has uncommitted changes. Preserve and commit the reviewed source before preparing the emergency.",
    );
    await git(wt, "checkout", "--", "hotfix.txt");

    // An interrupted sequencer (a crashed cherry-pick's marker, tree clean)
    // stops the review until the operation is resolved.
    const marker = join(
      await gitOut(wt, "rev-parse", "--absolute-git-dir"),
      "CHERRY_PICK_HEAD",
    );
    await Deno.writeTextFile(
      marker,
      `${await gitOut(wt, "rev-parse", "HEAD")}\n`,
    );
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "Resolve the repair checkout's active Git operation before preparing the emergency.",
    );
    await Deno.remove(marker);

    // A repair that lacks actual trunk must update first.
    await Deno.writeTextFile(join(dir, "hotfix.txt"), "trunk version\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "trunk change", "--no-gpg-sign");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      "The repair must contain actual trunk. Run discern update in this worktree, review and commit its result, then prepare a new emergency plan.",
    );

    // A source with nothing beyond the trunk has nothing to except.
    const green = await addWorktree(dir, "green");
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "This source is already on trunk. Use discern done to validate its current obligations.",
    );

    // The main checkout must be restored before any review.
    await Deno.writeTextFile(join(green, "green.txt"), "safe change\n");
    await git(green, "add", "-A");
    await git(green, "commit", "-q", "-m", "safe change", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "hotfix.txt"), "dirtied main\n");
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "Restore the main checkout to its configured trunk with clean tracked files and no active Git operation before reviewing emergency integration. Preserve all local work.",
    );
    await git(dir, "checkout", "--", "hotfix.txt");

    // With every machine obligation green there is no exception to approve.
    const done = await runAgent(green, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await refusal(green, "--reason", "Restore service"),
      "Every configured machine obligation has current passing evidence. Use discern done, then discern accept for ordinary landing.",
    );

    // Nothing landed anywhere along the way.
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      await gitOut(dir, "rev-parse", "HEAD"),
    );
  });
});

Deno.test("a repair that loosens a limit without a recorded proposal cannot use the emergency route", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        CONFIG_CHECK,
        "[standards.hotspots]",
        'direction = "down"',
        "limit = 5",
        'run = "echo 3"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "loosen");
    const config = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      config.replace("limit = 5", "limit = 50"),
    );
    await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "loosen the limit", "--no-gpg-sign");
    assertStringIncludes(
      await refusal(wt, "--reason", "Restore service"),
      LOOSENED_HOTSPOTS,
    );
  });
});

Deno.test("an emergency lands a recorded limit proposal only with the owner's approval of it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        CONFIG_CHECK,
        "[standards.hotspots]",
        'direction = "down"',
        "limit = 5",
        'run = "echo DISCERN_METRIC hotspots 7"',
        'inputs = ["hotfix.txt"]',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);
    const trunkBefore = await gitOut(dir, "rev-parse", "main");
    const wt = await addWorktree(dir, "propose");
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "fix: repair", "--no-gpg-sign");
    // After the owner agrees, the agent records a proposal that raises the
    // ceiling to the measured 7.
    const proposed = await runAgent(wt, [
      "standards",
      "propose",
      "hotspots",
      "--reason",
      "The repair adds hotspots the outage fix needs.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    const emergency = (...args: string[]) =>
      runAgent(wt, [
        "accept",
        "emergency",
        "--reason",
        "Restore service",
        ...args,
        "--json",
      ]);

    // The plan serves the proposal and its approval token for the owner.
    const preview = await emergency();
    assertEquals(preview.code, 1, preview.output);
    const envelope = decodeCliResult(preview.stdout, "accept");
    assertEquals(envelope.error, "awaiting_consent", preview.output);
    assertResultDataKey(envelope, "standard_approvals_required");
    const required = envelope.data.standard_approvals_required ?? [];
    assertEquals(
      required.map(({ proposal }) => [
        proposal.standard,
        proposal.trunk_limit,
        proposal.proposed_limit,
      ]),
      [["hotspots", 5, 7]],
    );
    const approval = required[0]?.token;
    const token = emergencyData(preview.stdout).confirmation;
    assert(approval !== undefined && token !== undefined, preview.output);
    assertStringIncludes(
      envelope.message ?? "",
      "It loosens a standard limit under its recorded proposal, which needs the owner's approval:\n\nhotspots: 5 → 7 (measured 7; delta +2)",
    );
    assertStringIncludes(
      envelope.message ?? "",
      `--approve-standard ${approval}`,
    );

    // A confirmation without the limit's approval serves the plan again.
    const unapproved = await emergency(
      "--confirmed",
      "--approval-token",
      token,
    );
    assertEquals(unapproved.code, 1, unapproved.output);
    const again = decodeCliResult(unapproved.stdout, "accept");
    assertEquals(again.error, "awaiting_consent", unapproved.output);
    assertStringIncludes(again.message ?? "", "missing: `hotspots`.");

    // A token for no current proposal is an error, never an approval.
    const unknown = await emergency(
      "--confirmed",
      "--approval-token",
      token,
      "--approve-standard",
      "0".repeat(64),
    );
    assertEquals(unknown.code, 1, unknown.output);
    assertEquals(
      decodeCliResult(unknown.stdout, "accept").error,
      "invalid_value",
      unknown.output,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assertEquals(
      (await observeCompletionRecords(dir, SYSTEM_CLOCK, ["exception"]))
        .records,
      [],
    );

    // The owner's exact approval lands the looser limit and records it.
    const landed = await emergency(
      "--confirmed",
      "--approval-token",
      token,
      "--approve-standard",
      approval,
    );
    assertEquals(landed.code, 0, landed.output);
    const approved = required.map(({ proposal }) => proposal);
    assertEquals(emergencyData(landed.stdout).standard_approvals, approved);
    assertStringIncludes(
      await gitOut(dir, "show", "main:discern.toml"),
      "limit = 7",
    );
    const [record] =
      (await observeCompletionRecords(dir, SYSTEM_CLOCK, ["exception"]))
        .records;
    assert(
      record?.reading.kind === "recorded" &&
        record.reading.record.kind === "exception",
    );
    assertEquals(
      record.reading.record.data.claim.standard_approvals,
      approved,
    );
  });
});

/** The owner's per-item emergency decisions, as each surface spells them. */
const CONFIRMATION_DECISIONS = [
  {
    cli: ["--variance", "release-notes"],
    mcp: { variance: ["release-notes"] },
  },
  {
    cli: ["--approve-standard", "limit-approval-token"],
    mcp: { approve_standard: ["limit-approval-token"] },
  },
] as const;

/** The emergency calls that take no owner decision, on each surface. */
const UNDECIDED_CALLS = [
  { cli: ["--prepare"], mcp: { prepare: true } },
  { cli: ["--recover", "landing-id"], mcp: { recover: "landing-id" } },
] as const;

/** Answers and receipts an emergency call can't take, each with its
 * refusal, as each surface spells them. */
const MISPLACED_ANSWERS = [
  {
    cli: ["--unmet", "release-notes", "--why", "The notes trail the fix."],
    mcp: {
      unmet: { id: "release-notes", why: "The notes trail the fix." },
    },
    refusal:
      "Checkpoint declarations require accept emergency --prepare. They cannot accompany integration or recovery.",
  },
  {
    cli: ["--composition-receipt", "composition"],
    mcp: { composition_receipt: "composition" },
    refusal:
      "--composition-receipt (MCP: composition_receipt) answers an ordinary landing's question about combined code. An emergency composes nothing, so remove it.",
  },
] as const;

/** Refuse one misplaced emergency argument set on the CLI and over MCP. */
async function refuseOnEverySurface(
  wt: string,
  cli: readonly string[],
  mcp: Readonly<Record<string, unknown>>,
  expected: string,
): Promise<void> {
  const tool = TOOLS.find((candidate) => candidate.name === "discern_accept");
  assert(tool !== undefined);
  const run = await runAgent(wt, [
    "accept",
    "emergency",
    "--reason",
    "Restore service",
    ...cli,
    "--json",
  ]);
  assertEquals(run.code, 1, run.output);
  const envelope = decodeCliResult(run.stdout, "accept");
  assertEquals(envelope.error, "invalid_arguments", run.output);
  assertStringIncludes(envelope.message ?? "", expected);
  const result = await runTool(
    tool,
    new WorkingRoot(wt),
    { action: "emergency", reason: "Restore service", ...mcp },
    undefined,
    () => Promise.resolve(undefined),
  );
  assertEquals(result.structuredContent?.error, "invalid_arguments");
  assertStringIncludes(String(result.structuredContent?.message), expected);
}

Deno.test("the emergency argument contract refuses misplaced decisions and answers on every surface", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_CHECK);
    await gitInit(dir);
    const wt = await addWorktree(dir, "repair");
    // The owner's decisions belong to the confirmation alone.
    for (const decision of CONFIRMATION_DECISIONS) {
      for (const call of UNDECIDED_CALLS) {
        await refuseOnEverySurface(
          wt,
          [...call.cli, ...decision.cli],
          { ...call.mcp, ...decision.mcp },
          CONFIRMATION_DECISIONS_ONLY,
        );
      }
    }
    // Checkpoint answers belong to preparation, and no emergency composes.
    for (const misplaced of MISPLACED_ANSWERS) {
      await refuseOnEverySurface(
        wt,
        misplaced.cli,
        misplaced.mcp,
        misplaced.refusal,
      );
    }
  });
});
