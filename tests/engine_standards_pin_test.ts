/**
 * Engine tests for `standards --pin` (ADR 0106) — capturing a measured improvement
 * into the limit instead of hand-editing discern.toml.
 *
 * `--pin` validates every Standard unless current Gate Proof already proves the
 * complete clean tree, tightens each asked-for limit that improved past its margin,
 * commits that change on its own (comment-preservingly), and leaves the prior
 * exact-HEAD Proof stale so acceptance cannot skip validation of a new commit.
 * These tests drive the real engine through `runAgent` and assert on the config,
 * the commit, and the proof file.
 *
 * The proof lives at `.git/discern/gate-proof` in a plain repo (what
 * `git rev-parse --git-path` resolves), so a test can seed a prior finish vouch by
 * writing a complete registered JSON record there, then assert that a pin does
 * not rewrite its exact commit identity.
 *
 * One pin run measures every configured Standard and tightens every selected
 * one, so the pin arithmetic (floor, ceiling, margin, `per` rate, at-limit,
 * names) is one fixture driven through a check and three pins, each step
 * asserting the variant it guards. The measurement-reuse lifecycle, the
 * Gate-Proof narrowing journey and the no-Proof selection journey are each one
 * fixture whose end state is the next step's start state. A measurement that
 * moves HEAD or dirties the tree leaves the validation runtime awaiting
 * recovery, so those refusals end their fixture.
 *
 * Guards: boundary:owner-chosen-standard-limits, claim:pin-measured-gains
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
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
import { readTextIfExists, targetExists } from "../src/shared/fs_presence.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { declarationEvidenceIdentity } from "../src/engine/checkpoints/evidence.ts";

const GateProofHeadFixtureSchema = z.object({ head: z.string() });

interface StandardSpec {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: string;
  run: string;
  per?: string;
  scale?: string;
  margin?: string;
  inputs?: string[];
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
      ...(r.inputs ? [`inputs = ${JSON.stringify(r.inputs)}`] : []),
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

/** Seed a prior registered `done` vouch for current HEAD by default. */
async function seedProof(dir: string, sha?: string): Promise<void> {
  const head = sha ?? await gitOut(dir, "rev-parse", "HEAD");
  const evidence = await declarationEvidenceIdentity(dir);
  assert(evidence.status === "ok");
  await Deno.mkdir(dirname(proofFile(dir)), { recursive: true });
  await Deno.writeTextFile(
    proofFile(dir),
    `${
      JSON.stringify({
        version: ON_DISK_FORMATS.gateProof.version,
        head,
        mode: "strict",
        proof: {
          branch: "agent/pin-fixture",
          trunk: "main",
          head: head.slice(0, 12),
          files_total: 1,
          insertions: 1,
          deletions: 0,
          line: "> **Proof:** complete pin fixture",
          markdown: "### Proof — complete pin fixture",
        },
        evidence: evidence.identity,
      })
    }\n`,
  );
}

/** Read the registered Gate Proof's commit while preserving absence. */
async function readProof(dir: string): Promise<string | undefined> {
  const raw = await readTextIfExists(proofFile(dir));
  if (raw === undefined) return undefined;
  return decodeWith(GateProofHeadFixtureSchema, raw).head;
}

/** Read the project config after pinning so exact limit edits can be asserted. */
async function readConfig(dir: string): Promise<string> {
  return await Deno.readTextFile(join(dir, "discern.toml"));
}

/** Commit every working-tree change on the current branch. */
async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message, "--no-gpg-sign");
}

/** A run command that counts its own executions in `.git/<counter>` (inside the
 * git admin dir, so the sentinel never dirties the tree) before emitting `value`. */
function countingRun(metric: string, value: string, counter: string): string {
  return `printf x >> .git/${counter} && echo 'DISCERN_METRIC ${metric} ${value}'`;
}

/** How many times a {@link countingRun} measurement actually executed. */
async function runCount(dir: string, counter: string): Promise<number> {
  return (await readTextIfExists(join(dir, ".git", counter)))?.length ?? 0;
}

/** Resolve the standard-measurement cache through its registered Git-admin location. */
function measurementsFile(dir: string): string {
  return join(dir, ".git", GIT_ADMIN_STATE.standardMeasurements.path);
}

// ── pinning tightens a limit to the measured value ─────────────────────────────

/** The arithmetic fixture: every pin variant as one Standard, so one check and
 * three pins exercise the whole matrix. `coverage` leaves a sentinel and counts
 * its executions so the dry-run and reuse contracts are observable. */
const ARITHMETIC_STANDARDS: StandardSpec[] = [
  {
    name: "coverage",
    direction: "up",
    limit: "80",
    run: "touch .git/measured.sentinel && " +
      countingRun("coverage", "95", "coverage-runs"),
  },
  {
    name: "bundle",
    metric: "bundle_bytes",
    direction: "down",
    limit: "100",
    run: "echo 'DISCERN_METRIC bundle_bytes 50'",
  },
  {
    // Ceiling 1_000_000 with 100_000 headroom; measured 700_000 → pin to 800_000.
    name: "size",
    direction: "down",
    limit: "1000000",
    margin: "100000",
    run: "echo 'DISCERN_METRIC size 700000'",
  },
  {
    // Ceiling 1000, margin 100; measured 950 → target 1050 is not tighter → no pin.
    name: "small",
    direction: "down",
    limit: "1000",
    margin: "100",
    run: "echo 'DISCERN_METRIC small 950'",
  },
  {
    name: "snug",
    direction: "up",
    limit: "70",
    run: "echo 'DISCERN_METRIC snug 70'",
  },
  {
    // 30 alerts / 1000 words * 1000 = 30, ceiling 40 → pins the ceiling to 30.
    name: "warnings",
    metric: "alerts",
    direction: "down",
    limit: "40",
    per: '"words"',
    scale: "1000",
    run: "echo 'DISCERN_METRIC alerts 30'; echo 'DISCERN_METRIC words 1000'",
  },
];

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

Deno.test("pin: refusals, a named check, then three pins tighten every variant of the arithmetic matrix", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, pinConfig(...ARITHMETIC_STANDARDS));
    await gitInit(dir);
    const initialHead = await gitOut(dir, "rev-parse", "HEAD");

    await t.step(
      "pin --dry-run: renders the pin plan and measures NOTHING",
      async () => {
        // The coverage run command leaves a sentinel file — if the dry-run executes
        // it, the sentinel appears. A dry-run that measures is the defect this pins
        // against: same flag as the plain check's dry-run, so the same no-execution
        // contract (ADR 0027); slack is knowable only from the plain check's
        // measured hints.
        const r = await runAgent(dir, ["standards", "--pin", "--dry-run"]);
        assertEquals(r.code, 0, r.output);
        // The plan names the standard and the pin semantics, but no measured value —
        // nothing ran, so there is none to show.
        assertStringIncludes(r.stdout, "coverage");
        assertTerminalTextIncludes(r.stdout, "would measure");
        assert(
          !r.stdout.includes("95"),
          `a dry-run must not know the measured value:\n${r.stdout}`,
        );
        assertEquals(
          await targetExists(join(dir, ".git", "measured.sentinel")),
          false,
          "dry-run must not run the measurement",
        );
        // Nothing written, nothing committed.
        assertEquals(limitOf(await readConfig(dir), "coverage"), "80");
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), initialHead);
      },
    );

    await t.step(
      "pin: an unknown standard name fails loudly and pins nothing",
      async () => {
        const r = await runAgent(dir, ["standards", "--pin", "nope"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.stderr, "Unknown Standard name: nope");
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), initialHead);
      },
    );

    await t.step(
      "standards: unknown positional names refuse in ordinary and dry-run modes",
      async () => {
        for (
          const args of [
            ["standards", "nope", "--json"],
            ["standards", "nope", "--dry-run", "--json"],
          ]
        ) {
          const result = await runAgent(dir, args);
          assertEquals(result.code, 1, result.output);
          assertEquals(
            decodeCliResult(result.stdout, "standards").error,
            "invalid_value",
          );
        }
      },
    );

    await t.step(
      "pin: refuses a dirty worktree (it commits the change alone)",
      async () => {
        await Deno.writeTextFile(join(dir, "dirty.txt"), "uncommitted\n");
        const r = await runAgent(dir, ["standards", "--pin"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.stderr, "clean worktree");
        assertEquals(
          limitOf(await readConfig(dir), "coverage"),
          "80",
          "no edit",
        );
        assertEquals(
          await gitOut(dir, "rev-parse", "HEAD"),
          initialHead,
          "no commit",
        );
        await Deno.remove(join(dir, "dirty.txt"));
      },
    );

    await t.step(
      "standards: positional names narrow an ordinary measurement without creating full-project reuse evidence",
      async () => {
        const r = await runAgent(dir, ["standards", "coverage", "--json"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          decodeCliResult(r.stdout, "standards").steps?.map((step) =>
            step.label
          ),
          ["coverage"],
        );
        assertEquals(
          await targetExists(measurementsFile(dir)),
          false,
          "partial measurements must not become a reusable full-project cache",
        );
        assertEquals(await runCount(dir, "coverage-runs"), 1);
      },
    );

    await t.step(
      "a green check hints any pinnable slack, so check → pin needs no measuring preview",
      async () => {
        // The check already measured everything: its hints name each standard with
        // slack — decided by the same pinnedLimit a real pin applies — and stay
        // silent about the ones already at their limit or within their margin.
        const r = await runAgent(dir, ["standards", "--json"]);
        assertEquals(r.code, 0, r.output);
        const obj = decodeCliResult(r.stdout, "standards");
        assertEquals(obj.ok, true);
        assertHasHint(obj, HINTS["standards-pinnable-slack"], {
          standards: [
            {
              name: "coverage",
              bound: "floor",
              limit: 80,
              measured: "95",
              newLimit: 95,
            },
            {
              name: "bundle",
              bound: "ceiling",
              limit: 100,
              measured: "50",
              newLimit: 50,
            },
            {
              name: "size",
              bound: "ceiling",
              limit: 1000000,
              measured: "700000",
              newLimit: 800000,
            },
            {
              name: "warnings",
              bound: "ceiling",
              limit: 40,
              measured: "30",
              newLimit: 30,
            },
          ],
          proofed: true,
        });
        assertEquals(
          await runCount(dir, "coverage-runs"),
          2,
          "the check measures once",
        );
      },
    );

    const beforePin = await readConfig(dir);
    await t.step(
      "pin: a failed commit rolls discern.toml back to HEAD (the retry is never stranded, B55)",
      async () => {
        // The class: a multi-step mutation with no rollback on a failed step. The pin
        // writes → stages → commits; when the commit fails it once left discern.toml
        // modified AND staged, and the natural retry was then refused by the clean-tree
        // guard — a dead end. The fix restores the file to HEAD on any failed step, so
        // the tree is clean again and the retry proceeds the moment the block clears.
        const hook = await installRejectingHook(dir);

        // The pin measures fine but the commit is rejected: it fails, reporting why.
        const failed = await runAgent(dir, ["standards", "--pin", "coverage"]);
        assertEquals(failed.code, 1, failed.output);
        assertTerminalTextIncludes(
          failed.stderr,
          "could not commit the re-pin",
        );

        // Crucially, it left NO trace: discern.toml is byte-identical to HEAD and the
        // tree is clean — not the modified+staged state that stranded the old retry.
        assertEquals(
          await readConfig(dir),
          beforePin,
          "discern.toml must be restored",
        );
        assertEquals(
          (await gitOut(dir, "status", "--porcelain")).trim(),
          "",
          "the tree must be clean after a failed pin",
        );
        // The retry is no longer refused: clear the block and the next pin is real.
        await Deno.remove(hook);
      },
    );

    // Simulate a prior green finish over this clean HEAD: the pin commit below
    // must leave its exact subject alone.
    await seedProof(dir);
    const priorHead = await gitOut(dir, "rev-parse", "HEAD");
    const named = await runAgent(dir, ["standards", "--pin", "coverage"]);
    assertEquals(named.code, 0, named.output);
    const pinnedHead = await gitOut(dir, "rev-parse", "HEAD");

    await t.step(
      "pin: tightens an up-standard floor to the measured value and commits",
      async () => {
        assertTerminalTextIncludes(named.stdout, "pinned floor 80 → 95");

        // The limit is now the measured value, and the guiding comment survived.
        const cfg = await readConfig(dir);
        assertEquals(limitOf(cfg, "coverage"), "95");
        assertStringIncludes(cfg, "# hand-tuned baseline");
        await assertDiscernTomlTidy(dir, "standards --pin");

        // Exactly one new commit, touching only discern.toml, with an audit body.
        assert(pinnedHead !== priorHead, "pin must create a commit");
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
      },
    );

    await t.step("pin: names restrict the pin to those standards", async () => {
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

    await t.step(
      "proof: a pin after a green check reuses its measurements — one measurement total",
      async () => {
        assertTerminalTextIncludes(
          named.stdout,
          HINTS["standards-pin-reused-measurements"].template(undefined),
        );
        assertEquals(
          await runCount(dir, "coverage-runs"),
          2,
          "the pin must NOT re-run the measurement",
        );
      },
    );

    await t.step(
      "pin: invalidates an honored Gate Proof at the new commit",
      async () => {
        // The prior Proof keeps its exact subject. The pin commit needs a fresh Gate.
        assertTerminalTextIncludes(
          named.stdout,
          renderCommandRefsCli(
            HINTS["standards-pin-no-proof"].template(undefined),
          ),
        );
        assertEquals(await readProof(dir), priorHead);
      },
    );

    const rest = await runAgent(dir, ["standards", "--pin", "--json"], {
      env: { [DISCERN_NO_ATTRIBUTION]: "1" },
    });
    assertEquals(rest.code, 0, rest.output);
    const restObj = decodeCliResult(rest.stdout, "standards");
    const restConfig = await readConfig(dir);

    await t.step("pin --json: reports pinned steps and ok", () => {
      assertEquals(restObj.verb, "standards");
      assertEquals(restObj.ok, true);
      assert(restObj.steps !== undefined);
      const step = restObj.steps.find((s) => s.label === "bundle");
      assert(step !== undefined);
      assert(step.note !== undefined);
      assertStringIncludes(step.note, "pinned ceiling 100 → 50");
    });

    await t.step(
      "pin: DISCERN_NO_ATTRIBUTION omits the co-author trailer",
      async () => {
        assertEquals(await parsedCommitTrailers(dir), "");
        assert(
          !(await gitOut(dir, "show", "-s", "--format=%B")).includes(
            DISCERN_MACHINE.trailer,
          ),
        );
      },
    );

    await t.step(
      "pin: tightens a down-standard ceiling to the measured value",
      () => {
        assertEquals(limitOf(restConfig, "bundle"), "50");
      },
    );

    await t.step(
      "pin: a margin leaves headroom below/above the measured value",
      () => {
        assertEquals(limitOf(restConfig, "size"), "800000");
      },
    );

    await t.step("pin: a `per` rate standard pins to the measured rate", () => {
      const step = restObj.steps?.find((s) => s.label === "warnings");
      assertStringIncludes(step?.note ?? "", "pinned ceiling 40 → 30");
      assertEquals(limitOf(restConfig, "warnings"), "30");
    });

    await t.step(
      "pin: later commits never rewrite the prior exact-HEAD Proof",
      async () => {
        assertEquals(await readProof(dir), priorHead);
        // Another commit also leaves the exact prior evidence untouched.
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
          priorHead,
          "Proof still names the commit the Gate actually checked",
        );
      },
    );

    const settled = await gitOut(dir, "rev-parse", "HEAD");
    const again = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(again.code, 0, again.output);
    const againObj = decodeCliResult(again.stdout, "standards");
    assertHasHint(againObj, HINTS["standards-pin-no-slack"]);
    assertEquals(await gitOut(dir, "rev-parse", "HEAD"), settled, "no commit");

    await t.step(
      "pin: an improvement smaller than the margin is left un-pinned",
      async () => {
        assertEquals(limitOf(await readConfig(dir), "small"), "1000");
      },
    );

    await t.step(
      "pin: nothing to pin when the metric already sits at the limit",
      async () => {
        assertEquals(limitOf(await readConfig(dir), "snug"), "70");
        assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
      },
    );
  });
});

// ── safety: never pin a red tree, never pin a moving one ──────────────────────

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
    const obj = decodeCliResult(r.stdout, "standards");
    assertEquals(obj.ok, true);
    assertHasHint(obj, HINTS["standards-pin-behind"], {
      behind: 1,
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
    assertTerminalTextIncludes(
      r.stderr,
      "Source HEAD changed during validation",
    );
    assertStringIncludes(r.stderr, beforeHead);
    assertTerminalTextIncludes(r.stderr, "discern done --recover");
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
    assertTerminalTextIncludes(r.stderr, "Unexpected checkout changes");
    assertStringIncludes(r.stderr, "mid-measure.txt");
    assertTerminalTextIncludes(r.stderr, "discern done --recover");
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

// ── selecting what to pin: no Gate Proof validates every Standard ─────────────

Deno.test("pin: without Gate Proof, target selection reuses same-commit values, measures every obligation, and a red sibling blocks the whole pin", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig(
        {
          name: "already_measured",
          inputs: ["**"],
          direction: "up",
          limit: "80",
          run: countingRun("already_measured", "95", "already-runs"),
        },
        {
          name: "missing_target",
          direction: "down",
          limit: "100",
          inputs: ["**"],
          run: countingRun("missing_target", "40", "missing-runs"),
        },
        {
          name: "unrelated",
          direction: "down",
          limit: "100",
          inputs: ["**"],
          run: countingRun("unrelated", "50", "unrelated-runs"),
        },
      ),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "work");
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-qm",
      "establish proof subject",
      "--no-gpg-sign",
    );

    await t.step(
      "pin: target selection reuses available values and measures missing obligations before pinning",
      async () => {
        const done = await runAgent(dir, [
          "standards",
          "already_measured",
          "--json",
        ]);
        assertEquals(done.code, 0, done.output);
        assertEquals(await runCount(dir, "already-runs"), 1);

        const pinned = await runAgent(dir, [
          "standards",
          "--pin",
          "already_measured",
          "missing_target",
          "--json",
        ]);

        assertEquals(pinned.code, 0, pinned.output);
        assertEquals(await runCount(dir, "already-runs"), 1);
        assertEquals(await runCount(dir, "missing-runs"), 1);
        assertEquals(
          await readTextIfExists(join(dir, ".git", "unrelated-runs")),
          "x",
          "without complete gate evidence, an unselected obligation still needs measurement",
        );
        const config = await readConfig(dir);
        assertEquals(limitOf(config, "already_measured"), "95");
        assertEquals(limitOf(config, "missing_target"), "40");
        assertEquals(limitOf(config, "unrelated"), "100");
      },
    );

    // A sibling over its ceiling joins the branch (new on the branch, so the
    // trunk comparison passes vacuously) → every pin must abort.
    await writeConfig(
      dir,
      pinConfig(
        {
          name: "already_measured",
          inputs: ["**"],
          direction: "up",
          limit: "95",
          run: countingRun("already_measured", "95", "already-runs"),
        },
        {
          name: "missing_target",
          direction: "down",
          limit: "40",
          inputs: ["**"],
          run: countingRun("missing_target", "40", "missing-runs"),
        },
        {
          name: "unrelated",
          direction: "down",
          limit: "100",
          inputs: ["**"],
          run: countingRun("unrelated", "50", "unrelated-runs"),
        },
        {
          name: "red_sibling",
          direction: "down",
          limit: "100",
          run: countingRun("red_sibling", "150", "red-sibling-runs"),
        },
      ),
    );
    await commitAll(dir, "add a red sibling");
    const before = await gitOut(dir, "rev-parse", "HEAD");
    const counts = {
      already: await runCount(dir, "already-runs"),
      missing: await runCount(dir, "missing-runs"),
      unrelated: await runCount(dir, "unrelated-runs"),
    };

    const preview = await runAgent(dir, [
      "standards",
      "--pin",
      "already_measured",
      "--dry-run",
      "--json",
    ]);
    const refused = await runAgent(dir, [
      "standards",
      "--pin",
      "already_measured",
      "--json",
    ]);

    await t.step(
      "pin: without Gate Proof a named request still validates every Standard",
      async () => {
        assertEquals(preview.code, 0, preview.output);
        assertEquals(
          decodeCliResult(preview.stdout, "standards").plan?.steps.map((step) =>
            step.label
          ),
          ["already_measured", "missing_target", "unrelated", "red_sibling"],
        );

        assertEquals(refused.code, 1, refused.output);
        assertEquals(await runCount(dir, "already-runs"), counts.already + 1);
        assertEquals(await runCount(dir, "missing-runs"), counts.missing + 1);
        assertEquals(
          await runCount(dir, "unrelated-runs"),
          counts.unrelated + 1,
        );
        assertEquals(await runCount(dir, "red-sibling-runs"), 1);
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
        assertEquals(limitOf(await readConfig(dir), "already_measured"), "95");
      },
    );

    await t.step(
      "pin: a failing standard blocks the whole pin",
      async () => {
        // It names the failing standard and points at `discern standards` for the detail.
        assertHasHint(
          decodeCliResult(refused.stdout, "standards"),
          HINTS["standards-pin-blocked"],
          { failingNames: ["red_sibling"] },
        );
        // Neither limit moved and no commit was made.
        const cfg = await readConfig(dir);
        assertEquals(limitOf(cfg, "red_sibling"), "100");
        assertEquals(limitOf(cfg, "unrelated"), "100");
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
      },
    );
  });
});

// ── selecting what to pin: honored Gate Proof narrows to the selection ────────

Deno.test("pin: honored Gate Proof narrows a named pin, the pinned commit passes both gate halves, and a live-trunk change still blocks the unselected", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig(
        {
          name: "selected",
          direction: "up",
          limit: "70",
          inputs: ["**"],
          run: countingRun("selected", "95", "selected-runs"),
        },
        {
          name: "unselected_guard",
          direction: "up",
          limit: "80",
          run: countingRun("unselected_guard", "95", "unselected-runs"),
        },
        {
          name: "unrelated",
          direction: "down",
          limit: "100",
          inputs: ["**"],
          run: countingRun("unrelated", "40", "unrelated-runs"),
        },
      ),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "work");
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-qm",
      "establish proof subject",
      "--no-gpg-sign",
    );
    const done = await runAgent(dir, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);

    await t.step(
      "pin: honored Gate Proof narrows named measurement to the selected standards",
      async () => {
        const preview = await runAgent(dir, [
          "standards",
          "--pin",
          "selected",
          "--dry-run",
          "--json",
        ]);
        assertEquals(preview.code, 0, preview.output);
        assertEquals(
          decodeCliResult(preview.stdout, "standards").plan?.steps.map((step) =>
            step.label
          ),
          ["selected"],
        );

        const pinned = await runAgent(dir, [
          "standards",
          "--pin",
          "selected",
          "--json",
        ]);
        assertEquals(pinned.code, 0, pinned.output);
        assertEquals(await runCount(dir, "selected-runs"), 1);
        assertEquals(
          await runCount(dir, "unrelated-runs"),
          1,
          "complete done measured every required standard; pin must not repeat unrelated work",
        );
        assertEquals(await runCount(dir, "unselected-runs"), 1);
        const config = await readConfig(dir);
        assertEquals(limitOf(config, "selected"), "95");
        assertEquals(limitOf(config, "unrelated"), "100");
        assertEquals(limitOf(config, "unselected_guard"), "80");
      },
    );

    await t.step(
      "pin: the tightened pin commit still passes both standards gate halves",
      async () => {
        const after = await runAgent(dir, ["done", "--json"]);

        assertEquals(after.code, 0, after.output);
        const obj = decodeCliResult(after.stdout, "done");
        assertResultDataKey(obj, "standards_limits");
        assert(obj.data.standards_limits !== undefined);
        assert(obj.data.standards !== undefined);
        assertEquals(obj.ok, true);
        assertEquals(obj.data.standards_limits.status, "verified");
        const selected = obj.data.standards.find((standard) =>
          standard.name === "selected"
        );
        assert(selected !== undefined);
        assertEquals(selected.limit, 95);
        assertEquals(selected.value, 95);
        assertEquals(selected.verdict, "held");
      },
    );

    await t.step(
      "pin: target-only measurement still reports an unselected live-trunk limit failure",
      async () => {
        await git(dir, "checkout", "-q", "main");
        await Deno.writeTextFile(
          join(dir, "discern.toml"),
          (await readConfig(dir)).replace("limit = 80", "limit = 90"),
        );
        await git(
          dir,
          "commit",
          "-aqm",
          "raise unselected floor",
          "--no-gpg-sign",
        );
        await git(dir, "checkout", "-q", "work");
        const before = await gitOut(dir, "rev-parse", "HEAD");
        const selectedRuns = await runCount(dir, "selected-runs");
        const unselectedRuns = await runCount(dir, "unselected-runs");

        const pin = await runAgent(dir, [
          "standards",
          "--pin",
          "selected",
          "--json",
        ]);
        assertEquals(pin.code, 1, pin.output);
        const result = decodeCliResult(pin.stdout, "standards");
        assertHasHint(result, HINTS["standards-pin-blocked"], {
          failingNames: ["unselected_guard"],
        });
        assert(
          result.diagnostics?.some((diagnostic) =>
            diagnostic.tool === "unselected_guard" &&
            diagnostic.message.includes("the floor only rises")
          ),
        );
        assert(
          result.steps?.every((step) =>
            !(step.note ?? "").includes("deleted on this branch")
          ),
          "an unselected configured Standard must not be presented as deleted",
        );
        assertEquals(
          await runCount(dir, "selected-runs"),
          selectedRuns + 1,
          "a changed policy requires a fresh selected measurement",
        );
        assertEquals(
          await runCount(dir, "unselected-runs"),
          unselectedRuns,
          "the unselected Standard should not be re-measured",
        );
        assertEquals(await gitOut(dir, "rev-parse", "HEAD"), before);
        assertEquals(limitOf(await readConfig(dir), "selected"), "95");
      },
    );
  });
});

// ── the measurement proof: check → pin measures once ─────────────────────────

/** Point the fixture's Standard at a script kept inside the git admin dir, so a
 * step can change what a measurement does (its value, a red flag, a mid-run
 * commit) without changing the Standard's definition or dirtying the tree. */
async function writeMeasureScript(dir: string, body: string): Promise<void> {
  await Deno.writeTextFile(join(dir, ".git", "measure.sh"), `${body}\n`);
}

/** The ordinary script: count the execution, then emit `.git/value` unless the
 * `.git/fail` flag turns the metric red. */
const PLAIN_MEASURE_SCRIPT = [
  "echo x >> .git/measure-count",
  "if test -f .git/fail; then echo 'DISCERN_METRIC coverage 10'; " +
  'else echo "DISCERN_METRIC coverage $(cat .git/value)"; fi',
].join("\n");

/** How many times the scripted measurement actually executed. */
async function measureCount(dir: string): Promise<number> {
  const text = await readTextIfExists(join(dir, ".git", "measure-count"));
  return text === undefined
    ? 0
    : text.split("\n").filter((l) => l !== "").length;
}

Deno.test("proof: the measurement evidence lifecycle — recorded by a green check, reused by a pin, invalidated by a commit, a red check or a moving HEAD", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      pinConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "sh .git/measure.sh",
      }),
    );
    await gitInit(dir);
    await writeMeasureScript(dir, PLAIN_MEASURE_SCRIPT);
    await Deno.writeTextFile(join(dir, ".git", "value"), "95\n");

    await t.step(
      "proof: a --force check over a dirty tree records nothing",
      async () => {
        await Deno.writeTextFile(join(dir, "dirty.txt"), "uncommitted\n");
        const check = await runAgent(dir, ["standards", "--force"]);
        assertEquals(check.code, 0, check.output);
        assertEquals(
          await targetExists(measurementsFile(dir)),
          false,
          "a dirty tree's values describe a state no pin will see",
        );
        assertEquals(await measureCount(dir), 1);
        await Deno.remove(join(dir, "dirty.txt"));
      },
    );

    await git(dir, "checkout", "-q", "-b", "work");
    // Green check on the branch records the proof (main's floor is also 80).
    const check = await runAgent(dir, ["standards", "--json"]);
    assertEquals(check.code, 0, check.output);
    assertEquals(await measureCount(dir), 2);

    await t.step(
      "proof: a reusing pin still re-checks never-loosen against LIVE main",
      async () => {
        // Main advances underneath the unchanged branch HEAD: its floor rises to 90,
        // so the branch's 80 is now a loosening the proof knows nothing about.
        const mainBefore = await gitOut(dir, "rev-parse", "main");
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
        const obj = decodeCliResult(pin.stdout, "standards");
        assertEquals(obj.ok, false);
        assert(obj.steps !== undefined);
        assert(obj.diagnostics !== undefined);
        const step = obj.steps[0];
        const diagnostic = obj.diagnostics[0];
        assert(step !== undefined);
        assert(step.note !== undefined);
        assert(diagnostic !== undefined);
        // The live never-loosen refusal is evaluated before measuring a rejected selected definition.
        assert(!step.note.includes("reused"), step.note);
        assertStringIncludes(
          diagnostic.message,
          "the floor only rises",
        );
        assertHasHint(obj, HINTS["standards-pin-blocked"], {
          failingNames: ["coverage"],
        });
        // No producer can repair the forbidden policy change.
        assertEquals(
          await measureCount(dir),
          2,
          "the rejected policy runs no extra producer",
        );
        assertEquals(
          await gitOut(dir, "rev-parse", "HEAD"),
          before,
          "no commit",
        );
        assertEquals(
          limitOf(await readConfig(dir), "coverage"),
          "80",
          "no edit",
        );

        // Main returns to the floor the check was measured against.
        await git(dir, "branch", "-f", "main", mainBefore);
      },
    );

    // HEAD moves past the recorded evidence, then a pin runs over the new commit.
    await git(
      dir,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "more work",
      "--no-gpg-sign",
    );
    const pinAfterCommit = await runAgent(dir, [
      "standards",
      "--pin",
      "--json",
    ]);

    await t.step(
      "proof: a commit between check and pin invalidates it — the pin re-measures",
      async () => {
        assertEquals(pinAfterCommit.code, 0, pinAfterCommit.output);
        assertEquals(
          await measureCount(dir),
          3,
          "a moved HEAD must force a fresh measurement",
        );
        assertEquals(limitOf(await readConfig(dir), "coverage"), "95");
      },
    );

    await t.step(
      "pin: does NOT forge a proof when none was honored beforehand",
      async () => {
        assertHasHint(
          decodeCliResult(pinAfterCommit.stdout, "standards"),
          HINTS["standards-pin-no-proof"],
        );
        // Fail-closed: no proof was written, so accept will re-run the gate.
        assertEquals(await readProof(dir), undefined);
      },
    );

    await t.step(
      "proof: a red check clears it, so a later pin measures fresh",
      async () => {
        // The metric is controlled by a flag file inside .git (never dirties the
        // tree): present → 10 (under the floor, red), absent → the value file
        // (green with slack).
        await Deno.writeTextFile(join(dir, ".git", "value"), "97\n");

        // Green check (human path) records the proof.
        const green = await runAgent(dir, ["standards"]);
        assertEquals(green.code, 0, green.output);
        assertEquals(await measureCount(dir), 4);

        // Same HEAD turns red (environment drift): the check must clear the proof.
        await Deno.writeTextFile(join(dir, ".git", "fail"), "");
        const red = await runAgent(dir, ["standards"]);
        assertEquals(red.code, 1, red.output);
        assertEquals(await measureCount(dir), 5);

        // Back to green conditions: the pin must MEASURE, not reuse the cleared vouch.
        await Deno.remove(join(dir, ".git", "fail"));
        const pin = await runAgent(dir, ["standards", "--pin"]);
        assertEquals(pin.code, 0, pin.output);
        assertEquals(
          await measureCount(dir),
          6,
          "a cleared proof must not be reused",
        );
        assertEquals(limitOf(await readConfig(dir), "coverage"), "97");
      },
    );

    // A proof naming some other commit — not the current HEAD — and a
    // measurement cache that does not parse.
    const stale = "0".repeat(40);
    await seedProof(dir, stale);
    await Deno.writeTextFile(join(dir, ".git", "value"), "99\n");
    await Deno.mkdir(dirname(measurementsFile(dir)), { recursive: true });
    await Deno.writeTextFile(measurementsFile(dir), "not json {{{\n");
    const fresh = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(fresh.code, 0, fresh.output);

    await t.step(
      "proof: a malformed proof file is ignored — the pin measures fresh",
      async () => {
        assertEquals(
          await measureCount(dir),
          7,
          "garbage must read as a cache miss",
        );
        assertEquals(limitOf(await readConfig(dir), "coverage"), "99");
      },
    );

    await t.step(
      "pin: a STALE prior proof is not carried (fail-closed)",
      async () => {
        assertHasHint(
          decodeCliResult(fresh.stdout, "standards"),
          HINTS["standards-pin-no-proof"],
        );
        // The stale marker is left untouched (still ≠ HEAD) — accept re-validates.
        const head = await gitOut(dir, "rev-parse", "HEAD");
        assertEquals(await readProof(dir), stale);
        assert(stale !== head);
      },
    );

    await t.step(
      "proof: a commit during measurement fails validation and retains recovery",
      async () => {
        // The measurement itself commits — a deterministic stand-in for "someone
        // commits in another terminal while the measurements run". The check
        // must reject values that describe a different committed source.
        await writeMeasureScript(
          dir,
          "git commit -q --allow-empty -m mid-measure --no-gpg-sign && " +
            "echo 'DISCERN_METRIC coverage 99'",
        );

        const check = await runAgent(dir, ["standards", "--json"]);
        assertEquals(check.code, 1, check.output);
        assertStringIncludes(check.stdout, "recovery-incomplete");
        assertTerminalTextIncludes(
          check.stdout,
          "Source HEAD changed during validation",
        );
        assertEquals(limitOf(await readConfig(dir), "coverage"), "99");
        assertEquals(
          await gitOut(dir, "log", "-1", "--format=%s"),
          "mid-measure",
        );
        assertEquals(
          await targetExists(measurementsFile(dir)),
          false,
          "values measured before a mid-run commit must not vouch for the new HEAD",
        );
      },
    );
  });
});
