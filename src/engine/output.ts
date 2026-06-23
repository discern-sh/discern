/**
 * Colour-aware human output for the gate recipes, matching the shell `output.sh`
 * helpers exactly: `info` (cyan →), `ok` (green ✓), `warn` (yellow !), and a
 * bold `heading`. All output goes to **stderr**, so `finish --json` keeps stdout
 * clean for the single JSON object (ADR 0004).
 */

import type { RenderSink } from "../shared/result.ts";

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
 * Whether colour is on (stdout is a TTY and NO_COLOR is unset). The engine routes
 * human output to stdout (matching the shell `output.sh`, which checks `[ -t 1 ]`),
 * so the TTY check is on stdout.
 */
export function colorEnabled(): boolean {
  const nc = Deno.env.get("NO_COLOR");
  if (nc !== undefined && nc !== "") {
    return false;
  }
  return Deno.stdout.isTerminal();
}

/** The human-output surface a gate recipe uses. */
export interface Out {
  c: Palette;
  color: boolean;
  info(m: string): void;
  ok(m: string): void;
  warn(m: string): void;
  /** Failure line (red ✗) to stderr, like the shell `die` without exiting. */
  error(m: string): void;
  heading(m: string): void;
  raw(s: string): void;
}

/**
 * Build the output surface. In human mode info/ok/heading/raw go to stdout
 * (matching the shell `output.sh`) and warn/error to stderr. In `quiet` mode —
 * used under `--json`, where the result envelope is the ENTIRE program output
 * (ADR 0030) — every method is a no-op, so nothing a verb narrates reaches
 * stdout OR stderr. This mirrors the installer `Logger`, which already silences
 * its human methods in JSON mode: one silence rule, both halves of the binary.
 */
export function makeOut(
  color: boolean,
  opts: { quiet?: boolean } = {},
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
      raw: noop,
    };
  }
  return {
    c,
    color,
    info: (m: string): void => writeStdout(`${c.cyan}→${c.reset} ${m}\n`),
    ok: (m: string): void => writeStdout(`${c.green}✓${c.reset} ${m}\n`),
    warn: (m: string): void => writeStderr(`${c.yellow}!${c.reset} ${m}\n`),
    error: (m: string): void => writeStderr(`${c.red}✗${c.reset} ${m}\n`),
    heading: (m: string): void => writeStdout(`\n${c.bold}${m}${c.reset}\n`),
    raw: (s: string): void => writeStdout(s),
  };
}

/** Adapt the gate's `Out` to a {@link RenderSink} (writes to its info stream). */
export function outSink(out: Out): RenderSink {
  return {
    heading: (t: string): void => out.heading(t),
    line: (t: string): void => out.raw(`${t}\n`),
    dim: (t: string): string => `${out.c.dim}${t}${out.c.reset}`,
  };
}
