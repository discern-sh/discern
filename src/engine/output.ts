/**
 * Token-aware human output shared by engine renderers. Semantic accent, success,
 * warning, and danger roles come from the installed package terminal context.
 * Routing remains unchanged: narration uses its declared stdout/stderr owner and
 * JSON mode stays silent outside the single result object.
 */

import {
  assertHumanOutputGroupId,
  assertHumanOutputGroupLabel,
  type RenderSink,
} from "../shared/result.ts";
import {
  productionTerminalContext,
  setTerminalContext,
  type TerminalContext,
  terminalContext,
  terminalContextWithColor,
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
 * Compatibility setter for existing tests and direct engine callers. The CLI
 * installs a complete {@link TerminalContext}; this façade projects an injected
 * boolean without reintroducing an independent environment decision.
 */
export function setColorOverride(color: boolean | undefined): void {
  setTerminalContext(
    color === undefined
      ? undefined
      : terminalContextWithColor(productionTerminalContext(), color),
  );
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
 * Build the output surface. In human mode info/ok/heading/raw go to stdout
 * and warn/error to stderr. In `quiet` mode —
 * used under `--json`, where the result envelope is the ENTIRE program output
 * (ADR 0030) — every method is a no-op, so nothing a verb narrates reaches
 * stdout OR stderr. This mirrors the installer `Logger`, which already silences
 * its human methods in JSON mode: one silence rule, both halves of the binary.
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
  if (opts.quiet ?? false) {
    const noop = (): void => {};
    return {
      color,
      terminal,
      info: noop,
      ok: noop,
      warn: noop,
      error: noop,
      heading: noop,
      group: (id: string, label?: string): void => {
        assertHumanOutputGroupId(id);
        if (label !== undefined) assertHumanOutputGroupLabel(id, label);
      },
      raw: noop,
    };
  }
  const writeHumanStdout = opts.stdout ?? writeStdout;
  const writeHumanStderr = opts.stderr ?? writeStderr;
  let wroteHuman = false;
  let trailingNewlines = 0;
  let lastStream: "stdout" | "stderr" = "stdout";
  const writeHuman = (text: string, stream: "stdout" | "stderr"): void => {
    if (text === "") return;
    (stream === "stdout" ? writeHumanStdout : writeHumanStderr)(text);
    wroteHuman = true;
    lastStream = stream;
    const suffix = text.match(/\n+$/)?.[0] ?? "";
    trailingNewlines = suffix.length === text.length
      ? Math.min(2, trailingNewlines + suffix.length)
      : Math.min(2, suffix.length);
  };
  const stdout = (text: string): void => writeHuman(text, "stdout");
  const stderr = (text: string): void => writeHuman(text, "stderr");
  return {
    color,
    terminal,
    info: (m: string): void => stdout(`${terminal.tone("→", "accent")} ${m}\n`),
    ok: (m: string): void => stdout(`${terminal.tone("✓", "success")} ${m}\n`),
    warn: (m: string): void =>
      stderr(`${terminal.tone("!", "warning")} ${m}\n`),
    error: (m: string): void =>
      stderr(`${terminal.tone("✗", "danger")} ${m}\n`),
    heading: (m: string): void => stdout(`\n${terminal.role(m, "strong")}\n`),
    group: (id: string, label?: string): void => {
      assertHumanOutputGroupId(id);
      if (label !== undefined) assertHumanOutputGroupLabel(id, label);
      if (wroteHuman && trailingNewlines < 2) {
        writeHuman("\n".repeat(2 - trailingNewlines), lastStream);
      }
      if (label !== undefined) {
        writeHuman(
          `  ${terminal.role("──", "muted")} ${
            terminal.role(label, "strong")
          }\n`,
          lastStream,
        );
      }
    },
    raw: (s: string): void => stdout(s),
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
    dim: (t: string): string => out.terminal.role(t, "muted"),
  };
}
