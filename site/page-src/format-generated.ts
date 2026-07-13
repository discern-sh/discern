/** Format generated text with the same Deno formatter used by the gate. */
export async function formatGeneratedText(
  source: string,
  extension: "html",
): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "--ext", extension, "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();

  const result = await child.output();
  if (!result.success) {
    throw new Error(
      `Formatting generated ${extension} failed: ${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}
