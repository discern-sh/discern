/** Shared captured process boundary for release verification and coordination. */
import { colorResolvedEnv } from "../src/shared/color_env.ts";

const DECODER = new TextDecoder();

interface CommandOutput {
  stderr: string;
  stdout: string;
}

/** Run a release tool with argument boundaries intact and captured failure evidence. */
export async function runReleaseCommand(
  command: string,
  args: string[],
  cwd: string = Deno.cwd(),
  env: Record<string, string> = {},
): Promise<CommandOutput> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    env: { ...colorResolvedEnv(), ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = DECODER.decode(result.stdout);
  const stderr = DECODER.decode(result.stderr);
  if (!result.success) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.code}\n` +
        `${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}
