/** Build the configured representative target locally, refuse build-host paths in it, and report its byte size. */
import { fromFileUrl } from "@std/path";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { resolveContainedProjectWritePath } from "../src/shared/project_path.ts";
import { BUILD_TARGETS } from "./build_targets.ts";
import { assertNoReleasePathLeaks, releasePathLeaks } from "./release_smoke.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const DEFAULT_TARGET = "x86_64-unknown-linux-gnu";

/** Invoke the canonical build task with the candidate checkout as its root. */
async function buildTarget(target: string, root: string): Promise<void> {
  const build = await new Deno.Command(Deno.execPath(), {
    args: ["task", "build", target],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!build.success) {
    throw new Error(`deno task build ${target} failed with exit ${build.code}`);
  }
}

/**
 * Measure only after a successful local build that passes the release path
 * guard, so every gate lane refuses a binary the release smoke would refuse.
 * The target registry owns output names. Remove its previous regular output
 * before building so success without new output, non-regular output, and
 * failed builds supply no size reading.
 */
export async function measureBinarySize(
  target: string = DEFAULT_TARGET,
  root: string = REPO_ROOT,
  build: (target: string, root: string) => Promise<void> = buildTarget,
): Promise<number> {
  const selected = BUILD_TARGETS.find((entry) => entry.triple === target);
  if (selected === undefined) {
    throw new Error(`unknown build target '${target}'`);
  }
  const outPath = await resolveContainedProjectWritePath(
    root,
    `dist/${selected.output}`,
    "binary size output",
  );
  const previous = await lstatIfExists(outPath);
  if (previous !== undefined) {
    if (!previous.isFile) throw new Error(`${outPath} is not a regular file`);
    await Deno.remove(outPath);
  }
  await build(target, root);
  const stat = await Deno.lstat(outPath);
  if (!stat.isFile || stat.isSymlink) {
    throw new Error(`${outPath} is not a regular file`);
  }
  await assertNoReleasePathLeaks(outPath, releasePathLeaks());
  console.error(`${outPath}: ${stat.size} bytes`);
  return stat.size;
}

if (import.meta.main) {
  if (Deno.args.length > 1) {
    throw new Error("Usage: binary_size.ts [target]");
  }
  console.log(
    `DISCERN_METRIC binary_size_bytes ${await measureBinarySize(Deno.args[0])}`,
  );
}
