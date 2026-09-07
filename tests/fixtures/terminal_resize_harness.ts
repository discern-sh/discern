/**
 * Run one command on this process's real pseudo-terminal while changing the
 * terminal's kernel-owned viewport. Product output remains on the PTY; size
 * evidence is written out of band for the parent test.
 */

import { waitForPendingCondition } from "../waiting.ts";

interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalResizeEvidence {
  readonly childCode: number;
  readonly initialSize: TerminalDimensions;
  readonly resizedSize?: TerminalDimensions;
  readonly finalSize: TerminalDimensions;
}

interface HarnessOptions {
  readonly resultPath: string;
  readonly initialSize: TerminalDimensions;
  readonly resize?: TerminalDimensions & {
    readonly whenPath: string;
    readonly releasePath: string;
  };
  readonly command: string;
  readonly commandArgs: readonly string[];
}

function argument(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

function dimensions(value: string | undefined): TerminalDimensions | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (match === null) throw new TypeError(`invalid terminal size ${value}`);
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

function parseOptions(args: readonly string[]): HarnessOptions {
  const separator = args.indexOf("--");
  const resultPath = argument(args, "--result");
  const initialSize = dimensions(argument(args, "--size"));
  const resizeSize = dimensions(argument(args, "--resize"));
  const resizeWhenPath = argument(args, "--resize-when");
  const releasePath = argument(args, "--release-after-resize");
  const command = separator < 0 ? undefined : args[separator + 1];
  if (
    resultPath === undefined || initialSize === undefined ||
    command === undefined
  ) {
    throw new TypeError(
      "--result, --size, and a command after -- are required",
    );
  }
  if (
    resizeSize !== undefined &&
    (resizeWhenPath === undefined || releasePath === undefined)
  ) {
    throw new TypeError(
      "a resize requires --resize-when and --release-after-resize",
    );
  }
  return {
    resultPath,
    initialSize,
    ...(resizeSize === undefined || resizeWhenPath === undefined ||
        releasePath === undefined
      ? {}
      : {
        resize: {
          ...resizeSize,
          whenPath: resizeWhenPath,
          releasePath,
        },
      }),
    command,
    commandArgs: args.slice(separator + 2),
  };
}

async function stty(args: readonly string[]): Promise<void> {
  const output = await new Deno.Command("stty", {
    args: [...args],
    stdin: "inherit",
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).trim());
  }
}

async function setSize(size: TerminalDimensions): Promise<void> {
  await stty(["cols", String(size.columns), "rows", String(size.rows)]);
}

function consoleSize(): TerminalDimensions {
  const size = Deno.consoleSize();
  return { columns: size.columns, rows: size.rows };
}

/** Await the parent acknowledgement that the initial live frame was observed. */
async function waitForPath(
  path: string,
  pending: Promise<Deno.CommandStatus>,
): Promise<void> {
  await waitForPendingCondition(
    pending,
    async () => {
      try {
        await Deno.stat(path);
        return true;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        return false;
      }
    },
    `resize readiness path ${path}`,
  );
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  await setSize(options.initialSize);
  const initialSize = consoleSize();
  let resizedSize: TerminalDimensions | undefined;
  const child = new Deno.Command(options.command, {
    args: [...options.commandArgs],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const pendingStatus = child.status;
  const requestedResize = options.resize;
  const resize = requestedResize === undefined
    ? undefined
    : (async (): Promise<void> => {
      await waitForPath(requestedResize.whenPath, pendingStatus);
      await setSize(requestedResize);
      resizedSize = consoleSize();
      using release = await Deno.open(requestedResize.releasePath, {
        write: true,
      });
      if (await release.write(Uint8Array.of(10)) !== 1) {
        throw new Error("resize acknowledgement was not written");
      }
    })();
  let status: Deno.CommandStatus;
  try {
    [status] = await Promise.all([pendingStatus, resize]);
  } catch (error) {
    try {
      child.kill("SIGTERM");
    } catch { /* The child may already have settled. */ }
    await pendingStatus;
    throw error;
  }
  const evidence: TerminalResizeEvidence = {
    childCode: status.code,
    initialSize,
    ...(resizedSize === undefined ? {} : { resizedSize }),
    finalSize: consoleSize(),
  };
  await Deno.writeTextFile(
    options.resultPath,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  Deno.exitCode = status.code;
}

if (import.meta.main) {
  await main(Deno.args);
}
