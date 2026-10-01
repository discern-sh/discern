/**
 * Where human output goes while work runs beside a live screen.
 *
 * Every direct process-output primitive under `src/` (the rows of
 * `PROCESS_OUTPUT_BOUNDARIES`) asks for the current capture before it writes.
 * Outside a capture nothing changes: narration, job bytes and result
 * envelopes reach stdout and stderr as before. Inside one, the same bytes
 * go to the capture instead, so work a session runs beside its screen can
 * narrate exactly as the CLI does without a single byte reaching the
 * terminal the session paints. A capture also marks its scope as unable to
 * interact: nothing inside it may prompt.
 */

import { AsyncLocalStorage } from "./module_loading.ts";

/** One process stream a boundary would have written to. */
export type CapturedStream = "stdout" | "stderr";

/** A destination for output that would have reached the process streams. */
export interface OutputCapture {
  /** Receive text exactly as the boundary would have written it. */
  write(stream: CapturedStream, text: string): void;
}

const scope = new AsyncLocalStorage<OutputCapture>();
const decoder = new TextDecoder();

/** The capture the current scope writes to, if any. */
export function currentOutputCapture(): OutputCapture | undefined {
  return scope.getStore();
}

/** Run `work` with every process-output boundary writing to `capture`. */
export async function withOutputCapture<T>(
  capture: OutputCapture,
  work: () => Promise<T>,
): Promise<T> {
  return await scope.run(capture, work);
}

/**
 * Deliver bytes to the current capture. Returns false when no capture is
 * active, so the boundary writes to its own stream.
 */
export function captureBytes(
  stream: CapturedStream,
  bytes: Uint8Array,
): boolean {
  const capture = scope.getStore();
  if (capture === undefined) return false;
  capture.write(stream, decoder.decode(bytes));
  return true;
}

/**
 * Deliver one line to the current capture. Returns false when no capture is
 * active, so the boundary writes to its own stream.
 */
export function captureLine(stream: CapturedStream, line: string): boolean {
  const capture = scope.getStore();
  if (capture === undefined) return false;
  capture.write(stream, `${line}\n`);
  return true;
}
