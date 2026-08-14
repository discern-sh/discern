/**
 * Run one command on this process's real pseudo-terminal while changing the
 * terminal's kernel-owned viewport. Product output remains on the PTY; size
 * evidence is written out of band for the parent test.
 */

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
    readonly delayMs: number;
    readonly whenPath?: string;
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
  const command = separator < 0 ? undefined : args[separator + 1];
  if (
    resultPath === undefined || initialSize === undefined ||
    command === undefined
  ) {
    throw new TypeError("--result, --size, and a command after -- are required");
  }
  const resizeDelay = Number(argument(args, "--resize-after") ?? "100");
  if (
    resizeSize !== undefined &&
    (!Number.isFinite(resizeDelay) || resizeDelay < 0)
  ) {
    throw new TypeError("--resize-after must be a non-negative number");
  }
  return {
    resultPath,
    initialSize,
    ...(resizeSize === undefined
      ? {}
      : {
        resize: {
          ...resizeSize,
          delayMs: resizeDelay,
          ...(resizeWhenPath === undefined
            ? {}
            : { whenPath: resizeWhenPath }),
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

/** Await a job-owned readiness file so the resize occurs during real work. */
async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await Deno.stat(path);
      return;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`resize readiness path did not appear: ${path}`);
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  await setSize(options.initialSize);
  const initialSize = consoleSize();
  let resizedSize: TerminalDimensions | undefined;
  const resize = options.resize === undefined
    ? undefined
    : (async (): Promise<void> => {
      if (options.resize?.whenPath !== undefined) {
        await waitForPath(options.resize.whenPath);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, options.resize?.delayMs)
      );
      if (options.resize === undefined) return;
      await setSize(options.resize);
      resizedSize = consoleSize();
    })();
  const child = new Deno.Command(options.command, {
    args: [...options.commandArgs],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  await resize;
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
