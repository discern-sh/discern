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

/**
 * Whether colour is on (stderr is a TTY and NO_COLOR is unset) — the engine
 * routes human output to stderr, so the TTY check is on stderr (the shell's
 * `output.sh` checks stdout, but the gate now writes human output to stderr).
 */
export function colorEnabled(): boolean {
  const nc = Deno.env.get("NO_COLOR");
  if (nc !== undefined && nc !== "") {
    return false;
  }
  return Deno.stderr.isTerminal();
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

/** Build the output surface for a given colour mode. */
export function makeOut(color: boolean): Out {
  const c = color ? ANSI : PLAIN;
  return {
    c,
    color,
    info: (m: string): void => writeStderr(`${c.cyan}→${c.reset} ${m}\n`),
    ok: (m: string): void => writeStderr(`${c.green}✓${c.reset} ${m}\n`),
    warn: (m: string): void => writeStderr(`${c.yellow}!${c.reset} ${m}\n`),
    error: (m: string): void => writeStderr(`${c.red}✗${c.reset} ${m}\n`),
    heading: (m: string): void => writeStderr(`\n${c.bold}${m}${c.reset}\n`),
    raw: (s: string): void => writeStderr(s),
  };
}
