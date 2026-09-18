/**
 * The committed install corpus (ADR 0014): one captured fresh installation per
 * past install schema under `tests/fixtures/installs/schema-<N>/`. The capture
 * script and the convergence test share the fresh-install recipe, the
 * Git-carried file boundary, and the manifest contract, so a fixture and the
 * fresh installation it is compared against come from one authority.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { gitInit, gitOut, runAgent, type RunResult } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Repository-relative root of the corpus. */
export const INSTALL_CORPUS_REL = "tests/fixtures/installs";

/** The captured installation's directory inside one fixture. */
export const FIXTURE_PROJECT_DIR = "project";

/** The manifest beside each captured installation. */
export const FIXTURE_MANIFEST = "fixture.json";

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
  files: z.record(z.string(), z.string()),
});

export type InstallFixtureManifest = z.infer<
  typeof InstallFixtureManifestSchema
>;

/** One committed fixture with its resolved paths. */
export interface InstallFixture {
  /** Repository-relative fixture directory, such as `tests/fixtures/installs/schema-1`. */
  readonly rel: string;
  /** Absolute path of the captured installation tree. */
  readonly projectDir: string;
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
 * installation's discern-owned ignore block excludes them.
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
        "A fixture enrolls through the manifest beside its captured installation.",
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
    fixtures.push({
      rel: dir,
      projectDir: join(REPO_ROOT, dir, FIXTURE_PROJECT_DIR),
      manifest,
    });
  }
  return fixtures.sort((a, b) => a.manifest.schema - b.manifest.schema);
}
