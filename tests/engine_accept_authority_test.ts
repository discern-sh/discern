/**
 * Acceptance's recorded-authority paths: standing coverage, per-effort grants,
 * fail-closed refusals, dry-run disclosure, proof evidence, and logbook lift.
 *
 * Guards: boundary:landing-authority, claim:gate-grants-no-authority
 */

import { runGit } from "../src/shared/subprocess.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { basename, dirname, join } from "@std/path";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { claimEffortGrant } from "../src/engine/worktree/effort_grant_cleanup.ts";
import {
  acceptanceTransactionMarkerRef,
  fastForwardCheckedOutBranch,
  readAcceptanceTransactionMarker,
} from "../src/engine/worktree/git.ts";
import {
  ACCEPTANCE_TRANSACTION_BOUNDARIES,
  type AcceptanceTransactionBoundary,
  withAcceptanceTransactionLock,
} from "../src/engine/worktree/acceptance_transaction.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
import {
  LANDING_CONSENT_SOURCES,
  type LandingConsent,
  type LandingConsentSource,
} from "../src/shared/consent.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import {
  addWorktree,
  convergeFixtureGitattributes,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { waitForPendingCondition } from "./waiting.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import { z } from "@zod/zod";

const INTERRUPTION_FIXTURES = {
  "effort-claim": "pre-CAS claim and post-CAS consumption",
  "trunk-ref": "post-CAS checkout convergence, local edits, and ABA movement",
  "proof-note": "post-CAS recovery records or discloses durable Proof evidence",
} as const satisfies Record<AcceptanceTransactionBoundary, string>;

interface SuccessfulLandingCase {
  /** The canonical authority source this real landing exercises. */
  readonly source: LandingConsentSource;
  /** The consent payload the envelope and Logbook must agree on. */
  readonly consent: LandingConsent;
  /** The authority wording the landing Proof must carry. */
  readonly proofPhrase: string;
}

/**
 * The successful landing cases. Tests take their expectations from this
 * declaration, and the coverage audit iterates the same declaration, so test
 * execution order carries no evidence.
 */
const SUCCESSFUL_LANDING_CASES = [
  {
    source: "conversation",
    consent: { source: "conversation" },
    proofPhrase: "landed with conversation consent",
  },
  {
    source: "effort-grant",
    consent: { source: "effort-grant" },
    proofPhrase: "landed under effort grant",
  },
  {
    source: "standing-grant",
    consent: { source: "standing-grant", scopes: ["map"] },
    proofPhrase: "landed under standing grant: `map`",
  },
] as const satisfies readonly SuccessfulLandingCase[];

/** Resolve one declared successful landing case by its canonical source. */
function successfulLandingCase(
  source: LandingConsentSource,
): SuccessfulLandingCase {
  const testCase = SUCCESSFUL_LANDING_CASES.find((c) => c.source === source);
  assert(testCase !== undefined, `no successful landing case for ${source}`);
  return testCase;
}

/** Hold a successful envelope, Proof line, and Logbook event to one authority fact. */
function assertSuccessfulLandingEvidence(
  consent: {
    readonly source: LandingConsentSource;
    readonly scopes?: string[] | undefined;
  },
  proofLine: string,
  event: LogbookEvent | undefined,
  testCase: SuccessfulLandingCase,
): void {
  assertEquals(
    {
      source: consent.source,
      ...(consent.scopes === undefined ? {} : { scopes: consent.scopes }),
    },
    testCase.consent,
  );
  assertStringIncludes(proofLine, testCase.proofPhrase);
  assert(event?.kind === "verb");
  assertEquals(event.consent, {
    source: testCase.consent.source,
    ...(testCase.consent.scopes === undefined
      ? {}
      : { scopes: [...testCase.consent.scopes] }),
  });
}

Deno.test("every acceptance transaction boundary has interruption fixtures", () => {
  assertEquals(
    ACCEPTANCE_TRANSACTION_BOUNDARIES.map((boundary) => boundary.id).sort(),
    Object.keys(INTERRUPTION_FIXTURES).sort(),
  );
});

/** Render the minimal acceptance config with optional standing grants for authority cases. */
function authorityConfig(grants: string[] = []): string {
  return [
    "[meta]",
    "bootstrapped = true",
    "",
    "[project]",
    'slug = "authority-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = ":"',
    "",
    "[scopes.map]",
    'paths = ["docs/**"]',
    "neutral = true",
    "",
    "[scopes.engine]",
    'paths = ["src/**"]',
    "",
    ...(grants.length > 0
      ? [
        "[acceptance]",
        `pre_authorized = ${JSON.stringify(grants)}`,
        "",
      ]
      : []),
  ].join("\n");
}

/** Materialize and commit one exact changed-path set on the worktree under test. */
async function commitPaths(
  worktree: string,
  paths: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [rel, contents] of Object.entries(paths)) {
    const path = join(worktree, rel);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
  }
  await git(worktree, "add", "-A");
  await git(
    worktree,
    "commit",
    "-q",
    "-m",
    "authority fixture",
    "--no-gpg-sign",
  );
}

/** Scaffold a repository, create an isolated branch, and commit its authority fixture. */
async function readyWorktree(
  dir: string,
  config: string,
  paths: Readonly<Record<string, string>>,
  name: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await gitInit(dir);
  const worktree = await addWorktree(dir, name);
  await commitPaths(worktree, paths);
  const completed = await runAgent(worktree, ["done", "--json"]);
  assertEquals(completed.code, 0, completed.output);
  return worktree;
}

/** Read every logbook shard and retain only recorded acceptance verb events. */
async function acceptEvents(dir: string): Promise<LogbookEvent[]> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const events: LogbookEvent[] = [];
  for await (const entry of Deno.readDir(logDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
    const text = await Deno.readTextFile(join(logDir, entry.name));
    for (const line of text.split("\n").filter((value) => value !== "")) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event", line);
      if (parsed.event.kind === "verb" && parsed.event.verb === "accept") {
        events.push(parsed.event);
      }
    }
  }
  return events;
}

/** Wait for an acceptance boundary artifact while failing if the operation settles first. */
async function waitForPath<T>(
  path: string,
  pending: Promise<T>,
): Promise<void> {
  await waitForPendingCondition(
    pending,
    async () => await targetExists(path),
    `accept readiness marker ${path}`,
  );
}

interface InterruptedAcceptanceFixture {
  readonly id: string;
  readonly journal: string;
}

/**
 * Inject the durable evidence an acceptance must leave before it claims
 * authority or advances the trunk.
 */
async function injectInterruptedAcceptance(
  worktree: string,
  mainRepo: string,
  expected: string,
  target: string,
  effortClaimPath?: string,
  consent?: LandingConsent,
): Promise<InterruptedAcceptanceFixture> {
  const id = effortClaimPath === undefined
    ? crypto.randomUUID()
    : basename(effortClaimPath);
  const journal = await gitAdminStatePath(
    worktree,
    "acceptanceTransaction",
  );
  assert(journal !== undefined);
  await Deno.mkdir(dirname(journal), { recursive: true });
  const boundConsent = consent ??
    (effortClaimPath === undefined
      ? { source: "conversation" as const }
      : { source: "effort-grant" as const });
  await Deno.writeTextFile(
    journal,
    `${
      JSON.stringify({
        version: 1,
        id,
        worktree_branch: await gitOut(worktree, "branch", "--show-current"),
        trunk: "main",
        expected_trunk: expected,
        target,
        main_repo: mainRepo,
        effort_claim: effortClaimPath !== undefined,
        consent: boundConsent,
        variances: [],
        standard_proposals: [],
      })
    }\n`,
  );
  return { id, journal };
}

/** Record the per-worktree proof ref for an interrupted transaction and verify its target. */
async function injectCommittedAcceptanceMarker(
  worktree: string,
  fixture: InterruptedAcceptanceFixture,
  target: string,
): Promise<void> {
  await git(
    worktree,
    "update-ref",
    acceptanceTransactionMarkerRef(fixture.id),
    target,
  );
  assertEquals(
    await readAcceptanceTransactionMarker(worktree, fixture.id),
    { kind: "present", target },
  );
}

Deno.test("accept previews standing authority without landing, then lands flagless under the standing grant and records its scopes", async (t) => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(["map"]),
      { "docs/guide.md": "covered\n" },
      "standing",
    );

    await t.step(
      "accept dry-run reports standing authority without landing",
      async () => {
        const preview = await runAgent(worktree, [
          "accept",
          "--dry-run",
          "--json",
        ]);
        assertEquals(preview.code, 0, preview.output);
        const envelope = decodeCliResult(preview.stdout, "accept");
        assertEquals(envelope.dry_run, true);
        assertStringIncludes(
          (envelope.plan?.details ?? []).join("\n"),
          "Authority:     standing grant (map)",
        );
        assert(await targetExists(worktree));
        assertEquals(await targetExists(join(dir, "docs", "guide.md")), false);
      },
    );

    await t.step(
      "accept lands flagless under a standing grant and records its scopes",
      async () => {
        const landed = await runAgent(worktree, ["accept", "--json"]);
        assertEquals(landed.code, 0, landed.output);
        const envelope = decodeCliResult(landed.stdout, "accept");
        assertResultDataKey(envelope, "consent");
        const { consent, proof_line: proofLine } = envelope.data;
        assert(consent !== undefined && proofLine !== undefined);
        assertEquals(envelope.data.scopes_changed, ["map"]);
        assertEquals(await targetExists(worktree), false);
        assertEquals(
          await Deno.readTextFile(join(dir, "docs", "guide.md")),
          "covered\n",
        );

        const events = await acceptEvents(dir);
        const event = events.at(-1);
        assertSuccessfulLandingEvidence(
          consent,
          proofLine,
          event,
          successfulLandingCase("standing-grant"),
        );
        assert(event?.kind === "verb");
        assertEquals(event.scopes, ["map"]);
      },
    );
  });
});

Deno.test("landing compare-and-swap rejects an ancestor trunk advance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["map"]));
    await gitInit(dir);
    const expected = await gitOut(dir, "rev-parse", "main");
    const worktree = await addWorktree(dir, "cas-race");

    // B is a policy-changing ancestor of the final validated C.
    await writeConfig(worktree, authorityConfig());
    await git(worktree, "add", "discern.toml");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "revoke standing grant",
      "--no-gpg-sign",
    );
    const advanced = await gitOut(worktree, "rev-parse", "HEAD");
    await commitPaths(worktree, { "docs/guide.md": "validated C\n" });
    const validated = await gitOut(worktree, "rev-parse", "HEAD");
    const staleTransaction = crypto.randomUUID();

    // A concurrent landing moves main A→B and converges its checkout.
    assertEquals(
      await fastForwardCheckedOutBranch(
        dir,
        "main",
        expected,
        advanced,
      ),
      { kind: "updated" },
    );

    // B remains an ancestor of C, so `merge --ff-only C` would accept stale
    // authority. The expected-old ref transaction must refuse instead.
    const stale = await fastForwardCheckedOutBranch(
      dir,
      "main",
      expected,
      validated,
      {
        transactionId: staleTransaction,
        transactionCwd: worktree,
      },
    );
    assertEquals(stale.kind, "moved");
    assertEquals(await gitOut(dir, "rev-parse", "main"), advanced);
    assertEquals(
      await readAcceptanceTransactionMarker(worktree, staleTransaction),
      { kind: "missing" },
      "a refused trunk CAS must not create half of the coupled marker update",
    );
    assertEquals(await targetExists(join(dir, "docs", "guide.md")), false);
    assert(await targetExists(worktree));
  });
});

Deno.test("landing compare-and-swap converges the unchanged trunk checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["map"]));
    await gitInit(dir);
    const expected = await gitOut(dir, "rev-parse", "main");
    const worktree = await addWorktree(dir, "cas-control");
    await commitPaths(worktree, { "docs/guide.md": "landed\n" });
    const validated = await gitOut(worktree, "rev-parse", "HEAD");
    const transactionId = crypto.randomUUID();

    assertEquals(
      await fastForwardCheckedOutBranch(
        dir,
        "main",
        expected,
        validated,
        { transactionId, transactionCwd: worktree },
      ),
      { kind: "updated" },
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), validated);
    assertEquals(
      await readAcceptanceTransactionMarker(worktree, transactionId),
      { kind: "present", target: validated },
      "the successful trunk CAS must publish its recovery marker atomically",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, "docs", "guide.md")),
      "landed\n",
    );
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
  });
});

Deno.test("accept retry reconciles an interruption after trunk CAS without entering its dirty guard", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed before checkout convergence\n" },
      "cas-interruption",
    );
    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
    );

    await git(
      dir,
      "update-ref",
      "-m",
      `discern accept transaction ${interrupted.id}`,
      "refs/heads/main",
      target,
      expected,
    );
    await injectCommittedAcceptanceMarker(worktree, interrupted, target);
    assert(
      (await gitOut(dir, "status", "--porcelain")) !== "",
      "the fixture must stop after the ref CAS and before read-tree",
    );

    const retried = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(retried.code, 1, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assertResultDataKey(retriedResult, "proof_note");
    assert(retriedResult.message !== undefined);
    const message = retriedResult.message;
    assertStringIncludes(message, "completed the interrupted landing");
    assertStringIncludes(message, "discern worktree prune");
    assert(
      !message.includes("uncommitted tracked changes"),
      "the journal-owned stale checkout must not trip the ordinary dirty guard",
    );
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "landed before checkout convergence\n",
    );
    assertEquals(await targetExists(interrupted.journal), false);
    assert(await targetExists(worktree));
    // The worktree still holds the honored Proof for the landed target, so
    // recovery records the durable Proof note under the journal's consent.
    const recoveredProofNote = retriedResult.data.proof_note;
    assert(recoveredProofNote !== undefined);
    assertEquals(recoveredProofNote.write.status, "recorded");
    const note = await runGit([
      "notes",
      "--ref",
      "refs/notes/discern",
      "show",
      target,
    ], { cwd: dir });
    assert(
      note.success,
      "recovery must complete the durable Proof note for the landed commit",
    );
  });
});

Deno.test("post-CAS recovery discloses a missing worktree Proof marker", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed before Proof recording\n" },
      "cas-missing-proof",
    );
    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
    );
    await git(
      dir,
      "update-ref",
      "-m",
      `discern accept transaction ${interrupted.id}`,
      "refs/heads/main",
      target,
      expected,
    );
    await injectCommittedAcceptanceMarker(worktree, interrupted, target);
    const proofPath = await gitAdminStatePath(worktree, "gateProof");
    assert(proofPath !== undefined);
    await Deno.remove(proofPath);

    const recovered = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(recovered.code, 1, recovered.output);
    const envelope = decodeCliResult(recovered.stdout, "accept");
    assertResultDataKey(envelope, "proof_note");
    const recoveredProofNote = envelope.data.proof_note;
    assert(recoveredProofNote !== undefined);
    assertEquals(recoveredProofNote.write.status, "missing_proof");
    assert(
      envelope.steps?.some((step) =>
        step.advisory?.kind === "proof-recording-unavailable" &&
        step.outcome === "failed"
      ) ?? false,
      recovered.output,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assert(await targetExists(worktree));
  });
});

Deno.test("journal-bound consent recovers a post-CAS transaction flaglessly and records the partial landing", async () => {
  const consentCases: LandingConsent[] = [
    { source: "conversation" },
    { source: "standing-grant", scopes: ["map"] },
  ];
  for (
    const consent of consentCases
  ) {
    await withTempDir(async (dir) => {
      const worktree = await readyWorktree(
        dir,
        consent.source === "standing-grant"
          ? authorityConfig(["map"])
          : authorityConfig(),
        consent.source === "standing-grant"
          ? { "docs/guide.md": "landed before checkout convergence\n" }
          : { "feature.txt": "landed before checkout convergence\n" },
        `bound-${consent.source}`,
      );
      const expected = await gitOut(dir, "rev-parse", "main");
      const target = await gitOut(worktree, "rev-parse", "HEAD");
      const interrupted = await injectInterruptedAcceptance(
        worktree,
        dir,
        expected,
        target,
        undefined,
        consent,
      );
      await git(
        dir,
        "update-ref",
        "-m",
        `discern accept transaction ${interrupted.id}`,
        "refs/heads/main",
        target,
        expected,
      );
      await injectCommittedAcceptanceMarker(worktree, interrupted, target);

      const recovered = await runAgent(worktree, ["accept", "--json"]);
      assertEquals(recovered.code, 1, recovered.output);
      const envelope = decodeCliResult(recovered.stdout, "accept");
      assertResultDataKey(envelope, "consent");
      assertResultDataKey(envelope, "landing");
      assertResultDataKey(envelope, "root");
      assertEquals(envelope.error, "partial_acceptance");
      assertEquals(envelope.data.consent, {
        source: consent.source,
        ...(consent.scopes === undefined
          ? {}
          : { scopes: [...consent.scopes] }),
      });
      assertEquals(envelope.data.landing, {
        recovery_performed: true,
        trunk_landed: true,
        worktree_removed: false,
        branch_deleted: false,
      });
      assertEquals(envelope.data.root, dir);
      assertEquals(await gitOut(dir, "status", "--porcelain"), "");
      assertEquals(await targetExists(interrupted.journal), false);
      assert(await targetExists(worktree));

      const event = (await acceptEvents(dir)).at(-1);
      assert(event?.kind === "verb");
      assertEquals(event.outcome, "partial");
      assertEquals(event.consent, {
        source: consent.source,
        ...(consent.scopes === undefined
          ? {}
          : { scopes: [...consent.scopes] }),
      });
      assertEquals(
        (event as unknown as { landing?: unknown }).landing,
        envelope.data.landing,
      );
    });
  }
});

Deno.test("journal-only pre-CAS consent may reconcile once but cannot authorize a fresh landing", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "not yet landed\n" },
      "bound-pre-cas",
    );
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      undefined,
      { source: "conversation" },
    );

    // The journal's conversation consent covers only the reconciliation: the
    // pre-CAS journal is cleared silently, and the fresh landing still awaits
    // the owner.
    const recovered = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(recovered.code, 1, recovered.output);
    const envelope = decodeCliResult(recovered.stdout, "accept");
    assertEquals(envelope.error, "awaiting_consent");
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
    assertEquals(await targetExists(interrupted.journal), false);
    assert(await targetExists(worktree));

    const completed = await runAgent(worktree, ["done", "--json"]);
    assertEquals(completed.code, 0, completed.output);
    const replay = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    assertEquals(
      decodeCliResult(replay.stdout, "accept").error,
      "awaiting_consent",
    );

    const events = await acceptEvents(dir);
    assertEquals(events.at(-2)?.outcome, "refused");
    assertEquals(events.at(-1)?.outcome, "refused");
  });
});

Deno.test("pre-CAS recovery reconciles once before requiring new evidence and a new acceptance plan", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "not landed after recovery\n" },
      "pre-cas-then-plan-refusal",
    );
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      undefined,
      { source: "conversation" },
    );
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(join(dir, "discern.toml"))}\n# local edit\n`,
    );

    const partial = await runAgent(
      worktree,
      ["accept", "--confirmed", "--json"],
    );
    assertEquals(partial.code, 1, partial.output);
    const envelope = decodeCliResult(partial.stdout, "accept");
    assert(envelope.message !== undefined);
    assertEquals(envelope.ok, false);
    // The journal reconciled silently; the fresh landing then refuses on the
    // dirty main checkout, before any effect, preserving the local edit.
    assertStringIncludes(
      envelope.message,
      "uncommitted tracked changes",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "# local edit",
    );
    assertEquals(await targetExists(interrupted.journal), false);
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assert(await targetExists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "refused");
  });
});

Deno.test("pre-CAS recovery reconciles, then the current effort grant lands fresh in the same call", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(dir, authorityConfig(), {
      "feature.txt": "not landed after authority loss\n",
    }, "pre-cas-then-authority-loss");
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      undefined,
      { source: "conversation" },
    );
    await grantEffort(worktree, branch, "2026-07-28T23:35:00.000Z");
    // The journal's conversation consent authorizes only the reconciliation;
    // the landing that follows rests on the CURRENT grant, freshly checked.
    const recovered = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(recovered.code, 0, recovered.output);
    const recovery = decodeCliResult(recovered.stdout, "accept");
    assertResultDataKey(recovery, "consent");
    assertEquals(recovery.data.consent, { source: "effort-grant" });
    assertEquals(recovery.data.landing, {
      recovery_performed: true,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(await targetExists(interrupted.journal), false);
    assertEquals(await targetExists(worktree), false);
    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "ok");
    assertEquals(event.consent, { source: "effort-grant" });
  });
});

Deno.test("a trunk CAS whose checkout and rollback both fail reports the irreversible landing as partial", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "ref moved without checkout\n" },
      "checkout-and-rollback-failure",
    );
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const mainLock = join(dir, ".git", "refs", "heads", "main.lock");
    const gitWrapper = join(dir, "fail-checkout-and-rollback-git");
    await Deno.writeTextFile(
      gitWrapper,
      [
        "#!/bin/sh",
        'saw_read_tree=""',
        'for arg in "$@"; do',
        '  if [ "$arg" = "read-tree" ]; then saw_read_tree=1; fi',
        "done",
        'if [ "$saw_read_tree" = 1 ]; then',
        `  : > "$${DISCERN_ENVIRONMENT_VARIABLES.testMainRefLock}"`,
        '  echo "forced checkout convergence failure" >&2',
        "  exit 1",
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    await Deno.chmod(gitWrapper, 0o755);

    const partial = await runAgent(
      worktree,
      ["accept", "--confirmed", "--json"],
      {
        env: {
          GIT_BIN: gitWrapper,
          [DISCERN_ENVIRONMENT_VARIABLES.testMainRefLock]: mainLock,
        },
      },
    );
    assertEquals(partial.code, 1, partial.output);
    const envelope = decodeCliResult(partial.stdout, "accept");
    assertResultDataKey(envelope, "root");
    assertEquals(envelope.data.landing?.trunk_landed, true, partial.output);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, await Deno.realPath(dir));

    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
    assert(await targetExists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: false,
        branch_deleted: false,
      },
    );

    await Deno.remove(mainLock);
  });
});

Deno.test("a post-landing worktree-removal failure returns partial effect state instead of a refusal", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed before removal failed\n" },
      "removal-failure",
    );
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const gitWrapper = join(dir, "lock-at-worktree-remove-git");
    await Deno.writeTextFile(
      gitWrapper,
      [
        "#!/bin/sh",
        'saw_worktree=""',
        'saw_remove=""',
        'for arg in "$@"; do',
        '  if [ "$arg" = "worktree" ]; then saw_worktree=1; fi',
        '  if [ "$arg" = "remove" ]; then saw_remove=1; fi',
        "done",
        'if [ "$saw_worktree" = 1 ] && [ "$saw_remove" = 1 ]; then',
        `  git worktree lock "$${DISCERN_ENVIRONMENT_VARIABLES.testWorktree}"`,
        '  echo "forced worktree removal failure" >&2',
        "  exit 1",
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    await Deno.chmod(gitWrapper, 0o755);

    const partial = await runAgent(
      worktree,
      ["accept", "--confirmed", "--json"],
      {
        env: {
          GIT_BIN: gitWrapper,
          [DISCERN_ENVIRONMENT_VARIABLES.testWorktree]: worktree,
        },
      },
    );
    assertEquals(partial.code, 1, partial.output);
    const envelope = decodeCliResult(partial.stdout, "accept");
    assertResultDataKey(envelope, "root");
    assertEquals(envelope.data.landing?.trunk_landed, true, partial.output);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, await Deno.realPath(dir));
    // The failing cleanup names the recovery verb, from the main checkout.
    assertStringIncludes(
      envelope.message ?? "",
      `could not be removed: run discern worktree prune from ${await Deno
        .realPath(dir)} after fixing the cause.`,
    );

    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "landed before removal failed\n",
    );
    assert(await targetExists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: false,
        branch_deleted: false,
      },
    );

    await git(dir, "worktree", "unlock", worktree);
  });
});

Deno.test("accept recovery preserves tracked data changed after an interrupted trunk CAS", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed while local work exists\n" },
      "cas-local-edit-interruption",
    );
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
    );
    await git(
      dir,
      "update-ref",
      "-m",
      `discern accept transaction ${interrupted.id}`,
      "refs/heads/main",
      target,
      expected,
    );
    await injectCommittedAcceptanceMarker(worktree, interrupted, target);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "operator edit after the process stopped\n",
    );

    const retried = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(retried.code, 1, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assert(retriedResult.message !== undefined);
    const message = retriedResult.message;
    assertStringIncludes(message, "preserved the trunk checkout");
    assertStringIncludes(message, "git diff");
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "operator edit after the process stopped\n",
    );
    assertEquals(await targetExists(join(dir, "feature.txt")), false);
    assertEquals(
      await targetExists(interrupted.journal),
      true,
      "unresolved recovery evidence must survive until the local edit is handled",
    );
    assert(await targetExists(worktree));
  });
});

Deno.test("landing compare-and-swap preserves a colliding untracked file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["map"]));
    await gitInit(dir);
    const expected = await gitOut(dir, "rev-parse", "main");
    const worktree = await addWorktree(dir, "cas-untracked");
    await commitPaths(worktree, { "docs/guide.md": "validated\n" });
    const validated = await gitOut(worktree, "rev-parse", "HEAD");

    const collision = join(dir, "docs", "guide.md");
    await Deno.mkdir(dirname(collision), { recursive: true });
    await Deno.writeTextFile(collision, "local scratch\n");

    const refused = await fastForwardCheckedOutBranch(
      dir,
      "main",
      expected,
      validated,
    );
    assertEquals(refused.kind, "checkout-failed");
    if (refused.kind === "checkout-failed") {
      assertEquals(refused.rolledBack, true);
    }
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assertEquals(await Deno.readTextFile(collision), "local scratch\n");
    assert(await targetExists(worktree));
  });
});

Deno.test("landing compare-and-swap preserves ignored file, directory, and symlink collisions", async (t) => {
  const cases = [
    {
      name: "file",
      localPath: "local-file",
      makeLocal: async (path: string): Promise<void> => {
        await Deno.writeTextFile(path, "ignored file\n");
      },
      proveLocal: async (path: string): Promise<void> => {
        assertEquals(await Deno.readTextFile(path), "ignored file\n");
      },
    },
    {
      name: "directory",
      localPath: "local-directory",
      makeLocal: async (path: string): Promise<void> => {
        await Deno.mkdir(path);
        await Deno.writeTextFile(join(path, "kept.txt"), "ignored child\n");
      },
      proveLocal: async (path: string): Promise<void> => {
        assertEquals(
          await Deno.readTextFile(join(path, "kept.txt")),
          "ignored child\n",
        );
      },
    },
    ...(Deno.build.os === "windows" ? [] : [{
      name: "symlink",
      localPath: "local-symlink",
      makeLocal: async (path: string): Promise<void> => {
        await Deno.symlink("machine-local-target", path);
      },
      proveLocal: async (path: string): Promise<void> => {
        assertEquals(await Deno.readLink(path), "machine-local-target");
      },
    }]),
  ];

  for (const testCase of cases) {
    await t.step(testCase.name, async () => {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await writeConfig(dir, authorityConfig(["map"]));
        await Deno.writeTextFile(join(dir, ".gitignore"), "local-*\n");
        await gitInit(dir);
        const expected = await gitOut(dir, "rev-parse", "main");
        const worktree = await addWorktree(dir, `ignored-${testCase.name}`);
        const targetPath = join(worktree, testCase.localPath);
        await Deno.writeTextFile(targetPath, "landed tracked bytes\n");
        await git(worktree, "add", "-f", testCase.localPath);
        await git(
          worktree,
          "commit",
          "-q",
          "-m",
          "track ignored collision",
          "--no-gpg-sign",
        );
        const validated = await gitOut(worktree, "rev-parse", "HEAD");
        const localPath = join(dir, testCase.localPath);
        await testCase.makeLocal(localPath);

        const refused = await fastForwardCheckedOutBranch(
          dir,
          "main",
          expected,
          validated,
        );
        assertEquals(refused.kind, "dirty");
        assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
        await testCase.proveLocal(localPath);
      });
    });
  }
});

Deno.test("accept records confirmed conversation consent in its proof and logbook", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "docs/conversation.md": "conversation\n" },
      "conversation",
    );
    const landed = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const envelope = decodeCliResult(landed.stdout, "accept");
    assertResultDataKey(envelope, "consent");
    const { consent, proof_line: proofLine } = envelope.data;
    assert(consent !== undefined && proofLine !== undefined);
    assertEquals(envelope.data.scopes_changed, ["map"]);

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assertSuccessfulLandingEvidence(
      consent,
      proofLine,
      event,
      successfulLandingCase("conversation"),
    );
    assert(event?.kind === "verb");
    assertEquals(event.scopes, ["map"]);
  });
});

Deno.test("accept lands flagless under an effort grant and consumes it", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "effort\n" },
      "effort",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    await grantEffort(worktree, branch, "2026-07-28T23:00:00.000Z");
    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    const worktreeGitDir = await gitOut(
      worktree,
      "rev-parse",
      "--absolute-git-dir",
    );
    const transactionMarkers = join(
      worktreeGitDir,
      "refs",
      "worktree",
      "discern",
      "acceptance-transactions",
    );

    const landed = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const envelope = decodeCliResult(landed.stdout, "accept");
    assertResultDataKey(envelope, "consent");
    const { consent, proof_line: proofLine } = envelope.data;
    assert(consent !== undefined && proofLine !== undefined);
    assertEquals(await targetExists(marker), false);
    assertEquals(
      await targetExists(transactionMarkers),
      false,
      "worktree removal must reap its acceptance marker refs",
    );

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assertSuccessfulLandingEvidence(
      consent,
      proofLine,
      event,
      successfulLandingCase("effort-grant"),
    );
  });
});

Deno.test("concurrent accept refuses without recovering the active transaction", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "one acceptance owns the transition\n" },
      "concurrent-acceptance",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    await grantEffort(worktree, branch, "2026-07-28T23:05:00.000Z");

    const grant = await gitAdminStatePath(worktree, "effortGrant");
    const claims = await gitAdminStatePath(worktree, "effortGrantClaims");
    const journalPath = await gitAdminStatePath(
      worktree,
      "acceptanceTransaction",
    );
    assert(grant !== undefined && claims !== undefined);
    assert(journalPath !== undefined);

    const paused = join(dir, "accept-update-ref-paused");
    const release = join(dir, "accept-update-ref-release");
    const gitWrapper = join(dir, "accept-pausing-git");
    await Deno.writeTextFile(
      gitWrapper,
      [
        "#!/bin/sh",
        'saw_update_ref=""',
        'saw_stdin=""',
        'for arg in "$@"; do',
        '  if [ "$arg" = "update-ref" ]; then saw_update_ref=1; fi',
        '  if [ "$arg" = "--stdin" ]; then saw_stdin=1; fi',
        "done",
        'if [ "$saw_update_ref" = 1 ] && [ "$saw_stdin" = 1 ]; then',
        `  : > "$${DISCERN_ENVIRONMENT_VARIABLES.testAcceptPaused}"`,
        `  while [ ! -e "$${DISCERN_ENVIRONMENT_VARIABLES.testAcceptRelease}" ]; do`,
        "    sleep 0.01",
        "  done",
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    await Deno.chmod(gitWrapper, 0o755);
    const env = {
      GIT_BIN: gitWrapper,
      [DISCERN_ENVIRONMENT_VARIABLES.testAcceptPaused]: paused,
      [DISCERN_ENVIRONMENT_VARIABLES.testAcceptRelease]: release,
    };

    const first = runAgent(worktree, ["accept", "--json"], { env });
    let failure: unknown;
    let journalBefore = "";
    let claimPath = "";
    let claimBefore = "";
    try {
      await waitForPath(paused, first);
      // The journal-bound transaction is the durable mid-flight evidence.
      journalBefore = await Deno.readTextFile(journalPath);
      const transaction = decodeWith(
        z.looseObject({
          id: z.string(),
          worktree_branch: z.string(),
          trunk: z.string(),
          expected_trunk: z.string(),
          effort_claim: z.boolean(),
          consent: z.looseObject({ source: z.string() }),
        }),
        journalBefore,
      );
      assertEquals(transaction.worktree_branch, branch);
      assertEquals(transaction.trunk, "main");
      assertEquals(transaction.expected_trunk, expected);
      assertEquals(transaction.effort_claim, true);
      assertEquals(transaction.consent.source, "effort-grant");
      claimPath = join(claims, transaction.id);
      claimBefore = await Deno.readTextFile(claimPath);
      assertEquals(await targetExists(grant), false);
      assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
      assertEquals(
        await readAcceptanceTransactionMarker(worktree, transaction.id),
        { kind: "missing" },
      );

      let concurrentOperationRan = false;
      let concurrentRefusal: unknown;
      try {
        // runAgent uses the suite temp home while this process retains its own
        // TMPDIR. Both must still resolve the same Git-derived lock identity.
        await withAcceptanceTransactionLock(worktree, () => {
          concurrentOperationRan = true;
          return Promise.resolve();
        });
      } catch (error) {
        concurrentRefusal = error;
      }
      assert(
        concurrentRefusal instanceof Error,
        "the active acceptance lock must refuse a concurrent operation",
      );
      assertStringIncludes(
        concurrentRefusal.message,
        "common repository boundary",
      );
      assertStringIncludes(
        concurrentRefusal.message,
        "This call made no change",
      );
      assertStringIncludes(concurrentRefusal.message, "Retry after");
      assertEquals(
        concurrentOperationRan,
        false,
        "the refused operation must never enter the transaction body",
      );

      assertEquals(
        await Deno.readTextFile(journalPath),
        journalBefore,
        "the refused operation must not rewrite the journal",
      );
      assertEquals(await Deno.readTextFile(claimPath), claimBefore);
      assertEquals(await targetExists(grant), false);
      assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
      assertEquals(
        await readAcceptanceTransactionMarker(worktree, transaction.id),
        { kind: "missing" },
      );
    } catch (error) {
      failure = error;
    } finally {
      await Deno.writeTextFile(release, "continue\n");
    }

    const landed = await first;
    if (failure !== undefined) {
      throw failure;
    }
    assertEquals(landed.code, 0, landed.output);
    assertEquals(
      await gitOut(dir, "show", "main:feature.txt"),
      "one acceptance owns the transition",
    );
    assertEquals(await targetExists(worktree), false);
  });
});

Deno.test("accept retry restores and reuses an effort claim interrupted before trunk CAS", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "claimed before CAS\n" },
      "pre-cas-claim-interruption",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    await grantEffort(worktree, branch, "2026-07-28T23:10:00.000Z");
    const claimed = await claimEffortGrant(worktree, branch);
    assert(claimed.status === "claimed");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      claimed.claim.path,
    );

    // Recovery restores the interrupted claim to the desk-visible marker, and
    // the restored grant then authorizes the fresh landing in the same call.
    const recovered = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(recovered.code, 0, recovered.output);
    const envelope = decodeCliResult(recovered.stdout, "accept");
    assertResultDataKey(envelope, "consent");
    assertEquals(envelope.data.consent, { source: "effort-grant" });
    assertEquals(envelope.data.landing?.recovery_performed, true);
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "claimed before CAS\n",
    );
    assertEquals(await targetExists(claimed.claim.path), false);
    assertEquals(await targetExists(interrupted.journal), false);
    assertEquals(await targetExists(worktree), false);
  });
});

Deno.test("accept retry consumes an effort claim interrupted after trunk CAS without replaying authority", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "claimed and landed\n" },
      "post-cas-claim-interruption",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    await grantEffort(worktree, branch, "2026-07-28T23:20:00.000Z");
    const claimed = await claimEffortGrant(worktree, branch);
    assert(claimed.status === "claimed");
    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      claimed.claim.path,
    );
    await git(
      dir,
      "update-ref",
      "-m",
      `discern accept transaction ${interrupted.id}`,
      "refs/heads/main",
      target,
      expected,
    );
    await injectCommittedAcceptanceMarker(worktree, interrupted, target);

    const retried = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(retried.code, 1, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assert(retriedResult.message !== undefined);
    const message = retriedResult.message;
    assertStringIncludes(message, "completed the interrupted landing");
    assertStringIncludes(message, "discern worktree prune");
    assert(
      !message.includes("Re-authorize"),
      "a post-CAS retry must never make the spent grant replayable",
    );
    assertEquals(await targetExists(marker), false);
    assertEquals(await targetExists(claimed.claim.path), false);
    assertEquals(await targetExists(interrupted.journal), false);
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assert(await targetExists(worktree));
  });
});

Deno.test("accept retry does not replay an effort claim after a landed ref is reset to its expected SHA", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed then reset\n" },
      "aba-claim-interruption",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    await grantEffort(worktree, branch, "2026-07-28T23:25:00.000Z");
    const claimed = await claimEffortGrant(worktree, branch);
    assert(claimed.status === "claimed");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      claimed.claim.path,
    );
    await git(
      dir,
      "update-ref",
      "-m",
      `discern accept transaction ${interrupted.id}`,
      "refs/heads/main",
      target,
      expected,
    );
    await injectCommittedAcceptanceMarker(worktree, interrupted, target);
    await git(
      dir,
      "update-ref",
      "-m",
      "operator reset after interrupted acceptance",
      "refs/heads/main",
      expected,
      target,
    );
    await git(worktree, "reflog", "expire", "--expire=now", "--all");
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      "",
      "ABA puts HEAD and the unchanged old checkout back in apparent agreement",
    );

    const retried = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(retried.code, 1, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assert(retriedResult.message !== undefined);
    const message = retriedResult.message;
    assertStringIncludes(message, "was later reset");
    assertStringIncludes(message, "effort grant was consumed");
    assertEquals(await targetExists(claimed.claim.path), false);
    assertEquals(await targetExists(interrupted.journal), false);

    const replay = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    assertEquals(
      decodeCliResult(replay.stdout, "accept").error,
      "awaiting_consent",
    );
    assert(await targetExists(worktree));
  });
});

Deno.test("accept retry reuses an effort claim only after its tagged CAS rollback", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "land after explicit rollback\n" },
      "tagged-rollback-claim-interruption",
    );
    const branch = await gitOut(worktree, "branch", "--show-current");
    const expected = await gitOut(dir, "rev-parse", "main");
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    await grantEffort(worktree, branch, "2026-07-28T23:27:00.000Z");
    const claimed = await claimEffortGrant(worktree, branch);
    assert(claimed.status === "claimed");
    const interrupted = await injectInterruptedAcceptance(
      worktree,
      dir,
      expected,
      target,
      claimed.claim.path,
    );
    const collision = join(dir, "feature.txt");
    await Deno.writeTextFile(collision, "local collision\n");
    const failedCheckout = await fastForwardCheckedOutBranch(
      dir,
      "main",
      expected,
      target,
      { transactionId: interrupted.id, transactionCwd: worktree },
    );
    assertEquals(failedCheckout.kind, "checkout-failed");
    if (failedCheckout.kind === "checkout-failed") {
      assertEquals(failedCheckout.rolledBack, true);
    }
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assertEquals(
      await readAcceptanceTransactionMarker(worktree, interrupted.id),
      { kind: "missing" },
      "Discern's rollback must remove the marker in the same ref transaction",
    );

    await Deno.remove(collision);
    // The tagged rollback proved the trunk never advanced, so the retry
    // restores the claim and lands the still-proven revision in one call.
    const recovered = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(recovered.code, 0, recovered.output);
    const envelope = decodeCliResult(recovered.stdout, "accept");
    assertResultDataKey(envelope, "consent");
    assertEquals(envelope.data.consent, { source: "effort-grant" });
    assertEquals(envelope.data.landing?.recovery_performed, true);
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "land after explicit rollback\n",
    );
    assertEquals(await targetExists(claimed.claim.path), false);
    assertEquals(await targetExists(interrupted.journal), false);
    assertEquals(await targetExists(worktree), false);
  });
});

Deno.test("accept refuses partial and unscoped standing coverage with the paths named", async () => {
  for (
    const fixture of [
      {
        name: "partial",
        paths: {
          "docs/guide.md": "covered\n",
          "src/feature.ts": "uncovered\n",
        },
        expected: ["src/feature.ts", "scopes: engine"],
      },
      {
        name: "unscoped",
        paths: { "notes.txt": "uncovered\n" },
        expected: ["notes.txt", "no matching scope"],
      },
    ]
  ) {
    await withTempDir(async (dir) => {
      const worktree = await readyWorktree(
        dir,
        authorityConfig(["map"]),
        fixture.paths,
        fixture.name,
      );
      const refused = await runAgent(worktree, ["accept", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const envelope = decodeCliResult(refused.stdout, "accept");
      assertEquals(envelope.error, "awaiting_consent");
      assert(envelope.message !== undefined);
      for (const expected of fixture.expected) {
        assertStringIncludes(envelope.message, expected);
      }
      assert(await targetExists(worktree));
    });
  }
});

Deno.test("accept gives unknown trunk grants zero authority and reports them", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["ghost"]));
    await gitInit(dir);
    const worktree = await addWorktree(dir, "unknown-grant");
    await writeConfig(worktree, authorityConfig());
    await commitPaths(worktree, { "docs/guide.md": "docs\n" });
    assertEquals((await runAgent(worktree, ["done", "--json"])).code, 0);

    const refused = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const envelope = decodeCliResult(refused.stdout, "accept");
    assertEquals(envelope.error, "awaiting_consent");
    assert(envelope.message !== undefined);
    assertStringIncludes(envelope.message, "unknown scope");
    assertStringIncludes(envelope.message, "ghost");
    assertStringIncludes(envelope.message, "cover nothing");
    assert(await targetExists(worktree));
  });
});

Deno.test("ordinary consent cannot bypass unreadable protected trunk policy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Valid TOML carrying a section the current schema no longer recognizes:
    // the committed record predates the engine reading it, and the branch
    // being landed is itself the migration that repairs it.
    await writeConfig(
      dir,
      `${authorityConfig()}\n[retired_levers]\nenabled = true\n`,
    );
    await gitInit(dir);
    const worktree = await addWorktree(dir, "schema-migration");
    await writeConfig(worktree, authorityConfig());
    await convergeFixtureGitattributes(worktree);
    await commitPaths(worktree, { "docs/migration.md": "migrated\n" });
    assertEquals((await runAgent(worktree, ["done", "--json"])).code, 0);

    const flagless = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(flagless.code, 1, flagless.output);
    const refusal = decodeCliResult(flagless.stdout, "accept");
    assertEquals(refusal.error, "awaiting_consent");
    assert(refusal.message !== undefined);
    assertStringIncludes(refusal.message, "could not be checked");
    assertStringIncludes(
      refusal.message,
      "does not match the current config schema",
    );
    assertStringIncludes(refusal.message, "retired_levers");

    const branch = await gitOut(worktree, "branch", "--show-current");
    await grantEffort(worktree, branch, "2026-07-29T08:00:00.000Z");
    const effort = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(effort.code, 1, effort.output);
    assertTerminalTextIncludes(
      effort.stdout,
      "could not be checked",
      "a recorded effort grant must not bypass an unreadable policy record",
    );
    assert(await targetExists(worktree));
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "retired_levers",
    );

    // The owner's current-conversation decision still lands the migration that
    // repairs the record, with the unreadable-policy evidence carried beside it.
    const confirmed = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(confirmed.code, 0, confirmed.output);
    const envelope = decodeCliResult(confirmed.stdout, "accept");
    assertResultDataKey(envelope, "authority_warnings");
    assert(
      (envelope.data.authority_warnings ?? []).some((warning) =>
        warning.includes("does not match the current config schema")
      ),
    );
    assertEquals(envelope.data.consent, { source: "conversation" });
    assertEquals(await targetExists(worktree), false);
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "retired_levers",
      ),
      "the landed migration repairs the committed policy record",
    );
  });
});

Deno.test("successful acceptance evidence covers every canonical landing-consent source", () => {
  assertEquals(
    SUCCESSFUL_LANDING_CASES.map((testCase) => testCase.source).sort(),
    [...LANDING_CONSENT_SOURCES].sort(),
  );
});

Deno.test("landing collision protection preserves a Git directory record when target writes its descendant", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root);
    await writeConfig(root, authorityConfig(["map"]));
    await Deno.writeTextFile(join(root, ".gitignore"), "cache/\n");
    await gitInit(root);
    const expected = await gitOut(root, "rev-parse", "HEAD");
    const path = await addWorktree(root, "nested-collision");
    await Deno.mkdir(join(path, "cache/package"), { recursive: true });
    await Deno.writeTextFile(join(path, "cache/package/new"), "candidate");
    await git(path, "add", "-f", "cache/package/new");
    await git(path, "commit", "-m", "Track nested descendant");
    await Deno.mkdir(join(root, "cache/package"), { recursive: true });
    await git(join(root, "cache/package"), "init", "-q");
    await Deno.writeTextFile(join(root, "cache/package/owned"), "preserve");
    const refused = await fastForwardCheckedOutBranch(
      root,
      "main",
      expected,
      await gitOut(path, "rev-parse", "HEAD"),
    );
    assertEquals(refused.kind, "dirty");
    assertEquals(await gitOut(root, "rev-parse", "HEAD"), expected);
    assertEquals(
      await Deno.readTextFile(join(root, "cache/package/owned")),
      "preserve",
    );
    assert((await Deno.lstat(join(root, "cache/package/.git"))).isDirectory);
  });
});
