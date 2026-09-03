/**
 * Build the per-platform `discern` binaries via `deno compile`.
 *
 * Each target produces a single self-contained binary with two projections
 * bundled:
 *  - `templates/` and `src/lib/tidy_plugins/`, bounded by Git's authored-file
 *    projection: physical entries outside it become `deno compile --exclude`
 *    paths, so ignored machine state cannot enter the artifact and the
 *    installed `discern` needs no Deno or network to scaffold and format; and
 *  - discern's own product manual, staged into
 *    {@link BUNDLED_MANUAL_STAGE_DIR} first (see
 *    {@link stageBundledManual}) and `--include`d, so `discern docs` serves it
 *    from any install. The configured Map and protected repository trees are
 *    never embedded in a customer binary.
 *
 * npm packages are resolved without the workspace's physical `node_modules`
 * and restricted to the product module graph. Dependencies used only by tests,
 * the site, or repo-internal tools stay development inputs, not release files.
 *
 * Output goes to `dist/`.
 *
 * Run: `deno task build` (optionally `deno task build <target>` to build one).
 */

import { copy, ensureDir, walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import {
  BUNDLED_MANUAL_STAGE_DIR,
  resolveRepositoryManualDir,
} from "../src/lib/paths.ts";
import { splitNulRecords } from "../src/shared/git_paths.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { BUILD_TARGETS, type BuildTarget } from "./build_targets.ts";
import { isHostMetadataPath } from "../src/shared/host_metadata.ts";
import { withToolTempDir } from "./temp_dir.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

/** Physical source trees whose authored files become binary resources. */
const DISTRIBUTION_SOURCE_ROOTS = [
  "templates",
  "src/lib/tidy_plugins",
] as const;

/** The least-privilege permissions the compiled binary carries. */
const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/**
 * List the present, authored distribution files under `repoRoot`: tracked files
 * plus untracked files Git does not ignore. Deleted index entries are absent;
 * known host metadata stays absent even if it was force-added to the index.
 */
export async function authoredDistributionFiles(
  repoRoot: string = REPO_ROOT,
  roots: readonly string[] = DISTRIBUTION_SOURCE_ROOTS,
): Promise<string[]> {
  const listed = await runGit(
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...roots,
    ],
    { cwd: repoRoot },
  );
  if (!listed.success) {
    throw new Error(
      `could not enumerate authored distribution files under ${repoRoot}: ${
        listed.stderr.trim() || `git exited ${listed.code}`
      }`,
    );
  }

  const files: string[] = [];
  for (const rel of splitNulRecords(listed.stdout)) {
    if (isHostMetadataPath(rel)) continue;
    try {
      const info = await Deno.lstat(join(repoRoot, rel));
      if (info.isFile || info.isSymlink) files.push(rel);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      // A deleted path can remain in Git's index until the deletion is staged.
    }
  }
  files.sort();

  for (const root of roots) {
    const prefix = `${root.replace(/\/+$/, "")}/`;
    if (!files.some((rel) => rel.startsWith(prefix))) {
      throw new Error(`no authored distribution files found under ${root}`);
    }
  }
  return files;
}

/**
 * Physical distribution entries outside the authored projection. A directory
 * with no authored descendant becomes one exclusion; mixed directories retain
 * their authored leaves and exclude only the other entries.
 */
export async function distributionExclusions(
  repoRoot: string,
  roots: readonly string[],
  authoredFiles: readonly string[],
): Promise<string[]> {
  const authored = new Set(authoredFiles);
  const exclusions: string[] = [];
  const excludedDirs: string[] = [];
  for (const sourceRoot of roots) {
    const root = sourceRoot.replace(/\/+$/, "");
    for await (const entry of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, entry.path).replaceAll("\\", "/");
      if (rel === root) continue;
      if (excludedDirs.some((dir) => rel.startsWith(`${dir}/`))) continue;
      if (entry.isDirectory) {
        const prefix = `${rel}/`;
        if (!authoredFiles.some((path) => path.startsWith(prefix))) {
          exclusions.push(rel);
          excludedDirs.push(rel);
        }
      } else if (!authored.has(rel)) {
        exclusions.push(rel);
      }
    }
  }
  return exclusions.sort();
}

/**
 * Materialize the validated published manual at `stagedDocs`. The copy is
 * assembled in a fresh sibling and replaces the destination only after every
 * planned source is a regular file and its staged bytes match. Prior stage
 * contents therefore cannot survive a successful run.
 *
 * Exported so the parity suite can drive the exact build seam against fixtures.
 */
export async function stageBundledManual(
  manualDir: string,
  stagedDocs: string,
): Promise<string[]> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: manualDir,
    includeInternal: false,
  });
  if (tree === undefined) {
    throw new Error(`could not discover the product manual under ${manualDir}`);
  }
  const projection = await buildManualProjection(tree.entries);
  const staged = projection.pages.map((page) => page.entry.relToDocs);

  const parent = dirname(stagedDocs);
  await ensureDir(parent);
  return await withToolTempDir("manual-build-stage", async (fresh) => {
    for (const page of projection.pages) {
      const source = page.entry.absPath;
      const info = await Deno.lstat(source);
      if (!info.isFile || info.isSymlink) {
        throw new Error(
          `${page.entry.relToDocs}: bundled manual sources must be regular files`,
        );
      }
      const destination = join(fresh, page.entry.relToDocs);
      await ensureDir(dirname(destination));
      await copy(source, destination);
      const [sourceBytes, stagedBytes] = await Promise.all([
        Deno.readFile(source),
        Deno.readFile(destination),
      ]);
      if (
        sourceBytes.length !== stagedBytes.length ||
        sourceBytes.some((byte, index) => byte !== stagedBytes[index])
      ) {
        throw new Error(
          `${page.entry.relToDocs}: staged manual bytes differ from the source`,
        );
      }
    }
    try {
      await Deno.remove(stagedDocs, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await Deno.rename(fresh, stagedDocs);
    return staged;
  }, { parent });
}

/** Prepare the repo-relative include tree consumed by `deno compile`. */
async function prepareBundledManual(): Promise<string> {
  const stageDir = join(REPO_ROOT, BUNDLED_MANUAL_STAGE_DIR);
  try {
    await Deno.remove(stageDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const stagedDocs = join(stageDir, "docs");
  const manualDir = resolveRepositoryManualDir(REPO_ROOT).abs;
  await stageBundledManual(manualDir, stagedDocs);
  // Keep the include path repo-relative, exactly as the compiled resource
  // resolver expects; the filesystem work above stays rooted explicitly.
  return BUNDLED_MANUAL_STAGE_DIR;
}

/**
 * Construct one `deno compile` invocation. Distribution roots stay directory
 * includes so their embedded paths remain stable; exact exclusions bound them
 * to the authored projection. npm resolution deliberately bypasses the
 * workspace's physical `node_modules`: repo-internal tools may have large npm
 * dependencies that are not part of discern's product graph.
 */
export function compileArguments<T extends Pick<BuildTarget, "triple">>(
  target: T,
  outPath: string,
  docsStageDir: string,
  distributionRoots: readonly string[],
  exclusions: readonly string[],
): string[] {
  return [
    "compile",
    ...PERMISSIONS,
    "--bundle",
    "--node-modules-dir=none",
    "--exclude-unused-npm",
    ...distributionRoots.flatMap((path) => ["--include", path]),
    ...exclusions.flatMap((path) => ["--exclude", path]),
    "--include",
    docsStageDir,
    "--target",
    target.triple,
    "--output",
    outPath,
    "src/main.ts",
  ];
}

/** Compile one target into `dist/`. Throws on a non-zero exit. */
async function compileTarget(
  target: BuildTarget,
  distDir: string,
  docsStageDir: string,
  exclusions: readonly string[],
): Promise<void> {
  const outPath = `${distDir}/${target.output}`;
  const args = compileArguments(
    target,
    outPath,
    docsStageDir,
    DISTRIBUTION_SOURCE_ROOTS,
    exclusions,
  );
  console.log(`→ compiling ${target.triple} → ${outPath}`);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  if (code !== 0) {
    throw new Error(`compile failed for ${target.triple} (exit ${code})`);
  }
  await verifyDarwinSignature(target, outPath);
}

/**
 * A darwin binary must be at least ad-hoc signed or the arm64 kernel refuses to
 * run it ("Killed: 9"). `deno compile` ad-hoc signs darwin targets when it runs
 * ON macOS; verify that here so an unsigned binary fails the build loudly
 * instead of at a user's first launch. Only meaningful (and only runnable) on a
 * macOS host (where `codesign` exists); a no-op elsewhere.
 */
async function verifyDarwinSignature(
  target: BuildTarget,
  outPath: string,
): Promise<void> {
  if (!target.triple.endsWith("apple-darwin") || Deno.build.os !== "darwin") {
    return;
  }
  const verify = await new Deno.Command("codesign", {
    args: ["--verify", "--verbose=2", outPath],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (verify.code !== 0) {
    throw new Error(
      `codesign --verify failed for ${target.triple}: the binary is not signed and would be kernel-killed on arm64. ` +
        `Build the darwin targets on macOS (deno ad-hoc signs there), or sign with rcodesign.`,
    );
  }
  console.log(`  ✓ ${target.triple} is ad-hoc signed`);
}

/** Build all targets, or just the one named on the command line. */
async function main(): Promise<void> {
  const distDir = "dist";
  await ensureDir(distDir);

  const only = Deno.args[0];
  const targets = only
    ? BUILD_TARGETS.filter((target) => target.triple === only)
    : BUILD_TARGETS;
  if (only && targets.length === 0) {
    console.error(
      `unknown target "${only}". Known: ${
        BUILD_TARGETS.map((target) => target.triple).join(", ")
      }`,
    );
    Deno.exit(1);
  }

  const docsStageDir = await prepareBundledManual();
  const distributionFiles = await authoredDistributionFiles();
  const exclusions = await distributionExclusions(
    REPO_ROOT,
    DISTRIBUTION_SOURCE_ROOTS,
    distributionFiles,
  );
  let buildFailure: unknown;
  try {
    for (const target of targets) {
      await compileTarget(
        target,
        distDir,
        docsStageDir,
        exclusions,
      );
    }
  } catch (error) {
    buildFailure = error;
  }

  // The staged manual is a transient embed input. Cleanup always runs, and a
  // failure remains visible without replacing an earlier compilation failure.
  let cleanupFailure: unknown;
  try {
    await Deno.remove(docsStageDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) cleanupFailure = error;
  }
  if (buildFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [buildFailure, cleanupFailure],
      "binary compilation and bundled-manual cleanup both failed",
    );
  }
  if (buildFailure !== undefined) throw buildFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  console.log(`✓ built ${targets.length} binary/binaries into ${distDir}/`);
}

if (import.meta.main) {
  await main();
}
