/**
 * Colour-aware human output for the gate: `info` (cyan →), `ok` (green ✓), `warn`
 * (yellow !), and a
 * bold `heading`. All output goes to **stderr**, so `done --json` keeps stdout
 * clean for the single JSON object (ADR 0004).
 */

import { assertHumanOutputGroupId, type RenderSink } from "../shared/result.ts";

/** The ANSI palette, mirroring `output.sh`'s C_* variables. */
export interface Palette {
  reset: string;
  bold: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  cyan: string;
}

const ANSI: Palette = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const PLAIN: Palette = {
  reset: "",
  bold: "",
  dim: "",
  red: "",
  green: "",
  yellow: "",
  cyan: "",
};

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

/** The ANSI / plain palette for a colour mode. */
export function palette(color: boolean): Palette {
  return color ? ANSI : PLAIN;
}

/**
 * The colour decision resolved once at the CLI entry point (`main`), from the
 * `--no-color` flag + NO_COLOR + whether stdout is a TTY. `undefined` means "no
 * decision has been threaded" — the standalone fallback below applies. Setting it
 * is what lets `--no-color` reach every engine verb: they all resolve colour
 * through {@link colorEnabled}, so one resolved value governs the whole binary
 * rather than each output path re-deciding (and forgetting the flag).
 */
let colorOverride: boolean | undefined;

/**
 * Thread the CLI's single resolved colour decision to every engine output path.
 * Called once by `main` after parsing the global flags; every {@link colorEnabled}
 * caller (the gate, status, desk, coupling, …) then honours `--no-color`, NO_COLOR,
 * and non-TTY output uniformly. Passing `undefined` restores the standalone fallback
 * (used by tests to reset process-global state between cases).
 */
export function setColorOverride(color: boolean | undefined): void {
  colorOverride = color;
}

/**
 * Whether colour is on. When the CLI has resolved the colour decision
 * ({@link setColorOverride}) that value wins — so the `--no-color` flag is honoured
 * everywhere. Absent that (a direct engine caller in a test), fall back to the
 * standalone rule: NO_COLOR unset AND stdout is a TTY. The engine routes human
 * output to stdout, so the TTY check is on stdout.
 */
export function colorEnabled(): boolean {
  if (colorOverride !== undefined) {
    return colorOverride;
  }
  const nc = Deno.env.get("NO_COLOR");
  if (nc !== undefined && nc !== "") {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** The human-output surface a gate command uses. */
export interface Out {
  c: Palette;
  color: boolean;
  info(m: string): void;
  ok(m: string): void;
  warn(m: string): void;
  /** Failure line (red ✗) to stderr, without exiting. */
  error(m: string): void;
  heading(m: string): void;
  /** Start a new semantic group after one empty line. */
  group(id: string): void;
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
  } = {},
): Out {
  const c = color ? ANSI : PLAIN;
  if (opts.quiet ?? false) {
    const noop = (): void => {};
    return {
      c,
      color,
      info: noop,
      ok: noop,
      warn: noop,
      error: noop,
      heading: noop,
      group: (id: string): void => assertHumanOutputGroupId(id),
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
    c,
    color,
    info: (m: string): void => stdout(`${c.cyan}→${c.reset} ${m}\n`),
    ok: (m: string): void => stdout(`${c.green}✓${c.reset} ${m}\n`),
    warn: (m: string): void => stderr(`${c.yellow}!${c.reset} ${m}\n`),
    error: (m: string): void => stderr(`${c.red}✗${c.reset} ${m}\n`),
    heading: (m: string): void => stdout(`\n${c.bold}${m}${c.reset}\n`),
    group: (id: string): void => {
      assertHumanOutputGroupId(id);
      if (!wroteHuman || trailingNewlines >= 2) return;
      writeHuman("\n".repeat(2 - trailingNewlines), lastStream);
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

/** Adapt the gate's `Out` to a {@link RenderSink} (writes to its info stream). */
export function outSink(out: Out): RenderSink {
  return {
    heading: (t: string): void => out.heading(t),
    line: (t: string): void => out.raw(`${t}\n`),
    dim: (t: string): string => `${out.c.dim}${t}${out.c.reset}`,
  };
}
