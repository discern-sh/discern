/** Real-PTY command capture composed with the published terminal projection. */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  projectTerminalHtml,
  projectTerminalSpans,
} from "discern-design-system/cli/projection";
import {
  type PtyGeometry,
  type PtyInputPhase,
  runPtyProcess,
} from "./pty_process.ts";

/** Named geometries shared by the task, fixtures, and future journey harnesses. */
export const TERMINAL_CAPTURE_GEOMETRIES = {
  canonical: { columns: 80, rows: 24 },
  wide: { columns: 120, rows: 24 },
  tall: { columns: 80, rows: 40 },
  short: { columns: 80, rows: 13 },
} as const satisfies Readonly<Record<string, PtyGeometry>>;

export type TerminalCaptureGeometryName =
  keyof typeof TERMINAL_CAPTURE_GEOMETRIES;

/** Context supplied to a narrowly-scoped volatile-fact normalizer. */
export interface TerminalCaptureNormalizationContext {
  readonly name: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

/** One documented scalar replacement applied after the real PTY run. */
export interface TerminalCaptureNormalizer {
  readonly name: string;
  readonly normalize: (
    output: string,
    context: TerminalCaptureNormalizationContext,
  ) => string;
}

/** Controlled process facts that materially affect the terminal rendering. */
export interface TerminalCaptureEnvironment {
  readonly color: "on" | "off";
  readonly locale: string;
  readonly mode: "static" | "interactive";
  readonly term: "xterm-256color";
}

/** A final real-terminal screen and any readiness-keyed intermediate screens. */
export interface TerminalCommandCapture {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly args: readonly string[];
  readonly geometry: PtyGeometry;
  readonly environment: TerminalCaptureEnvironment;
  readonly exitCode: number;
  readonly normalizers: readonly string[];
  readonly screen: string;
  readonly keyframes: Readonly<Record<string, string>>;
}

/** Inputs for one invocation of a compiled Discern command. */
export interface CaptureDiscernCommandOptions {
  readonly executable: string;
  readonly name: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly geometry?: PtyGeometry;
  readonly color?: boolean;
  readonly locale?: string;
  readonly static?: boolean;
  readonly input?: readonly PtyInputPhase[];
  readonly env?: Readonly<Record<string, string>>;
  readonly normalizers?: readonly TerminalCaptureNormalizer[];
  readonly timeoutMs?: number;
}

/** Options for the package-owned HTML projection of one captured screen. */
export interface TerminalCaptureHtmlOptions {
  readonly keyframe?: string;
  readonly theme?: "dark" | "light";
}

/** Normalize only the line discipline added by script(1)'s PTY transport. */
export function normalizePtyLineEndings(output: string): string {
  // Complete-frame writers already return to column zero before each newline;
  // script(1)'s line discipline can add a second carriage return.
  const normalized = output.replaceAll("\r\r\n", "\n")
    .replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) {
    throw new Error(
      "terminal capture contains a live carriage-return repaint; capture a static command state or a named settled keyframe",
    );
  }
  return normalized;
}

/**
 * Extract the settled full-frame repaint from one interactive PTY transcript.
 * Package interactions redraw by erasing from the active frame origin and then
 * emitting a complete replacement. Content after the final erase is therefore
 * the visible frame, apart from cursor visibility and background-query controls
 * that manage the terminal but occupy no cells.
 */
export function settledInteractiveTerminalFrame(output: string): string {
  const normalized = normalizePtyLineEndings(output);
  const erasures = [...normalized.matchAll(/\x1b\[(?:[012])?J/gu)];
  const last = erasures.at(-1);
  const frame = last?.index === undefined
    ? normalized
    : normalized.slice(last.index + last[0].length);
  return frame
    .replace(/^\x1b\[H/u, "")
    .replaceAll(/\x1b\[\?25[hl]/gu, "")
    .replaceAll("\x1b]11;?\x1b\\", "");
}

/** Apply named normalizers without changing their declared order. */
function applyNormalizers(
  output: string,
  normalizers: readonly TerminalCaptureNormalizer[],
  context: TerminalCaptureNormalizationContext,
): string {
  return normalizers.reduce(
    (current, normalizer) => normalizer.normalize(current, context),
    output,
  );
}

/** Capture a complete Discern invocation through the repository's one PTY driver. */
export async function captureDiscernCommand(
  options: CaptureDiscernCommandOptions,
): Promise<TerminalCommandCapture> {
  const geometry = options.geometry ?? TERMINAL_CAPTURE_GEOMETRIES.canonical;
  const color = options.color ?? true;
  const staticOutput = options.static ?? options.input === undefined;
  const locale = options.locale ?? "en_US.UTF-8";
  const environment: TerminalCaptureEnvironment = {
    color: color ? "on" : "off",
    locale,
    mode: staticOutput ? "static" : "interactive",
    term: "xterm-256color",
  };
  const result = await runPtyProcess({
    command: options.executable,
    args: options.args,
    cwd: options.cwd,
    geometry,
    env: {
      ...options.env,
      TERM: environment.term,
      COLORTERM: "",
      LANG: locale,
      LC_ALL: locale,
      CI: staticOutput ? "1" : "false",
      NO_COLOR: color ? "" : "1",
      FORCE_COLOR: color ? "1" : "",
    },
    ...(options.input === undefined
      ? { keepInputOpen: true }
      : { input: options.input }),
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  const normalizers = options.normalizers ?? [];
  const context: TerminalCaptureNormalizationContext = {
    name: options.name,
    args: options.args,
    cwd: options.cwd,
  };
  const normalized = (output: string): string =>
    applyNormalizers(
      staticOutput
        ? normalizePtyLineEndings(output)
        : settledInteractiveTerminalFrame(output),
      normalizers,
      context,
    );
  return {
    schemaVersion: 1,
    name: options.name,
    args: [...options.args],
    geometry: { ...geometry },
    environment,
    exitCode: result.code,
    normalizers: normalizers.map((normalizer) => normalizer.name),
    screen: normalized(result.transcript),
    keyframes: Object.fromEntries(
      Object.entries(result.keyframes).map(([name, output]) => [
        name,
        normalized(output),
      ]),
    ),
  };
}

/** Compile the current checkout into the binary whose product output is captured. */
export async function compileDiscernCaptureBinary(
  repoRoot: string,
  destination: string,
): Promise<void> {
  await ensureDir(dirname(destination));
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "--cached-only",
      "--config",
      join(repoRoot, "deno.json"),
      "-A",
      "--output",
      destination,
      join(repoRoot, "src", "main.ts"),
    ],
    cwd: repoRoot,
    env: { DENO_NO_UPDATE_CHECK: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `could not compile the terminal-capture binary:\n${
        decoder.decode(result.stderr)
      }${decoder.decode(result.stdout)}`,
    );
  }
}

/** Escape a document title; terminal styling stays package-owned. */
function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Project one final or named screen through the published package surface. */
export function renderTerminalCaptureHtml(
  capture: TerminalCommandCapture,
  options: TerminalCaptureHtmlOptions = {},
): string {
  const keyframe = options.keyframe;
  const screen = keyframe === undefined
    ? capture.screen
    : capture.keyframes[keyframe];
  if (screen === undefined) {
    throw new Error(`terminal capture has no keyframe named ${keyframe}`);
  }
  // Resolve spans as part of the projection boundary too: malformed or
  // unsupported package output must fail before an artifact is written.
  projectTerminalSpans(screen);
  const title = keyframe === undefined
    ? `${capture.name} — ${capture.geometry.columns}×${capture.geometry.rows}`
    : `${capture.name} — ${keyframe}`;
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    `<title>${escapeHtmlText(title)}</title>`,
    projectTerminalHtml(screen, { theme: options.theme ?? "dark" }),
    "",
  ].join("\n");
}

/** Stable persisted form used by exact capture fixtures. */
export function serializeTerminalCapture(
  capture: TerminalCommandCapture,
): string {
  return `${JSON.stringify(capture, null, 2)}\n`;
}
