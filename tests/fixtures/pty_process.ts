/** Generic real-PTY process driver shared by interactive integration harnesses. */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** One delayed input write. Omitting bytes leaves only the delay before EOF. */
export interface PtyInputStep {
  readonly delayMs: number;
  readonly bytes?: string | Uint8Array;
}

/** A command whose standard streams are attached to one pseudo-terminal. */
export interface PtyProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: readonly PtyInputStep[];
  /** Keep the PTY input side open until a non-interactive child exits. */
  readonly keepInputOpen?: boolean;
  readonly timeoutMs?: number;
}

/** Complete observable process result; product values travel elsewhere. */
export interface PtyProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly transcript: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Launch any command through the platform script(1) PTY and feed raw chunks. */
export async function runPtyProcess(
  options: PtyProcessOptions,
): Promise<PtyProcessResult> {
  if (Deno.build.os === "windows") {
    throw new Error("the interactive PTY harness requires script(1)");
  }
  const command = [options.command, ...options.args];
  const keepInputOpen = options.keepInputOpen === true;
  if (keepInputOpen && options.input !== undefined) {
    throw new TypeError("keepInputOpen and input are mutually exclusive");
  }
  const scriptArgs = Deno.build.os === "darwin"
    ? ["-q", "/dev/null", ...command]
    : ["-q", "-e", "-c", command.map(shellQuote).join(" "), "/dev/null"];
  const child = new Deno.Command("script", {
    args: scriptArgs,
    cwd: options.cwd,
    env: {
      TERM: "xterm-256color",
      COLORTERM: "",
      LANG: "en_US.UTF-8",
      LC_ALL: "",
      CI: "false",
      NO_COLOR: "",
      FORCE_COLOR: "",
      ...options.env,
    },
    stdin: keepInputOpen || options.input !== undefined ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  const process = child.spawn();
  const heldWriter = keepInputOpen ? process.stdin.getWriter() : undefined;
  const inputSteps = options.input;
  const input = inputSteps === undefined
    ? undefined
    : (async (): Promise<void> => {
      const writer = process.stdin.getWriter();
      try {
        for (const step of inputSteps) {
          if (step.delayMs > 0) await delay(step.delayMs);
          if (step.bytes !== undefined) {
            const bytes = typeof step.bytes === "string"
              ? ENCODER.encode(step.bytes)
              : step.bytes;
            if (bytes.length > 0) await writer.write(bytes);
          }
        }
      } finally {
        await writer.close();
      }
    })();

  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill("SIGTERM");
    } catch {
      // The child finished between the timer and signal delivery.
    }
  }, timeoutMs);
  const output = await process.output();
  clearTimeout(timer);
  await heldWriter?.close().catch(() => undefined);
  await input?.catch(() => undefined);
  const stdout = DECODER.decode(output.stdout);
  const stderr = DECODER.decode(output.stderr);
  if (timedOut) {
    throw new Error(
      `pseudo-terminal command exceeded ${timeoutMs}ms:\n${stdout}${stderr}`,
    );
  }
  return {
    code: output.code,
    stdout,
    stderr,
    transcript: stdout + stderr,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
