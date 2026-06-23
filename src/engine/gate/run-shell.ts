/**
 * Run a joined stage command string (from `cmds_in_stage`) the way the
 * prepare/test convenience verbs run it. By default stdio is inherited (the
 * command's output reaches the terminal directly). In `quiet` mode — used under
 * `--json`, where the result envelope is the ENTIRE program output (ADR 0030) —
 * the command's stdout and stderr are discarded, so combined output stays exactly
 * the one JSON line. (Surfacing a quiet failure's output as a diagnostic is the
 * deferred prepare/test enrichment — see TODO.md.)
 */
export async function runShellInherit(
  command: string,
  opts: { quiet?: boolean } = {},
): Promise<boolean> {
  const discard = opts.quiet ?? false;
  const child = await new Deno.Command("sh", {
    args: ["-c", command],
    stdin: "null",
    stdout: discard ? "null" : "inherit",
    stderr: discard ? "null" : "inherit",
  }).output();
  return child.success;
}
