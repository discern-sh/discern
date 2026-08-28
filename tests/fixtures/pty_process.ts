/** Generic real-PTY process driver shared by interactive integration harnesses. */

import { realDelay, waitUntil } from "../waiting.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const ESCAPE_BYTE = 0x1b;

/** Infrastructure allowance for a successful process under concurrent suite load. */
export const TEST_PROCESS_TIMEOUT_MS = 180_000;

/** One input write relative to an observed-ready phase. */
export interface PtyInputStep {
  readonly delayMs?: number;
  readonly bytes?: string | Uint8Array;
  /** Run one test-owned side effect (for example, request a PTY resize) at
   * this exact point in the readiness-gated input sequence. */
  readonly effect?: (
    context: { readonly transcript: string },
  ) => void | Promise<void>;
  /** Allow an intentional lone Escape key press before later scripted input. */
  readonly allowLoneEscape?: boolean;
}

/** Output accumulated from the real PTY at one observable instant. */
export interface PtyObservedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly transcript: string;
  readonly phaseStdout: string;
  readonly phaseStderr: string;
}

/** Positive observable condition that makes one keyframe safe to capture. */
export interface PtyOutputCondition {
  readonly description: string;
  readonly test: (output: PtyObservedOutput) => boolean;
}

/** One named keyframe and the condition that proves it is ready. */
export interface PtyKeyframeCapture {
  readonly name: string;
  readonly when: PtyOutputCondition;
}

/** Input that cannot begin until the child has rendered a named marker. */
export interface PtyInputPhase {
  readonly waitFor:
    | string
    | readonly [string, ...string[]]
    | PtyOutputCondition;
  /** Save the transcript only after its own positive readiness condition. */
  readonly capture?: PtyKeyframeCapture;
  readonly steps: readonly [PtyInputStep, ...PtyInputStep[]];
}

/** Terminal dimensions applied before the target command starts. */
export interface PtyGeometry {
  readonly columns: number;
  readonly rows: number;
}

/** A command whose standard streams are attached to one pseudo-terminal. */
export interface PtyProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly geometry?: PtyGeometry;
  /** Bytes written immediately after spawn; the wrapper pipe stays open until exit. */
  readonly initialInput?: string | Uint8Array;
  readonly input?: readonly PtyInputPhase[];
  /** Keep the PTY input side open until a non-interactive child exits. */
  readonly keepInputOpen?: boolean;
  /** Behavioral completion bound. Scripted-input runs start it only after the
   * final readiness-gated input phase completes. */
  readonly timeoutMs?: number;
}

/** Complete observable process result; product values travel elsewhere. */
export interface PtyProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly transcript: string;
  /** Exact wrapper stream bytes, retained even when UTF-8 decoding substitutes. */
  readonly stdoutBytes: Uint8Array;
  readonly stderrBytes: Uint8Array;
  readonly transcriptBytes: Uint8Array;
  readonly keyframes: Readonly<Record<string, string>>;
}

interface OutputCursor {
  readonly stdout: number;
  readonly stderr: number;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Build a keyframe condition from markers observed in order on one stream. */
export function ptyOutputContains(
  requestedMarkers: string | readonly [string, ...string[]],
): PtyOutputCondition {
  const markers = typeof requestedMarkers === "string"
    ? [requestedMarkers]
    : [...requestedMarkers];
  assertOutputMarkers(markers, "PTY keyframe readiness");
  return {
    description: `output markers ${JSON.stringify(markers)}`,
    test: (output: PtyObservedOutput): boolean =>
      containsSequence(output.phaseStdout, 0, markers) ||
      containsSequence(output.phaseStderr, 0, markers),
  };
}

/** Launch any command through the platform script(1) PTY and feed raw chunks. */
export async function runPtyProcess(
  options: PtyProcessOptions,
): Promise<PtyProcessResult> {
  validateInput(options.input);
  if (Deno.build.os === "windows") {
    throw new Error("the interactive PTY harness requires script(1)");
  }
  const geometry = options.geometry;
  if (
    geometry !== undefined &&
    (!Number.isSafeInteger(geometry.columns) || geometry.columns <= 0 ||
      !Number.isSafeInteger(geometry.rows) || geometry.rows <= 0)
  ) {
    throw new TypeError("PTY geometry must use positive integer dimensions");
  }
  const targetCommand = geometry === undefined
    ? [options.command, ...options.args]
    : [
      "sh",
      "-c",
      'stty cols "$1" rows "$2"; shift 2; exec "$@"',
      "discern-pty-geometry",
      String(geometry.columns),
      String(geometry.rows),
      options.command,
      ...options.args,
    ];
  // util-linux script(1) uses its inherited SHELL to interpret -c. SHELL is
  // also command input in tests that exercise shell selection, so an explicit
  // override must travel inside the PTY command instead of replacing the
  // wrapper's own interpreter. BSD script receives the same argv harmlessly.
  const commandShell = options.env?.SHELL;
  const command = commandShell === undefined
    ? targetCommand
    : ["/usr/bin/env", `SHELL=${commandShell}`, ...targetCommand];
  const wrapperEnvironment = { ...options.env };
  delete wrapperEnvironment.SHELL;
  const keepInputOpen = options.keepInputOpen === true;
  const inputModes = Number(keepInputOpen) +
    Number(options.initialInput !== undefined) +
    Number(options.input !== undefined);
  if (inputModes > 1) {
    throw new TypeError(
      "keepInputOpen, initialInput, and input are mutually exclusive",
    );
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
      ...(geometry === undefined
        ? {}
        : {
          COLUMNS: String(geometry.columns),
          LINES: String(geometry.rows),
        }),
      ...wrapperEnvironment,
    },
    stdin: inputModes > 0 ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  const process = child.spawn();
  // script(1) is an interactive wrapper, not an ordinary pipe consumer. BSD
  // injects terminal EOF bytes when its piped stdin closes; util-linux warns
  // that the inner session can instead miss EOF and hang. Keep every input
  // mode's pipe alive until the real command settles so the final scripted
  // byte is never coupled to wrapper EOF/HUP handling.
  const inputWriter = inputModes > 0 ? process.stdin.getWriter() : undefined;

  let observedStdout = "";
  let observedStderr = "";
  const keyframes: Record<string, string> = {};
  let inputProgress = "no scripted input";
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
  const observedOutput = (cursor: OutputCursor): PtyObservedOutput => ({
    stdout: observedStdout,
    stderr: observedStderr,
    transcript: observedStdout + observedStderr,
    phaseStdout: observedStdout.slice(cursor.stdout),
    phaseStderr: observedStderr.slice(cursor.stderr),
  });
  const waitForOutput = async (
    readiness: PtyInputPhase["waitFor"],
    cursor: OutputCursor,
  ): Promise<void> => {
    if (isOutputCondition(readiness)) {
      await waitForOutputCondition(readiness, cursor);
      return;
    }
    const requestedMarkers = readiness;
    const markers = typeof requestedMarkers === "string"
      ? [requestedMarkers]
      : requestedMarkers;
    assertOutputMarkers(markers, "PTY input readiness");
    while (
      !containsSequence(observedStdout, cursor.stdout, markers) &&
      !containsSequence(observedStderr, cursor.stderr, markers)
    ) {
      if (outputFinished) {
        throw new Error(
          `pseudo-terminal command exited before rendering input markers ${JSON.stringify(markers)}`,
        );
      }
      await new Promise<void>((resolve) => outputWaiters.push(resolve));
    }
  };
  const waitForOutputCondition = async (
    condition: PtyOutputCondition,
    cursor: OutputCursor,
  ): Promise<void> => {
    while (!condition.test(observedOutput(cursor))) {
      if (outputFinished) {
        throw new Error(
          `pseudo-terminal command exited before satisfying keyframe condition ${JSON.stringify(condition.description)}`,
        );
      }
      await new Promise<void>((resolve) => outputWaiters.push(resolve));
    }
  };
  const initialInput = options.initialInput;
  const immediateInput = initialInput === undefined
    ? undefined
    : (async (): Promise<void> => {
      const writer = inputWriter;
      if (writer === undefined) {
        throw new Error("PTY initial input has no writable wrapper pipe");
      }
      inputProgress = "writing initial input";
      const bytes = typeof initialInput === "string"
        ? ENCODER.encode(initialInput)
        : initialInput;
      if (bytes.length > 0) await writer.write(bytes);
      inputProgress = "initial input complete";
    })().then(
      () => undefined,
      (error: unknown) => error,
    );
  const inputPhases = options.input;
  const phasedInput = inputPhases === undefined
    ? undefined
    : (async (): Promise<void> => {
      const writer = inputWriter;
      if (writer === undefined) {
        throw new Error("PTY scripted input has no writable wrapper pipe");
      }
      let cursor: OutputCursor = { stdout: 0, stderr: 0 };
      for (const [phaseIndex, phase] of inputPhases.entries()) {
        inputProgress =
          `phase ${phaseIndex + 1}/${inputPhases.length} waiting for ` +
          readinessDescription(phase.waitFor);
        await waitForOutput(phase.waitFor, cursor);
        inputProgress = `phase ${phaseIndex + 1}/${inputPhases.length} ready`;
        const capture = phase.capture;
        if (capture !== undefined) {
          inputProgress = `phase ${phaseIndex + 1}/${inputPhases.length} ` +
            `waiting to capture ${JSON.stringify(capture.name)} when ` +
            capture.when.description;
          await waitForOutputCondition(capture.when, cursor);
          keyframes[capture.name] = observedOutput(cursor).transcript;
          inputProgress = `phase ${phaseIndex + 1}/${inputPhases.length} ` +
            `captured ${JSON.stringify(capture.name)}`;
        }
        const nextCursor: OutputCursor = {
          stdout: observedStdout.length,
          stderr: observedStderr.length,
        };
        for (const [stepIndex, step] of phase.steps.entries()) {
          const delayMs = step.delayMs ?? 0;
          if (delayMs > 0) {
            await realDelay("pty-input-step-pacing", delayMs);
          }
          inputProgress =
            `phase ${phaseIndex + 1}/${inputPhases.length} step ` +
            `${stepIndex + 1}/${phase.steps.length}`;
          await step.effect?.({
            transcript: observedStdout + observedStderr,
          });
          const bytes = inputBytes(step);
          if (bytes !== undefined && bytes.length > 0) {
            await writer.write(bytes);
          }
        }
        cursor = nextCursor;
        inputProgress = `phase ${phaseIndex + 1}/${inputPhases.length} complete`;
      }
    })().then(
      () => undefined,
      (error: unknown) => error,
    );
  const input = immediateInput ?? phasedInput;

  const timeoutMs = options.timeoutMs ?? TEST_PROCESS_TIMEOUT_MS;
  const statusPromise = process.status;
  let timedOut = false;
  let inputError: unknown;
  if (input !== undefined) {
    const readiness = await settledWithin(input, TEST_PROCESS_TIMEOUT_MS);
    if (readiness.kind === "timeout") {
      timedOut = true;
    } else {
      inputError = readiness.value;
    }
  }
  if (timedOut || inputError !== undefined) {
    await terminateProcessTree(process);
  }
  let status: Deno.CommandStatus;
  if (timedOut || inputError !== undefined) {
    status = await statusPromise;
  } else {
    const completion = await settledWithin(statusPromise, timeoutMs);
    if (completion.kind === "timeout") {
      timedOut = true;
      await terminateProcessTree(process);
      status = await statusPromise;
    } else {
      status = completion.value;
    }
  }
  await inputWriter?.close().catch(() => undefined);
  await outputComplete;
  const [stdoutOutput, stderrOutput] = await Promise.all([
    stdoutBytes,
    stderrBytes,
  ]);
  const stdout = DECODER.decode(stdoutOutput);
  const stderr = DECODER.decode(stderrOutput);
  const transcriptBytes = concatenateBytes(stdoutOutput, stderrOutput);
  if (timedOut) {
    throw new Error(
      `pseudo-terminal command exceeded ${timeoutMs}ms ` +
        `(${inputProgress}):\n${stdout}${stderr}`,
    );
  }
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
    stdoutBytes: stdoutOutput,
    stderrBytes: stderrOutput,
    transcriptBytes,
    keyframes,
  };
}

/** Resolve one harness phase without letting an infrastructure hang run forever. */
async function settledWithin<T>(
  pending: Promise<T>,
  timeoutMs: number,
): Promise<
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "timeout" }
> {
  let outcome:
    | { readonly kind: "value"; readonly value: T }
    | { readonly kind: "error"; readonly error: unknown }
    | undefined;
  void pending.then(
    (value) => {
      outcome = { kind: "value", value };
    },
    (error: unknown) => {
      outcome = { kind: "error", error };
    },
  );
  try {
    await waitUntil(() => outcome !== undefined, "the PTY operation to settle", {
      timeoutMs,
    });
  } catch {
    return { kind: "timeout" };
  }
  if (outcome?.kind === "error") throw outcome.error;
  return outcome ?? { kind: "timeout" };
}

/** Stop the PTY wrapper and every child still below it. A timeout must not
 * leave the real command running after the test that owned it has failed. */
async function terminateProcessTree(process: Deno.ChildProcess): Promise<void> {
  const descendants = await descendantProcessIds(process.pid);
  signalProcesses(descendants, "SIGTERM");
  try {
    process.kill("SIGTERM");
  } catch {
    // The wrapper finished between the timeout and signal delivery.
  }
  await realDelay("pty-termination-grace", 100);
  signalProcesses(descendants, "SIGKILL");
  try {
    process.kill("SIGKILL");
  } catch {
    // SIGTERM already settled the wrapper.
  }
}

/** Snapshot the descendant tree before terminating its PTY-owning parent. */
async function descendantProcessIds(rootPid: number): Promise<number[]> {
  const output = await new Deno.Command("ps", {
    args: ["-axo", "pid=,ppid="],
    stdout: "piped",
    stderr: "null",
  }).output().catch(() => undefined);
  if (output === undefined || !output.success) return [];
  const children = new Map<number, number[]>();
  for (const line of DECODER.decode(output.stdout).split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const members = children.get(parent) ?? [];
    members.push(pid);
    children.set(parent, members);
  }
  const descendants: number[] = [];
  const visit = (parent: number): void => {
    for (const child of children.get(parent) ?? []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
}

function signalProcesses(
  processIds: readonly number[],
  signal: Deno.Signal,
): void {
  for (const pid of processIds) {
    try {
      Deno.kill(pid, signal);
    } catch {
      // A descendant may settle while its sibling is being signalled.
    }
  }
}

function concatenateBytes(
  first: Uint8Array,
  second: Uint8Array,
): Uint8Array {
  const output = new Uint8Array(first.length + second.length);
  output.set(first, 0);
  output.set(second, first.length);
  return output;
}

function validateInput(
  phases: readonly PtyInputPhase[] | undefined,
): void {
  if (phases === undefined) return;
  let pendingLoneEscape = false;
  const keyframeNames = new Set<string>();
  for (const phase of phases) {
    if (
      isOutputCondition(phase.waitFor) &&
      phase.waitFor.description.length === 0
    ) {
      throw new TypeError("PTY input readiness description must not be empty");
    }
    const capture = phase.capture;
    if (capture !== undefined) {
      if (capture.name.length === 0) {
        throw new TypeError("PTY keyframe name must not be empty");
      }
      if (keyframeNames.has(capture.name)) {
        throw new TypeError(
          `PTY keyframe name must be unique: ${capture.name}`,
        );
      }
      if (capture.when.description.length === 0) {
        throw new TypeError("PTY keyframe readiness description must not be empty");
      }
      keyframeNames.add(capture.name);
    }
    for (const step of phase.steps) {
      const bytes = inputBytes(step);
      if (bytes === undefined || bytes.length === 0) continue;
      if (pendingLoneEscape) {
        throw new TypeError(
          "PTY input must not leave a lone Escape byte before later input; " +
            "join Escape to its first continuation byte in one step, or set " +
            "allowLoneEscape for an intentional Escape key press",
        );
      }
      pendingLoneEscape = bytes[bytes.length - 1] === ESCAPE_BYTE &&
        step.allowLoneEscape !== true;
    }
  }
}

/** Whether one phase waits on a positive output predicate instead of markers. */
function isOutputCondition(
  readiness: PtyInputPhase["waitFor"],
): readiness is PtyOutputCondition {
  return typeof readiness === "object" && !Array.isArray(readiness);
}

/** Render one phase's readiness boundary without serializing its function. */
function readinessDescription(readiness: PtyInputPhase["waitFor"]): string {
  return isOutputCondition(readiness)
    ? readiness.description
    : JSON.stringify(readiness);
}

function assertOutputMarkers(
  markers: readonly string[],
  label: string,
): void {
  if (markers.some((marker) => marker.length === 0)) {
    throw new TypeError(`${label} marker must not be empty`);
  }
}

function inputBytes(step: PtyInputStep): Uint8Array | undefined {
  if (step.bytes === undefined) return undefined;
  return typeof step.bytes === "string"
    ? ENCODER.encode(step.bytes)
    : step.bytes;
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
