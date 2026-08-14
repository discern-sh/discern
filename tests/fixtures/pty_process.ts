/** Generic real-PTY process driver shared by interactive integration harnesses. */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** One input write relative to an observed-ready phase. */
export interface PtyInputStep {
  readonly delayMs?: number;
  readonly bytes?: string | Uint8Array;
}

/** Input that cannot begin until the child has rendered a named marker. */
export interface PtyInputPhase {
  readonly waitFor: string | readonly [string, ...string[]];
  readonly steps: readonly [PtyInputStep, ...PtyInputStep[]];
  /** Skip this fallback phase when the child exits before requesting it. */
  readonly skipIfExited?: boolean;
}

/** A command whose standard streams are attached to one pseudo-terminal. */
export interface PtyProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: readonly PtyInputPhase[];
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

interface OutputCursor {
  readonly stdout: number;
  readonly stderr: number;
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

  let observedStdout = "";
  let observedStderr = "";
  let outputFinished = false;
  let outputWaiters: Array<() => void> = [];
  const notifyOutput = (): void => {
    const waiters = outputWaiters;
    outputWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const stdoutBytes = collectOutput(process.stdout, (text) => {
    observedStdout += text;
    notifyOutput();
  });
  const stderrBytes = collectOutput(process.stderr, (text) => {
    observedStderr += text;
    notifyOutput();
  });
  const outputComplete = Promise.all([stdoutBytes, stderrBytes]).then(() => {
    outputFinished = true;
    notifyOutput();
  });
  const waitForOutput = async (
    requestedMarkers: string | readonly [string, ...string[]],
    cursor: OutputCursor,
    skipIfExited: boolean,
  ): Promise<boolean> => {
    const markers = typeof requestedMarkers === "string"
      ? [requestedMarkers]
      : requestedMarkers;
    if (markers.some((marker) => marker.length === 0)) {
      throw new TypeError("PTY input readiness marker must not be empty");
    }
    while (
      !containsSequence(observedStdout, cursor.stdout, markers) &&
      !containsSequence(observedStderr, cursor.stderr, markers)
    ) {
      if (outputFinished) {
        if (skipIfExited) return false;
        throw new Error(
          `pseudo-terminal command exited before rendering input markers ${JSON.stringify(markers)}`,
        );
      }
      await new Promise<void>((resolve) => outputWaiters.push(resolve));
    }
    return true;
  };
  const inputPhases = options.input;
  const input = inputPhases === undefined
    ? undefined
    : (async (): Promise<void> => {
      const writer = process.stdin.getWriter();
      let cursor: OutputCursor = { stdout: 0, stderr: 0 };
      try {
        inputLoop:
        for (const phase of inputPhases) {
          const skipIfExited = phase.skipIfExited === true;
          const ready = await waitForOutput(
            phase.waitFor,
            cursor,
            skipIfExited,
          );
          if (!ready) break;
          const nextCursor: OutputCursor = {
            stdout: observedStdout.length,
            stderr: observedStderr.length,
          };
          for (const step of phase.steps) {
            const delayMs = step.delayMs ?? 0;
            if (delayMs > 0) {
              if (skipIfExited) {
                const exited = await Promise.race([
                  delay(delayMs).then(() => false),
                  outputComplete.then(() => true),
                ]);
                if (exited) break inputLoop;
              } else {
                await delay(delayMs);
              }
            }
            if (skipIfExited && outputFinished) break inputLoop;
            if (step.bytes !== undefined) {
              const bytes = typeof step.bytes === "string"
                ? ENCODER.encode(step.bytes)
                : step.bytes;
              if (bytes.length > 0) {
                try {
                  await writer.write(bytes);
                } catch (error) {
                  if (!skipIfExited) throw error;
                  // A fallback write may race the child that made it needless.
                  // If the child remains stuck, the process timeout still wins.
                  await outputComplete;
                  break inputLoop;
                }
              }
            }
          }
          cursor = nextCursor;
        }
      } finally {
        await writer.close().catch(() => undefined);
      }
    })().then(
      () => undefined,
      (error: unknown) => error,
    );

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
  const status = await process.status;
  clearTimeout(timer);
  await heldWriter?.close().catch(() => undefined);
  await outputComplete;
  const [stdoutOutput, stderrOutput] = await Promise.all([
    stdoutBytes,
    stderrBytes,
  ]);
  const stdout = DECODER.decode(stdoutOutput);
  const stderr = DECODER.decode(stderrOutput);
  if (timedOut) {
    throw new Error(
      `pseudo-terminal command exceeded ${timeoutMs}ms:\n${stdout}${stderr}`,
    );
  }
  const inputError = await input;
  if (inputError !== undefined) {
    const message = inputError instanceof Error
      ? inputError.message
      : String(inputError);
    throw new Error(`${message}:\n${stdout}${stderr}`, { cause: inputError });
  }
  return {
    code: status.code,
    stdout,
    stderr,
    transcript: stdout + stderr,
  };
}

function containsSequence(
  output: string,
  from: number,
  markers: readonly string[],
): boolean {
  let cursor = from;
  for (const marker of markers) {
    const found = output.indexOf(marker, cursor);
    if (found < 0) return false;
    cursor = found + marker.length;
  }
  return true;
}

async function collectOutput(
  stream: ReadableStream<Uint8Array>,
  observe: (text: string) => void,
): Promise<Uint8Array> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.length;
    const text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) observe(text);
  }
  const tail = decoder.decode();
  if (tail.length > 0) observe(tail);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
