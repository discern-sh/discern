/**
 * Acceptance's recorded-authority paths: standing coverage, per-effort grants,
 * fail-closed refusals, dry-run disclosure, receipt evidence, and logbook lift.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { grantEffort } from "../src/engine/worktree/effort_grant.ts";
import { fastForwardCheckedOutBranch } from "../src/engine/worktree/git.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
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
    );
    assertEquals(stale.kind, "moved");
    assertEquals(await gitOut(dir, "rev-parse", "main"), advanced);
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

    assertEquals(
      await fastForwardCheckedOutBranch(
        dir,
        "main",
        expected,
        validated,
      ),
      { kind: "updated" },
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), validated);
    assertEquals(
      await Deno.readTextFile(join(dir, "docs", "guide.md")),
      "landed\n",
    );
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
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

    const landed = await runAgent(worktree, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const envelope = JSON.parse(landed.stdout);
    assertEquals(envelope.data.consent, { source: "effort-grant" });
    assertStringIncludes(
      envelope.data.receipt_line,
      "landed under effort grant",
    );
    assertEquals(await exists(marker), false);

    const events = await acceptEvents(dir);
    const event = events.at(-1);
    assert(event?.kind === "verb");
    assertEquals(event.consent, { source: "effort-grant" });
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
