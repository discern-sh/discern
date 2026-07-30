/**
 * The one process boundary for Vale. The prose standard is only comparable
 * across machines when every caller uses the tracked binary version.
 */

import { join } from "@std/path";

const decoder = new TextDecoder();

/** Extract Vale's semver from `vale --version` output. */
export function parseValeVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
}

/** Run the tracked Vale version or fail with one actionable correction. */
export async function runVale(
  repoRoot: string,
  args: string[],
): Promise<Deno.CommandOutput> {
  const expected = (
    await Deno.readTextFile(join(repoRoot, ".vale-version"))
  ).trim();

  let versionRun: Deno.CommandOutput;
  try {
    versionRun = await new Deno.Command("vale", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    throw new Error(
      `Vale ${expected} is required but was not found. Install that version and rerun the command.`,
      { cause: error },
    );
  }

  const actual = parseValeVersion(
    `${decoder.decode(versionRun.stdout)} ${decoder.decode(versionRun.stderr)}`,
  );
  if (!versionRun.success || actual !== expected) {
    throw new Error(
      `Vale ${expected} is required; found ${
        actual ?? "an unreadable version"
      }. Install ${expected} and rerun the command.`,
    );
  }

  return await new Deno.Command("vale", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
}
