/**
 * Shared placement + swap logic for the maintainer CLI installers
 * (`install_dev_cli.ts` and `use_compiled_build.ts`).
 *
 * Both must agree on exactly WHERE `discern` lives on PATH and HOW it is
 * replaced — so the compiled lease's restore-on-exit puts the dev shim back in
 * precisely the spot the dev installer would. One definition here, no drift.
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** Run a command and capture its trimmed stdout/stderr plus exit code. */
export async function capture(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const opts: Deno.CommandOptions = { args, stdout: "piped", stderr: "piped" };
  if (cwd !== undefined) opts.cwd = cwd;
  const { code, stdout, stderr } = await new Deno.Command(cmd, opts).output();
  const dec = new TextDecoder();
  return {
    code,
    stdout: dec.decode(stdout).trim(),
    stderr: dec.decode(stderr).trim(),
  };
}

/** Resolve the first `name` on PATH, or null if absent. */
export async function which(name: string): Promise<string | null> {
  const found = await capture("/bin/sh", ["-c", `command -v ${name}`]);
  return found.code === 0 && found.stdout.length > 0 ? found.stdout : null;
}

/** Where `discern` is (or will be) installed on PATH. */
export interface CliDest {
  /** Absolute path to the `discern` file to write. */
  dest: string;
  /** The directory holding it. */
  targetDir: string;
  /** Whether that directory is actually on the current PATH. */
  onPath: boolean;
}

/**
 * Resolve where to install `discern`: in place beside the one already on PATH,
 * else `~/.local/bin`. Shared so every installer targets the same file.
 */
export async function resolveCliDest(): Promise<CliDest> {
  const existing = await which("discern");
  const home = Deno.env.get("HOME") ?? "";
  const targetDir = existing !== null
    ? dirname(existing)
    : join(home, ".local", "bin");
  const dest = join(targetDir, "discern");
  const onPath = (Deno.env.get("PATH") ?? "").split(":").includes(targetDir);
  return { dest, targetDir, onPath };
}

/** Absolute path to the from-source dev shim (`scripts/discern`). */
export function shimSource(): string {
  return fromFileUrl(new URL("./discern", import.meta.url));
}

/**
 * The main working tree to bake into the installed shim as its durable
 * out-of-checkout fallback: the shared git dir's parent, so it resolves to the
 * MAIN checkout even when this runs from a linked worktree. Falls back to
 * `repoRoot` when git can't answer (e.g. not a git checkout).
 */
export async function resolveBakedCheckout(repoRoot: string): Promise<string> {
  const common = await capture(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    repoRoot,
  );
  return common.code === 0 && common.stdout.length > 0
    ? dirname(common.stdout)
    : repoRoot;
}

/** The literal placeholder assignment the source shim carries for stamping. */
const BAKED_PLACEHOLDER = `discern_baked_checkout=""`;

/**
 * Bake `checkoutPath` into a copy of the source dev shim as its durable
 * out-of-checkout fallback, returning the rendered script text. Single-quoted so
 * nothing in the path is expanded; any embedded single quote is escaped. Throws
 * if the shim has lost its stamping placeholder — a renamed placeholder must
 * fail loud here, never silently ship an un-bakeable shim.
 */
export function renderShim(checkoutPath: string): string {
  const source = Deno.readTextFileSync(shimSource());
  if (!source.includes(BAKED_PLACEHOLDER)) {
    throw new Error(
      `dev shim has no ${BAKED_PLACEHOLDER} line to stamp — cannot bake the checkout path`,
    );
  }
  const escaped = checkoutPath.replaceAll("'", "'\\''");
  return source.replace(
    BAKED_PLACEHOLDER,
    `discern_baked_checkout='${escaped}'`,
  );
}

/**
 * Replace `dest` with `src`, made executable, ATOMICALLY: stage a sibling temp
 * file then rename it into place, so an interrupted copy can never leave a
 * half-written `discern` on PATH. Async form, for the normal install path.
 */
export async function installExecutable(
  src: string,
  dest: string,
): Promise<void> {
  await Deno.mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${Deno.pid}`;
  await Deno.copyFile(src, tmp);
  await Deno.chmod(tmp, 0o755);
  await Deno.rename(tmp, dest);
}

/**
 * Atomically write `contents` to `dest` as an executable, using the same
 * stage-then-rename dance as {@link installExecutable}. This is how the dev shim
 * is placed: it is written from rendered text (with the checkout baked in), not
 * copied from a file.
 */
export async function writeExecutable(
  contents: string,
  dest: string,
): Promise<void> {
  await Deno.mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${Deno.pid}`;
  await Deno.writeTextFile(tmp, contents);
  await Deno.chmod(tmp, 0o755);
  await Deno.rename(tmp, dest);
}

/**
 * Synchronous twin of {@link writeExecutable}, for the compiled lease's
 * signal-handler restore. Doing the swap-back synchronously keeps it atomic with
 * respect to a second Ctrl+C, so the re-stamped dev shim is guaranteed back
 * before exit.
 */
export function writeExecutableSync(contents: string, dest: string): void {
  Deno.mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${Deno.pid}`;
  Deno.writeTextFileSync(tmp, contents);
  Deno.chmodSync(tmp, 0o755);
  Deno.renameSync(tmp, dest);
}
