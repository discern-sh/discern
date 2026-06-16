/**
 * Engine tests for named metric ratchets (ADR 0003).
 *
 * Coverage is the built-in instance ([ratchets].coverage_min); named
 * [ratchets.<name>] tables generalise it with a direction (up=floor,
 * down=ceiling) and an explicit metric-emission convention
 * (`ICCULUS_METRIC <name> <number>`). These tests drive `agent finish:coverage`
 * and `agent finish:ratchets` against slots that emit metrics.
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

/** A config with a coverage-phase slot and a coverage_min floor. */
function coverageConfig(floor: string, covSlotRun: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes]",
    'neutral = ["docs/"]',
    'web = ["src/**"]',
    "",
    "[slots.cov]",
    'phase = "coverage"',
    `run = "${covSlotRun}"`,
    "",
    "[ratchets]",
    `coverage_min = ${floor}`,
    "",
  ].join("\n");
}

/** A config with a measurement slot and one named [ratchets.<name>] table. */
function namedRatchetConfig(opts: {
  name: string;
  metric: string;
  direction: string;
  limit: string;
  slotRun: string;
  coverageMin?: string;
}): string {
  const lines = [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes]",
    'neutral = ["docs/"]',
    'web = ["src/**"]',
    "",
    "[slots.measure]",
    'phase = "coverage"',
    `run = "${opts.slotRun}"`,
    "",
    "[ratchets]",
    `coverage_min = ${opts.coverageMin ?? "0"}`,
    "",
    `[ratchets.${opts.name}]`,
    `metric = "${opts.metric}"`,
    `direction = "${opts.direction}"`,
    `limit = ${opts.limit}`,
    'slot = "measure"',
    "",
  ];
  return lines.join("\n");
}

Deno.test("ratchets: coverage passes when the emitted metric meets the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      coverageConfig("80", "echo 'ICCULUS_METRIC coverage 85'"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:coverage"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("ratchets: coverage fails when the emitted metric is below the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      coverageConfig("80", "echo 'ICCULUS_METRIC coverage 70'"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:coverage"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "below the floor");
  });
});

Deno.test("ratchets: coverage legacy NN% fallback still works", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // No ICCULUS_METRIC line — only a trailing percentage, the legacy shape.
    await writeConfig(dir, coverageConfig("80", "echo 'Total coverage: 90%'"));
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:coverage"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("ratchets: coverage floor of 0 disables the ratchet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      coverageConfig("0", "echo 'ICCULUS_METRIC coverage 1'"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:coverage"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "disabled");
  });
});

Deno.test("ratchets: coverage_min may not be lowered vs main", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      coverageConfig("80", "echo 'ICCULUS_METRIC coverage 99'"),
    );
    await gitInit(dir); // main now has coverage_min = 80
    await git(dir, "checkout", "-q", "-b", "agent/x");
    await writeConfig(
      dir,
      coverageConfig("70", "echo 'ICCULUS_METRIC coverage 99'"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "lower the floor", "--no-gpg-sign");

    const r = await runAgent(dir, ["finish:coverage"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "only rises");
  });
});

Deno.test("ratchets: a named down-ratchet passes within its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      namedRatchetConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        slotRun: "echo 'ICCULUS_METRIC bundle_bytes 50'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "within the ceiling");
    assertStringIncludes(r.stdout, "ratchet(s) held");
  });
});

Deno.test("ratchets: a named down-ratchet fails above its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      namedRatchetConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        slotRun: "echo 'ICCULUS_METRIC bundle_bytes 150'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:ratchets"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "exceeds the ceiling");
  });
});

Deno.test("ratchets: a named up-ratchet passes above its floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      namedRatchetConfig({
        name: "typecov",
        metric: "typecov",
        direction: "up",
        limit: "90",
        slotRun: "echo 'ICCULUS_METRIC typecov 95'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("ratchets: finish:ratchets runs coverage AND named, aggregating failures", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      namedRatchetConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        slotRun: "echo 'ICCULUS_METRIC bundle_bytes 150'", // fails
        coverageMin: "0", // coverage skipped (no floor)
      }),
    );
    // Add a coverage floor + slot so BOTH run: rewrite with coverage too.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        "",
        "[slots.cov]",
        'phase = "coverage"',
        "run = \"echo 'ICCULUS_METRIC coverage 95'\"",
        "",
        "[slots.measure]",
        'phase = "coverage"',
        "run = \"echo 'ICCULUS_METRIC bundle_bytes 150'\"",
        "",
        "[ratchets]",
        "coverage_min = 80",
        "",
        "[ratchets.bundle]",
        'metric = "bundle_bytes"',
        'direction = "down"',
        "limit = 100",
        'slot = "measure"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:ratchets"]);
    assertEquals(r.code, 1, r.output);
    // Coverage held (reported) AND the bundle ratchet failed — both ran.
    assertStringIncludes(r.output, "coverage");
    assertStringIncludes(r.stderr, "exceeds the ceiling");
    assertStringIncludes(r.stderr, "ratchets failed");
  });
});

Deno.test("ratchets: finish:ratchets is a clean no-op when nothing is configured", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // default config: coverage_min = 0.0, no named
    await gitInit(dir);
    const r = await runAgent(dir, ["finish:ratchets"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "No ratchets configured");
  });
});
