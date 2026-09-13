import { assertOutsideCommonPublication } from "../shared/operation_execution_boundary.ts";
/**
 * External pager boundary shared by interactive reading surfaces.
 *
 * Callers opt in explicitly, render their content before this boundary, and
 * retain responsibility for a failed-pager fallback. `$PAGER` remains a shell
 * command by terminal convention; the default is the exact argv `less -R`.
 */

import { bestEffort } from "../shared/best_effort.ts";
import { commandEvidence } from "../shared/command_evidence.ts";
import { spawnedByEnv } from "../shared/invocation_context.ts";

/** The outcome of handing rendered text to the configured external pager. */
export interface PagerResult {
  readonly shown: boolean;
  /** The configured command, or the default command when no pager was set. */
  readonly command?: string;
  readonly error?: unknown;
}

/**
 * Send rendered text through `$PAGER`, or `less -R` when it is unset.
 *
 * The pager inherits stdout and stderr and owns the foreground terminal until
 * it exits. A failure is returned rather than narrated so each product surface
 * can render it through its own error contract.
 */
export async function pageThrough(
  text: string,
  pager: string | undefined = Deno.env.get("PAGER")?.trim(),
): Promise<PagerResult> {
  await assertOutsideCommonPublication();
  const command = pager ? "sh" : "less";
  const args = pager ? ["-c", pager] : ["-R"];
  const displayedCommand = commandEvidence([command, ...args]);
  try {
    const child = new Deno.Command(command, {
      args,
      env: { ...spawnedByEnv("interactive") },
      stdin: "piped",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const writer = child.stdin.getWriter();
    await bestEffort("docs-pager-input-close", async () => {
      await writer.write(new TextEncoder().encode(`${text}\n`));
      await writer.close();
    });
    const status = await child.status;
    return status.success ? { shown: true, command: displayedCommand } : {
      shown: false,
      command: displayedCommand,
      error: new Error(`pager exited with status ${status.code}`),
    };
  } catch (error) {
    return { shown: false, command: displayedCommand, error };
  }
}
