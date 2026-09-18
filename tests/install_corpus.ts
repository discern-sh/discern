/**
 * The committed install corpus (ADR 0014): one captured fresh installation per
 * past install schema under `tests/fixtures/installs/schema-<N>/`, archived so
 * repository searches find live sources rather than the copy. The capture
 * script and the convergence test share the fresh-install recipe, the
 * Git-carried file boundary, the archive form, and the manifest contract, so a
 * fixture and the fresh installation it is compared against come from one
 * authority.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { sha256Hex } from "../src/shared/sha256.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { gitInit, gitOut, runAgent, type RunResult } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Repository-relative root of the corpus. */
export const INSTALL_CORPUS_REL = "tests/fixtures/installs";

/** The plaintext manifest beside each captured installation. */
export const FIXTURE_MANIFEST = "manifest.json";

/** The archived installation: gzip over a JSON object of relative path to text. */
export const FIXTURE_SNAPSHOT = "snapshot.json.gz";

/**
 * The project directory name every capture and comparison installs into.
 * Provider files derive relative paths from it (the Codex writable worktrees
 * root), so a fresh installation converges only when it shares the name.
 */
export const FIXTURE_PROJECT_BASENAME = "demo";

/** The project content that exists before setup begins. */
export const FIXTURE_SEED_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Demo\n",
};

const FIXTURE_MANIFEST_PATH = new RegExp(
  `^${INSTALL_CORPUS_REL}/schema-\\d+/${FIXTURE_MANIFEST.replace(".", "\\.")}$`,
  "u",
);

/** The one manifest contract every fixture directory satisfies. */
const InstallFixtureManifestSchema = z.object({
  schema: z.number().int().min(1),
  discern_version: z.string(),
  source: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    trees: z.object({ src: z.string(), templates: z.string() }),
  }),
  reproduce: z.string(),
  setup_args: z.array(z.string()),
  project_directory: z.string(),
  seed: z.record(z.string(), z.string()),
  snapshot_sha256: z.string(),
  files: z.record(z.string(), z.string()),
});

/** The archive's decoded form: every captured file's text by relative path. */
const SnapshotSchema = z.record(z.string(), z.string());

export type InstallFixtureManifest = z.infer<
  typeof InstallFixtureManifestSchema
>;

/** One committed fixture with its resolved location. */
export interface InstallFixture {
  /** Repository-relative fixture directory, such as `tests/fixtures/installs/schema-1`. */
  readonly rel: string;
  /** Absolute fixture directory holding the manifest and archive. */
  readonly dir: string;
  readonly manifest: InstallFixtureManifest;
}

/** The production setup invocation that authors a fixture for `agents`. */
export function fixtureSetupArgs(agents: readonly string[]): string[] {
  return [
    "setup",
    "begin",
    "--confirmed",
    "--name",
    "Demo",
    "--slug",
    "demo",
    "--agents",
    agents.join(","),
    "--json",
  ];
}

/** Author one fresh installation at `root` through the production setup path. */
export async function freshInstall(
  root: string,
  seed: Readonly<Record<string, string>>,
  setupArgs: readonly string[],
): Promise<RunResult> {
  await Deno.mkdir(root, { recursive: true });
  for (const [rel, text] of Object.entries(seed)) {
    await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
    await Deno.writeTextFile(join(root, rel), text);
  }
  await gitInit(root);
  return await runAgent(root, [...setupArgs]);
}

/**
 * The files Git carries for the installation at `root`: tracked files plus
 * untracked files its own ignore rules admit. Materialized skills and
 * machine-local provider state stay outside this boundary because the
 * installation's discern-owned ignore block excludes them; every clone lacks
 * them and `upgrade` regenerates them.
 */
export async function gitCarriedFiles(root: string): Promise<string[]> {
  const listed = await gitOut(
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  );
  return listed.split("\0").filter((rel) => rel !== "").sort();
}

/** Lowercase hex SHA-256 of raw bytes, the archive's identity in a manifest. */
export async function sha256HexBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compress a captured installation into the archive form the corpus stores. */
export async function packSnapshot(
  files: Readonly<Record<string, string>>,
): Promise<Uint8Array<ArrayBuffer>> {
  const json = new TextEncoder().encode(JSON.stringify(files));
  const compressed = new Blob([json]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/**
 * Unpack a fixture's archive after verifying the archive and every member
 * against the manifest, so a captured installation cannot drift silently.
 */
export async function readSnapshot(
  fixture: InstallFixture,
): Promise<Record<string, string>> {
  const packed = await Deno.readFile(join(fixture.dir, FIXTURE_SNAPSHOT));
  if (await sha256HexBytes(packed) !== fixture.manifest.snapshot_sha256) {
    throw new Error(
      `${fixture.rel}/${FIXTURE_SNAPSHOT} changed: its hash no longer matches the manifest`,
    );
  }
  const unpacked = new Blob([packed]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  const snapshot = decodeWith(
    SnapshotSchema,
    await new Response(unpacked).text(),
  );
  const expected = Object.keys(fixture.manifest.files).sort().join("\n");
  const actual = Object.keys(snapshot).sort().join("\n");
  if (actual !== expected) {
    throw new Error(
      `${fixture.rel}/${FIXTURE_SNAPSHOT} holds a different file set than its manifest`,
    );
  }
  for (const [rel, text] of Object.entries(snapshot)) {
    if (await sha256Hex(text) !== fixture.manifest.files[rel]) {
      throw new Error(`${fixture.rel}: frozen input changed: ${rel}`);
    }
  }
  return snapshot;
}

/** One file's convergence-relevant state. */
export interface TreeEntry {
  readonly executable: boolean;
  readonly text: string;
}

/**
 * Snapshot every file beneath `root` except Git's own directory, keyed by
 * relative path. Ignored files are included so regenerated machine-local
 * artifacts converge too.
 */
export async function snapshotTree(
  root: string,
): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>();
  /** Visit one directory, recording files and descending into subdirectories. */
  async function visit(rel: string): Promise<void> {
    for await (const entry of Deno.readDir(join(root, rel))) {
      if (entry.name === ".git") continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const path = join(root, childRel);
      if (entry.isSymlink) {
        entries.set(childRel, {
          executable: false,
          text: `symlink:${await Deno.readLink(path)}`,
        });
        continue;
      }
      if (entry.isDirectory) {
        await visit(childRel);
        continue;
      }
      const stat = await Deno.stat(path);
      entries.set(childRel, {
        executable: ((stat.mode ?? 0) & 0o111) !== 0,
        text: await Deno.readTextFile(path),
      });
    }
  }
  await visit("");
  return entries;
}

/** Every committed fixture in ascending schema order, each validated against its manifest. */
export async function installFixtures(): Promise<InstallFixture[]> {
  const manifests = await structuralGuardScope({
    guard: "tests/install_corpus.ts#committed-install-fixtures",
    universe: {
      kind: "specialized",
      name: "install corpus manifests",
      extensions: [".json"],
      reason:
        "Fixture manifests are inert data outside the canonical authored universes.",
    },
    narrow: {
      reason:
        "A fixture enrolls through the manifest beside its archived installation.",
      include: (rel) => FIXTURE_MANIFEST_PATH.test(rel),
    },
  });
  const fixtures: InstallFixture[] = [];
  for (const rel of manifests) {
    const dir = dirname(rel);
    const manifest = decodeWith(
      InstallFixtureManifestSchema,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    );
    const named = Number(dir.match(/schema-(\d+)$/u)?.[1]);
    if (named !== manifest.schema) {
      throw new Error(
        `${rel} records schema ${manifest.schema} inside directory ${dir}`,
      );
    }
    fixtures.push({ rel: dir, dir: join(REPO_ROOT, dir), manifest });
  }
  return fixtures.sort((a, b) => a.manifest.schema - b.manifest.schema);
}
