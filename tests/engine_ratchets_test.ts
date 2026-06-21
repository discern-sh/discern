/**
 * Engine tests for metric ratchets (ADR 0003).
 *
 * Every ratchet is a `[ratchets.<name>]` table with a direction (up=floor,
 * down=ceiling), a `limit`, and an inline `run` command that emits
 * `ICCULUS_METRIC <name> <number>`. There is no built-in or special ratchet —
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
    `run = "${opts.run}"`,
    "",
  ].join("\n");
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
        run: "echo 'ICCULUS_METRIC coverage 85'",
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
        run: "echo 'ICCULUS_METRIC coverage 70'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "below the floor");
  });
});

Deno.test("ratchets: a trailing NN% is NOT read — only the ICCULUS_METRIC marker counts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // No ICCULUS_METRIC line — only a trailing percentage. There is no fallback
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
        run: "echo 'ICCULUS_METRIC coverage 99'",
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
        run: "echo 'ICCULUS_METRIC coverage 99'",
      }),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "lower the floor", "--no-gpg-sign");

    const r = await runAgent(dir, ["ratchets"]);
    // A floor may only rise vs main: the never-loosen baseline is read from main's
    // root icculus.toml (with the legacy .icculus/config.toml as a fallback).
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
        run: "echo 'ICCULUS_METRIC bundle_bytes 50'",
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
        run: "echo 'ICCULUS_METRIC bundle_bytes 150'",
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
        run: "echo 'ICCULUS_METRIC typecov 95'",
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
        // no `run` key at all — nothing to measure
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "has no run command");
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
        "run = \"echo 'ICCULUS_METRIC coverage 95'\"",
        "",
        "[ratchets.bundle]",
        'metric = "bundle_bytes"',
        'direction = "down"',
        "limit = 100",
        "run = \"echo 'ICCULUS_METRIC bundle_bytes 150'\"",
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
