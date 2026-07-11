/**
 * The OS-temp artifact registry (ADR 0117). The gate persists every job's full
 * output (ADR 0096) plus offloaded diagnostic text as OS-temp files, at
 * agent-run frequency — so without retention the temp dir grows without bound
 * (tens of thousands of orphaned logs were observed in the wild). These tests
 * pin the retention contract: every registered artifact family is reaped past
 * its TTL, nothing outside the registry is ever touched, and — the structural
 * guard — no code in `src/` can mint a temp file/dir outside the registry
 * module, so a future artifact family cannot silently opt out of the reaper.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  makeTempArtifact,
  pruneStaleTempArtifacts,
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
  TEMP_ARTIFACT_TTL_MS,
} from "../src/shared/temp_artifacts.ts";

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

    const removed = await pruneStaleTempArtifacts({ dir });

    assertEquals(removed, stale.length);
    for (const path of stale) {
      assertEquals(await exists(path), false, `${path} must be reaped`);
    }
    for (const path of fresh) {
      assertEquals(await exists(path), true, `${path} must survive`);
    }
  });
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

    const removed = await pruneStaleTempArtifacts({ dir });

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
    assertEquals(await pruneStaleTempArtifacts({ dir, maxRemovals: 2 }), 2);
    assertEquals(await pruneStaleTempArtifacts({ dir, maxRemovals: 2 }), 2);
    // …and successive sweeps finish the job.
    assertEquals(await pruneStaleTempArtifacts({ dir, maxRemovals: 2 }), 1);
    assertEquals(await pruneStaleTempArtifacts({ dir, maxRemovals: 2 }), 0);
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

// ── the structural guard ─────────────────────────────────────────────────────────

const SRC_DIR = join(dirname(fromFileUrl(import.meta.url)), "..", "src");
const REGISTRY_REL = join("src", "shared", "temp_artifacts.ts");

Deno.test("temp artifacts: src/ mints temp files only through the registry (the reaper's coverage is total)", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(SRC_DIR, { exts: [".ts"] })) {
    const rel = join("src", relative(SRC_DIR, entry.path));
    if (rel === REGISTRY_REL) {
      continue; // the one place allowed to call the primitive
    }
    const text = await Deno.readTextFile(entry.path);
    if (/Deno\.makeTemp(File|Dir)(Sync)?\(/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "a temp file/dir minted outside src/shared/temp_artifacts.ts never gets " +
      "reaped — add an artifact kind to TEMP_ARTIFACT_KINDS and create it " +
      "via makeTempArtifact instead",
  );
});

Deno.test("temp artifacts: the registry's families cover the artifact names the envelope exposes", () => {
  // The two families the result envelope points at today. A rename here must be
  // deliberate: stale files under the OLD prefix would fall out of retention.
  assertStringIncludes(TEMP_ARTIFACT_KINDS.job, "discern-job-");
  assertStringIncludes(TEMP_ARTIFACT_KINDS.diag, "discern-diag-");
});
