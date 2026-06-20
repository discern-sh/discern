/**
 * Run a joined stage command string (from `cmds_in_stage`) with inherited stdio,
 * the way the shell tidy/test recipes `eval` it. Used by the convenience recipes.
 */
export async function runShellInherit(command: string): Promise<boolean> {
  const child = await new Deno.Command("sh", {
    args: ["-c", command],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return child.success;
}
