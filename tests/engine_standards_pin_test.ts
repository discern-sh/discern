/**
 * Engine tests for `standards --pin` (ADR 0106) — capturing a measured improvement
 * into the limit instead of hand-editing discern.toml.
 *
 * `--pin` measures every standard, tightens each asked-for limit that improved past
 * its margin toward the measured value, commits that change on its own (comment-
 * preservingly), and carries a gate proof forward across the gate-neutral
 * commit so `accept` skips the redundant re-run. These tests drive the real engine
 * through `runAgent` and assert on the config, the commit, and the proof file.
 *
 * The proof lives at `.git/discern/gate-proof` in a plain repo (what
 * `git rev-parse --git-path` resolves), so a test can seed a prior finish vouch by
 * writing HEAD there, then assert the pin carried it onto the new HEAD — which is
 * exactly the (proof names HEAD, clean tree) condition `accept` honors.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  parsedCommitTrailers,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";

interface StandardSpec {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: string;
  run: string;
  per?: string;
  scale?: string;
  margin?: string;
}

/** A discern.toml with one or more `[standards.<name>]` tables, with a comment above
 * each limit so a test can prove the pin edit is surgical (comments survive). */
function pinConfig(...standards: StandardSpec[]): string {
  const lines = [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
  ];
  for (const r of standards) {
    lines.push(
      "",
      `[standards.${r.name}]`,
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

/** The `limit = N` value written under `[standards.<name>]` in raw config text. */
function limitOf(configText: string, name: string): string | undefined {
  const section = configText.match(
    new RegExp(`\\[standards\\.${name}\\]([\\s\\S]*?)(?:\\n\\[|$)`),
  )?.[1];
  return section?.match(/^\s*limit\s*=\s*(\S+)/m)?.[1];
}

/** Resolve the gate-proof fixture through its registered Git-admin location. */
function proofFile(dir: string): string {
  return join(dir, ".git", GIT_ADMIN_STATE.gateProof.path);
}

/** Seed a prior `done` vouch: write `sha` (default current HEAD) to the proof. */
async function seedProof(dir: string, sha?: string): Promise<void> {
  const head = sha ?? await gitOut(dir, "rev-parse", "HEAD");
  await Deno.mkdir(dirname(proofFile(dir)), { recursive: true });
  await Deno.writeTextFile(proofFile(dir), `${head}\n`);
}

/** Read a trimmed gate proof while preserving missing state as absence. */
async function readProof(dir: string): Promise<string | undefined> {
  try {
    return (await Deno.readTextFile(proofFile(dir))).trim();
  } catch {
    return undefined;
  }
}

/** Read the project config after pinning so exact limit edits can be asserted. */
async function readConfig(dir: string): Promise<string> {
  return await Deno.readTextFile(join(dir, "discern.toml"));
}

// ── pinning tightens a limit to the measured value ─────────────────────────────

Deno.test("pin: tightens an up-standard floor to the measured value and commits", async () => {
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

    const r = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "pinned floor 80 → 95");

    // The limit is now the measured value, and the guiding comment survived.
    const cfg = await readConfig(dir);
    assertEquals(limitOf(cfg, "coverage"), "95");
    assertStringIncludes(cfg, "# hand-tuned baseline");
    await assertDiscernTomlTidy(dir, "standards --pin");

    // Exactly one new commit, touching only discern.toml, with an audit body.
    const after = await gitOut(dir, "rev-parse", "HEAD");
    assert(after !== before, "pin must create a commit");
    assertEquals(
      await gitOut(dir, "show", "--name-only", "--format=", "HEAD"),
      "discern.toml",
    );
    const msg = await gitOut(dir, "log", "-1", "--format=%B");
    assertStringIncludes(msg, "Pin standard baseline: coverage 80 → 95");
    assertStringIncludes(msg, "floor 80 → 95 (measured 95)");
    assertEquals(await parsedCommitTrailers(dir), DISCERN_MACHINE.trailer);
    assertEquals(
      msg.split(`\n\n${DISCERN_MACHINE.trailer}`)[0],
      "Pin standard baseline: coverage 80 → 95\n\n" +
        "Capture a measured improvement so it cannot regress. `discern standards`\n" +
        "measured these metrics past their limits; `--pin` tightens each limit to\n" +
        "the measured value, leaving any configured margin of headroom:\n\n" +
        "- coverage: floor 80 → 95 (measured 95)",
      "attribution must not rewrite the standards pin subject or audit body",
    );
  });
});

Deno.test("pin: DISCERN_NO_ATTRIBUTION omits the co-author trailer", async () => {
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

    const r = await runAgent(dir, ["standards", "--pin"], {
      env: { [DISCERN_NO_ATTRIBUTION]: "1" },
    });
    assertEquals(r.code, 0, r.output);
    assertEquals(await parsedCommitTrailers(dir), "");
    assert(
      !(await gitOut(dir, "show", "-s", "--format=%B")).includes(
        DISCERN_MACHINE.trailer,
      ),
    );
  });
});

Deno.test("pin: tightens a down-standard ceiling to the measured value", async () => {
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
    const r = await runAgent(dir, ["standards", "--pin"]);
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
    const r = await runAgent(dir, ["standards", "--pin"]);
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
    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(JSON.parse(r.stdout), HINTS["standards-pin-no-slack"]);
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
    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(JSON.parse(r.stdout), HINTS["standards-pin-no-slack"]);
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: a `per` rate standard pins to the measured rate", async () => {
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
    const r = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "pinned ceiling 40 → 30");
    assertEquals(limitOf(await readConfig(dir), "warnings"), "30");
  });
});

// ── selecting what to pin ──────────────────────────────────────────────────────

Deno.test("pin: names restrict the pin to those standards", async () => {
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
    const r = await runAgent(dir, ["standards", "--pin", "coverage"]);
    assertEquals(r.code, 0, r.output);
    const cfg = await readConfig(dir);
    assertEquals(
      limitOf(cfg, "coverage"),
      "95",
      "the named standard is pinned",
    );
    assertEquals(
      limitOf(cfg, "bundle"),
      "100",
      "the un-named standard is untouched",
    );
    // The commit body mentions only coverage.
    const body = await gitOut(dir, "log", "-1", "--format=%b");
    assertStringIncludes(body, "coverage");
    assert(
      !body.includes("bundle"),
      "only the named standard is in the commit",
    );
  });
});

Deno.test("pin: an unknown standard name fails loudly and pins nothing", async () => {
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
    const r = await runAgent(dir, ["standards", "--pin", "nope"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "no standard named nope");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: standard names without --pin are a clear error, not silently ignored", async () => {
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
    const r = await runAgent(dir, ["standards", "coverage"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "only apply with --pin");
  });
});

// ── safety: never pin a red tree, never pin a dirty one, never loosen ──────────

Deno.test("pin: a failing standard blocks the whole pin", async () => {
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
    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 1, r.output);
    // It names the failing standard and points at `discern standards` for the detail.
    assertHasHint(
      JSON.parse(r.stdout),
      HINTS["standards-pin-blocked"],
      { failingNames: ["bundle"] },
    );
    // Neither limit moved and no commit was made.
    const cfg = await readConfig(dir);
    assertEquals(limitOf(cfg, "coverage"), "80");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("pin: a behind-trunk worktree succeeds with an update hint", async () => {
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
    const wt = await addWorktree(dir, "behind-pin");
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "advance main",
      "--no-gpg-sign",
    );
    const beforeHead = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(wt, ["standards", "--pin", "--json"]);

    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim()) as {
      ok: boolean;
      hints?: string[];
    };
    assertEquals(obj.ok, true);
    assertHasHint(obj, HINTS["standards-pin-behind"], {
      behind: "1",
      trunk: "main",
    });
    assert(
      await gitOut(wt, "rev-parse", "HEAD") !== beforeHead,
      "the hint must not block the pin commit",
    );
    assertEquals(limitOf(await readConfig(wt), "coverage"), "95");
    assertEquals(
      await gitOut(wt, "rev-list", "--count", "HEAD..main"),
      "1",
      "the successful pin remains behind main until update",
    );
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

    const r = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "clean worktree");
    assertEquals(limitOf(await readConfig(dir), "coverage"), "80", "no edit");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before, "no commit");
  });
});

Deno.test("pin: refuses when HEAD moves during measurement and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "git commit -q --allow-empty -m mid-measure --no-gpg-sign && " +
          "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const beforeHead = await gitOut(dir, "rev-parse", "HEAD");
    const beforeConfig = await readConfig(dir);

    const r = await runAgent(dir, ["standards", "--pin"]);

    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "HEAD moved");
    assertStringIncludes(r.stderr, beforeHead);
    assertStringIncludes(r.stderr, "re-run `discern standards --pin`");
    assertEquals(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "mid-measure",
      "the measurement's commit must remain HEAD; pin must add no commit",
    );
    assertEquals(
      await readConfig(dir),
      beforeConfig,
      "pin must not rewrite discern.toml after HEAD moves",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      "",
      "pin must not stage or write anything after the measurement's commit",
    );
  });
});

Deno.test("pin: refuses when measurement dirties the worktree and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "touch mid-measure.txt && echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const beforeHead = await gitOut(dir, "rev-parse", "HEAD");
    const beforeConfig = await readConfig(dir);

    const r = await runAgent(dir, ["standards", "--pin"]);

    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "worktree changed");
    assertStringIncludes(r.stderr, "mid-measure.txt");
    assertStringIncludes(r.stderr, "re-run `discern standards --pin`");
    assertEquals(
      await gitOut(dir, "rev-parse", "HEAD"),
      beforeHead,
      "pin must not commit after the measurement dirties the worktree",
    );
    assertEquals(
      await readConfig(dir),
      beforeConfig,
      "pin must not rewrite discern.toml after the worktree changes",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      "?? mid-measure.txt",
      "only the measurement's own untracked file may remain",
    );
  });
});

Deno.test("pin --dry-run: renders the pin plan and measures NOTHING", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The run command leaves a sentinel file — if the dry-run executes it, the
    // sentinel appears. A dry-run that measures is the defect this pins against:
    // same flag as the plain check's dry-run, so the same no-execution contract
    // (ADR 0027); slack is knowable only from the plain check's measured hints.
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "touch measured.sentinel && echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const r = await runAgent(dir, ["standards", "--pin", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    // The plan names the standard and the pin semantics, but no measured value —
    // nothing ran, so there is none to show.
    assertStringIncludes(r.stdout, "coverage");
    assertStringIncludes(r.stdout, "would measure");
    assert(
      !r.stdout.includes("95"),
      `a dry-run must not know the measured value:\n${r.stdout}`,
    );
    const sentinel = await Deno.stat(join(dir, "measured.sentinel")).catch(
      () => undefined,
    );
    assertEquals(sentinel, undefined, "dry-run must not run the measurement");
    // Nothing written, nothing committed.
    assertEquals(limitOf(await readConfig(dir), "coverage"), "80");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
  });
});

Deno.test("a green check hints any pinnable slack, so check → pin needs no measuring preview", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 95'",
      }, {
        name: "snug",
        direction: "up",
        limit: "70",
        run: "echo 'DISCERN_METRIC snug 70'",
      }),
    );
    await gitInit(dir);
    // The check already measured everything: its hints name the standard with
    // slack — decided by the same pinnedLimit a real pin applies — and stay
    // silent about the one already at its limit.
    const r = await runAgent(dir, ["standards", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim()) as {
      ok: boolean;
      hints?: string[];
    };
    assertEquals(obj.ok, true);
    assertHasHint(obj, HINTS["standards-pinnable-slack"], {
      standards: [{
        name: "coverage",
        bound: "floor",
        limit: 80,
        measured: "95",
        newLimit: 95,
      }],
      proofed: true,
    });
  });
});

// ── the gate proof carries across the pin commit ────────────────────────

Deno.test("pin: carries an honored gate proof onto the new commit", async () => {
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
    await seedProof(dir);

    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(
      JSON.parse(r.stdout),
      HINTS["standards-pin-carried-proof"],
    );

    // The proof now names the NEW HEAD over a clean tree — accept's honored
    // condition — so accept would skip the redundant gate re-run.
    const head = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readProof(dir), head);
  });
});

Deno.test("pin: the tightened pin commit still passes both standards gate halves", async () => {
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

    const before = await runAgent(dir, ["done", "--json"]);
    assertEquals(before.code, 0, before.output);
    const pin = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 0, pin.output);
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");

    const after = await runAgent(dir, ["done", "--json"]);

    assertEquals(after.code, 0, after.output);
    const obj = JSON.parse(after.stdout.trim()) as {
      ok: boolean;
      data?: {
        standards_limits?: { status: string };
        standards?: Array<{
          name: string;
          limit: number;
          value?: number;
          verdict?: string;
        }>;
      };
    };
    assertEquals(obj.ok, true);
    assertEquals(obj.data?.standards_limits?.status, "verified");
    const coverage = obj.data?.standards?.find((standard) =>
      standard.name === "coverage"
    );
    assertEquals(coverage?.limit, 95);
    assertEquals(coverage?.value, 95);
    assertEquals(coverage?.verdict, "held");
  });
});

Deno.test("pin: does NOT forge a proof when none was honored beforehand", async () => {
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
    await gitInit(dir); // no proof seeded

    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(JSON.parse(r.stdout), HINTS["standards-pin-no-proof"]);
    // Fail-closed: no proof was written, so accept will re-run the gate.
    assertEquals(await readProof(dir), undefined);
  });
});

Deno.test("pin: a STALE prior proof is not carried (fail-closed)", async () => {
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
    // A proof naming some other commit — not the current HEAD.
    const stale = "0".repeat(40);
    await seedProof(dir, stale);

    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(JSON.parse(r.stdout), HINTS["standards-pin-no-proof"]);
    // The stale marker is left untouched (still ≠ HEAD) — accept re-validates.
    const head = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readProof(dir), stale);
    assert(stale !== head);
  });
});

Deno.test("pin: a further commit after the pin strands the carried proof (fail-closed)", async () => {
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
    await seedProof(dir);

    await runAgent(dir, ["standards", "--pin"]);
    const pinnedHead = await gitOut(dir, "rev-parse", "HEAD");
    assertEquals(await readProof(dir), pinnedHead);

    // The agent keeps working: another commit lands after the pin. The carried
    // proof still names the pin commit, so it no longer matches HEAD — accept
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
      await readProof(dir),
      pinnedHead,
      "proof still names the pin commit",
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
    const r = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim()) as {
      ok: boolean;
      verb: string;
      steps?: Array<{ label: string; outcome: string; note?: string }>;
      hints?: string[];
    };
    assertEquals(obj.verb, "standards");
    assertEquals(obj.ok, true);
    assertEquals(obj.steps?.[0]?.label, "coverage");
    assertStringIncludes(obj.steps?.[0]?.note ?? "", "pinned floor 80 → 95");
  });
});

// ── the failed-commit rollback: a partial pin leaves no trace ──────────────────

/** Install a `pre-commit` hook that always rejects the commit, so the pin's commit
 * step fails after the config has been rewritten and staged — the multi-step
 * mutation's failure point (B55). Returns the hook path so a test can clear it. */
async function installRejectingHook(dir: string): Promise<string> {
  const hookDir = join(dir, ".git", "hooks");
  await Deno.mkdir(hookDir, { recursive: true });
  const hook = join(hookDir, "pre-commit");
  await Deno.writeTextFile(
    hook,
    "#!/bin/sh\necho 'rejected by hook' >&2\nexit 1\n",
  );
  await Deno.chmod(hook, 0o755);
  return hook;
}

Deno.test("pin: a failed commit rolls discern.toml back to HEAD (the retry is never stranded, B55)", async () => {
  // The class: a multi-step mutation with no rollback on a failed step. The pin
  // writes → stages → commits; when the commit fails it once left discern.toml
  // modified AND staged, and the natural retry was then refused by the clean-tree
  // guard — a dead end. The fix restores the file to HEAD on any failed step, so
  // the tree is clean again and the retry proceeds the moment the block clears.
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
    const before = await readConfig(dir);
    const hook = await installRejectingHook(dir);

    // The pin measures fine but the commit is rejected: it fails, reporting why.
    const failed = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(failed.code, 1, failed.output);
    assertStringIncludes(failed.stderr, "could not commit the re-pin");

    // Crucially, it left NO trace: discern.toml is byte-identical to HEAD and the
    // tree is clean — not the modified+staged state that stranded the old retry.
    assertEquals(
      await readConfig(dir),
      before,
      "discern.toml must be restored",
    );
    const status = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      status.trim(),
      "",
      "the tree must be clean after a failed pin",
    );

    // The retry is no longer refused: clear the block and it pins for real.
    await Deno.remove(hook);
    const retry = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(retry.code, 0, retry.output);
    assertStringIncludes(retry.stdout, "pinned floor 80 → 95");
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
  });
});

// ── the measurement proof: check → pin measures once ─────────────────────────

/** A run command that counts its own executions in `.git/measure-count` (inside the
 * git admin dir, so the sentinel never dirties the tree) before emitting `value`. */
function countingRun(metric: string, value: string): string {
  return `echo x >> .git/measure-count && echo 'DISCERN_METRIC ${metric} ${value}'`;
}

/** How many times a {@link countingRun} measurement actually executed. */
async function measureCount(dir: string): Promise<number> {
  try {
    const text = await Deno.readTextFile(join(dir, ".git", "measure-count"));
    return text.split("\n").filter((l) => l !== "").length;
  } catch {
    return 0;
  }
}

/** Resolve the standard-measurement cache through its registered Git-admin location. */
function measurementsFile(dir: string): string {
  return join(dir, ".git", GIT_ADMIN_STATE.standardMeasurements.path);
}

Deno.test("proof: a pin after a green check reuses its measurements — one measurement total", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: countingRun("coverage", "95"),
      }),
    );
    await gitInit(dir);

    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    assertEquals(await measureCount(dir), 1, "the check measures once");
    // The green check's hint promises the reuse a pin on this commit performs.
    assertHasHint(
      JSON.parse(check.stdout.trim()),
      HINTS["standards-pinnable-slack"],
      {
        standards: [{
          name: "coverage",
          bound: "floor",
          limit: 80,
          measured: "95",
          newLimit: 95,
        }],
        proofed: true,
      },
    );

    const pin = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 0, pin.output);
    const pinObj = JSON.parse(pin.stdout) as {
      hints?: string[];
      steps?: Array<{ note?: string }>;
    };
    assertStringIncludes(pinObj.steps?.[0]?.note ?? "", "pinned floor 80 → 95");
    assertHasHint(pinObj, HINTS["standards-pin-reused-measurements"]);
    assertEquals(
      await measureCount(dir),
      1,
      "the pin must NOT re-run the measurement",
    );
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
  });
});

Deno.test("proof: a commit between check and pin invalidates it — the pin re-measures", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: countingRun("coverage", "95"),
      }),
    );
    await gitInit(dir);

    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "more work",
      "--no-gpg-sign",
    );

    const pin = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(pin.code, 0, pin.output);
    assertEquals(
      await measureCount(dir),
      2,
      "a moved HEAD must force a fresh measurement",
    );
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
  });
});

Deno.test("proof: a red check clears it, so a later pin measures fresh", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The metric is controlled by a flag file inside .git (never dirties the tree):
    // present → 10 (under the floor, red), absent → 95 (green with slack).
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo x >> .git/measure-count && " +
          "{ test -f .git/fail && echo 'DISCERN_METRIC coverage 10' " +
          "|| echo 'DISCERN_METRIC coverage 95'; }",
      }),
    );
    await gitInit(dir);

    // Green check (human path) records the proof.
    const green = await runAgent(dir, ["standards"]);
    assertEquals(green.code, 0, green.output);
    assertEquals(await measureCount(dir), 1);

    // Same HEAD turns red (environment drift): the check must clear the proof.
    await Deno.writeTextFile(join(dir, ".git", "fail"), "");
    const red = await runAgent(dir, ["standards"]);
    assertEquals(red.code, 1, red.output);
    assertEquals(await measureCount(dir), 2);

    // Back to green conditions: the pin must MEASURE, not reuse the cleared vouch.
    await Deno.remove(join(dir, ".git", "fail"));
    const pin = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(pin.code, 0, pin.output);
    assertEquals(
      await measureCount(dir),
      3,
      "a cleared proof must not be reused",
    );
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
  });
});

Deno.test("proof: a malformed proof file is ignored — the pin measures fresh", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: countingRun("coverage", "95"),
      }),
    );
    await gitInit(dir);
    await Deno.mkdir(dirname(measurementsFile(dir)), { recursive: true });
    await Deno.writeTextFile(measurementsFile(dir), "not json {{{\n");

    const pin = await runAgent(dir, ["standards", "--pin"]);
    assertEquals(pin.code, 0, pin.output);
    assertEquals(
      await measureCount(dir),
      1,
      "garbage must read as a cache miss",
    );
    assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
  });
});

Deno.test("proof: a --force check over a dirty tree records nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: countingRun("coverage", "95"),
      }),
    );
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "dirty.txt"), "uncommitted\n");

    const check = await runAgent(dir, ["standards", "--force"]);
    assertEquals(check.code, 0, check.output);
    const proof = await Deno.stat(measurementsFile(dir)).catch(() => undefined);
    assertEquals(
      proof,
      undefined,
      "a dirty tree's values describe a state no pin will see",
    );
  });
});

Deno.test("proof: a commit made while the check measured is never recorded (the pin catches it)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The measurement itself commits — a deterministic stand-in for "someone
    // commits in another terminal while the (slow) measurements run". The check
    // stays green, but the values describe the PINNED tree, not the new HEAD.
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "git commit -q --allow-empty -m mid-measure --no-gpg-sign && " +
          "echo 'DISCERN_METRIC coverage 95'",
      }),
    );
    await gitInit(dir);

    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    const proof = await Deno.stat(measurementsFile(dir)).catch(() => undefined);
    assertEquals(
      proof,
      undefined,
      "values measured before a mid-run commit must not vouch for the new HEAD",
    );
  });
});

Deno.test("proof: a reusing pin still re-checks never-loosen against LIVE main", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: countingRun("coverage", "95"),
      }),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "work");

    // Green check on the branch records the proof (main's floor is also 80).
    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    assertEquals(await measureCount(dir), 1);

    // Main advances underneath the unchanged branch HEAD: its floor rises to 90,
    // so the branch's 80 is now a loosening the proof knows nothing about.
    await git(dir, "checkout", "-q", "main");
    const cfg = await readConfig(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      cfg.replace("limit = 80", "limit = 90"),
    );
    await git(dir, "commit", "-aqm", "raise the floor", "--no-gpg-sign");
    await git(dir, "checkout", "-q", "work");

    const before = await gitOut(dir, "rev-parse", "HEAD");
    const pin = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 1, pin.output);
    const obj = JSON.parse(pin.stdout.trim()) as {
      ok: boolean;
      steps?: Array<{ note?: string }>;
      diagnostics?: Array<{ message: string }>;
      hints?: string[];
    };
    assertEquals(obj.ok, false);
    // The verdict came from the proof replay, and it carries the live reason.
    assertStringIncludes(
      obj.steps?.[0]?.note ?? "",
      "reused from the green check",
    );
    assertStringIncludes(
      obj.diagnostics?.[0]?.message ?? "",
      "the floor only rises",
    );
    assertHasHint(obj, HINTS["standards-pin-blocked"], {
      failingNames: ["coverage"],
    });
    // No re-measurement, no commit, no edit.
    assertEquals(await measureCount(dir), 1, "replay must not re-measure");
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before, "no commit");
    assertEquals(limitOf(await readConfig(dir), "coverage"), "80", "no edit");
  });
});
