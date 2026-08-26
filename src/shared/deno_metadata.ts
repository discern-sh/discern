/** Read one bounded Deno metadata protocol through its exact argv surface. */
export async function denoMetadata(
  repoRoot: string,
  args: readonly string[],
): Promise<string> {
  const output = await new Deno.Command("deno", {
    args: [...args],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `\`deno ${args.join(" ")}\` failed: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}
