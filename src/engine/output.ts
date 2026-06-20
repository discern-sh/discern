/**
 * Colour-aware human output for the gate recipes, matching the shell `output.sh`
 * helpers exactly: `info` (cyan →), `ok` (green ✓), `warn` (yellow !), and a
 * bold `heading`. All output goes to **stderr**, so `finish --json` keeps stdout
 * clean for the single JSON object (ADR 0004).
 */

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

/** A string writer targeting stdout or stderr. */
export function streamWriter(
  stream: "stdout" | "stderr",
): (s: string) => void {
  return stream === "stdout" ? writeStdout : writeStderr;
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
 * Build the output surface. info/ok/heading/raw go to `infoStream` — stdout for
 * the non-`--json` gate (matching the shell), stderr for `finish --json` (keeping
 * stdout clean for the JSON object). warn/error ALWAYS go to stderr.
 */
export function makeOut(
  color: boolean,
  infoStream: "stdout" | "stderr" = "stdout",
): Out {
  const c = color ? ANSI : PLAIN;
  const w = streamWriter(infoStream);
  return {
    c,
    color,
    info: (m: string): void => w(`${c.cyan}→${c.reset} ${m}\n`),
    ok: (m: string): void => w(`${c.green}✓${c.reset} ${m}\n`),
    warn: (m: string): void => writeStderr(`${c.yellow}!${c.reset} ${m}\n`),
    error: (m: string): void => writeStderr(`${c.red}✗${c.reset} ${m}\n`),
    heading: (m: string): void => w(`\n${c.bold}${m}${c.reset}\n`),
    raw: (s: string): void => w(s),
  };
}
