/**
 * Install (or refresh) the local-development `discern` wrapper onto PATH, and
 * remove the retired `discern-next`.
 *
 * The wrapper (`scripts/discern`) runs the engine from whichever checkout you are
 * inside — a worktree runs its own in-progress engine — falling back to
 * $DISCERN_HOME elsewhere. This script copies it next to the `discern` already on
 * PATH (or `~/.local/bin`), so the installed copy survives worktree churn, and
 * prints the $DISCERN_HOME to export for the out-of-checkout fallback.
 *
 * It is a MAINTAINER helper, not a shipped feature: it lives in `scripts/`
 * (outside `templates/`), is never bundled into the binary, and is deliberately
 * kept OUT of discern's own `setup`/`upgrade` verbs — those are user-facing.
 *
 * Usage:
 *   deno task install-dev-cli
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** Run a command and capture its trimmed stdout/stderr plus exit code. */
async function capture(
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
async function which(name: string): Promise<string | null> {
  const found = await capture("/bin/sh", ["-c", `command -v ${name}`]);
  return found.code === 0 && found.stdout.length > 0 ? found.stdout : null;
}

async function main(): Promise<number> {
  const wrapperSrc = fromFileUrl(new URL("./discern", import.meta.url));
  const repoRoot = fromFileUrl(new URL("..", import.meta.url));

  // The durable fallback checkout: the *main* working tree, found via the shared
  // git dir so it resolves to main even when this runs from a linked worktree.
  const common = await capture(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    repoRoot,
  );
  const discernHome = common.code === 0 && common.stdout.length > 0
    ? dirname(common.stdout)
    : repoRoot;

  // Install beside the `discern` already on PATH (replace it in place); otherwise
  // fall back to ~/.local/bin.
  const existing = await which("discern");
  const home = Deno.env.get("HOME") ?? "";
  const targetDir = existing !== null
    ? dirname(existing)
    : join(home, ".local", "bin");

  const dest = join(targetDir, "discern");
  try {
    await Deno.mkdir(targetDir, { recursive: true });
    await Deno.copyFile(wrapperSrc, dest);
    await Deno.chmod(dest, 0o755);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`install-dev-cli: could not write ${dest}: ${reason}`);
    return 1;
  }
  console.error(`installed: ${dest}`);

  // Retire discern-next — the unified wrapper supersedes it.
  const next = await which("discern-next");
  if (next !== null) {
    try {
      await Deno.remove(next);
      console.error(`removed:   ${next} (superseded by the unified discern)`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`install-dev-cli: could not remove ${next}: ${reason}`);
    }
  }

  console.error("");
  console.error(
    "For the out-of-checkout fallback (running discern against other projects),",
  );
  console.error("export this in your shell profile:");
  console.error(`    export DISCERN_HOME=${discernHome}`);

  const pathDirs = (Deno.env.get("PATH") ?? "").split(":");
  if (!pathDirs.includes(targetDir)) {
    console.error("");
    console.error(
      `Note: ${targetDir} is not on your PATH — add it to use \`discern\`.`,
    );
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
