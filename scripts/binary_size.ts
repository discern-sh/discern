/** Build the configured representative target locally and report its byte size. */
import { fromFileUrl, join } from "@std/path";
import { BUILD_TARGETS } from "./build_targets.ts";

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
 * Measure only after a successful local build. The target registry owns output
 * names; missing, non-regular or failed output never supplies a size reading.
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
  await build(target, root);
  const outPath = join(root, "dist", selected.output);
  const stat = await Deno.lstat(outPath);
  if (!stat.isFile || stat.isSymlink) {
    throw new Error(`${outPath} is not a regular file`);
  }
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
