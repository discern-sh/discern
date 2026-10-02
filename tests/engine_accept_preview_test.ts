/**
 * A landing preview reports what it found as facts beside its plan: the
 * revision that lands with its commits and diff stats, whether the trunk
 * moved so the landing composes first, the authority, the queue walk after
 * it, and the records the landing consumes. Human surfaces word these facts
 * instead of parsing the plan's detail lines.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { recordSubmission } from "../src/engine/worktree/submission_writer.ts";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import {
  acceptPreviewFacts,
  type AcceptPreviewRow,
} from "../src/engine/worktree/accept_preview.ts";
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
import type { AcceptPreviewData } from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "preview-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
].join("\n");

/** One committed effort worktree with one new file of two lines. */
async function effortWithWork(dir: string, name: string): Promise<string> {
  const wt = await addWorktree(dir, name);
  await Deno.writeTextFile(join(wt, `${name}.txt`), `${name}\nwork\n`);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
  return wt;
}

/** Queue an already-proven effort, as an agent's accept would. */
async function submit(wt: string, effort: string): Promise<void> {
  const proof = await inspectGateProof(wt);
  assert(proof.status === "honored" && proof.proof_data?.completion);
  await recordSubmission(wt, {
    id: crypto.randomUUID(),
    effort_id: effort,
    branch: await gitOut(wt, "branch", "--show-current"),
    head: await gitOut(wt, "rev-parse", "HEAD"),
    tree: await gitOut(wt, "rev-parse", "HEAD^{tree}"),
    proof: {
      candidate_id: proof.proof_data.completion.candidate_id,
      proof_id: proof.proof_data.completion.proof_id,
    },
    submitted_at: "2026-09-12T11:00:00.000Z",
  });
}

/** Run `accept --dry-run` in an effort and return its preview facts and plan. */
async function preview(
  wt: string,
): Promise<{
  facts: AcceptPreviewData;
  plan:
    | {
      readonly steps: readonly { label: string; note?: string | undefined }[];
    }
    | undefined;
}> {
  const run = await runAgent(wt, ["accept", "--dry-run", "--json"]);
  assertEquals(run.code, 0, run.output);
  const result = decodeCliResult(run.stdout, "accept");
  const facts = result.data !== undefined && "preview" in result.data
    ? result.data.preview
    : undefined;
  assert(facts !== undefined, run.output);
  return { facts, plan: result.plan };
}

Deno.test("a landing preview names what lands, its authority, the queue walk after it, and how far the trunk moved", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const alpha = await effortWithWork(dir, "alpha");
    const beta = await effortWithWork(dir, "beta");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
    const betaBranch = await gitOut(beta, "branch", "--show-current");
    await grantEffort(beta, betaBranch, "2026-09-12T10:00:00.000Z");
    await submit(beta, "beta");

    const { facts, plan } = await preview(alpha);
    assertEquals(facts.lands, {
      head: await gitOut(alpha, "rev-parse", "HEAD"),
      commits: 1,
      files: 1,
      insertions: 2,
      deletions: 0,
    });
    assertEquals(facts.integrates, undefined);
    assertEquals(facts.authority.kind, "conversation-required");
    assertEquals(facts.authority.covered_paths, 0);
    assertEquals(facts.queue_walk.map((row) => row.branch), [betaBranch]);
    assertEquals(facts.landing_in_progress, undefined);
    assertEquals([facts.ends_grant, facts.leaves_queue], [false, false]);
    const fastForward = plan?.steps.find((step) =>
      step.label === BUILT_IN_STEP_LABELS.fastForwardTrunk
    );
    assertStringIncludes(fastForward?.note ?? "", "main → agent/alpha");

    // The pre-authorized, queued effort's own preview consumes both records
    // and walks nothing further.
    const own = await preview(beta);
    assertEquals(own.facts.authority.kind, "authorized");
    assertEquals(own.facts.authority.source, "effort-grant");
    assertEquals([own.facts.ends_grant, own.facts.leaves_queue], [
      true,
      true,
    ]);
    assertEquals(own.facts.queue_walk, []);

    // Once the trunk moves past alpha's base, its preview composes first and
    // says by how much; the proven revision and what it lands are unchanged.
    for (const name of ["one", "two"]) {
      await Deno.writeTextFile(join(dir, `${name}.txt`), `${name}\n`);
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", `main: ${name}`, "--no-gpg-sign");
    }
    const moved = await preview(alpha);
    assertEquals(moved.facts.integrates, { behind: 2 });
    assertEquals(moved.facts.lands.commits, 1);
    const combined = moved.plan?.steps.find((step) =>
      step.label === BUILT_IN_STEP_LABELS.fastForwardTrunk
    );
    assertStringIncludes(combined?.note ?? "", "the combined commit");
  });
});

Deno.test("preview facts keep unknown counts absent, name a running landing, and carry the owner decisions it needs", () => {
  const row = (
    effort: string,
    patch: Partial<AcceptPreviewRow> = {},
  ): AcceptPreviewRow => ({
    effort,
    branch: `agent/${effort}`,
    head: effort.repeat(4),
    authority: "pre-authorized",
    readiness: "ready",
    ...patch,
  });
  const facts = acceptPreviewFacts({
    effort: "self",
    head: "f".repeat(40),
    proof: { files_total: 3, insertions: 5, deletions: 1 },
    standardApprovals: 1,
    commits: "unknown",
    behind: "unknown",
    authority: {
      kind: "conversation-required",
      standingScopes: ["docs"],
      classifications: [
        { path: "docs/a.md", scopes: ["docs"] },
        { path: "src/b.ts", scopes: [] },
      ],
      uncovered: [{ path: "src/b.ts", scopes: [] }],
      warnings: [],
    },
    submitted: true,
    ignored: {
      status: "changed",
      changed_roots: ["site/_site"],
      changed_total: 1,
      truncated: false,
    },
    rows: [
      row("self"),
      row("busy", { operation_handle: "lnd-1" }),
      row("waiting", { readiness: "waiting" }),
      row("owner", { authority: "awaiting-owner" }),
      row("next"),
    ],
    checkpoints: { stale: ["map-drift"], unmet: [] },
  });
  assertEquals(facts.lands.commits, undefined);
  assertEquals(facts.integrates, {});
  assertEquals(facts.authority, {
    kind: "conversation-required",
    covered_paths: 1,
    uncovered_paths: 1,
  });
  assertEquals(facts.queue_walk.map((entry) => entry.effort), ["next"]);
  assertEquals(facts.landing_in_progress?.effort, "busy");
  assertEquals(facts.ignored_roots, ["site/_site"]);
  assertEquals([facts.ends_grant, facts.leaves_queue], [false, true]);
  assertEquals(facts.standard_approvals, 1);
  assertEquals(facts.stale_declarations, ["map-drift"]);
  assertEquals(facts.variances, undefined);
});
