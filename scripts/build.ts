/**
 * Build the per-platform `discern` binaries via `deno compile`.
 *
 * Each target produces a single self-contained binary with two trees bundled:
 *  - `templates/` (`--include templates`), so the installed `discern` needs no
 *    Deno and no network to scaffold; and
 *  - discern's OWN documentation, staged into {@link BUNDLED_DOCS_STAGE_DIR}
 *    first (see {@link stageBundledDocs}) and `--include`d, so `discern docs`
 *    serves it from any install. Only published pages in the public manual
 *    subtrees are staged; internal decision and maintainer trees are never
 *    embedded in a customer binary.
 *
 * Output goes to `dist/`.
 *
 * Run: `deno task build` (optionally `deno task build -- <target>` to build one).
 */

import { copy, ensureDir } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { discoverDocs, isPublicDoc } from "../src/lib/docs.ts";
import {
  BUNDLED_DOCS_STAGE_DIR,
  isBundledDocEntry,
  resolveMapDir,
} from "../src/lib/paths.ts";
import { BUILD_TARGETS, type BuildTarget } from "./build_targets.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

/** The least-privilege permissions the compiled binary carries. */
const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/**
 * Copy the public projection of `mapDir` into `stagedDocs`. The subtree
 * allowlist is the tier-level boundary; {@link isPublicDoc} is the page-level
 * boundary. Walking the document model and copying individual leaves means a
 * `publish: false` page is absent from the binary rather than merely hidden by
 * its views, while internal decision and maintainer trees never enter the stage.
 *
 * Exported so the parity suite can drive the exact build seam against fixtures.
 */
export async function stageBundledDocs(
  mapDir: string,
  stagedDocs: string,
): Promise<string[]> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: mapDir,
    includeInternal: false,
  });
  if (tree === undefined) {
    throw new Error(`could not discover documentation under ${mapDir}`);
  }

  const staged: string[] = [];
  await ensureDir(stagedDocs);
  for (const entry of tree.entries) {
    const topLevel = entry.relToDocs.split("/")[0] ?? entry.relToDocs;
    if (!isBundledDocEntry(topLevel) || !isPublicDoc(entry)) continue;
    const destination = join(stagedDocs, entry.relToDocs);
    await ensureDir(dirname(destination));
    await copy(entry.absPath, destination);
    staged.push(entry.relToDocs);
  }
  return staged;
}

/** Prepare the repo-relative include tree consumed by `deno compile`. */
async function prepareBundledDocs(): Promise<string> {
  const stageDir = join(REPO_ROOT, BUNDLED_DOCS_STAGE_DIR);
  await Deno.remove(stageDir, { recursive: true }).catch(
    () => {},
  );
  const stagedDocs = join(stageDir, "docs");
  const mapDir = resolveMapDir(REPO_ROOT, await loadConfig(REPO_ROOT)).abs;
  await stageBundledDocs(mapDir, stagedDocs);
  // Keep the include path repo-relative, exactly as the compiled resource
  // resolver expects; the filesystem work above stays rooted explicitly.
  return BUNDLED_DOCS_STAGE_DIR;
}

/** Compile one target into `dist/`. Throws on a non-zero exit. */
async function compileTarget(
  target: BuildTarget,
  distDir: string,
  docsStageDir: string,
): Promise<void> {
  const outPath = `${distDir}/${target.output}`;
  const args = [
    "compile",
    ...PERMISSIONS,
    "--include",
    "templates",
    "--include",
    "src/lib/tidy_plugins",
    "--include",
    docsStageDir,
    "--target",
    target.triple,
    "--output",
    outPath,
    "src/main.ts",
  ];
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

  const docsStageDir = await prepareBundledDocs();
  try {
    for (const target of targets) {
      await compileTarget(target, distDir, docsStageDir);
    }
  } finally {
    // The staged docs are a transient embed input — never leave them behind to
    // dirty the tree or shadow the live map in a later `deno task dev docs`.
    await Deno.remove(docsStageDir, { recursive: true }).catch(() => {});
  }
  console.log(`✓ built ${targets.length} binary/binaries into ${distDir}/`);
}

if (import.meta.main) {
  await main();
}
