/**
 * Engine tests for metric ratchets (ADR 0003).
 *
 * Every ratchet is a `[ratchets.<name>]` table with a direction (up=floor,
 * down=ceiling), a `limit`, and an inline `run` command that emits
 * `DISCERN_METRIC <name> <number>`. There is no built-in or special ratchet —
 * "coverage" is just a conventional name. `agent ratchets` runs them all.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/**
 * A config with one `[ratchets.<name>]` table whose `run` emits the metric. The
 * run is inline on the ratchet (not a separate gate job), so only `agent
 * ratchets` ever executes it — the gate never does.
 */
function ratchetConfig(opts: {
  name: string;
  metric?: string;
  direction: string;
  limit: string;
  run: string;
  /** Raw TOML for `per`, e.g. `'{ words = "content/**" }'` or `'"words"'`. */
  per?: string;
  scale?: string;
}): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    `[ratchets.${opts.name}]`,
    ...(opts.metric ? [`metric = "${opts.metric}"`] : []),
    `direction = "${opts.direction}"`,
    `limit = ${opts.limit}`,
    ...(opts.per ? [`per = ${opts.per}`] : []),
    ...(opts.scale ? [`scale = ${opts.scale}`] : []),
    `run = "${opts.run}"`,
    "",
  ].join("\n");
}

/** Write a file under `dir`, creating parent dirs — a known-size corpus for a
 * `per = { <extent> = … }` denominator (the file is committed by `gitInit`). */
async function writeText(
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  const path = `${dir}/${rel}`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/** A tracked file with exactly `wordCount` whitespace-delimited tokens. */
function writeWordFile(
  dir: string,
  rel: string,
  wordCount: number,
): Promise<void> {
  return writeText(dir, rel, Array(wordCount).fill("w").join(" "));
}

Deno.test("ratchets: coverage passes when the emitted metric meets the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 85'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("ratchets: coverage fails when the emitted metric is below the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 70'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "below the floor");
  });
});

Deno.test("ratchets: a trailing NN% is NOT read — only the DISCERN_METRIC marker counts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // No DISCERN_METRIC line — only a trailing percentage. There is no fallback
    // any more, so the metric is unreadable and the ratchet errors.
    await writeConfig(
      dir,
      ratchetConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'Total coverage: 90%'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "could not read metric");
  });
});

Deno.test("ratchets: a limit may not be lowered vs main", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 99'",
      }),
    );
    await gitInit(dir); // main now has ratchets.coverage.limit = 80
    await git(dir, "checkout", "-q", "-b", "agent/x");
    await writeConfig(
      dir,
      ratchetConfig({
        name: "coverage",
        direction: "up",
        limit: "70",
        run: "echo 'DISCERN_METRIC coverage 99'",
      }),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "lower the floor", "--no-gpg-sign");

    const r = await runAgent(dir, ["ratchets"]);
    // A floor may only rise vs main: the never-loosen baseline is read from main's
    // root discern.toml (with the legacy .discern/config.toml as a fallback).
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "only rises");
  });
});

Deno.test("ratchets: a down-ratchet passes within its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle_bytes 50'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "within the ceiling");
    assertStringIncludes(r.stdout, "ratchet(s) held");
  });
});

Deno.test("ratchets: a down-ratchet fails above its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle_bytes 150'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "exceeds the ceiling");
  });
});

Deno.test("ratchets: an up-ratchet passes above its floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "typecov",
        direction: "up",
        limit: "90",
        run: "echo 'DISCERN_METRIC typecov 95'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("ratchets: a misconfigured ratchet (no run command) errors clearly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[ratchets.coverage]",
        'direction = "up"',
        "limit = 80",
        // no `run` key at all — nothing to measure. `run` is now schema-required,
        // so this is caught at load with a path-qualified message, not deferred to
        // a runtime "no run command" check.
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "discern.toml is invalid");
    assertStringIncludes(r.stderr, "ratchets.coverage.run");
  });
});

Deno.test("ratchets: runs every configured ratchet, aggregating failures", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Two ratchets: coverage holds, bundle fails. Both must run.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[ratchets.coverage]",
        'direction = "up"',
        "limit = 80",
        "run = \"echo 'DISCERN_METRIC coverage 95'\"",
        "",
        "[ratchets.bundle]",
        'metric = "bundle_bytes"',
        'direction = "down"',
        "limit = 100",
        "run = \"echo 'DISCERN_METRIC bundle_bytes 150'\"",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    // Coverage held (reported) AND the bundle ratchet failed — both ran.
    assertStringIncludes(r.stdout, "meets the floor");
    assertStringIncludes(r.stderr, "exceeds the ceiling");
    assertStringIncludes(r.stderr, "ratchets failed");
  });
});

Deno.test("ratchets: a clean no-op when nothing is configured", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // default config: no [ratchets.<name>] tables
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "No ratchets configured");
  });
});

// ── `per`: ratchet a rate, not a raw count ─────────────────────────────────────

Deno.test("ratchets: per a built-in word extent passes within the rate ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "12",
        per: '{ words = "content/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await writeWordFile(dir, "content/a.txt", 100); // denominator = 100 words
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    // 1 alert / 100 words * 1000 = 10 per 1,000 words, within the ceiling of 12.
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "within the ceiling");
    assertStringIncludes(r.stdout, "per 100 words");
  });
});

Deno.test("ratchets: per a built-in word extent fails when the rate exceeds the ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "5",
        per: '{ words = "content/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await writeWordFile(dir, "content/a.txt", 100);
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    // 10 per 1,000 words exceeds the ceiling of 5.
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "exceeds the ceiling");
    assertStringIncludes(r.stderr, "per 100 words");
  });
});

Deno.test("ratchets: per a second emitted metric divides one number by the other", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
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
    const r = await runAgent(dir, ["ratchets"]);
    // 30 alerts / 1000 words * 1000 = 30, within the ceiling of 40.
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "within the ceiling");
    assertStringIncludes(r.stdout, "per 1000");
  });
});

Deno.test("ratchets: a `per` extent matching nothing errors instead of dividing by zero", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "5",
        per: '{ words = "nope/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "nothing to divide by");
  });
});

// ── The class-guard: a rate is invariant under growth; a raw count is not ───────
// This pair is the regression guard for the whole reason `per` exists. If a future
// change made the measured value scale with corpus size again, the first test
// breaks. Drive both off the SAME corpus/metric growth so the contrast is exact.

Deno.test("ratchets: a rate is invariant under proportional growth (the fix)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const cfg = ratchetConfig({
      name: "prose",
      direction: "down",
      limit: "21", // ceiling on the RATE (per 1,000 words)
      per: '{ words = "content/**" }',
      scale: "1000",
      run: "echo 'DISCERN_METRIC prose 3'",
    });
    await writeConfig(dir, cfg);
    await writeWordFile(dir, "content/a.txt", 150); // 3 / 150 * 1000 = 20.0
    await gitInit(dir);
    const small = await runAgent(dir, ["ratchets"]);
    assertEquals(small.code, 0, small.output);
    assertStringIncludes(small.stdout, "within the ceiling");

    // Grow the corpus and the alerts proportionally: density stays 20.0, so the
    // SAME ceiling still holds — growth alone never breaches it.
    await writeWordFile(dir, "content/a.txt", 300);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "21",
        per: '{ words = "content/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 6'", // 6 / 300 * 1000 = 20.0
      }),
    );
    const grown = await runAgent(dir, ["ratchets"]);
    assertEquals(grown.code, 0, grown.output);
    assertStringIncludes(grown.stdout, "within the ceiling");
  });
});

Deno.test("ratchets: the same growth breaks a raw count, and the failure points at `per`", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A raw-count ceiling at the small count (3), no `per`.
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "3",
        run: "echo 'DISCERN_METRIC prose 3'",
      }),
    );
    await gitInit(dir);
    const small = await runAgent(dir, ["ratchets"]);
    assertEquals(small.code, 0, small.output); // 3 within the ceiling of 3

    // Same proportional growth as the rate test — but a raw count rises with size
    // and breaches the ceiling, the exact trap `per` removes.
    await writeConfig(
      dir,
      ratchetConfig({
        name: "prose",
        direction: "down",
        limit: "3",
        run: "echo 'DISCERN_METRIC prose 6'",
      }),
    );
    const grown = await runAgent(dir, ["ratchets"]);
    assertEquals(grown.code, 1, grown.output);
    assertStringIncludes(grown.stderr, "exceeds the ceiling");
    assertStringIncludes(grown.stderr, "ratchet a rate"); // the normalize hint
  });
});

// ── Every built-in extent measures the right denominator ───────────────────────
// `per = { words = … }` is exercised above; cover the other three measures so a
// regression in any branch of the extent counter (not just words) fails. Each
// emits a 0 numerator, so the rate is 0 regardless and the breakdown reveals the
// measured denominator the assertion pins.

Deno.test("ratchets: the `files` extent counts matching tracked files", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "r",
        direction: "down",
        limit: "1",
        per: '{ files = "content/**" }',
        run: "echo 'DISCERN_METRIC r 0'",
      }),
    );
    await writeWordFile(dir, "content/a.txt", 1);
    await writeWordFile(dir, "content/b.txt", 1);
    await writeWordFile(dir, "content/c.txt", 1);
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "per 3 files");
  });
});

Deno.test("ratchets: the `lines` extent sums newlines across matching files", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "r",
        direction: "down",
        limit: "1",
        per: '{ lines = "content/**" }',
        run: "echo 'DISCERN_METRIC r 0'",
      }),
    );
    await writeText(dir, "content/x.txt", "a\nb\nc\nd\n"); // 4 newlines
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "per 4 lines");
  });
});

Deno.test("ratchets: the `bytes` extent sums file sizes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "r",
        direction: "down",
        limit: "1",
        per: '{ bytes = "content/**" }',
        run: "echo 'DISCERN_METRIC r 0'",
      }),
    );
    await writeText(dir, "content/x.txt", "abcdefghij"); // 10 bytes
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "per 10 bytes");
  });
});

Deno.test("ratchets: a `per` metric the run never emits errors clearly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      ratchetConfig({
        name: "warnings",
        metric: "alerts",
        direction: "down",
        limit: "10",
        per: '"words"', // but the run emits no `words` metric
        scale: "1000",
        run: "echo 'DISCERN_METRIC alerts 5'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "could not read 'per' metric 'words'");
  });
});
