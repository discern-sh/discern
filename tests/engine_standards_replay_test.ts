/**
 * Engine tests for the gate's input-keyed measurement replay (ADR 0133): a
 * measurement taken at commit X still stands at HEAD when nothing the metric
 * reads changed in between. Each `[standards.<name>]` may declare `inputs` —
 * the globs the metric reads, matched by the SAME matcher the scopes use — and
 * a gate run whose whole change set (committed diff PLUS dirty working-tree
 * paths) falls outside them replays the recorded value instead of
 * re-measuring, loudly naming the source commit.
 *
 * Rename-safety is part of the contract and the regression class that has
 * bitten this project before: a rename touching an input counts on BOTH sides
 * (a metric file renamed away IS a change), guaranteed by the `--no-renames`
 * decomposition in the one shared diff reader. Guarded here permanently.
 *
 * Conservative by default: omitted `inputs` always measures, and the
 * standalone `standards` verb never replays (pinning and CI stay full-fat).
 *
 * Every scenario starts from one recorded green measurement, so the scenarios
 * that leave a fresh measurement behind (a touched input, a rename, a changed
 * definition) chain on one baseline: each step's end state is the next step's
 * recorded baseline, and the invocation counter proves which runs measured.
 *
 * Guards: boundary:measured-standards
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import type { GateWireData } from "../src/shared/result_schemas.ts";
import {
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

type GateJson = Omit<CliResultForCommand<"done">, "data"> & {
  data: GateWireData;
};

/** A config whose one standard counts its own invocations into `runs.count`
 * (gitignored, so a measurement never dirties the tree) and declares `src/**`
 * as its inputs unless `inputs` overrides. */
function replayConfig(opts: {
  limit?: number;
  inputs?: string | undefined;
  margin?: number;
}): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "true"',
    "",
    "[standards.cov]",
    'direction = "up"',
    `limit = ${opts.limit ?? 80}`,
    ...(opts.margin === undefined ? [] : [`margin = ${opts.margin}`]),
    'run = "echo x >> runs.count; echo DISCERN_METRIC cov 90"',
    ...(opts.inputs !== undefined ? [`inputs = [${opts.inputs}]`] : []),
    "",
  ].join("\n");
}

/** Scaffold, configure, and commit a repo whose standard has run once green —
 * the recorded baseline every replay scenario starts from. Returns the
 * baseline commit sha. */
async function setUpMeasuredBaseline(
  dir: string,
  opts: { inputs?: string | undefined; limit?: number },
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, replayConfig(opts));
  await Deno.writeTextFile(join(dir, ".gitignore"), "runs.count\n");
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src/metric-input.txt"), "v1\n");
  await gitInit(dir);
  const first = await runAgent(dir, ["done", "--json"]);
  assertEquals(first.code, 0, first.output);
  assertEquals(await measurementRuns(dir), 1);
  return await gitOut(dir, "rev-parse", "HEAD");
}

/** How many times the measurement command has actually executed. */
async function measurementRuns(dir: string): Promise<number> {
  const raw = (await readTextIfExists(join(dir, "runs.count"))) ?? "";
  return raw === "" ? 0 : raw.trim().split("\n").length;
}

/** Commit a docs-only change that must not invalidate a source-scoped measurement. */
async function commitDocsChange(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "docs/note.md"),
    `note ${SYSTEM_CLOCK.wallNow()}\n`,
  );
  await git(dir, "add", "docs");
  await git(dir, "commit", "-qm", "docs only", "--no-gpg-sign");
}

/** Decode the done envelope used to inspect replay source and measurement facts. */
function parseGate(stdout: string): GateJson {
  const result = decodeCliResult(stdout, "done");
  assert(result.data !== undefined && "failed_stage" in result.data);
  return { ...result, data: result.data };
}

Deno.test("replay: untouched inputs replay the recorded value; a changed definition, a tightened policy or a fresh worktree measures fresh", async (t) => {
  await withTempDir(async (dir) => {
    const baseline = await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    const before = observedRecords(await observeCompletionRecords(dir)).filter((
      record,
    ) => record.kind === "evidence");
    assert(before.length > 0);
    // A committed branch ahead of the trunk, changing only a non-input path,
    // so a proof renders AND the standard replays.
    await git(dir, "checkout", "-qb", "agent/replay-proof");
    await commitDocsChange(dir);

    const replayed = await runAgent(dir, ["done", "--json"]);
    assertEquals(replayed.code, 0, replayed.output);

    await t.step(
      "replay: untouched inputs replay the recorded value — no re-measure, the source commit named in step and envelope",
      async () => {
        assertEquals(
          await measurementRuns(dir),
          1,
          "an untouched-inputs run must not re-measure",
        );
        const obj = parseGate(replayed.stdout);
        const step = (obj.steps ?? []).find((s) => s.label === "standard:cov");
        assertEquals(step?.outcome, "ok");
        assertStringIncludes(step?.note ?? "", "replayed from");
        assertStringIncludes(step?.note ?? "", "inputs unchanged");
        const entry = obj.data?.standards?.find((s) => s.name === "cov");
        assertEquals(entry?.measurement, "replayed");
        assertEquals(entry?.value, 90);
        assertEquals(entry?.replayed_from, baseline);
        assertEquals(entry?.margin, 0);
        assertEquals(entry?.pin_eligible, true);
        assertEquals(entry?.pin_target, 90);
      },
    );

    await t.step(
      "replay: an unchanged measurement retains its original provenance record",
      async () => {
        assertEquals(
          observedRecords(await observeCompletionRecords(dir)).filter((
            record,
          ) => before.some((original) => original.id === record.id)),
          before,
          "replay must not rewrite a measurement as if it occurred at the new HEAD",
        );
      },
    );

    await t.step(
      "replay: the proof names the replay's source commit",
      async () => {
        await commitDocsChange(dir);
        const r = await runAgent(dir, ["done"]);
        assertEquals(r.code, 0, r.output);
        const markdown = r.output;
        assertStringIncludes(markdown, "replayed from");
        assertStringIncludes(markdown, baseline.slice(0, 7));
        assertStringIncludes(markdown, "inputs unchanged");
        assertEquals(await measurementRuns(dir), 1);
      },
    );

    await t.step(
      "replay: the standalone `standards` verb never replays",
      async () => {
        const r = await runAgent(dir, ["standards", "--json"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          await measurementRuns(dir),
          2,
          "the standalone verb always measures — pinning and CI stay full-fat",
        );
      },
    );

    await t.step(
      "replay: a fresh worktree cannot reuse evidence with a different declared seed",
      async () => {
        // Identical inputs alone cannot substitute a different execution seed:
        // the worktree forks from this branch's replayed-green HEAD, so the
        // recorded evidence is visible to it and must still be refused.
        const wt = await addWorktree(dir, "replay-from-trunk");
        await commitDocsChange(wt);

        const r = await runAgent(wt, ["done", "--json"]);
        assertEquals(r.code, 0, r.output);
        const measuredInWorktree =
          (await readTextIfExists(join(wt, "runs.count"))) ?? "";
        assertEquals(
          measuredInWorktree,
          "x\n",
          "the worktree needs its own declared execution conditions",
        );
        const entry = parseGate(r.stdout).data?.standards?.find(
          (s) => s.name === "cov",
        );
        assertEquals(entry?.measurement, "measured");
        assertEquals(entry?.replayed_from, undefined);
      },
    );

    await t.step(
      "replay: unchanged input evidence does not cross a changed Standard definition",
      async () => {
        await writeConfig(dir, replayConfig({ inputs: '"src/**"', margin: 1 }));
        await git(
          dir,
          "commit",
          "-aqm",
          "change pinning definition",
          "--no-gpg-sign",
        );

        const result = await runAgent(dir, ["done", "--json"]);
        assertEquals(result.code, 0, result.output);
        assertEquals(
          await measurementRuns(dir),
          3,
          "a changed definition must measure even when declared inputs are untouched",
        );
        assertEquals(
          parseGate(result.stdout).data.standards?.[0]?.measurement,
          "measured",
        );
      },
    );

    await t.step(
      "replay: a tightened policy requires fresh measurement and enforces the new limit",
      async () => {
        // Tighten the floor past the recorded value (90 → 95) and commit — a legal
        // tightening; policy is bound independently of inputs and requires a fresh
        // reading against the current limit.
        await writeConfig(
          dir,
          replayConfig({ inputs: '"src/**"', limit: 95, margin: 1 }),
        );
        await git(dir, "commit", "-aqm", "tighten the floor", "--no-gpg-sign");

        const r = await runAgent(dir, ["done", "--json"]);
        assertEquals(r.code, 1, r.output);
        assertEquals(
          await measurementRuns(dir),
          4,
          "the changed policy invalidates the previous applicability",
        );
        const obj = parseGate(r.stdout);
        assertEquals(obj.data?.failed_stage, "test");
        const diag = (obj.diagnostics ?? []).find((d) =>
          d.tool === "standard:cov"
        );
        assert(diag !== undefined, r.stdout);
        assertStringIncludes(diag.message, "below the floor 95");
        assertEquals(obj.data.standards?.[0]?.measurement, "measured");
      },
    );
  });
});

Deno.test("replay: a touched, dirty or renamed input measures fresh, on both sides of a rename", async (t) => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });

    await t.step("replay: a touched input measures fresh", async () => {
      await Deno.writeTextFile(join(dir, "src/metric-input.txt"), "v2\n");
      await git(dir, "commit", "-aqm", "touch an input", "--no-gpg-sign");

      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 0, r.output);
      assertEquals(
        await measurementRuns(dir),
        2,
        "a touched input must measure",
      );
      const entry = parseGate(r.stdout).data?.standards?.find(
        (s) => s.name === "cov",
      );
      assertEquals(entry?.measurement, "measured");
    });

    await t.step(
      "replay: dirty runs measure the current working tree without reusable Proof",
      async () => {
        await Deno.writeTextFile(join(dir, "src/metric-input.txt"), "dirty\n");

        const r = await runAgent(dir, ["done", "--standalone", "--json"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          await measurementRuns(dir),
          3,
          "a dirty input must measure",
        );

        // Dirty non-input paths also require standalone feedback without reusable Proof.
        await git(dir, "checkout", "--", "src/metric-input.txt");
        await Deno.writeTextFile(join(dir, "scratch.txt"), "not an input\n");
        const replay = await runAgent(dir, ["done", "--standalone", "--json"]);
        assertEquals(replay.code, 0, replay.output);
        assertEquals(
          await measurementRuns(dir),
          4,
          "dirty diagnostic runs measure their current working tree",
        );
        assertEquals(
          parseGate(replay.stdout).data.gate_proof?.status,
          "skipped_dirty",
        );
        await Deno.remove(join(dir, "scratch.txt"));
      },
    );

    await t.step(
      "replay: a DIRTY rename of an input file counts as touched on both sides",
      async () => {
        // The rename, staged but uncommitted: the porcelain R entry carries the
        // origin path, and both sides must count.
        await Deno.mkdir(join(dir, "lib"), { recursive: true });
        await git(dir, "mv", "src/metric-input.txt", "lib/metric-input.txt");

        const r = await runAgent(dir, ["done", "--standalone", "--json"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          await measurementRuns(dir),
          5,
          "a dirty renamed-away input must trigger a fresh measurement",
        );
        // Back to the committed layout for the committed rename below.
        await git(dir, "mv", "lib/metric-input.txt", "src/metric-input.txt");
        assertEquals(await gitOut(dir, "status", "--porcelain"), "");
      },
    );

    await t.step(
      "replay: a COMMITTED rename of an input file counts as touched on both sides (the regression class)",
      async () => {
        // Rename the input file AWAY from the inputs. Rename detection would
        // collapse this to one R line naming only the NEW path — outside src/** —
        // and the replay would stand on a tree the metric no longer describes.
        await git(dir, "mv", "src/metric-input.txt", "lib/metric-input.txt");
        await git(
          dir,
          "commit",
          "-qm",
          "rename the input away",
          "--no-gpg-sign",
        );

        const r = await runAgent(dir, ["done", "--json"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          await measurementRuns(dir),
          6,
          "a renamed-away input must trigger a fresh measurement",
        );
      },
    );
  });
});

Deno.test("replay: omitted inputs always measure (the conservative default)", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: undefined });
    await commitDocsChange(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await measurementRuns(dir),
      2,
      "no declared inputs means every gate run measures",
    );
  });
});

Deno.test("a standard's own `timeout` bounds its gate measurement job while siblings keep the global budget", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "true"',
        "",
        "[standards.slow]",
        'direction = "up"',
        "limit = 1",
        'run = "tail -f /dev/null"',
        "timeout = 1",
        "",
        "[gate]",
        "timeout = 600",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);

    assertEquals(r.code, 1, r.output);
    const obj = parseGate(r.stdout);
    const diag = (obj.diagnostics ?? []).find(
      (d) => d.tool === "standard:slow",
    );
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "timed out after 1s");
    // The gate-path Standard diagnostic attributes the kill to the Standard's
    // own `timeout` key, structurally marked as a timeout.
    assertStringIncludes(
      diag.message,
      "the budget comes from `[standards.slow].timeout`",
    );
    assertEquals(diag.rule, "timeout");
    const lint = (obj.steps ?? []).find((s) => s.label === "lint");
    assertEquals(lint?.outcome, "ok");
  });
});
