/** The site build's use of the Deno toolchain, as byte transforms. */

/**
 * Run one Deno subcommand as a byte transform: `input` goes to its standard
 * input and its standard output comes back.
 */
async function denoTransform(
  args: readonly string[],
  input: string,
  purpose: string,
): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: [...args],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();

  const result = await child.output();
  if (!result.success) {
    throw new Error(
      `${purpose} failed: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

/** Format generated text with the same Deno formatter used by the gate. */
export function formatGeneratedText(
  source: string,
  extension: "html",
): Promise<string> {
  return denoTransform(
    ["fmt", "--ext", extension, "-"],
    source,
    `Formatting generated ${extension}`,
  );
}

/**
 * Bundle one browser entry module and everything it imports into a single
 * script, with npm packages resolved through the repository's own import map
 * and lockfile. The script is minified unless the caller asks otherwise.
 * Minifying is also what selects each package's production build, so an
 * unminified bundle carries the development builds and the warnings that
 * only they give.
 */
export function bundleBrowserModule(
  entry: string,
  { minify = true }: { readonly minify?: boolean } = {},
): Promise<string> {
  return denoTransform(
    ["bundle", "--platform", "browser", ...(minify ? ["--minify"] : []), entry],
    "",
    `Bundling ${entry}`,
  );
}
