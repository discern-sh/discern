/**
 * Run a project-supplied shell command (a `[worktree.setup].steps` entry, a
 * resource `create`/`destroy`) with its output routed exactly where the logger
 * routes human narration. This is the single source of that routing, shared by the
 * setup-step runner (./lifecycle.ts) and the resource runner (./resources.ts) so
 * the two can never drift.
 *
 * The load-bearing case: the `worktree:create` hook returns the new worktree's
 * path on its OWN stdout, so its stdout must carry ONLY that path. Its logger is
 * configured with `humanStream: "stderr"`; a chatty setup step (e.g. `vale sync`,
 * which prints download progress) must therefore not inherit the hook's stdout, or
 * its newlines land in front of the path and Claude Code rejects it with "path
 * contains control characters". So when human narration goes to stderr, the
 * command's stdout is drained onto stderr too.
 */

import { byteWriter } from "../output.ts";
import type { Logger } from "../../lib/log.ts";
import { SPAWN_FAILED } from "../../shared/subprocess.ts";

/**
 * Run `command` via `sh -c` in `cwd`, routing its stdio the same way `log` routes
 * human narration:
 *   - JSON mode (`log.json`)   → discard all stdio (the `--json` result envelope is
 *                                the whole program output; ADR 0030);
 *   - human output on stdout   → inherit stdout+stderr (the user watches it live);
 *   - human output on stderr   → send the command's stdout to STDERR as well, so a
 *                                caller that reserves its stdout for a machine
 *                                result (the worktree:create hook's path) stays
 *                                clean.
 * `env` adds variables for the child. An empty/whitespace command is a `0` no-op. A
 * spawn failure resolves to `127` rather than throwing, so one bad command never
 * aborts a whole setup/teardown/prune.
 */
export async function runShellRouted(
  command: string,
  opts: { cwd: string; log: Logger; env?: Record<string, string> },
): Promise<number> {
  if (command.trim() === "") {
    return 0;
  }
  const { cwd, log, env } = opts;
  const quiet = log.json;
  // Reserve the parent's stdout (a structured channel) when narration is on stderr.
  const stdoutToStderr = !quiet && log.humanStream === "stderr";
  try {
    const child = new Deno.Command("sh", {
      args: ["-c", command],
      cwd,
      ...(env !== undefined ? { env } : {}),
      stdin: quiet ? "null" : "inherit",
      stdout: quiet ? "null" : stdoutToStderr ? "piped" : "inherit",
      stderr: quiet ? "null" : "inherit",
    }).spawn();
    // Drain the piped stdout onto stderr — concurrently with the process, so a
    // command that fills its stdout pipe never blocks. Reuses the engine's single
    // raw-byte writer rather than re-implementing the stream pump.
    if (stdoutToStderr) {
      const toStderr = byteWriter("stderr");
      for await (const chunk of child.stdout) {
        toStderr(chunk);
      }
    }
    return (await child.status).code;
  } catch {
    return SPAWN_FAILED; // could not spawn — treat as a failed (retryable) command
  }
}
