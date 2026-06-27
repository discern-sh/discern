/**
 * Run a project-supplied shell command (a `[worktree.setup].steps`/`ensure` entry,
 * a resource `create`/`destroy`/`ensure`) with the engine's automated-command output
 * convention: CAPTURE its output and surface it ONLY on failure. This is the single
 * source of that routing, shared by the setup/ensure runner (./lifecycle.ts) and the
 * resource runner (./resources.ts) so the two can never drift.
 *
 * It mirrors the gate's job convention (engine/jobs/command.ts): a SUCCESSFUL command
 * is silent — its output reaches neither the parent's stdout (which a caller may
 * reserve for a machine result, e.g. the `worktree:create` hook's worktree path) nor
 * the `SessionStart` hook's stdout (which Claude Code injects as agent context, so a
 * chatty `vale sync`/`npm ci` would otherwise leak its progress bar into every
 * session). A FAILED command surfaces its captured output to STDERR — the diagnostic
 * channel — so the caller's failure narration carries the command's own output beside
 * it. In `--json` mode all output is discarded (the result envelope is the whole
 * program output; ADR 0030).
 */

import { byteWriter } from "../output.ts";
import type { Logger } from "../../lib/log.ts";
import { SPAWN_FAILED } from "../../shared/subprocess.ts";

const ENCODER = new TextEncoder();
const NEWLINE = 0x0a;

/** Concatenate captured output chunks into one buffer. */
function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Run `command` via `sh -c` in `cwd`, capturing its combined output and surfacing it
 * only when the command FAILS:
 *   - exit 0    → silent (the captured output is discarded — nothing reaches stdout or
 *                 stderr, so a healthy command never pollutes a reserved stdout or the
 *                 agent-context channel);
 *   - exit N≠0  → the captured output is written to STDERR (the diagnostic channel),
 *                 so the failure is debuggable next to the caller's own narration;
 *   - `--json`  → all output discarded, success or failure (ADR 0030).
 * `env` adds variables for the child. An empty/whitespace command is a `0` no-op. A
 * spawn failure resolves to `127` rather than throwing, so one bad command never
 * aborts a whole setup/teardown/prune. Both child streams are drained even on success,
 * so a command that fills a pipe never blocks.
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
  try {
    const child = new Deno.Command("sh", {
      args: ["-c", command],
      cwd,
      ...(env !== undefined ? { env } : {}),
      stdin: "null",
      stdout: quiet ? "null" : "piped",
      stderr: quiet ? "null" : "piped",
    }).spawn();
    if (quiet) {
      return (await child.status).code;
    }
    // Capture stdout+stderr concurrently (draining both so a full pipe never blocks),
    // holding the bytes only long enough to surface them if the command fails.
    const chunks: Uint8Array[] = [];
    const drain = async (s: ReadableStream<Uint8Array>): Promise<void> => {
      for await (const chunk of s) {
        chunks.push(chunk);
      }
    };
    await Promise.all([drain(child.stdout), drain(child.stderr)]);
    const code = (await child.status).code;
    if (code !== 0) {
      // Loud on failure: the captured output → STDERR, never the parent's stdout. A
      // trailing newline is added when the command omitted one, so the caller's next
      // narration line starts clean.
      const out = concat(chunks);
      if (out.length > 0) {
        const write = byteWriter("stderr");
        write(out);
        if (out[out.length - 1] !== NEWLINE) {
          write(ENCODER.encode("\n"));
        }
      }
    }
    return code;
  } catch {
    return SPAWN_FAILED; // could not spawn — treat as a failed (retryable) command
  }
}
