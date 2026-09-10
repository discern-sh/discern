import { superviseSpawn } from "../engine/owned_child.ts";

/** Read Deno metadata and settle its owned child on cancellation. */
export async function denoMetadata(
  repoRoot: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const isolatedGroup = Deno.build.os !== "windows";
  const { value: output } = await superviseSpawn(
    () =>
      new Deno.Command("deno", {
        args: [...args],
        cwd: repoRoot,
        stdout: "piped",
        stderr: "piped",
        detached: isolatedGroup,
      }).spawn(),
    (child) => child.output(),
    { isolatedGroup, ...(signal === undefined ? {} : { signal }) },
  );
  if (!output.success) {
    throw new Error(
      `Deno metadata failed: ${
        new TextDecoder().decode(output.stderr).trim()
      }\nCommand: deno ${
        args.map((arg) =>
          arg.startsWith("data:") ? "<aggregate module graph>" : arg
        ).join(" ")
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}
