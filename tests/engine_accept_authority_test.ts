/**
 * Acceptance's recorded-authority paths: standing coverage, per-effort grants,
 * fail-closed refusals, dry-run disclosure, receipt evidence, and logbook lift.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
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
import type { LandingConsent } from "../src/shared/consent.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const INTERRUPTION_FIXTURES = {
  "effort-claim": "pre-CAS claim and post-CAS consumption",
  "trunk-ref": "post-CAS checkout convergence, local edits, and ABA movement",
} as const satisfies Record<AcceptanceTransactionBoundary, string>;

Deno.test("every acceptance transaction boundary has interruption fixtures", () => {
  assertEquals(
    ACCEPTANCE_TRANSACTION_BOUNDARIES.map((boundary) => boundary.id).sort(),
    Object.keys(INTERRUPTION_FIXTURES).sort(),
  );
});

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
    "[scopes.docs]",
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
  return worktree;
}

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

const ACCEPT_READINESS_TIMEOUT_MS = 180_000;

async function waitForPath<T>(
  path: string,
  pending: Promise<T>,
): Promise<void> {
  let settled:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown }
    | undefined;
  void pending.then(
    (value) => {
      settled = { ok: true, value };
    },
    (error: unknown) => {
      settled = { ok: false, error };
    },
  );
  const timeoutMs = ACCEPT_READINESS_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await exists(path)) {
      return;
    }
    if (settled !== undefined) {
      if (!settled.ok) {
        throw settled.error;
      }
      throw new Error(
        `accept settled before writing its readiness marker: ${
          JSON.stringify(settled.value)
        }`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${path}`);
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
  await Deno.writeTextFile(
    journal,
    `${
      JSON.stringify({
        version: consent === undefined ? 1 : 2,
        id,
        worktree_branch: await gitOut(worktree, "branch", "--show-current"),
        trunk: "main",
        expected_trunk: expected,
        target,
        main_repo: mainRepo,
        effort_claim: effortClaimPath !== undefined,
        ...(consent === undefined ? {} : { consent }),
      })
    }\n`,
  );
  return { id, journal };
}

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

Deno.test("accept lands flagless under a standing grant and records its scopes", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(["docs"]),
      { "docs/guide.md": "covered\n" },
      "standing",
    );
    const landed = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const envelope = JSON.parse(landed.stdout);
    assertEquals(envelope.data.consent, {
      source: "standing-grant",
      scopes: ["docs"],
    });
    assertStringIncludes(
      envelope.data.receipt_line,
      "landed under standing grant: docs",
    );
    assertEquals(await exists(worktree), false);
    assertEquals(
      await Deno.readTextFile(join(dir, "docs", "guide.md")),
      "covered\n",
    );

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.consent, {
      source: "standing-grant",
      scopes: ["docs"],
    });
  });
});

Deno.test("landing compare-and-swap rejects an ancestor trunk advance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["docs"]));
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
    assertEquals(await exists(join(dir, "docs", "guide.md")), false);
    assert(await exists(worktree));
  });
});

Deno.test("landing compare-and-swap converges the unchanged trunk checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["docs"]));
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
    const message = JSON.parse(retried.stdout).message as string;
    assertStringIncludes(message, "reconciled the interrupted landing");
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
    assertEquals(await exists(interrupted.journal), false);
    assert(await exists(worktree));
  });
});

Deno.test("an unconfirmed retry leaves an unbound post-CAS transaction byte-for-byte untouched and records a refusal", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "landed before checkout convergence\n" },
      "unbound-cas-interruption",
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
    const journalBefore = await Deno.readTextFile(interrupted.journal);
    const checkoutBefore = await gitOut(dir, "status", "--porcelain");
    assert(
      checkoutBefore !== "",
      "the fixture stops before checkout convergence",
    );

    const refused = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const envelope = JSON.parse(refused.stdout);
    assertEquals(envelope.error, "awaiting_consent");
    assertEquals(
      await Deno.readTextFile(interrupted.journal),
      journalBefore,
      "authority-free retry must not rewrite or remove the journal",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      checkoutBefore,
      "authority-free retry must not converge the main checkout",
    );
    assertEquals(await exists(join(dir, "feature.txt")), false);
    assertEquals(
      await readAcceptanceTransactionMarker(worktree, interrupted.id),
      { kind: "present", target },
    );

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "refused");
    assertEquals(event.error, "awaiting_consent");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      undefined,
    );
  });
});

Deno.test("journal-bound consent recovers a post-CAS transaction flaglessly and records the partial landing", async () => {
  const consentCases: LandingConsent[] = [
    { source: "conversation" },
    { source: "standing-grant", scopes: ["docs"] },
  ];
  for (
    const consent of consentCases
  ) {
    await withTempDir(async (dir) => {
      const worktree = await readyWorktree(
        dir,
        consent.source === "standing-grant"
          ? authorityConfig(["docs"])
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
      const envelope = JSON.parse(recovered.stdout);
      assertEquals(envelope.error, "partial_acceptance");
      assertEquals(envelope.data.consent, consent);
      assertEquals(envelope.data.landing, {
        recovery_performed: true,
        trunk_landed: true,
        worktree_removed: false,
        branch_deleted: false,
      });
      assertEquals(envelope.data.root, dir);
      assertEquals(await gitOut(dir, "status", "--porcelain"), "");
      assertEquals(await exists(interrupted.journal), false);
      assert(await exists(worktree));

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

    const recovered = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(recovered.code, 1, recovered.output);
    const envelope = JSON.parse(recovered.stdout);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.landing, {
      recovery_performed: true,
      trunk_landed: false,
      worktree_removed: false,
      branch_deleted: false,
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assertEquals(await exists(join(dir, "feature.txt")), false);
    assertEquals(await exists(interrupted.journal), false);
    assert(await exists(worktree));

    const replay = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    assertEquals(JSON.parse(replay.stdout).error, "awaiting_consent");

    const events = await acceptEvents(dir);
    assertEquals(events.at(-2)?.outcome, "partial");
    assertEquals(events.at(-1)?.outcome, "refused");
  });
});

Deno.test("an authorized pre-CAS recovery makes every later plan refusal partial", async () => {
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
    const envelope = JSON.parse(partial.stdout);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, dir);
    assertEquals(envelope.data.consent, { source: "conversation" });
    assertEquals(envelope.data.landing, {
      recovery_performed: true,
      trunk_landed: false,
      worktree_removed: false,
      branch_deleted: false,
    });
    assertStringIncludes(envelope.message, "uncommitted tracked changes");
    assertEquals(await exists(interrupted.journal), false);
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assert(await exists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      envelope.data.landing,
    );
  });
});

Deno.test("post-recovery authority loss remains a partial acceptance", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "not landed after authority loss\n" },
      "pre-cas-then-authority-loss",
    );
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
    const grant = await gitAdminStatePath(worktree, "effortGrant");
    assert(grant !== undefined);

    const gitWrapper = join(dir, "revoke-authority-during-plan-git");
    await Deno.writeTextFile(
      gitWrapper,
      [
        "#!/bin/sh",
        'saw_status=""',
        'saw_porcelain=""',
        'for arg in "$@"; do',
        '  if [ "$arg" = "status" ]; then saw_status=1; fi',
        '  if [ "$arg" = "--porcelain" ]; then saw_porcelain=1; fi',
        "done",
        'if [ "$saw_status" = 1 ] && [ "$saw_porcelain" = 1 ] && ' +
        '[ ! -e "$DISCERN_TEST_ACCEPTANCE_JOURNAL" ]; then',
        '  rm -f "$DISCERN_TEST_EFFORT_GRANT"',
        "fi",
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    await Deno.chmod(gitWrapper, 0o755);

    const partial = await runAgent(worktree, ["accept", "--json"], {
      env: {
        GIT_BIN: gitWrapper,
        DISCERN_TEST_EFFORT_GRANT: grant,
        DISCERN_TEST_ACCEPTANCE_JOURNAL: interrupted.journal,
      },
    });
    assertEquals(partial.code, 1, partial.output);
    const envelope = JSON.parse(partial.stdout);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, dir);
    assertEquals(envelope.data.consent, { source: "conversation" });
    assertEquals(envelope.data.landing, {
      recovery_performed: true,
      trunk_landed: false,
      worktree_removed: false,
      branch_deleted: false,
    });
    assertStringIncludes(envelope.message, "needs their explicit acceptance");
    assertEquals(await exists(interrupted.journal), false);
    assertEquals(await exists(grant), false);
    assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
    assert(await exists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(event.consent, { source: "conversation" });
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      envelope.data.landing,
    );
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
        '  : > "$DISCERN_TEST_MAIN_REF_LOCK"',
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
          DISCERN_TEST_MAIN_REF_LOCK: mainLock,
        },
      },
    );
    assertEquals(partial.code, 1, partial.output);
    const envelope = JSON.parse(partial.stdout);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, await Deno.realPath(dir));
    assertEquals(envelope.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: false,
      branch_deleted: false,
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(await exists(join(dir, "feature.txt")), false);
    assert(await exists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      envelope.data.landing,
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
        '  git worktree lock "$DISCERN_TEST_WORKTREE"',
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
          DISCERN_TEST_WORKTREE: worktree,
        },
      },
    );
    assertEquals(partial.code, 1, partial.output);
    const envelope = JSON.parse(partial.stdout);
    assertEquals(envelope.error, "partial_acceptance");
    assertEquals(envelope.data.root, await Deno.realPath(dir));
    assertEquals(envelope.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: false,
      branch_deleted: false,
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "landed before removal failed\n",
    );
    assert(await exists(worktree));

    const event = (await acceptEvents(dir)).at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      envelope.data.landing,
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
    const message = JSON.parse(retried.stdout).message as string;
    assertStringIncludes(message, "preserved the trunk checkout");
    assertStringIncludes(message, "git diff");
    assertEquals(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "operator edit after the process stopped\n",
    );
    assertEquals(await exists(join(dir, "feature.txt")), false);
    assertEquals(
      await exists(interrupted.journal),
      true,
      "unresolved recovery evidence must survive until the local edit is handled",
    );
    assert(await exists(worktree));
  });
});

Deno.test("landing compare-and-swap preserves a colliding untracked file", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, authorityConfig(["docs"]));
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
    assert(await exists(worktree));
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
        await writeConfig(dir, authorityConfig(["docs"]));
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

Deno.test("accept records confirmed conversation consent in its receipt and logbook", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(),
      { "feature.txt": "conversation\n" },
      "conversation",
    );
    const landed = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const envelope = JSON.parse(landed.stdout);
    assertEquals(envelope.data.consent, { source: "conversation" });
    assertStringIncludes(
      envelope.data.receipt_line,
      "landed with conversation consent",
    );

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.consent, { source: "conversation" });
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
    const envelope = JSON.parse(landed.stdout);
    assertEquals(envelope.data.consent, { source: "effort-grant" });
    assertStringIncludes(
      envelope.data.receipt_line,
      "landed under effort grant",
    );
    assertEquals(await exists(marker), false);
    assertEquals(
      await exists(transactionMarkers),
      false,
      "worktree removal must reap its acceptance marker refs",
    );

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.consent, { source: "effort-grant" });
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

    const journal = await gitAdminStatePath(
      worktree,
      "acceptanceTransaction",
    );
    const grant = await gitAdminStatePath(worktree, "effortGrant");
    const claims = await gitAdminStatePath(worktree, "effortGrantClaims");
    assert(journal !== undefined);
    assert(grant !== undefined);
    assert(claims !== undefined);

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
        '  : > "$DISCERN_TEST_ACCEPT_PAUSED"',
        '  while [ ! -e "$DISCERN_TEST_ACCEPT_RELEASE" ]; do',
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
      DISCERN_TEST_ACCEPT_PAUSED: paused,
      DISCERN_TEST_ACCEPT_RELEASE: release,
    };

    const first = runAgent(worktree, ["accept", "--json"], { env });
    let failure: unknown;
    let journalBefore = "";
    let claimPath = "";
    let claimBefore = "";
    try {
      await waitForPath(paused, first);
      journalBefore = await Deno.readTextFile(journal);
      const transaction = JSON.parse(journalBefore);
      assertEquals(transaction.worktree_branch, branch);
      assertEquals(transaction.expected_trunk, expected);
      assertEquals(transaction.effort_claim, true);
      claimPath = join(claims, transaction.id);
      claimBefore = await Deno.readTextFile(claimPath);
      assertEquals(await exists(grant), false);
      assertEquals(await gitOut(dir, "rev-parse", "main"), expected);
      assertEquals(
        await readAcceptanceTransactionMarker(worktree, transaction.id),
        { kind: "missing" },
      );

      let concurrentOperationRan = false;
      let concurrentRefusal: unknown;
      try {
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
        "Another acceptance is already running",
      );
      assertEquals(
        concurrentOperationRan,
        false,
        "the refused operation must never enter the transaction body",
      );

      assertEquals(await Deno.readTextFile(journal), journalBefore);
      assertEquals(await Deno.readTextFile(claimPath), claimBefore);
      assertEquals(await exists(grant), false);
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
    assertEquals(await exists(worktree), false);
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

    const retried = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(retried.code, 0, retried.output);
    const envelope = JSON.parse(retried.stdout);
    assertEquals(envelope.data.consent, { source: "effort-grant" });
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "claimed before CAS\n",
    );
    assertEquals(await exists(claimed.claim.path), false);
    assertEquals(await exists(interrupted.journal), false);
    assertEquals(await exists(worktree), false);
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
    const message = JSON.parse(retried.stdout).message as string;
    assertStringIncludes(message, "reconciled the interrupted landing");
    assertStringIncludes(message, "discern worktree prune");
    assert(
      !message.includes("Re-authorize"),
      "a post-CAS retry must never make the spent grant replayable",
    );
    assertEquals(await exists(marker), false);
    assertEquals(await exists(claimed.claim.path), false);
    assertEquals(await exists(interrupted.journal), false);
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assert(await exists(worktree));
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
    const message = JSON.parse(retried.stdout).message as string;
    assertStringIncludes(message, "was later reset");
    assertStringIncludes(message, "effort grant was consumed");
    assertEquals(await exists(claimed.claim.path), false);
    assertEquals(await exists(interrupted.journal), false);

    const replay = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(replay.code, 1, replay.output);
    assertEquals(JSON.parse(replay.stdout).error, "awaiting_consent");
    assert(await exists(worktree));
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
    const retried = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(retried.code, 0, retried.output);
    assertEquals(JSON.parse(retried.stdout).data.consent, {
      source: "effort-grant",
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(
      await Deno.readTextFile(join(dir, "feature.txt")),
      "land after explicit rollback\n",
    );
    assertEquals(await exists(claimed.claim.path), false);
    assertEquals(await exists(interrupted.journal), false);
    assertEquals(await exists(worktree), false);
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
        authorityConfig(["docs"]),
        fixture.paths,
        fixture.name,
      );
      const refused = await runAgent(worktree, ["accept", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const envelope = JSON.parse(refused.stdout);
      assertEquals(envelope.error, "awaiting_consent");
      for (const expected of fixture.expected) {
        assertStringIncludes(envelope.message, expected);
      }
      assert(await exists(worktree));
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

    const refused = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const envelope = JSON.parse(refused.stdout);
    assertStringIncludes(envelope.message, "unknown scope");
    assertStringIncludes(envelope.message, "ghost");
    assertStringIncludes(envelope.message, "cover nothing");
    assert(await exists(worktree));
  });
});

Deno.test("accept falls back loudly when trunk authority is unreadable and confirmed cannot bypass malformed policy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[acceptance\npre_authorized = [\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "broken-policy");
    await writeConfig(worktree, authorityConfig());
    await commitPaths(worktree, { "docs/guide.md": "repair\n" });

    const flagless = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(flagless.code, 1, flagless.output);
    assertStringIncludes(
      JSON.parse(flagless.stdout).message,
      "could not be checked",
    );

    const branch = await gitOut(worktree, "branch", "--show-current");
    await grantEffort(worktree, branch, "2026-07-28T23:30:00.000Z");
    const effort = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(effort.code, 1, effort.output);
    assertStringIncludes(
      effort.stdout,
      "could not be checked",
      "a recorded effort grant must not bypass malformed trunk policy",
    );

    const confirmed = await runAgent(worktree, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(confirmed.code, 1, confirmed.output);
    assertStringIncludes(confirmed.stdout, "policy is invalid");
    assert(await exists(worktree));
  });
});

Deno.test("accept dry-run reports standing authority without landing", async () => {
  await withTempDir(async (dir) => {
    const worktree = await readyWorktree(
      dir,
      authorityConfig(["docs"]),
      { "docs/guide.md": "preview\n" },
      "authority-preview",
    );
    const preview = await runAgent(worktree, [
      "accept",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    const envelope = JSON.parse(preview.stdout);
    assertEquals(envelope.dry_run, true);
    assert(
      envelope.plan.details.some((detail: string) =>
        detail.includes("standing grant (docs)")
      ),
    );
    assert(await exists(worktree));
    assertEquals(await exists(join(dir, "docs", "guide.md")), false);
  });
});
