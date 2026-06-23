/**
 * Run a joined stage command string (from `cmds_in_stage`) the way the
 * prepare/test convenience verbs run it. By default stdio is inherited (the
 * command's output reaches the terminal directly). In `toStderr` mode — used under
 * `--json`, where stdout must carry only the result envelope — the command's stdout
 * is routed to the parent's stderr instead, keeping stdout clean.
 */
export async function runShellInherit(
  command: string,
  opts: { toStderr?: boolean } = {},
): Promise<boolean> {
  if (!(opts.toStderr ?? false)) {
    const child = await new Deno.Command("sh", {
      args: ["-c", command],
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    return child.success;
  }

  // --json: child stdout → parent stderr (stderr stays inherited, already fd 2), so
  // nothing the command prints can corrupt the single JSON object on stdout.
  const child = new Deno.Command("sh", {
    args: ["-c", command],
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  for await (const chunk of child.stdout) {
    let n = 0;
    while (n < chunk.length) {
      n += Deno.stderr.writeSync(chunk.subarray(n));
    }
  }
  return (await child.status).success;
}
