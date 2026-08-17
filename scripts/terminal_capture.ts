/** Capture one current-source Discern command to a reviewable HTML file. */

import { dirname, fromFileUrl, isAbsolute, join, resolve } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  captureDiscernCommand,
  compileDiscernCaptureBinary,
  renderTerminalCaptureHtml,
  TERMINAL_CAPTURE_GEOMETRIES,
  type TerminalCaptureGeometryName,
} from "../tests/fixtures/terminal_command_capture.ts";
import type {
  PtyInputPhase,
  PtyInputStep,
} from "../tests/fixtures/pty_process.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

interface CaptureTaskOptions {
  readonly name: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly geometry: TerminalCaptureGeometryName;
  readonly color: boolean;
  readonly locale: string;
  readonly output: string;
  readonly theme: "dark" | "light";
  readonly script?: string | undefined;
  readonly keyframe?: string | undefined;
}

export const TERMINAL_REVIEW_GUIDE =
  "project/map/80-development/reviewing-terminal-output.md";

/** Keep the artifact path first, then route the reviewer to the full workflow. */
export function terminalCaptureHandoff(output: string): string {
  return `${output}\nReview: ${TERMINAL_REVIEW_GUIDE}`;
}

const HELP = `Capture a Discern command from a real PTY and project it to HTML.

Usage:
  deno task terminal:capture <name> [options] [-- <discern arguments...>]

Options:
  --geometry <canonical|wide|tall|short>  Terminal dimensions (default: canonical)
  --output <path>                   HTML destination
  --cwd <path>                      Project to run in (default: current directory)
  --locale <locale>                 Captured locale (default: en_US.UTF-8)
  --no-color                        Capture package output without colour
  --theme <dark|light>              HTML background theme (default: dark)
  --script <path>                   JSON readiness/input phases for an interactive capture
  --keyframe <name>                 Render one named frame captured by --script

With no arguments after --, <name> is the Discern verb. Use "help" for root
--help. Artifacts default to .scratch/terminal-captures/.
`;

/** Read one required option value from the task argument list. */
function optionValue(args: readonly string[], at: number): string {
  const value = args[at + 1];
  if (value === undefined || value === "--") {
    throw new TypeError(`${args[at]} needs a value`);
  }
  return value;
}

/** Keep the default artifact basename inert and portable. */
function artifactName(name: string): string {
  const safe = name.toLowerCase().replaceAll(/[^a-z0-9_-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  if (safe === "") throw new TypeError("capture name must contain a word");
  return safe;
}

/** Parse the small dev-task interface without involving the product CLI. */
function parseOptions(args: readonly string[]): CaptureTaskOptions {
  if (args.length === 0 || args.includes("--help")) {
    console.log(HELP.trimEnd());
    Deno.exit(args.length === 0 ? 1 : 0);
  }
  const delimiter = args.indexOf("--");
  const taskArgs = delimiter < 0 ? args : args.slice(0, delimiter);
  const commandArgs = delimiter < 0 ? [] : args.slice(delimiter + 1);
  const name = taskArgs[0];
  if (name === undefined || name.startsWith("--")) {
    throw new TypeError("the capture name must be the first argument");
  }
  let geometry: TerminalCaptureGeometryName = "canonical";
  let color = true;
  let locale = "en_US.UTF-8";
  let cwd = Deno.cwd();
  let output: string | undefined;
  let theme: "dark" | "light" = "dark";
  let script: string | undefined;
  let keyframe: string | undefined;
  for (let at = 1; at < taskArgs.length; at += 1) {
    const arg = taskArgs[at];
    switch (arg) {
      case "--geometry": {
        const value = optionValue(taskArgs, at);
        if (!(value in TERMINAL_CAPTURE_GEOMETRIES)) {
          throw new TypeError(`unknown terminal geometry: ${value}`);
        }
        geometry = value as TerminalCaptureGeometryName;
        at += 1;
        break;
      }
      case "--output":
        output = optionValue(taskArgs, at);
        at += 1;
        break;
      case "--cwd":
        cwd = resolve(optionValue(taskArgs, at));
        at += 1;
        break;
      case "--locale":
        locale = optionValue(taskArgs, at);
        at += 1;
        break;
      case "--no-color":
        color = false;
        break;
      case "--theme": {
        const value = optionValue(taskArgs, at);
        if (value !== "dark" && value !== "light") {
          throw new TypeError(`unknown HTML theme: ${value}`);
        }
        theme = value;
        at += 1;
        break;
      }
      case "--script":
        script = resolve(optionValue(taskArgs, at));
        at += 1;
        break;
      case "--keyframe":
        keyframe = optionValue(taskArgs, at);
        at += 1;
        break;
      default:
        throw new TypeError(`unknown terminal capture option: ${arg}`);
    }
  }
  const defaultOutput = join(
    REPO_ROOT,
    ".scratch",
    "terminal-captures",
    `${artifactName(name)}-${geometry}.html`,
  );
  const target = output === undefined
    ? defaultOutput
    : isAbsolute(output)
    ? output
    : resolve(output);
  if (keyframe !== undefined && script === undefined) {
    throw new TypeError("--keyframe requires --script");
  }
  return {
    name,
    args: commandArgs.length > 0
      ? commandArgs
      : name === "help"
      ? ["--help"]
      : [name],
    cwd,
    geometry,
    color,
    locale,
    output: target,
    theme,
    ...(script === undefined ? {} : { script }),
    ...(keyframe === undefined ? {} : { keyframe }),
  };
}

/** Narrow a JSON object without letting unchecked input reach the PTY driver. */
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Parse one scripted input step from the review file. */
function parseInputStep(value: unknown, label: string): PtyInputStep {
  const source = record(value, label);
  if (source.bytes !== undefined && typeof source.bytes !== "string") {
    throw new TypeError(`${label}.bytes must be a string`);
  }
  if (
    source.delayMs !== undefined &&
    (typeof source.delayMs !== "number" || !Number.isFinite(source.delayMs) ||
      source.delayMs < 0)
  ) {
    throw new TypeError(`${label}.delayMs must be a non-negative number`);
  }
  if (
    source.allowLoneEscape !== undefined &&
    typeof source.allowLoneEscape !== "boolean"
  ) {
    throw new TypeError(`${label}.allowLoneEscape must be a boolean`);
  }
  return {
    ...(source.bytes === undefined ? {} : { bytes: source.bytes }),
    ...(source.delayMs === undefined ? {} : { delayMs: source.delayMs }),
    ...(source.allowLoneEscape === undefined
      ? {}
      : { allowLoneEscape: source.allowLoneEscape }),
  };
}

/** Parse readiness-gated PTY phases from one ignored review script. */
async function readInputScript(path: string): Promise<PtyInputPhase[]> {
  const source: unknown = JSON.parse(await Deno.readTextFile(path));
  if (!Array.isArray(source) || source.length === 0) {
    throw new TypeError("capture script must be a non-empty array of phases");
  }
  return source.map((value, phaseIndex) => {
    const label = `phase ${phaseIndex + 1}`;
    const phase = record(value, label);
    const markers = typeof phase.waitFor === "string"
      ? phase.waitFor
      : Array.isArray(phase.waitFor) && phase.waitFor.length > 0 &&
          phase.waitFor.every((marker) => typeof marker === "string")
      ? phase.waitFor as [string, ...string[]]
      : undefined;
    if (markers === undefined) {
      throw new TypeError(`${label}.waitFor must be a string or string array`);
    }
    if (
      phase.captureAs !== undefined && typeof phase.captureAs !== "string"
    ) {
      throw new TypeError(`${label}.captureAs must be a string`);
    }
    if (!Array.isArray(phase.steps) || phase.steps.length === 0) {
      throw new TypeError(`${label}.steps must be a non-empty array`);
    }
    const steps = phase.steps.map((step, stepIndex) =>
      parseInputStep(step, `${label} step ${stepIndex + 1}`)
    ) as [PtyInputStep, ...PtyInputStep[]];
    return {
      waitFor: markers,
      ...(phase.captureAs === undefined ? {} : { captureAs: phase.captureAs }),
      steps,
    };
  });
}

/** Compile, capture, project, and report the one resulting artifact path. */
async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  const temp = await Deno.makeTempDir({ prefix: "discern-terminal-capture-" });
  const executable = join(
    temp,
    Deno.build.os === "windows" ? "discern.exe" : "discern",
  );
  try {
    await compileDiscernCaptureBinary(REPO_ROOT, executable);
    const input = options.script === undefined
      ? undefined
      : await readInputScript(options.script);
    const capture = await captureDiscernCommand({
      executable,
      name: options.name,
      args: options.args,
      cwd: options.cwd,
      geometry: TERMINAL_CAPTURE_GEOMETRIES[options.geometry],
      color: options.color,
      locale: options.locale,
      env: {
        DISCERN_DOCS_DIR: join(REPO_ROOT, "project", "map"),
        DISCERN_TEMPLATES_DIR: join(REPO_ROOT, "templates"),
      },
      ...(input === undefined ? {} : { input, static: false }),
    });
    await ensureDir(dirname(options.output));
    await Deno.writeTextFile(
      options.output,
      renderTerminalCaptureHtml(capture, {
        theme: options.theme,
        ...(options.keyframe === undefined
          ? {}
          : { keyframe: options.keyframe }),
      }),
    );
    console.log(terminalCaptureHandoff(options.output));
    if (capture.exitCode !== 0) Deno.exitCode = capture.exitCode;
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => undefined);
  }
}

if (import.meta.main) {
  await main(Deno.args);
}
