/**
 * Capture the current schema's fresh installation into the committed install
 * corpus (ADR 0014). Run it on a clean setup surface before raising
 * `SCHEMA_VERSION`, so the schema being retired keeps its exact starting bytes:
 *
 *   deno run --allow-read --allow-write --allow-env --allow-run scripts/capture_install_fixture.ts
 *
 * The capture authors a fresh installation through the production setup path
 * in a scratch repository, archives the files Git would carry as
 * `tests/fixtures/installs/schema-<N>/snapshot.json.gz`, and records beside it
 * the plaintext manifest the convergence test replays.
 */

import { join } from "@std/path";
import { DISCERN_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { gitOut } from "../tests/engine_helpers.ts";
import {
  FIXTURE_MANIFEST,
  FIXTURE_PROJECT_BASENAME,
  FIXTURE_SEED_FILES,
  FIXTURE_SNAPSHOT,
  fixtureSetupArgs,
  freshInstall,
  gitCarriedFiles,
  INSTALL_CORPUS_REL,
  type InstallFixtureManifest,
  packSnapshot,
  sha256HexBytes,
} from "../tests/install_corpus.ts";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { withToolTempDir } from "./temp_dir.ts";

/** The paths whose committed state determines what a fresh installation writes. */
const SETUP_SURFACE = ["src", "templates", "deno.json", "deno.lock"];

/** The exact command that reproduces a capture from its recorded source commit. */
export const CAPTURE_COMMAND =
  "deno run --allow-read --allow-write --allow-env --allow-run scripts/capture_install_fixture.ts";

/** Refuse a capture whose recorded source commit would not reproduce its bytes. */
async function assertCleanSetupSurface(): Promise<void> {
  const dirty = await gitOut(
    REPO_ROOT,
    "status",
    "--porcelain",
    "--",
    ...SETUP_SURFACE,
  );
  if (dirty !== "") {
    throw new Error(
      `the setup surface has uncommitted changes, so HEAD would not reproduce this capture; commit or stash them first:\n${dirty}`,
    );
  }
}

/** Read the Git-carried installation and hash every file. */
async function readInstallation(
  root: string,
): Promise<{ files: Record<string, string>; hashes: Record<string, string> }> {
  const files: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const rel of await gitCarriedFiles(root)) {
    const text = await Deno.readTextFile(join(root, rel));
    files[rel] = text;
    hashes[rel] = await sha256Hex(text);
  }
  return { files, hashes };
}

/** Author, archive, and record one fixture for the current schema. */
async function main(): Promise<void> {
  await assertCleanSetupSurface();
  const fixtureRel = `${INSTALL_CORPUS_REL}/schema-${SCHEMA_VERSION}`;
  const fixtureDir = join(REPO_ROOT, fixtureRel);
  if (await pathExists(fixtureDir)) {
    throw new Error(
      `${fixtureRel} already exists; a captured schema is frozen, so remove it deliberately before recapturing`,
    );
  }
  const setupArgs = fixtureSetupArgs(AGENT_NAMES);
  const capture = await withToolTempDir(
    "install-fixture-capture",
    async (temp) => {
      const root = join(temp, FIXTURE_PROJECT_BASENAME);
      const result = await freshInstall(root, FIXTURE_SEED_FILES, setupArgs);
      if (result.code !== 0) {
        throw new Error(
          `setup begin failed while capturing schema ${SCHEMA_VERSION}:\n${result.output}`,
        );
      }
      return await readInstallation(root);
    },
  );
  const packed = await packSnapshot(capture.files);
  const manifest: InstallFixtureManifest = {
    schema: SCHEMA_VERSION,
    discern_version: DISCERN_VERSION,
    source: {
      commit: await gitOut(REPO_ROOT, "rev-parse", "HEAD"),
      trees: {
        src: await gitOut(REPO_ROOT, "rev-parse", "HEAD:src"),
        templates: await gitOut(REPO_ROOT, "rev-parse", "HEAD:templates"),
      },
    },
    reproduce: CAPTURE_COMMAND,
    setup_args: setupArgs,
    project_directory: FIXTURE_PROJECT_BASENAME,
    seed: { ...FIXTURE_SEED_FILES },
    snapshot_sha256: await sha256HexBytes(packed),
    files: capture.hashes,
  };
  await Deno.mkdir(fixtureDir, { recursive: true });
  await Deno.writeFile(join(fixtureDir, FIXTURE_SNAPSHOT), packed);
  await Deno.writeTextFile(
    join(fixtureDir, FIXTURE_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(fixtureRel);
}

if (import.meta.main) await main();
