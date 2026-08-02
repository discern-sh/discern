/**
 * The OS-temp artifact registry (ADR 0117). The gate persists every job's full
 * output (ADR 0096) plus offloaded diagnostic text as OS-temp files, at
 * agent-run frequency — so without retention the temp dir grows without bound
 * (tens of thousands of orphaned logs were observed in the wild). These tests
 * pin the retention contract: every registered artifact family is reaped past
 * its TTL, nothing outside the registry is ever touched, and — the structural
 * guard — no code in `src/` can mint an OS-temp file/dir outside the registry
 * module, so a future artifact family cannot silently opt out of the reaper.
 * The one non-artifact use is the target-adjacent write-authority probe: its
 * exact primitive and target directory are pinned below, and its own tests
 * prove immediate cleanup.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  makeTempArtifact,
  makeTempArtifactDir,
  pruneStaleTempArtifacts,
  TEMP_ARTIFACT_DIR_KINDS,
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
  TEMP_ARTIFACT_TTL_MS,
} from "../src/shared/temp_artifacts.ts";
import {
  sweepDueTempArtifacts,
  TEMP_ARTIFACT_SWEEP_INTERVAL_MS,
} from "../src/engine/gate/temp_artifact_sweep.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  suiteTempDir,
  writeConfig,
} from "./engine_helpers.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Create `name` in `dir` with its mtime backdated `ageMs` into the past. */
async function fileAged(
  dir: string,
  name: string,
  ageMs: number,
): Promise<string> {
  const path = join(dir, name);
  await Deno.writeTextFile(path, "artifact body\n");
  const then = new Date(Date.now() - ageMs);
  await Deno.utime(path, then, then);
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("temp artifacts: every registered family is reaped past the TTL — new kinds auto-enrol", async () => {
  await withTempDir(async (dir) => {
    // Driven off the registry itself: a kind added to TEMP_ARTIFACT_KINDS is
    // covered here with no test edit.
    const stale: string[] = [];
    const fresh: string[] = [];
    for (const prefix of Object.values(TEMP_ARTIFACT_KINDS)) {
      stale.push(
        await fileAged(
          dir,
          `${prefix}stale${TEMP_ARTIFACT_SUFFIX}`,
          TEMP_ARTIFACT_TTL_MS + HOUR_MS,
        ),
      );
      fresh.push(
        await fileAged(dir, `${prefix}fresh${TEMP_ARTIFACT_SUFFIX}`, HOUR_MS),
      );
    }

    const { removed } = await pruneStaleTempArtifacts({ dir });

    assertEquals(removed, stale.length);
    for (const path of stale) {
      assertEquals(await exists(path), false, `${path} must be reaped`);
    }
    for (const path of fresh) {
      assertEquals(await exists(path), true, `${path} must survive`);
    }
  });
});

/** Create directory `name` in `dir`, non-empty, mtime backdated `ageMs`. */
async function dirAged(
  dir: string,
  name: string,
  ageMs: number,
): Promise<string> {
  const path = join(dir, name);
  await Deno.mkdir(path);
  await Deno.writeTextFile(join(path, "discern"), "#!/usr/bin/env sh\n");
  const then = new Date(Date.now() - ageMs);
  await Deno.utime(path, then, then);
  return path;
}

Deno.test("temp artifacts: every directory family is reaped recursively past the TTL — new kinds auto-enrol", async () => {
  await withTempDir(async (dir) => {
    const age = TEMP_ARTIFACT_TTL_MS + HOUR_MS;
    const stale: string[] = [];
    const fresh: string[] = [];
    for (const prefix of Object.values(TEMP_ARTIFACT_DIR_KINDS)) {
      stale.push(await dirAged(dir, `${prefix}stale`, age));
      // A live owner refreshes its directory's mtime on use (the self-shim
      // touches it every spawn), so "fresh" is exactly "in use".
      fresh.push(await dirAged(dir, `${prefix}fresh`, HOUR_MS));
      // A FILE wearing a directory family's prefix is outside both shapes.
      fresh.push(await fileAged(dir, `${prefix}file-trap`, age));
    }

    const { removed } = await pruneStaleTempArtifacts({ dir });

    assertEquals(removed, stale.length);
    for (const path of stale) {
      assertEquals(await exists(path), false, `${path} must be reaped`);
    }
    for (const path of fresh) {
      assertEquals(await exists(path), true, `${path} must survive`);
    }
  });
});

Deno.test("temp artifacts: makeTempArtifactDir mints its registered prefix", async () => {
  for (
    const kind of Object.keys(TEMP_ARTIFACT_DIR_KINDS) as Array<
      keyof typeof TEMP_ARTIFACT_DIR_KINDS
    >
  ) {
    const path = await makeTempArtifactDir(kind);
    try {
      assert(
        basename(path).startsWith(TEMP_ARTIFACT_DIR_KINDS[kind]),
        `a '${kind}' directory must carry its registered prefix: ${path}`,
      );
      assert((await Deno.stat(path)).isDirectory);
    } finally {
      await Deno.remove(path, { recursive: true }).catch(() => undefined);
    }
  }
});

Deno.test("temp artifacts: nothing outside the registry's prefix+suffix shape is ever touched", async () => {
  await withTempDir(async (dir) => {
    const age = TEMP_ARTIFACT_TTL_MS + HOUR_MS;
    const foreign = await fileAged(
      dir,
      `someone-elses${TEMP_ARTIFACT_SUFFIX}`,
      age,
    );
    const wrongSuffix = await fileAged(dir, "discern-job-not-a-log.txt", age);
    // A DIRECTORY with an artifact-shaped name must also survive.
    const dirTrap = join(dir, `discern-job-dir${TEMP_ARTIFACT_SUFFIX}`);
    await Deno.mkdir(dirTrap);

    const { removed } = await pruneStaleTempArtifacts({ dir });

    assertEquals(removed, 0);
    assertEquals(await exists(foreign), true);
    assertEquals(await exists(wrongSuffix), true);
    assertEquals(await exists(dirTrap), true);
  });
});

Deno.test("temp artifacts: the removal budget bounds a sweep, and later sweeps drain the backlog", async () => {
  await withTempDir(async (dir) => {
    const age = TEMP_ARTIFACT_TTL_MS + HOUR_MS;
    const prefix = Object.values(TEMP_ARTIFACT_KINDS)[0] ?? "discern-job-";
    for (let i = 0; i < 5; i++) {
      await fileAged(dir, `${prefix}backlog-${i}${TEMP_ARTIFACT_SUFFIX}`, age);
    }
    // A sweep against a backlog bigger than its budget removes exactly the
    // budget (the inline sweep must stay fast even on a polluted machine)…
    assertEquals(
      (await pruneStaleTempArtifacts({ dir, maxRemovals: 2 })).removed,
      2,
    );
    assertEquals(
      (await pruneStaleTempArtifacts({ dir, maxRemovals: 2 })).removed,
      2,
    );
    // …and successive sweeps finish the job.
    assertEquals(
      (await pruneStaleTempArtifacts({ dir, maxRemovals: 2 })).removed,
      1,
    );
    assertEquals(
      (await pruneStaleTempArtifacts({ dir, maxRemovals: 2 })).removed,
      0,
    );
  });
});

Deno.test("temp artifacts: the inspection budget bounds a fresh population, and its cursor rotates across future siblings", async () => {
  await withTempDir(async (dir) => {
    const prefix = Object.values(TEMP_ARTIFACT_KINDS)[0] ?? "discern-job-";
    // The unrelated names model future artifacts in this registered family:
    // the detector changes neither its scan nor its expected pages for them.
    for (const name of ["alpha", "bravo", "charlie", "delta"]) {
      await fileAged(
        dir,
        `${prefix}${name}${TEMP_ARTIFACT_SUFFIX}`,
        HOUR_MS,
      );
    }
    await fileAged(
      dir,
      `${prefix}future${TEMP_ARTIFACT_SUFFIX}`,
      TEMP_ARTIFACT_TTL_MS + HOUR_MS,
    );

    let cursor: string | undefined;
    const inspected: number[] = [];
    const removed: number[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await pruneStaleTempArtifacts({
        dir,
        maxInspections: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      inspected.push(result.inspected);
      removed.push(result.removed);
      cursor = result.cursor;
    }

    assertEquals(inspected, [2, 2, 2]);
    assertEquals(
      removed,
      [0, 0, 1],
      "the cursor reaches the stale future sibling instead of rescanning page one",
    );
  });
});

Deno.test("temp artifacts: budgeted pages visit a large population once each — no revisits, full drain", async () => {
  await withTempDir(async (dir) => {
    const prefix = Object.values(TEMP_ARTIFACT_KINDS)[0] ?? "discern-job-";
    const age = TEMP_ARTIFACT_TTL_MS + HOUR_MS;
    const total = 400;
    const budget = 25;
    for (let i = 0; i < total; i++) {
      await fileAged(
        dir,
        `${prefix}${String(i).padStart(4, "0")}${TEMP_ARTIFACT_SUFFIX}`,
        i % 2 === 0 ? age : HOUR_MS,
      );
    }
    // A cursor that revisits any page cannot clear the stale half within
    // exactly population/budget pages; one that skips entries clears less.
    let cursor: string | undefined;
    let removed = 0;
    for (let page = 0; page < total / budget; page++) {
      const result = await pruneStaleTempArtifacts({
        dir,
        maxInspections: budget,
        maxRemovals: budget,
        ...(cursor === undefined ? {} : { cursor }),
      });
      assert(
        result.inspected <= budget,
        `page ${page} inspected ${result.inspected}`,
      );
      removed += result.removed;
      cursor = result.cursor;
    }
    assertEquals(removed, total / 2);
  });
});

Deno.test("temp artifacts: independent callers share one repository-wide sweep interval", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const artifacts = join(dir, "artifacts");
    await Deno.mkdir(artifacts);
    const prefix = Object.values(TEMP_ARTIFACT_KINDS)[0] ?? "discern-job-";
    const age = TEMP_ARTIFACT_TTL_MS + HOUR_MS;
    for (const name of ["first", "future-sibling"]) {
      await fileAged(
        artifacts,
        `${prefix}${name}${TEMP_ARTIFACT_SUFFIX}`,
        age,
      );
    }
    const now = Date.now();
    const sweep = () =>
      sweepDueTempArtifacts(dir, {
        now,
        prune: { dir: artifacts, maxInspections: 1, maxRemovals: 1 },
      });

    const concurrent = await Promise.all([sweep(), sweep()]);
    assertEquals(
      concurrent.filter((outcome) => outcome.kind === "swept").length,
      1,
      "one caller sweeps; its repository-shared stamp suppresses the other",
    );
    assertEquals(
      (await Array.fromAsync(Deno.readDir(artifacts))).length,
      1,
      "the suppressed caller must not spend a second inspection budget",
    );

    const next = await sweepDueTempArtifacts(dir, {
      now: now + TEMP_ARTIFACT_SWEEP_INTERVAL_MS + 1,
      prune: { dir: artifacts, maxInspections: 1, maxRemovals: 1 },
    });
    assertEquals(next.kind, "swept");
    assertEquals(
      (await Array.fromAsync(Deno.readDir(artifacts))).length,
      0,
      "the persisted cursor drains the next page when the interval expires",
    );
  });
});

Deno.test("temp artifacts: creation goes through the registry, so what is minted is what gets reaped", async () => {
  for (
    const kind of Object.keys(TEMP_ARTIFACT_KINDS) as Array<
      keyof typeof TEMP_ARTIFACT_KINDS
    >
  ) {
    const path = await makeTempArtifact(kind);
    try {
      const name = basename(path);
      assert(
        name.startsWith(TEMP_ARTIFACT_KINDS[kind]) &&
          name.endsWith(TEMP_ARTIFACT_SUFFIX),
        `a '${kind}' artifact must carry its registered prefix and the shared suffix: ${name}`,
      );
    } finally {
      await Deno.remove(path).catch(() => undefined);
    }
  }
});

Deno.test("engine suite: spawned-engine artifacts land in the suite temp home, not the shared OS temp dir", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Twelve error-like lines make the passing job loud enough to keep its
    // output artifact, giving the envelope a real OS-temp path to check.
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
        "lint = \"printf 'error: one\\nerror: two\\nerror: three\\nerror: four\\nerror: five\\nerror: six\\nerror: seven\\nerror: eight\\nerror: nine\\nerror: ten\\nerror: eleven\\nerror: twelve\\n'\"",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const envelope = JSON.parse(r.stdout.trim()) as {
      steps?: Array<{ label?: string; output_path?: string }>;
    };
    const outputPath = envelope.steps?.find((step) =>
      step.label === "lint"
    )?.output_path;
    assert(typeof outputPath === "string", r.stdout);
    // realPath both sides: macOS spells its temp dir with and without the
    // /private prefix depending on who resolved it.
    const home = await Deno.realPath(await suiteTempDir());
    const artifact = await Deno.realPath(outputPath);
    assert(
      artifact.startsWith(`${home}/`),
      `a spawned engine minted ${artifact} outside the injected suite temp ` +
        `home ${home} — engineEnv must inject TMPDIR so parallel suites ` +
        `cannot pollute or scan the shared OS temp dir`,
    );
  });
});

// ── the structural guard ─────────────────────────────────────────────────────────

const SRC_DIR = join(dirname(fromFileUrl(import.meta.url)), "..", "src");
const REGISTRY_REL = join("src", "shared", "temp_artifacts.ts");
const WRITE_PREFLIGHT_REL = join("src", "shared", "write_preflight.ts");

Deno.test("temp artifacts: src/ mints temp files only through the registry (the reaper's coverage is total)", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(SRC_DIR, { exts: [".ts"] })) {
    const rel = join("src", relative(SRC_DIR, entry.path));
    if (rel === REGISTRY_REL) {
      continue; // the one place allowed to call the primitive
    }
    const text = await Deno.readTextFile(entry.path);
    if (rel === WRITE_PREFLIGHT_REL) {
      const primitives = text.match(/Deno\.makeTemp(File|Dir)(Sync)?\(/g) ?? [];
      assertEquals(
        primitives.length,
        1,
        "the write-authority module may mint exactly one immediate probe",
      );
      assertStringIncludes(
        text,
        "dir: target.path",
        "the write-authority probe must be target-adjacent, never an OS-temp artifact",
      );
      continue;
    }
    if (/Deno\.makeTemp(File|Dir)(Sync)?\(/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "an OS-temp file/dir minted outside src/shared/temp_artifacts.ts never " +
      "gets reaped — add an artifact kind to TEMP_ARTIFACT_KINDS and create " +
      "it via makeTempArtifact instead",
  );
});

Deno.test("temp artifacts: the registry's families cover the artifact names the envelope exposes", () => {
  // The two families the result envelope points at today. A rename here must be
  // deliberate: stale files under the OLD prefix would fall out of retention.
  assertStringIncludes(TEMP_ARTIFACT_KINDS.job, "discern-job-");
  assertStringIncludes(TEMP_ARTIFACT_KINDS.diag, "discern-diag-");
});
