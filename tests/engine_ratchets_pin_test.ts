/**
 * Engine tests for `ratchets --pin` (ADR 0106) — capturing a measured improvement
 * into the limit instead of hand-editing discern.toml.
 *
 * `--pin` measures every ratchet, tightens each asked-for limit that improved past
 * its margin toward the measured value, commits that change on its own (comment-
 * preservingly), and carries a gate-pass receipt forward across the gate-neutral
 * commit so `graduate` skips the redundant re-run. These tests drive the real engine
 * through `runAgent` and assert on the config, the commit, and the receipt file.
 *
 * The receipt lives at `.git/discern-gate-pass` in a plain repo (what
 * `git rev-parse --git-path` resolves), so a test can seed a prior finish vouch by
 * writing HEAD there, then assert the pin carried it onto the new HEAD — which is
 * exactly the (receipt names HEAD, clean tree) condition `graduate` honors.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

interface RatchetSpec {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: string;
  run: string;
  per?: string;
  scale?: string;
  margin?: string;
}

/** A discern.toml with one or more `[ratchets.<name>]` tables, with a comment above
 * each limit so a test can prove the pin edit is surgical (comments survive). */
function pinConfig(...ratchets: RatchetSpec[]): string {
  const lines = [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
  ];
  for (const r of ratchets) {
    lines.push(
      "",
      `[ratchets.${r.name}]`,
      ...(r.metric ? [`metric = "${r.metric}"`] : []),
      `direction = "${r.direction}"`,
      "# hand-tuned baseline — keep this comment across a re-pin",
      `limit = ${r.limit}`,
      ...(r.per ? [`per = ${r.per}`] : []),
      ...(r.scale ? [`scale = ${r.scale}`] : []),
      ...(r.margin ? [`margin = ${r.margin}`] : []),
      `run = "${r.run}"`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** The `limit = N` value written under `[ratchets.<name>]` in raw config text. */
function limitOf(configText: string, name: string): string | undefined {
  const section = configText.match(
    new RegExp(`\\[ratchets\\.${name}\\]([\\s\\S]*?)(?:\\n\\[|$)`),
  )?.[1];
  return section?.match(/^\s*limit\s*=\s*(\S+)/m)?.[1];
}

function receiptFile(dir: string): string {
  return join(dir, ".git", "discern-gate-pass");
}

/** Seed a prior `finish` vouch: write `sha` (default current HEAD) to the receipt. */
async function seedReceipt(dir: string, sha?: string): Promise<void> {
  const head = sha ?? await gitOut(dir, "rev-parse", "HEAD");
  await Deno.writeTextFile(receiptFile(dir), `${head}\n`);
}

async function readReceipt(dir: string): Promise<string | undefined> {
  try {
    return (await Deno.readTextFile(receiptFile(dir))).trim();
  } catch {
    return undefined;
  }
}

async function readConfig(dir: string): Promise<string> {
  return await Deno.readTextFile(join(dir, "discern.toml"));
}

// ── pinning tightens a limit to the measured value ─────────────────────────────

Deno.test("pin: tightens an up-ratchet floor to the measured value and commits", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");

    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "pinned floor 80 → 95");

    // The limit is now the measured value, and the guiding comment survived.
    const cfg = await readConfig(dir);
    assertEquals(limitOf(cfg, "coverage"), "95");
    assertStringIncludes(cfg, "# hand-tuned baseline");

    // Exactly one new commit, touching only discern.toml, with an audit body.
    const after = await gitOut(dir, "rev-parse", "HEAD");
    assert(after !== before, "pin must create a commit");
    assertEquals(
      await gitOut(dir, "show", "--name-only", "--format=", "HEAD"),
      "discern.toml",
    );
    const msg = await gitOut(dir, "log", "-1", "--format=%s%n%b");
    assertStringIncludes(msg, "Pin ratchet baseline: coverage 80 → 95");
    assertStringIncludes(msg, "floor 80 → 95 (measured 95)");
  });
});

Deno.test("pin: tightens a down-ratchet ceiling to the measured value", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle_bytes 50'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "pinned ceiling 100 → 50");
    assertEquals(limitOf(await readConfig(dir), "bundle"), "50");
  });
});

Deno.test("pin: a margin leaves headroom below/above the measured value", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Ceiling 1_000_000 with 100_000 headroom; measured 700_000 → pin to 800_000.
    await writeConfig(
      dir,
      pinConfig({
        name: "size",
        direction: "down",
        limit: "1000000",
        margin: "100000",
        run: "echo 'DISCERN_METRIC size 700000'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(limitOf(await readConfig(dir), "size"), "800000");
  });
});

Deno.test("pin: an improvement smaller than the margin is left un-pinned", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Ceiling 1000, margin 100; measured 950 → target 1050 is not tighter → no pin.
    await writeConfig(
      dir,
      pinConfig({
        name: "size",
        direction: "down",
        limit: "1000",
        margin: "100",
        run: "echo 'DISCERN_METRIC size 950'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "nothing to pin");
    assertEquals(limitOf(await readConfig(dir), "size"), "1000");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before, "no commit");
  });
});

Deno.test("pin: nothing to pin when the metric already sits at the limit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "90",
        run: "echo 'DISCERN_METRIC coverage 90'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Nothing to pin");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: a `per` rate ratchet pins to the measured rate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // 30 alerts / 1000 words * 1000 = 30, ceiling 40 → pins the ceiling to 30.
    await writeConfig(
      dir,
      pinConfig({
        name: "warnings",
        metric: "alerts",
        direction: "down",
        limit: "40",
        per: '"words"',
        scale: "1000",
        run:
          "echo 'DISCERN_METRIC alerts 30'; echo 'DISCERN_METRIC words 1000'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "pinned ceiling 40 → 30");
    assertEquals(limitOf(await readConfig(dir), "warnings"), "30");
  });
});

// ── selecting what to pin ──────────────────────────────────────────────────────

Deno.test("pin: names restrict the pin to those ratchets", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig(
        {
          name: "coverage",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage 95'",
        },
        {
          name: "bundle",
          direction: "down",
          limit: "100",
          run: "echo 'DISCERN_METRIC bundle 40'",
        },
      ),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "--pin", "coverage"]);
    assertEquals(r.code, 0, r.output);
    const cfg = await readConfig(dir);
    assertEquals(limitOf(cfg, "coverage"), "95", "the named ratchet is pinned");
    assertEquals(
      limitOf(cfg, "bundle"),
      "100",
      "the un-named ratchet is untouched",
    );
    // The commit body mentions only coverage.
    const body = await gitOut(dir, "log", "-1", "--format=%b");
    assertStringIncludes(body, "coverage");
    assert(!body.includes("bundle"), "only the named ratchet is in the commit");
  });
});

Deno.test("pin: an unknown ratchet name fails loudly and pins nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["ratchets", "--pin", "nope"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "no ratchet named nope");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: ratchet names without --pin are a clear error, not silently ignored", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "coverage"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "only apply with --pin");
  });
});

// ── safety: never pin a red tree, never pin a dirty one, never loosen ──────────

Deno.test("pin: a failing ratchet blocks the whole pin", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // coverage holds with slack; bundle is over its ceiling → the pin must abort.
    await writeConfig(
      dir,
      pinConfig(
        {
          name: "coverage",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage 95'",
        },
        {
          name: "bundle",
          direction: "down",
          limit: "100",
          run: "echo 'DISCERN_METRIC bundle 150'",
        },
      ),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 1, r.output);
    // It names the failing ratchet and points at `discern ratchets` for the detail.
    assertStringIncludes(r.output, "Not pinning");
    assertStringIncludes(r.output, "bundle");
    // Neither limit moved and no commit was made.
    const cfg = await readConfig(dir);
    assertEquals(limitOf(cfg, "coverage"), "80");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: refuses a dirty worktree (it commits the change alone)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "dirty.txt"), "uncommitted\n");
    const before = await gitOut(dir, "rev-parse", "HEAD");

    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "clean worktree");
    assertEquals(limitOf(await readConfig(dir), "coverage"), "80", "no edit");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before, "no commit");
  });
});

Deno.test("pin --dry-run: reports what it would pin and changes nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["ratchets", "--pin", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "would pin floor 80 → 95");
    // Nothing written, nothing committed.
    assertEquals(limitOf(await readConfig(dir), "coverage"), "80");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

// ── the gate-pass receipt carries across the pin commit ────────────────────────

Deno.test("pin: carries an honored gate-pass receipt onto the new commit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    // Simulate a prior green finish over this clean HEAD.
    await seedReceipt(dir);

    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Carried the gate-pass receipt forward");

    // The receipt now names the NEW HEAD over a clean tree — graduate's honored
    // condition — so graduate would skip the redundant gate re-run.
    const head = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readReceipt(dir), head);
  });
});

Deno.test("pin: does NOT forge a receipt when none was honored beforehand", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir); // no receipt seeded

    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "No current gate-pass receipt to carry");
    // Fail-closed: no receipt was written, so graduate will re-run the gate.
    assertEquals(await readReceipt(dir), undefined);
  });
});

Deno.test("pin: a STALE prior receipt is not carried (fail-closed)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    // A receipt naming some other commit — not the current HEAD.
    const stale = "0".repeat(40);
    await seedReceipt(dir, stale);

    const r = await runAgent(dir, ["ratchets", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "No current gate-pass receipt to carry");
    // The stale marker is left untouched (still ≠ HEAD) — graduate re-validates.
    const head = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readReceipt(dir), stale);
    assert(stale !== head);
  });
});

Deno.test("pin: a further commit after the pin strands the carried receipt (fail-closed)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    await seedReceipt(dir);

    await runAgent(dir, ["ratchets", "--pin"]);
    const pinnedHead = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readReceipt(dir), pinnedHead);

    // The agent keeps working: another commit lands after the pin. The carried
    // receipt still names the pin commit, so it no longer matches HEAD — graduate
    // correctly falls back to re-running the gate rather than trusting a stale vouch.
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "more work",
      "--no-gpg-sign",
    );
    const newHead = await gitOut(dir, "rev-parse", "HEAD");
    assert(newHead !== pinnedHead);
    assertEquals(
      await readReceipt(dir),
      pinnedHead,
      "receipt still names the pin commit",
    );
  });
});

// ── the JSON envelope ──────────────────────────────────────────────────────────

Deno.test("pin --json: reports pinned steps and ok", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim()) as {
      ok: boolean;
      verb: string;
      steps?: Array<{ label: string; outcome: string; note?: string }>;
      hints?: string[];
    };
    assertEquals(obj.verb, "ratchets");
    assertEquals(obj.ok, true);
    assertEquals(obj.steps?.[0]?.label, "coverage");
    assertStringIncludes(obj.steps?.[0]?.note ?? "", "pinned floor 80 → 95");
  });
});
