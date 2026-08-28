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

Deno.test("replay: untouched inputs replay the recorded value — no re-measure, the source commit named in step and envelope", async () => {
  await withTempDir(async (dir) => {
    const baseline = await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    await commitDocsChange(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await measurementRuns(dir),
      1,
      "an untouched-inputs run must not re-measure",
    );
    const obj = parseGate(r.stdout);
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
  });
});

Deno.test("replay: a touched input measures fresh", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    await Deno.writeTextFile(join(dir, "src/metric-input.txt"), "v2\n");
    await git(dir, "commit", "-aqm", "touch an input", "--no-gpg-sign");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await measurementRuns(dir), 2, "a touched input must measure");
    const entry = parseGate(r.stdout).data?.standards?.find(
      (s) => s.name === "cov",
    );
    assertEquals(entry?.measurement, "measured");
  });
});

Deno.test("replay: a COMMITTED rename of an input file counts as touched on both sides (the regression class)", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    // Rename the input file AWAY from the inputs. Rename detection would
    // collapse this to one R line naming only the NEW path — outside src/** —
    // and the replay would stand on a tree the metric no longer describes.
    await Deno.mkdir(join(dir, "lib"), { recursive: true });
    await git(dir, "mv", "src/metric-input.txt", "lib/metric-input.txt");
    await git(dir, "commit", "-qm", "rename the input away", "--no-gpg-sign");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await measurementRuns(dir),
      2,
      "a renamed-away input must trigger a fresh measurement",
    );
  });
});

Deno.test("replay: a DIRTY rename of an input file counts as touched on both sides", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    // The same rename, staged but uncommitted: the porcelain R entry carries
    // the origin path, and both sides must count.
    await Deno.mkdir(join(dir, "lib"), { recursive: true });
    await git(dir, "mv", "src/metric-input.txt", "lib/metric-input.txt");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await measurementRuns(dir),
      2,
      "a dirty renamed-away input must trigger a fresh measurement",
    );
  });
});

Deno.test("replay: a dirty (uncommitted) edit to an input counts as touched — dirty runs measure as-is, so they replay as-is too", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    await Deno.writeTextFile(join(dir, "src/metric-input.txt"), "dirty\n");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(await measurementRuns(dir), 2, "a dirty input must measure");

    // The inverse: a dirty NON-input path still replays.
    await git(dir, "checkout", "--", "src/metric-input.txt");
    await Deno.writeTextFile(join(dir, "scratch.txt"), "not an input\n");
    const replay = await runAgent(dir, ["done", "--json"]);
    assertEquals(replay.code, 0, replay.output);
    assertEquals(
      await measurementRuns(dir),
      2,
      "a dirty non-input path must still replay",
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

Deno.test("replay: the standalone `standards` verb never replays", async () => {
  await withTempDir(async (dir) => {
    await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    await commitDocsChange(dir);

    const r = await runAgent(dir, ["standards", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await measurementRuns(dir),
      2,
      "the standalone verb always measures — pinning and CI stay full-fat",
    );
  });
});

Deno.test("replay: a replayed value the branch's own tightened limit now fails is a genuine gate failure", async () => {
  await withTempDir(async (dir) => {
    const baseline = await setUpMeasuredBaseline(dir, {
      inputs: '"src/**"',
      limit: 80,
    });
    // Tighten the floor past the recorded value (90 → 95) and commit — a legal
    // tightening; the config file is not an input, so the value replays and
    // must FAIL against the current limit.
    await writeConfig(dir, replayConfig({ inputs: '"src/**"', limit: 95 }));
    await git(dir, "commit", "-aqm", "tighten the floor", "--no-gpg-sign");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(
      await measurementRuns(dir),
      1,
      "the value replays — no re-run",
    );
    const obj = parseGate(r.stdout);
    assertEquals(obj.data?.failed_stage, "check/test");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standard:cov");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "below the floor 95");
    assertStringIncludes(diag.message, baseline.slice(0, 7));
  });
});

Deno.test("replay: a fresh worktree replays from the TRUNK checkout's recorded measurement", async () => {
  await withTempDir(async (dir) => {
    // The trunk checkout measures once (recording its proof); a fresh
    // worktree has no proof of its own, so the baseline chain falls through
    // to the trunk's — a new branch touching no inputs pays seconds, not a
    // measurement, from its very first gate run.
    const baseline = await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    const wt = await addWorktree(dir, "replay-from-trunk");
    await commitDocsChange(wt);

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const measuredInWorktree =
      (await readTextIfExists(join(wt, "runs.count"))) ?? "";
    assertEquals(
      measuredInWorktree,
      "",
      "the worktree must replay the trunk's measurement, not re-run it",
    );
    const entry = parseGate(r.stdout).data?.standards?.find(
      (s) => s.name === "cov",
    );
    assertEquals(entry?.measurement, "replayed");
    assertEquals(entry?.replayed_from, baseline);
  });
});

Deno.test("replay: the proof names the replay's source commit", async () => {
  await withTempDir(async (dir) => {
    const baseline = await setUpMeasuredBaseline(dir, { inputs: '"src/**"' });
    // A committed branch ahead of the trunk, changing only a non-input path,
    // so a proof renders AND the standard replays.
    await git(dir, "checkout", "-qb", "agent/replay-proof");
    await commitDocsChange(dir);

    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 0, r.output);
    const markdown = r.output;
    assertStringIncludes(markdown, "replayed from");
    assertStringIncludes(markdown, baseline.slice(0, 7));
    assertStringIncludes(markdown, "inputs unchanged");
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
        'run = "sleep 9999"',
        "timeout = 1",
        "",
        "[gate]",
        "timeout = 600",
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = SYSTEM_CLOCK.wallNow();
    const r = await runAgent(dir, ["done", "--json"]);
    const elapsed = SYSTEM_CLOCK.wallNow() - start;

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
    assert(elapsed < 30_000, `bounded by the override, took ${elapsed}ms`);
  });
});
