/**
 * Token-aware human output shared by engine renderers. Semantic accent, success,
 * warning, and danger roles come from the installed package terminal context.
 * Routing remains unchanged: narration uses its declared stdout/stderr owner and
 * JSON mode stays silent outside the single result object. The rendering itself
 * is the shared narration authority (`src/lib/narration.ts`); `Out` is its
 * engine-stream configuration plus the raw stdout channel.
 */

import type { RenderSink } from "../shared/result.ts";
import {
  makeNarration,
  makeOutputSink,
  silentOutputSink,
} from "../lib/narration.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalContextWithColor,
  terminalLine,
  terminalPresentationContext,
} from "../lib/terminal.ts";

const ENCODER = new TextEncoder();

/** Write a string fully to stderr. */
export function writeStderr(s: string): void {
  const bytes = ENCODER.encode(s);
  let n = 0;
  while (n < bytes.length) {
    n += Deno.stderr.writeSync(bytes.subarray(n));
  }
}

/** Write a string fully to stdout. */
export function writeStdout(s: string): void {
  const bytes = ENCODER.encode(s);
  let n = 0;
  while (n < bytes.length) {
    n += Deno.stdout.writeSync(bytes.subarray(n));
  }
}

/** A raw-byte writer targeting stdout or stderr (for the job runner's output). */
export function byteWriter(
  stream: "stdout" | "stderr",
): (b: Uint8Array) => void {
  const target = stream === "stdout" ? Deno.stdout : Deno.stderr;
  return (b: Uint8Array): void => {
    let n = 0;
    while (n < b.length) {
      n += target.writeSync(b.subarray(n));
    }
  };
}

/**
 * Whether the shared process context permits colour. Direct callers use the
 * terminal module's production constructor; the CLI installs its one resolved
 * context before dispatch.
 */
export function colorEnabled(): boolean {
  return terminalContext().color;
}

/** The human-output surface a gate command uses. */
export interface Out {
  color: boolean;
  /** The explicit package presentation context shared by feature renderers. */
  terminal: TerminalContext;
  info(m: string): void;
  ok(m: string): void;
  warn(m: string): void;
  /** Failure line (red ✗) to stderr, without exiting. */
  error(m: string): void;
  heading(m: string): void;
  /** Start a semantic group and optionally give it a visible ruled label. */
  group(id: string, label?: string): void;
  raw(s: string): void;
}

/**
 * Build the output surface. In terminal mode info/ok/heading/raw go to stdout
 * and warn/error to stderr — one stream policy configuring the shared
 * narration authority (`src/lib/narration.ts`), whose sink owns every group
 * boundary. In `quiet` mode —
 * used under `--json` or `--markdown`, where one result is the ENTIRE program output
 * (ADR 0030) — the sink swallows everything, so nothing a verb narrates
 * reaches stdout OR stderr. This mirrors the installer `Logger`, which
 * silences its narration in quiet result mode: one silence rule, both halves of
 * the binary.
 */
export function makeOut(
  color: boolean,
  opts: {
    quiet?: boolean;
    /** Test seam for the stdout byte writer. */
    stdout?: ((text: string) => void) | undefined;
    /** Test seam for the stderr byte writer. */
    stderr?: ((text: string) => void) | undefined;
    /** Explicit package presentation facts for deterministic rendering tests. */
    terminal?: TerminalContext;
  } = {},
): Out {
  const terminal = terminalContextWithColor(
    opts.terminal ?? terminalPresentationContext(color),
    color,
  );
  const sink = (opts.quiet ?? false) ? silentOutputSink() : makeOutputSink({
    kind: "raw",
    stdout: opts.stdout ?? writeStdout,
    stderr: opts.stderr ?? writeStderr,
  });
  const narration = makeNarration(sink, terminal, {
    narration: "stdout",
    alerts: "stderr",
  });
  return {
    color,
    terminal,
    info: narration.info,
    ok: narration.ok,
    warn: narration.warn,
    error: narration.error,
    heading: narration.heading,
    group: narration.group,
    raw: (s: string): void => sink.write(s, "stdout"),
  };
}

/** Compact duration for one-line surfaces: `45s`, `3m`, `2h`, `1d`. */
export function compactDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/** A run-summary duration with seconds retained: `45s`, `3m 12s`, `2h 4m 9s`. */
export function elapsedDuration(ms: number): string {
  const totalSeconds = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(minutes > 0 ? [`${minutes}m`] : []),
    ...(seconds > 0 || totalSeconds === 0 ? [`${seconds}s`] : []),
  ].join(" ");
}

/** Adapt the gate's `Out` to a {@link RenderSink} (writes to its info stream). */
export function outSink(out: Out): RenderSink {
  return {
    heading: (t: string): void => out.heading(t),
    line: (t: string): void => out.raw(`${t}\n`),
    safeLine: (t: string): string => terminalLine(t),
    dim: (t: string): string => out.terminal.role(terminalLine(t), "muted"),
  };
}
