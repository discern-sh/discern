/** End-to-end contract for measured, commit-bound Standard limit proposals. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { statIfExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

/** Minimal falling ceiling whose metric grows with tracked source files. */
function proposalConfig(): string {
  return [
    "[project]",
    'slug = "limit-proposal-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[standards.sources]",
    'direction = "down"',
    "limit = 1",
    "run = \"count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC sources $count\"",
    'inputs = ["src/**"]',
    "",
  ].join("\n");
}

/** Create one clean feature worktree whose source-count ceiling is breached. */
async function proposalWorktree(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, proposalConfig());
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
  await gitInit(dir);
  const worktree = await addWorktree(dir, "limit-proposal");
  await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
  await git(worktree, "add", "src/feature.ts");
  await git(worktree, "commit", "-m", "Add feature source");
  return worktree;
}

interface ApprovalChallenge {
  readonly token: string;
  readonly proposal: {
    readonly standard: string;
    readonly proposed_limit: number;
    readonly reason: string;
  };
}

/** Read the exact structured approval challenge from an accept refusal. */
function approvalChallenge(stdout: string): ApprovalChallenge {
  const challenge = (decodeCliResult(stdout, "accept").data as {
    standard_approvals_required?: ApprovalChallenge[];
  }).standard_approvals_required?.[0];
  assert(challenge !== undefined);
  return challenge;
}

Deno.test("standards propose records the breached value in one config-only commit and is idempotent", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    const measured = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(measured.code, 1, measured.output);
    const measuredData = decodeCliResult(measured.stdout, "standards").data as {
      standards?: { name: string; value?: number; verdict?: string }[];
    };
    assertEquals(measuredData.standards?.[0]?.value, 2);
    assertEquals(measuredData.standards?.[0]?.verdict, "regressed");

    const before = await gitOut(worktree, "rev-parse", "HEAD");
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The feature adds one source file required by the product.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    const envelope = decodeCliResult(proposed.stdout, "standards propose");
    assertEquals(envelope.verb, "standards propose");
    const proposalResult = (envelope.data as {
      proposal: {
        status: string;
        proposal: {
          standard: string;
          measured_commit: string;
          commit: string;
          trunk_limit: number;
          proposed_limit: number;
          measurement: number;
          delta: number;
          reason: string;
          evidence_paths: string[];
        };
      };
    }).proposal;
    assertEquals(proposalResult.status, "recorded");
    assertEquals(proposalResult.proposal.standard, "sources");
    assertEquals(proposalResult.proposal.measured_commit, before);
    assertEquals(proposalResult.proposal.trunk_limit, 1);
    assertEquals(proposalResult.proposal.proposed_limit, 2);
    assertEquals(proposalResult.proposal.measurement, 2);
    assertEquals(proposalResult.proposal.delta, 1);
    assertEquals(proposalResult.proposal.evidence_paths, ["src/feature.ts"]);
    assertEquals(
      await gitOut(worktree, "show", "--name-only", "--format=", "HEAD"),
      "discern.toml",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(worktree, "discern.toml")),
      "limit = 2",
    );

    const commit = await gitOut(worktree, "rev-parse", "HEAD");
    assertEquals(proposalResult.proposal.commit, commit);
    const repeated = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The feature adds one source file required by the product.",
      "--json",
    ]);
    assertEquals(repeated.code, 0, repeated.output);
    assertEquals(
      (decodeCliResult(repeated.stdout, "standards propose").data as {
        proposal: { status: string };
      }).proposal.status,
      "unchanged",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), commit);

    const replaced = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "A revised owner-facing reason for the same measured breach.",
      "--json",
    ]);
    assertEquals(replaced.code, 0, replaced.output);
    const replacement = (decodeCliResult(replaced.stdout, "standards propose")
      .data as {
        proposal: { status: string; proposal: { reason: string } };
      }).proposal;
    assertEquals(replacement.status, "replaced");
    assertEquals(
      replacement.proposal.reason,
      "A revised owner-facing reason for the same measured breach.",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), commit);
  });
});

Deno.test("proposal-bearing Gate Proof is green and prominent while accept needs exact approval", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The feature adds one source file required by the product.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);

    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const doneData = decodeCliResult(done.stdout, "done").data as {
      proof?: {
        line: string;
        standard_proposals?: { standard: string; reason: string }[];
      };
      standards?: { name: string; measurement: string }[];
    };
    const proof = doneData.proof;
    assert(proof !== undefined);
    assertEquals(proof.standard_proposals?.[0]?.standard, "sources");
    assertStringIncludes(
      proof.line,
      "proposal awaiting exact owner approval: sources",
    );
    assertEquals(doneData.standards?.[0]?.measurement, "measured");

    const markdown = await runAgent(worktree, [
      "done",
      "--markdown",
      "--rerun",
    ]);
    assertEquals(markdown.code, 0, markdown.output);
    assertTerminalTextIncludes(
      markdown.stdout,
      "Standard limit proposal for `sources`",
    );
    assertTerminalTextIncludes(
      markdown.stdout,
      "The feature adds one source file required by the product.",
    );

    const refused = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const refusal = decodeCliResult(refused.stdout, "accept");
    assertEquals(refusal.error, "awaiting_standard_approval");
    const approval = approvalChallenge(refused.stdout);
    assertMatch(approval.token, /^[0-9a-f]{64}$/u);
    assertEquals(approval.proposal.standard, "sources");
    assertEquals(approval.proposal.proposed_limit, 2);
    assertEquals(
      approval.proposal.reason,
      "The feature adds one source file required by the product.",
    );
    assertStringIncludes(
      String(refusal.message),
      `--approve-standard ${approval.token}`,
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      await gitOut(dir, "rev-parse", "HEAD"),
    );

    const wrong = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--approve-standard",
      "other",
      "--json",
    ]);
    assertEquals(wrong.code, 1, wrong.output);
    assertEquals(
      decodeCliResult(wrong.stdout, "accept").error,
      "invalid_value",
    );

    const proposalPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposals",
    );
    assert(proposalPath !== undefined);
    assertStringIncludes(await Deno.readTextFile(proposalPath), '"sources"');
  });
});

Deno.test("accept lands the already-proved proposal commit after exact approval", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The feature adds one source file required by the product.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    const proposalCommit = await gitOut(worktree, "rev-parse", "HEAD");

    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalCommit);

    const awaiting = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(awaiting.code, 1, awaiting.output);
    const approvalToken = approvalChallenge(awaiting.stdout).token;

    const accepted = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--approve-standard",
      approvalToken,
      "--json",
    ]);
    assertEquals(accepted.code, 0, accepted.output);
    const data = decodeCliResult(accepted.stdout, "accept").data as {
      proof_line?: string;
      standard_approvals?: {
        standard: string;
        proposed_limit: number;
        reason: string;
      }[];
    };
    // The landed line states the proposal in its resolved state — the
    // awaiting-decision segment never survives next to its own resolution.
    assertStringIncludes(
      String(data.proof_line),
      "proposal approved by the owner: sources",
    );
    assertEquals(String(data.proof_line).includes("awaiting"), false);
    assertEquals(data.standard_approvals?.[0]?.standard, "sources");
    assertEquals(data.standard_approvals?.[0]?.proposed_limit, 2);
    assertEquals(
      data.standard_approvals?.[0]?.reason,
      "The feature adds one source file required by the product.",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), proposalCommit);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "limit = 2",
    );
    await assertRejectsNotFound(worktree);
  });
});

/** Assert that a transaction-owned path was removed. */
async function assertRejectsNotFound(path: string): Promise<void> {
  assertEquals(await statIfExists(path), undefined);
}

Deno.test("standards propose refuses trunk, unknown, absent-evidence, and dirty states read-only", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proposalConfig());
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);

    const trunk = await runAgent(dir, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The breached limit belongs to a feature branch.",
      "--json",
    ]);
    assertEquals(trunk.code, 1, trunk.output);
    assertTerminalTextIncludes(
      String(decodeCliResult(trunk.stdout, "standards propose").message),
      "never edits the trunk",
    );

    const worktree = await addWorktree(dir, "proposal-preconditions");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");
    const head = await gitOut(worktree, "rev-parse", "HEAD");

    const unknown = await runAgent(worktree, [
      "standards",
      "propose",
      "absent",
      "--reason",
      "Unknown Standards cannot be proposed.",
      "--json",
    ]);
    assertEquals(unknown.code, 1, unknown.output);
    assertEquals(
      decodeCliResult(unknown.stdout, "standards propose").error,
      "unknown_standard",
    );

    const absent = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "A measurement must exist first.",
      "--json",
    ]);
    assertEquals(absent.code, 1, absent.output);
    assertTerminalTextIncludes(
      String(decodeCliResult(absent.stdout, "standards propose").message),
      "no fresh measured breach",
    );

    await Deno.writeTextFile(join(worktree, "scratch.txt"), "dirty\n");
    const dirty = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "Dirty trees cannot enter a config-only transaction.",
      "--json",
    ]);
    assertEquals(dirty.code, 1, dirty.output);
    assertEquals(
      decodeCliResult(dirty.stdout, "standards propose").error,
      "dirty_worktree",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), head);
    assertStringIncludes(
      await Deno.readTextFile(join(worktree, "discern.toml")),
      "limit = 1",
    );
  });
});

Deno.test("standards propose refuses stale and failed fresh measurements", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    await Deno.mkdir(join(worktree, "docs"), { recursive: true });
    await Deno.writeTextFile(join(worktree, "docs", "later.md"), "later\n");
    await git(worktree, "add", "docs/later.md");
    await git(worktree, "commit", "-m", "Move beyond measured commit");
    const stale = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "Stale measurements cannot authorize a new limit.",
      "--json",
    ]);
    assertEquals(stale.code, 1, stale.output);
    assertStringIncludes(
      String(decodeCliResult(stale.stdout, "standards propose").message),
      "(stale)",
    );
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      proposalConfig().replace(
        "count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC sources $count",
        "echo measurement-failed; exit 7",
      ),
    );
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "failed-proposal-measurement");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const failed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "Failed commands carry no numeric proposal evidence.",
      "--json",
    ]);
    assertEquals(failed.code, 1, failed.output);
    assertTerminalTextIncludes(
      String(decodeCliResult(failed.stdout, "standards propose").message),
      "did not yield a numeric metric",
    );
  });
});

Deno.test("a deleted Standard and an unproposed simultaneous breach remain ordinary failures", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    await writeConfig(
      worktree,
      [
        "[project]",
        'slug = "limit-proposal-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join("\n"),
    );
    await git(worktree, "add", "discern.toml");
    await git(worktree, "commit", "-m", "Delete Standard");
    const deleted = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "Deleted Standards cannot carry proposals.",
      "--json",
    ]);
    assertEquals(deleted.code, 1, deleted.output);
    assertEquals(
      decodeCliResult(deleted.stdout, "standards propose").error,
      "unknown_standard",
    );
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const sharedRun =
      "echo DISCERN_METRIC first 2; echo DISCERN_METRIC second 2";
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "multi-limit-proposal"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[standards.first]",
        'metric = "first"',
        'direction = "down"',
        "limit = 1",
        `run = "${sharedRun}"`,
        'inputs = ["src/**"]',
        "",
        "[standards.second]",
        'metric = "second"',
        'direction = "down"',
        "limit = 1",
        `run = "${sharedRun}"`,
        'inputs = ["src/**"]',
        "",
      ].join("\n"),
    );
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "multi-limit-proposal");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "first",
      "--reason",
      "Only the first Standard has been proposed.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const diagnostics = decodeCliResult(done.stdout, "done").diagnostics as {
      tool: string;
      message: string;
    }[];
    assert(
      diagnostics.some((diagnostic) => diagnostic.tool === "standard:second"),
    );
    assert(
      !diagnostics.some((diagnostic) => diagnostic.tool === "standard:first"),
    );
  });
});

Deno.test("trunk movement and changed fresh measurement stale a proposal", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The feature adds one source file required by the product.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    await Deno.writeTextFile(join(dir, "trunk.txt"), "trunk moved\n");
    await git(dir, "add", "trunk.txt");
    await git(dir, "commit", "-m", "Move trunk");
    const stale = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(stale.code, 1, stale.output);
    const diagnostics = decodeCliResult(stale.stdout, "standards")
      .diagnostics as {
        message: string;
      }[];
    assert(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes("trunk moved or changed identity")
      ),
      stale.stdout,
    );
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      proposalConfig().replace(
        "count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC sources $count",
        "echo DISCERN_METRIC sources $(git config --get test.metric)",
      ),
    );
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);
    await git(dir, "config", "test.metric", "2");
    const worktree = await addWorktree(dir, "changed-measurement");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The initial measured value is two.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    await git(worktree, "config", "test.metric", "3");
    const changed = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(changed.code, 1, changed.output);
    assertTerminalTextIncludes(
      changed.stdout,
      "proposed limit records 2",
    );
    const stale = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(stale.code, 1, stale.output);
    assertTerminalTextIncludes(
      stale.stdout,
      "latest fresh measurement is 3",
    );
  });
});

Deno.test("reason changes rotate exact approval tokens and revocation blocks landing", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const proposed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The original exact reason.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    assertEquals((await runAgent(worktree, ["done", "--json"])).code, 0);
    const firstStop = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(firstStop.code, 1, firstStop.output);
    const firstToken = approvalChallenge(firstStop.stdout).token;

    const replaced = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      "The revised exact reason.",
      "--json",
    ]);
    assertEquals(replaced.code, 0, replaced.output);
    const redone = await runAgent(worktree, ["done", "--json"]);
    assertEquals(redone.code, 0, redone.output);
    const staleApproval = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--approve-standard",
      firstToken,
      "--json",
    ]);
    assertEquals(staleApproval.code, 1, staleApproval.output);
    assertEquals(
      decodeCliResult(staleApproval.stdout, "accept").error,
      "invalid_value",
    );
    const secondStop = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(secondStop.code, 1, secondStop.output);
    const secondToken = approvalChallenge(secondStop.stdout).token;
    assert(firstToken !== secondToken);

    const proposalPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposals",
    );
    assert(proposalPath !== undefined);
    await Deno.remove(proposalPath);
    const revoked = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--approve-standard",
      secondToken,
      "--json",
    ]);
    assertEquals(revoked.code, 1, revoked.output);
    assertEquals(
      decodeCliResult(revoked.stdout, "accept").error,
      "proposal_stale",
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      await gitOut(dir, "rev-parse", "HEAD"),
    );
  });
});

Deno.test("proposal recovery unwinds a pre-commit edit and finalizes a post-commit record", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const measuredCommit = await gitOut(worktree, "rev-parse", "HEAD");
    const branch = await gitOut(worktree, "branch", "--show-current");
    const transactionPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposalTransaction",
    );
    assert(transactionPath !== undefined);
    await Deno.mkdir(dirname(transactionPath), { recursive: true });
    const reason = "The feature adds one source file required by the product.";
    const plannedProposal = {
      standard: "sources",
      measured_commit: measuredCommit,
      definition_fingerprint: "recovery-validates-the-real-plan-after-unwind",
      trunk: "main",
      trunk_commit: await gitOut(dir, "rev-parse", "main"),
      direction: "down",
      trunk_limit: 1,
      proposed_limit: 2,
      measurement: 2,
      delta: 1,
      reason,
      evidence_paths: ["src/feature.ts"],
    };
    await Deno.writeTextFile(
      transactionPath,
      `${
        JSON.stringify({
          version: 1,
          branch,
          source_commit: measuredCommit,
          config_path: "discern.toml",
          proposal: plannedProposal,
        })
      }\n`,
    );
    await writeConfig(
      worktree,
      proposalConfig().replace("limit = 1", "limit = 2"),
    );

    const resumed = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      reason,
      "--json",
    ]);
    assertEquals(resumed.code, 0, resumed.output);
    const resumedProposal = (decodeCliResult(
      resumed.stdout,
      "standards propose",
    ).data as {
      proposal: {
        status: string;
        proposal: Record<string, unknown> & {
          commit: string;
          measured_commit: string;
        };
      };
    }).proposal;
    assertEquals(resumedProposal.status, "recorded");
    assertEquals(resumedProposal.proposal.measured_commit, measuredCommit);
    await assertRejectsNotFound(transactionPath);

    const proposalPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposals",
    );
    assert(proposalPath !== undefined);
    await Deno.remove(proposalPath);
    const { commit: _commit, ...proposalBeforeCommit } =
      resumedProposal.proposal;
    await Deno.writeTextFile(
      transactionPath,
      `${
        JSON.stringify({
          version: 1,
          branch,
          source_commit: measuredCommit,
          config_path: "discern.toml",
          proposal: proposalBeforeCommit,
        })
      }\n`,
    );

    const finalized = await runAgent(worktree, [
      "standards",
      "propose",
      "sources",
      "--reason",
      reason,
      "--json",
    ]);
    assertEquals(finalized.code, 0, finalized.output);
    const finalizedProposal = (decodeCliResult(
      finalized.stdout,
      "standards propose",
    ).data as {
      proposal: { status: string; proposal: { commit: string } };
    }).proposal;
    assertEquals(finalizedProposal.status, "recovered");
    assertEquals(
      finalizedProposal.proposal.commit,
      resumedProposal.proposal.commit,
    );
    await assertRejectsNotFound(transactionPath);
    assertStringIncludes(await Deno.readTextFile(proposalPath), '"sources"');
  });
});
