/**
 * End-to-end contract for measured, commit-bound Standard limit proposals.
 *
 * A proposal's states form one lifecycle — recorded, renewed, replaced, proved,
 * challenged, revoked, staled by the trunk, rebound to a descendant, landed —
 * so the journey test drives one worktree through every state in order, each
 * step asserting the transition it guards. Refusals that need their own
 * fixture (a failed measurement, a simultaneous unproposed breach, a changed
 * fresh measurement, interrupted transactions) keep their own repositories.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, isAbsolute, join } from "@std/path";
import { z } from "@zod/zod";
import { readTextIfExists, statIfExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { readProposalStore } from "../src/engine/gate/standard_proposal_state.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { standardsProposeBatchResult } from "../src/engine/gate/standard_proposals.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult, decodeWith } from "./decode_cli_result.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

const MutableProposalStoreFixtureSchema = z.object({
  version: z.number(),
  proposals: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

/** The measured `sources` command: count tracked source files, after planting
 * a process counter in common Git administration. */
const SOURCES_RUN =
  "printf x >> $(git rev-parse --git-common-dir)/proposal-target-runs; " +
  "count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC sources $count";

const BATCH_RUN =
  "printf x >> $(git rev-parse --git-common-dir)/proposal-batch-runs; " +
  "sources=$(git ls-files 'src/**' | wc -l); " +
  "docs=$(git ls-files 'docs/**' | wc -l); " +
  "echo DISCERN_METRIC sources $sources; echo DISCERN_METRIC docs $docs";

/** Minimal falling ceiling whose metric grows with tracked source files, plus
 * an unrelated holding Standard over docs so a targeted measurement is
 * observable. `sourcesRun` swaps the measurement for a variant fixture. */
function proposalConfig(sourcesRun = SOURCES_RUN): string {
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
    `run = "${sourcesRun}"`,
    'inputs = ["src/**"]',
    "",
    "[standards.unrelated]",
    'direction = "down"',
    "limit = 10",
    'run = "printf x >> $(git rev-parse --git-common-dir)/proposal-unrelated-runs; echo DISCERN_METRIC unrelated 1"',
    'inputs = ["docs/**"]',
    "",
  ].join("\n");
}

/** Two ceilings with one exact producer recipe, for an atomic batch. */
function batchProposalConfig(): string {
  return [
    "[project]",
    'slug = "limit-proposal-batch-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[standards.sources]",
    'direction = "down"',
    "limit = 1",
    `run = "${BATCH_RUN}"`,
    'inputs = ["src/**", "docs/**"]',
    "",
    "[standards.docs]",
    'direction = "down"',
    "limit = 1",
    `run = "${BATCH_RUN}"`,
    'inputs = ["src/**", "docs/**"]',
    "",
  ].join("\n");
}

/** Create one clean branch where both shared-producer ceilings are breached. */
async function batchProposalWorktree(
  dir: string,
  name: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, batchProposalConfig());
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
  await Deno.writeTextFile(join(dir, "docs", "base.md"), "base\n");
  await gitInit(dir);
  const worktree = await addWorktree(dir, name);
  await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
  await Deno.writeTextFile(join(worktree, "docs", "feature.md"), "feature\n");
  await git(worktree, "add", "src/feature.ts", "docs/feature.md");
  await git(worktree, "commit", "-m", "Add measured feature files");
  return worktree;
}

/** Create one clean feature worktree whose source-count ceiling is breached. */
async function proposalWorktree(
  dir: string,
  sourcesRun = SOURCES_RUN,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, proposalConfig(sourcesRun));
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
  await gitInit(dir);
  const worktree = await addWorktree(dir, "limit-proposal");
  await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
  await git(worktree, "add", "src/feature.ts");
  await git(worktree, "commit", "-m", "Add feature source");
  return worktree;
}

/** Count planted process invocations kept in common Git administration. */
async function proposalInvocationCount(
  worktree: string,
  counter: string,
): Promise<number> {
  const common = await gitOut(worktree, "rev-parse", "--git-common-dir");
  const path = isAbsolute(common)
    ? join(common, counter)
    : join(worktree, common, counter);
  return (await readTextIfExists(path))?.length ?? 0;
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
  const result = decodeCliResult(stdout, "accept");
  assert(
    result.data !== undefined && "standard_approvals_required" in result.data,
  );
  const challenge = result.data.standard_approvals_required?.[0];
  assert(challenge !== undefined);
  return challenge;
}

/** Run `standards propose sources --reason <reason> --json` in the worktree. */
function propose(
  worktree: string,
  reason: string,
  ...flags: string[]
): ReturnType<typeof runAgent> {
  return runAgent(worktree, [
    "standards",
    "propose",
    "sources",
    "--reason",
    reason,
    ...flags,
    "--json",
  ]);
}

/** The proposal payload of a `standards propose` envelope. */
interface ProposalResult {
  status: string;
  proposal: Record<string, unknown> & {
    standard: string;
    measured_commit: string;
    commit: string;
    bound_commit: string;
    trunk_commit: string;
    trunk_limit: number;
    proposed_limit: number;
    measurement: number;
    delta: number;
    reason: string;
    evidence_paths: string[];
  };
}

/** Decode the proposal payload of a `standards propose` envelope. */
function proposalOf(stdout: string): ProposalResult {
  return (decodeCliResult(stdout, "standards propose").data as {
    proposal: ProposalResult;
  }).proposal;
}

Deno.test("Standards proposal batches reject invalid sets before repository access", async () => {
  for (
    const testCase of [
      {
        proposals: [],
        message: "at least one",
      },
      {
        proposals: [
          { name: "sources", reason: "A technical source requirement." },
          { name: "sources", reason: "A second technical requirement." },
        ],
        message: "appears more than once",
      },
      {
        proposals: [{
          name: "sources",
          reason: "Owner approved this increase.",
        }],
        message: "technical justification",
      },
    ]
  ) {
    const result = await standardsProposeBatchResult("unused", {
      proposals: testCase.proposals,
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "invalid_value");
    assertStringIncludes(result.message ?? "", testCase.message);
  }
});

Deno.test("one Standards proposal batch shares production, commits every limit once, and is idempotent", async () => {
  await withTempDir(async (dir) => {
    const worktree = await batchProposalWorktree(
      dir,
      "limit-proposal-batch",
    );
    const sourceHead = await gitOut(worktree, "rev-parse", "HEAD");
    const proposals = [
      {
        name: "sources",
        reason: "The feature requires one additional source file.",
      },
      {
        name: "docs",
        reason: "The feature requires one additional documentation file.",
      },
    ];

    const trunkRefusal = await standardsProposeBatchResult(dir, {
      proposals,
      dryRun: true,
    });
    assertEquals(trunkRefusal.ok, false);
    assertEquals(trunkRefusal.error, "precondition_failed");

    const unknown = await standardsProposeBatchResult(worktree, {
      proposals: [{
        name: "unknown",
        reason: "The feature requires one additional generated artifact.",
      }],
      dryRun: true,
    });
    assertEquals(unknown.ok, false);
    assertEquals(unknown.error, "unknown_standard");

    const preview = await standardsProposeBatchResult(worktree, {
      proposals,
      dryRun: true,
    });
    assert(preview.ok, JSON.stringify(preview));
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), sourceHead);
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      0,
    );

    const recorded = await standardsProposeBatchResult(worktree, {
      proposals,
    });
    assert(recorded.ok, JSON.stringify(recorded));
    assertEquals(recorded.verb, "standards");
    const batch = (recorded.data as {
      proposal_batch?: {
        status: string;
        proposals: Array<{
          standard: string;
          commit: string;
          bound_commit: string;
        }>;
      };
    } | undefined)?.proposal_batch;
    assert(batch !== undefined);
    assertEquals(batch.status, "recorded");
    assertEquals(
      batch.proposals.map((proposal) => proposal.standard),
      ["sources", "docs"],
    );
    const proposalHead = await gitOut(worktree, "rev-parse", "HEAD");
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD^"), sourceHead);
    assertEquals(
      await gitOut(worktree, "diff", "--name-only", sourceHead, proposalHead),
      "discern.toml",
    );
    for (const proposal of batch.proposals) {
      assertEquals(proposal.commit, proposalHead);
      assertEquals(proposal.bound_commit, proposalHead);
    }
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      1,
    );
    const store = await readProposalStore(worktree);
    assertEquals(store.status, "ok");
    if (store.status === "ok") {
      assertEquals(
        store.store.proposals.map((proposal) => proposal.standard),
        ["docs", "sources"],
      );
      assert(
        store.store.proposals.every((proposal) =>
          proposal.commit === proposalHead &&
          proposal.bound_commit === proposalHead
        ),
      );
    }

    const revisedProposals = proposals.map((proposal) =>
      proposal.name === "sources"
        ? {
          ...proposal,
          reason: "The feature's source boundary requires one additional file.",
        }
        : proposal
    );
    const replacementPreview = await standardsProposeBatchResult(worktree, {
      proposals: revisedProposals,
      dryRun: true,
    });
    assert(replacementPreview.ok, JSON.stringify(replacementPreview));
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalHead);

    const replaced = await standardsProposeBatchResult(worktree, {
      proposals: revisedProposals,
    });
    assert(replaced.ok, JSON.stringify(replaced));
    assertEquals(
      (replaced.data as { proposal_batch?: { status: string } } | undefined)
        ?.proposal_batch?.status,
      "replaced",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalHead);
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      1,
    );

    const repeated = await standardsProposeBatchResult(worktree, {
      proposals: revisedProposals,
    });
    assert(repeated.ok, JSON.stringify(repeated));
    assertEquals(
      (repeated.data as { proposal_batch?: { status: string } } | undefined)
        ?.proposal_batch?.status,
      "unchanged",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalHead);
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      1,
    );

    await Deno.writeTextFile(
      join(worktree, "src", "feature.ts"),
      "refined feature\n",
    );
    await git(worktree, "commit", "-am", "Refine feature source");
    const descendant = await gitOut(worktree, "rev-parse", "HEAD");
    const renewed = await standardsProposeBatchResult(worktree, {
      proposals: revisedProposals,
    });
    assert(renewed.ok, JSON.stringify(renewed));
    assertEquals(
      (renewed.data as { proposal_batch?: { status: string } } | undefined)
        ?.proposal_batch?.status,
      "rebound",
    );
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), descendant);
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      2,
    );
    const renewedStore = await readProposalStore(worktree);
    assertEquals(renewedStore.status, "ok");
    if (renewedStore.status === "ok") {
      assert(
        renewedStore.store.proposals.every((proposal) =>
          proposal.bound_commit === descendant
        ),
      );
    }
    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
  });
});

Deno.test("a new proposal batch refuses existing sibling state before measurement or writes", async () => {
  await withTempDir(async (dir) => {
    const worktree = await batchProposalWorktree(
      dir,
      "proposal-existing-sibling",
    );
    const first = await standardsProposeBatchResult(worktree, {
      proposals: [{
        name: "sources",
        reason: "The feature requires one additional source file.",
      }],
    });
    assert(first.ok, JSON.stringify(first));
    const firstHead = await gitOut(worktree, "rev-parse", "HEAD");
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      1,
    );

    const refused = await standardsProposeBatchResult(worktree, {
      proposals: [{
        name: "docs",
        reason: "The feature requires one additional documentation file.",
      }],
    });
    assertEquals(refused.ok, false);
    assertEquals(refused.error, "proposal_stale");
    assertStringIncludes(refused.message ?? "", "existing proposal state");
    assertStringIncludes(refused.message ?? "", "No measurement or write ran");
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), firstHead);
    assertEquals(
      await proposalInvocationCount(worktree, "proposal-batch-runs"),
      1,
    );
  });
});

/** Assert that a transaction-owned path was removed. */
async function assertRejectsNotFound(path: string): Promise<void> {
  assertEquals(await statIfExists(path), undefined);
}

Deno.test("standards propose: one proposal's lifecycle — recorded, renewed, replaced, proved, challenged, revoked, staled by the trunk, rebound and landed", async (t) => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    const reasonA = "The feature adds one source file required by the product.";
    const reasonB =
      "A revised owner-facing reason for the same measured breach.";
    const reasonC = "The revised exact reason.";
    const proposalPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposals",
    );
    assert(proposalPath !== undefined);

    // The ceiling is really breached, and its evidence sits at this commit.
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    // Move beyond the measured commit touching BOTH standards' inputs: the
    // check's fresh measurements no longer describe the new HEAD, so the
    // propose must physically re-measure its named Standard (observable in the
    // counters) instead of replaying the check's evidence. The source count
    // itself stays 2 — only content changed.
    await Deno.mkdir(join(worktree, "docs"), { recursive: true });
    await Deno.writeTextFile(join(worktree, "docs", "later.md"), "later\n");
    await Deno.writeTextFile(join(worktree, "src", "base.ts"), "base grew\n");
    await git(worktree, "add", "docs/later.md", "src/base.ts");
    await git(worktree, "commit", "-m", "Move beyond measured commit");
    const targetRuns = await proposalInvocationCount(
      worktree,
      "proposal-target-runs",
    );
    const unrelatedRuns = await proposalInvocationCount(
      worktree,
      "proposal-unrelated-runs",
    );
    const before = await gitOut(worktree, "rev-parse", "HEAD");

    const proposed = await propose(worktree, reasonA);
    assertEquals(proposed.code, 0, proposed.output);
    const envelope = decodeCliResult(proposed.stdout, "standards propose");
    assertEquals(envelope.verb, "standards propose");
    const proposalResult = proposalOf(proposed.stdout);
    const commit = await gitOut(worktree, "rev-parse", "HEAD");

    await t.step(
      "standards propose records the breached value in one config-only commit",
      async () => {
        assertEquals(proposalResult.status, "recorded");
        assertEquals(proposalResult.proposal.standard, "sources");
        assertEquals(proposalResult.proposal.measured_commit, before);
        assertEquals(proposalResult.proposal.trunk_limit, 1);
        assertEquals(proposalResult.proposal.proposed_limit, 2);
        assertEquals(proposalResult.proposal.measurement, 2);
        assertEquals(proposalResult.proposal.delta, 1);
        assertEquals(proposalResult.proposal.evidence_paths, [
          "src/base.ts",
          "src/feature.ts",
        ]);
        assertEquals(
          await gitOut(worktree, "show", "--name-only", "--format=", "HEAD"),
          "discern.toml",
        );
        assertStringIncludes(
          await Deno.readTextFile(join(worktree, "discern.toml")),
          "limit = 2",
        );
        assertEquals(proposalResult.proposal.commit, commit);
        assertEquals(proposalResult.proposal.bound_commit, commit);
      },
    );

    await t.step("standards propose remeasures stale evidence", () => {
      // The standalone check measured one commit earlier; the proposal binds
      // its own fresh measurement to the commit it was asked about.
      assertEquals(proposalResult.proposal.measured_commit, before);
    });

    await t.step(
      "standards propose measures only its named Standard",
      async () => {
        assertEquals(
          await proposalInvocationCount(worktree, "proposal-target-runs"),
          targetRuns + 1,
        );
        assertEquals(
          await proposalInvocationCount(worktree, "proposal-unrelated-runs"),
          unrelatedRuns,
        );
      },
    );

    await t.step(
      "standards propose is idempotent and replaces only the reason",
      async () => {
        // The canonical store requires the descendant binding. A private-era
        // version number and missing field are malformed, never upgraded in place.
        const currentStoreText = await Deno.readTextFile(proposalPath);
        const incompleteStore = decodeWith(
          MutableProposalStoreFixtureSchema,
          currentStoreText,
        );
        incompleteStore.version = 1;
        delete incompleteStore.proposals[0]?.bound_commit;
        await Deno.writeTextFile(
          proposalPath,
          `${JSON.stringify(incompleteStore)}\n`,
        );
        assertEquals((await readProposalStore(worktree)).status, "malformed");
        await Deno.writeTextFile(proposalPath, currentStoreText);

        const repeated = await propose(worktree, reasonA);
        assertEquals(repeated.code, 0, repeated.output);
        assertEquals(proposalOf(repeated.stdout), {
          status: "unchanged",
          proposal: {
            ...proposalResult.proposal,
            bound_commit: commit,
          },
        });
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), commit);

        const replaced = await propose(worktree, reasonB);
        assertEquals(replaced.code, 0, replaced.output);
        const replacement = proposalOf(replaced.stdout);
        assertEquals(replacement.status, "replaced");
        assertEquals(replacement.proposal.reason, reasonB);
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), commit);
      },
    );

    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    // A recorded effort grant never covers a standard limit proposal: the
    // flagless accept still stops for the exact owner approval.
    await grantEffort(
      worktree,
      await gitOut(worktree, "branch", "--show-current"),
      "2026-09-12T10:00:00.000Z",
    );
    const queueStop = await runAgent(worktree, [
      "accept",
      "queue",
      "--json",
    ]);
    assertEquals(queueStop.code, 1, queueStop.output);
    const queueRefusal = decodeCliResult(queueStop.stdout, "accept");
    assertEquals(queueRefusal.error, "awaiting_standard_approval");
    assertStringIncludes(queueRefusal.message ?? "", "Approval token:");
    assertEquals((await readSubmission(worktree)).status, "missing");
    const firstStop = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(firstStop.code, 1, firstStop.output);
    const firstToken = approvalChallenge(firstStop.stdout).token;

    await t.step(
      "proposal-bearing Gate Proof is green and prominent while accept needs exact approval",
      async () => {
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
          "Standard proposal awaiting exact owner approval: `sources`",
        );
        assertEquals(doneData.standards?.[0]?.measurement, "measured");
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), commit);

        const refusal = decodeCliResult(firstStop.stdout, "accept");
        assertEquals(refusal.error, "awaiting_standard_approval");
        const approval = approvalChallenge(firstStop.stdout);
        assertMatch(approval.token, /^[0-9a-f]{64}$/u);
        assertEquals(approval.proposal.standard, "sources");
        assertEquals(approval.proposal.proposed_limit, 2);
        assertEquals(approval.proposal.reason, reasonB);
        assertStringIncludes(
          refusal.message ?? "",
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
        assertStringIncludes(
          await Deno.readTextFile(proposalPath),
          '"sources"',
        );
      },
    );

    await t.step(
      "reason changes rotate exact approval tokens and revocation blocks landing",
      async () => {
        const replaced = await propose(worktree, reasonC);
        assertEquals(replaced.code, 0, replaced.output);
        // A deliberate rerun re-proves the replaced proposal and renders the
        // Markdown Proof, which carries the proposal and its exact reason.
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
        assertTerminalTextIncludes(markdown.stdout, reasonC);

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

        const store = await Deno.readTextFile(proposalPath);
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
        // The owner's record returns exactly as it was, so the lifecycle continues.
        await Deno.writeTextFile(proposalPath, store);
      },
    );

    await t.step(
      "trunk movement stales a proposal until the branch updates",
      async () => {
        await Deno.writeTextFile(join(dir, "trunk.txt"), "trunk moved\n");
        await git(dir, "add", "trunk.txt");
        await git(dir, "commit", "-m", "Move trunk without changing Standards");
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
        const proposalHead = await gitOut(worktree, "rev-parse", "HEAD");
        const behind = await propose(worktree, reasonC);
        assertEquals(behind.code, 1, behind.output);
        assertEquals(
          decodeCliResult(behind.stdout, "standards propose").error,
          "proposal_stale",
        );
        assertTerminalTextIncludes(behind.stdout, "discern update");
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalHead);
      },
    );

    await git(worktree, "merge", "--no-edit", "--no-gpg-sign", "main");
    const descendant = await gitOut(worktree, "rev-parse", "HEAD");
    const currentTrunk = await gitOut(dir, "rev-parse", "main");
    let reboundResult: ProposalResult | undefined;

    await t.step(
      "an unchanged proposal rebinds to a measured descendant without another commit",
      async () => {
        const beforePreview = await Deno.readTextFile(proposalPath);

        const preview = await propose(worktree, reasonC, "--dry-run");
        assertEquals(preview.code, 0, preview.output);
        assertEquals(
          decodeCliResult(preview.stdout, "standards propose").plan?.steps.map(
            (step) => step.label,
          ),
          ["sources", "rebind-sources"],
        );
        assertEquals(await Deno.readTextFile(proposalPath), beforePreview);
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), descendant);

        const rebound = await propose(worktree, reasonC);
        assertEquals(rebound.code, 0, rebound.output);
        reboundResult = proposalOf(rebound.stdout);
        assertEquals(reboundResult.status, "rebound");
        assertEquals(
          reboundResult.proposal.commit,
          proposalResult.proposal.commit,
        );
        assertEquals(
          reboundResult.proposal.measured_commit,
          proposalResult.proposal.measured_commit,
        );
        assertEquals(reboundResult.proposal.bound_commit, descendant);
        assertEquals(reboundResult.proposal.trunk_commit, currentTrunk);
        assertEquals(reboundResult.proposal.evidence_paths, [
          "src/base.ts",
          "src/feature.ts",
        ]);
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), descendant);

        const repeated = await propose(worktree, reasonC);
        assertEquals(repeated.code, 0, repeated.output);
        assertEquals(proposalOf(repeated.stdout).status, "unchanged");
        assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), descendant);
      },
    );
    assert(reboundResult !== undefined);

    const proved = await runAgent(worktree, ["done", "--json"]);
    assertEquals(proved.code, 0, proved.output);

    await t.step(
      "the Gate Proof carries the rebound proposal at the descendant",
      () => {
        const proofProposal = (decodeCliResult(proved.stdout, "done").data as {
          proof?: {
            standard_proposals?: {
              commit: string;
              bound_commit: string;
            }[];
          };
        }).proof?.standard_proposals?.[0];
        assertEquals(proofProposal, {
          ...reboundResult?.proposal,
          commit: proposalResult.proposal.commit,
          bound_commit: descendant,
        });
      },
    );

    await t.step(
      "accept lands the already-proved proposal commit after exact approval",
      async () => {
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
        const result = decodeCliResult(accepted.stdout, "accept");
        assert(result.data !== undefined && "consent" in result.data);
        const data = result.data;
        assertEquals(data.landing?.trunk_landed, true, accepted.stdout);
        // The landed line states the proposal in its resolved state — the
        // awaiting-decision segment never survives next to its own resolution.
        assertStringIncludes(
          String(data.proof_line),
          "Standard proposal approved by the owner: `sources`",
        );
        assertEquals(String(data.proof_line).includes("awaiting"), false);
        assertEquals(data.standard_approvals?.[0]?.standard, "sources");
        assertEquals(data.standard_approvals?.[0]?.proposed_limit, 2);
        assertEquals(data.standard_approvals?.[0]?.reason, reasonC);
        assertEquals(await gitOut(dir, "rev-parse", "main"), descendant);
        assertStringIncludes(
          await Deno.readTextFile(join(dir, "discern.toml")),
          "limit = 2",
        );
        await assertRejectsNotFound(worktree);
      },
    );
  });
});

Deno.test("standards propose refuses trunk, unknown, dirty and deleted states read-only", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proposalConfig());
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);

    await t.step("standards propose refuses the trunk", async () => {
      const trunk = await propose(
        dir,
        "The breached limit belongs to a feature branch.",
      );
      assertEquals(trunk.code, 1, trunk.output);
      assertTerminalTextIncludes(
        String(decodeCliResult(trunk.stdout, "standards propose").message),
        "never edits the trunk",
      );
    });

    const worktree = await addWorktree(dir, "proposal-preconditions");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");
    const head = await gitOut(worktree, "rev-parse", "HEAD");

    await t.step(
      "standards propose refuses unknown and dirty states",
      async () => {
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

        await Deno.writeTextFile(join(worktree, "scratch.txt"), "dirty\n");
        const dirty = await propose(
          worktree,
          "Dirty trees cannot enter a config-only transaction.",
        );
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
        await Deno.remove(join(worktree, "scratch.txt"));
      },
    );

    await t.step("a deleted Standard cannot carry a proposal", async () => {
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
      const deleted = await propose(
        worktree,
        "Deleted Standards cannot carry proposals.",
      );
      assertEquals(deleted.code, 1, deleted.output);
      assertEquals(
        decodeCliResult(deleted.stdout, "standards propose").error,
        "unknown_standard",
      );
    });
  });
});

Deno.test("standards propose refuses failed measurements", async () => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(
      dir,
      "echo measurement-failed; exit 7",
    );
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const failed = await propose(
      worktree,
      "Failed commands carry no numeric proposal evidence.",
    );
    assertEquals(failed.code, 1, failed.output);
    assertTerminalTextIncludes(
      String(decodeCliResult(failed.stdout, "standards propose").message),
      "could not complete",
    );
  });
});

Deno.test("an unproposed simultaneous breach remains an ordinary failure", async () => {
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

Deno.test("a changed fresh measurement stales a proposal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      proposalConfig(
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
    const proposed = await propose(
      worktree,
      "The initial measured value is two.",
    );
    assertEquals(proposed.code, 0, proposed.output);
    const proposalHead = await gitOut(worktree, "rev-parse", "HEAD");
    await git(worktree, "config", "test.metric", "3");
    const changed = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(changed.code, 1, changed.output);
    assertTerminalTextIncludes(
      changed.stdout,
      "sources 3 exceeds the ceiling 2",
    );
    const stale = await runAgent(worktree, ["standards", "--json"]);
    assertEquals(stale.code, 1, stale.output);
    assertTerminalTextIncludes(
      stale.stdout,
      "latest fresh measurement is 3",
    );
    const reproposed = await propose(
      worktree,
      "The initial measured value is two.",
    );
    assertEquals(reproposed.code, 1, reproposed.output);
    assertEquals(
      decodeCliResult(reproposed.stdout, "standards propose").error,
      "proposal_stale",
    );
    assertTerminalTextIncludes(
      reproposed.stdout,
      "renewal cannot change the proposed value",
    );
    assertTerminalTextIncludes(reproposed.stdout, "new value 3, delta 2");
    assertTerminalTextIncludes(reproposed.stdout, "obtain fresh agreement");
    assertTerminalTextIncludes(reproposed.stdout, "Restore the main limit 1");
    assertEquals(await gitOut(worktree, "rev-parse", "HEAD"), proposalHead);
    assertStringIncludes(
      await Deno.readTextFile(join(worktree, "discern.toml")),
      "limit = 2",
    );
  });
});

Deno.test("proposal state from a newer discern refuses replacement, and recovery unwinds a pre-commit edit and finalizes a post-commit record", async (t) => {
  await withTempDir(async (dir) => {
    const worktree = await proposalWorktree(dir);
    assertEquals((await runAgent(worktree, ["standards", "--json"])).code, 1);
    const measuredCommit = await gitOut(worktree, "rev-parse", "HEAD");
    const branch = await gitOut(worktree, "branch", "--show-current");
    const reason = "The feature adds one source file required by the product.";
    const proposalPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposals",
    );
    assert(proposalPath !== undefined);
    const transactionPath = await gitAdminStatePath(
      worktree,
      "standardLimitProposalTransaction",
    );
    assert(transactionPath !== undefined);

    await t.step(
      "proposal recovery unwinds a pre-commit edit and finalizes a post-commit record",
      async () => {
        await Deno.mkdir(dirname(transactionPath), { recursive: true });
        const plannedProposal = {
          standard: "sources",
          measured_commit: measuredCommit,
          definition_fingerprint:
            "recovery-validates-the-real-plan-after-unwind",
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
              version: ON_DISK_FORMATS.standardLimitProposalTransaction.version,
              branch,
              source_commit: measuredCommit,
              config_path: "discern.toml",
              proposals: [plannedProposal],
            })
          }\n`,
        );
        await writeConfig(
          worktree,
          proposalConfig().replace("limit = 1", "limit = 2"),
        );

        const resumed = await propose(worktree, reason);
        assertEquals(resumed.code, 0, resumed.output);
        const resumedProposal = proposalOf(resumed.stdout);
        assertEquals(resumedProposal.status, "recorded");
        assertEquals(resumedProposal.proposal.measured_commit, measuredCommit);
        await assertRejectsNotFound(transactionPath);

        await Deno.remove(proposalPath);
        const {
          commit: _commit,
          bound_commit: _boundCommit,
          ...proposalBeforeCommit
        } = resumedProposal.proposal;
        await Deno.writeTextFile(
          transactionPath,
          `${
            JSON.stringify({
              version: ON_DISK_FORMATS.standardLimitProposalTransaction.version,
              branch,
              source_commit: measuredCommit,
              config_path: "discern.toml",
              proposals: [proposalBeforeCommit],
            })
          }\n`,
        );

        const finalized = await propose(worktree, reason);
        assertEquals(finalized.code, 0, finalized.output);
        const finalizedProposal = proposalOf(finalized.stdout);
        assertEquals(finalizedProposal.status, "recovered");
        assertEquals(
          finalizedProposal.proposal.commit,
          resumedProposal.proposal.commit,
        );
        await assertRejectsNotFound(transactionPath);
        assertStringIncludes(
          await Deno.readTextFile(proposalPath),
          '"sources"',
        );
      },
    );

    await t.step(
      "proposal state written by a newer discern refuses replacement",
      async () => {
        // The transaction refusal is read-only: recovery parses the journal
        // before any measurement, so it can run over the recovered state.
        const newerTransaction = `${
          JSON.stringify({
            version: ON_DISK_FORMATS.standardLimitProposalTransaction.version +
              1,
          })
        }\n`;
        await Deno.writeTextFile(transactionPath, newerTransaction);

        const transactionRefusal = await propose(worktree, reason);
        assertEquals(transactionRefusal.code, 1, transactionRefusal.output);
        assertStringIncludes(
          transactionRefusal.stdout,
          "standard-limit-proposal-transaction",
        );
        assertEquals(
          await Deno.readTextFile(transactionPath),
          newerTransaction,
        );
        await Deno.remove(transactionPath);

        // The store refusal fires when the propose finally persists its
        // record, so it needs a proposable state to journey that far. The
        // recovered proposal's limit edit cannot stand once its record is
        // replaced by the unreadable store, so restore the trunk limit; the
        // ceiling is then breached again and freshly proposable.
        await writeConfig(worktree, proposalConfig());
        await git(worktree, "add", "discern.toml");
        await git(worktree, "commit", "-m", "Restore the trunk limit");
        const newerStore = `${
          JSON.stringify({
            version: ON_DISK_FORMATS.standardLimitProposalStore.version + 1,
            proposals: [],
          })
        }\n`;
        await Deno.writeTextFile(proposalPath, newerStore);
        assertEquals((await readProposalStore(worktree)).status, "newer");

        const storeRefusal = await propose(worktree, reason);
        assertEquals(storeRefusal.code, 1, storeRefusal.output);
        assertStringIncludes(
          storeRefusal.stdout,
          "standard-limit-proposal-store",
        );
        assertEquals(await Deno.readTextFile(proposalPath), newerStore);
      },
    );
  });
});

Deno.test("both proposal entry points share one grounding and one trunk baseline", async () => {
  // The scalar CLI form and the MCP batch keep their own reconciliation policy
  // and their own result projection, but the preconditions they establish
  // first — reasons, branch, HEAD, write authority, recovery, a clean tree,
  // the named standards, the trunk baseline — belong to one implementation.
  // A re-inlined prelude is the duplication this guard exists to prevent.
  const files = await structuralGuardScope({
    guard:
      "tests/engine_standard_limit_proposals_test.ts#shared-proposal-ground",
    universe: "authored-ts",
    narrow: {
      reason:
        "One module owns every standard-limit proposal entry point; the invariant is that no entry point re-implements another's preconditions.",
      include: (path) => path === "src/engine/gate/standard_proposals.ts",
    },
  });
  const module = files[0];
  assert(module !== undefined, "the proposal module must enter the guard");
  const source = await Deno.readTextFile(join(REPO_ROOT, module));
  const entries = [
    ...source.matchAll(/export async function (standardsPropose\w*)\(/gu),
  ];
  assertEquals(
    entries.map((entry) => entry[1]),
    ["standardsProposeBatchResult", "standardsProposeResult"],
  );
  for (const entry of entries) {
    const from = entry.index ?? 0;
    const next = source.indexOf("\nexport ", from + 1);
    const body = source.slice(from, next === -1 ? undefined : next);
    for (const shared of ["groundProposalRequest(", "proposalSubjects("]) {
      assertStringIncludes(
        body,
        shared,
        `${entry[1]} must reach its preconditions through ${shared}`,
      );
    }
  }
});
