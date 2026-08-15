/** Deterministic real-command scenarios for the four flagship terminal captures. */

import { fromFileUrl, join } from "@std/path";
import {
  addWorktree,
  git,
  gitInit,
  scaffoldEngine,
  writeConfig,
} from "../engine_helpers.ts";
import {
  captureDiscernCommand,
  type TerminalCaptureNormalizationContext,
  type TerminalCaptureNormalizer,
  type TerminalCommandCapture,
  TERMINAL_CAPTURE_GEOMETRIES,
} from "./terminal_command_capture.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Checked-in artifact directory shared by the generator and exact tests. */
export const FLAGSHIP_CAPTURE_DIRECTORY = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "terminal_captures",
);

/** The command order is significant: done records proof and therefore runs last. */
export const FLAGSHIP_COMMANDS = [
  { name: "status", args: ["status"] },
  { name: "doctor", args: ["doctor"] },
  { name: "help", args: ["--help"] },
  { name: "done", args: ["done"] },
] as const;

const FIXTURE_CONFIG = [
  "[project]",
  'name = "Terminal Capture"',
  'slug = "terminal-capture"',
  "logbook = false",
  "agents = []",
  "",
  "[repository]",
  'trunk = "main"',
  'branch_prefix = "agent/"',
  "",
  "[guidance]",
  "sources = []",
  "",
  "[jobs]",
  'format = "true"',
  'build = "true"',
  'lint = "true"',
  'typecheck = "true"',
  'test = "true"',
  'smoke = "true"',
  "",
].join("\n");

/** Replace absolute locations only where a renderer labels the scalar as a path. */
function fixedWidthPlaceholder(value: string, label: string): string {
  const token = `<${label}>`;
  return token.length >= value.length
    ? token.slice(0, value.length)
    : `${token}${" ".repeat(value.length - token.length)}`;
}

const absolutePaths: TerminalCaptureNormalizer = {
  name: "absolute-paths",
  normalize: (
    output: string,
    context: TerminalCaptureNormalizationContext,
  ): string =>
    output.replaceAll(
      context.cwd,
      fixedWidthPlaceholder(context.cwd, "PROJECT_PATH"),
    ).replace(
      /^(At: )(.*)$/gmu,
      (_match: string, prefix: string, path: string): string =>
        `${prefix}${fixedWidthPlaceholder(path, "PROJECT_PATH")}`,
    ),
};

/** Replace ISO and relative clock readings without touching surrounding prose. */
const timestamps: TerminalCaptureNormalizer = {
  name: "timestamps",
  normalize: (output: string): string =>
    output.replace(
        /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu,
        (value: string): string => value.replaceAll(/\d/gu, "0"),
      )
      .replace(
        /\b\d+(?:\.\d+)?(?:ms|s|m|h|d) ago\b/gu,
        (value: string): string => value.replaceAll(/\d/gu, "0"),
      ),
};

/** Replace measured durations only after narration words that identify a timing. */
const durations: TerminalCaptureNormalizer = {
  name: "durations",
  normalize: (output: string): string =>
    output.replace(
      /\b(in|after|waited|took) (<?\d+(?:\.\d+)?(?:ms|s|m|h))\b/gu,
      (_match: string, prefix: string, value: string): string =>
        `${prefix} ${value.replaceAll(/\d/gu, "0")}`,
    ),
};

/** Replace semantic versions, including tool versions reported by doctor. */
const versions: TerminalCaptureNormalizer = {
  name: "version-strings",
  normalize: (output: string): string =>
    output.replace(
      /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/gu,
      (value: string): string => {
        const prefix = value.startsWith("v") ? "v" : "";
        return prefix + value.slice(prefix.length).replaceAll(/\d/gu, "0")
          .replaceAll(/[A-Za-z]/gu, "x");
      },
    ),
};

/** Collapse OS/architecture and Git build suffixes on doctor's environment rows. */
const runtimePlatform: TerminalCaptureNormalizer = {
  name: "runtime-platform",
  normalize: (output: string): string =>
    output
      .replace(
        /^(discern \S+ · ).*( · git \S+).*$/gmu,
        "$1<PLATFORM>$2",
      )
      .replace(/( git: )(\S+).*$/gmu, "$1$2"),
};

/** Replace content-derived Git object names while retaining their field labels. */
const commitIdentifiers: TerminalCaptureNormalizer = {
  name: "commit-identifiers",
  normalize: (output: string): string =>
    output.replace(
      /\b[0-9a-f]{12,40}\b/gu,
      (value: string): string => value.replaceAll(/[0-9a-f]/gu, "0"),
    ),
};

/** Ordered, documented scalar normalizers applied at capture time. */
export const FLAGSHIP_CAPTURE_NORMALIZERS = [
  absolutePaths,
  timestamps,
  durations,
  versions,
  runtimePlatform,
  commitIdentifiers,
] as const satisfies readonly TerminalCaptureNormalizer[];

/** Apply the flagship policy directly for focused normalizer coverage. */
export function normalizeFlagshipTerminalOutput(
  output: string,
  context: TerminalCaptureNormalizationContext,
): string {
  return FLAGSHIP_CAPTURE_NORMALIZERS.reduce(
    (current, normalizer) => normalizer.normalize(current, context),
    output,
  );
}

/** Create one clean committed worktree with the deterministic six-job Gate. */
async function createFixtureWorktree(main: string): Promise<string> {
  await scaffoldEngine(main, { agents: [] });
  await writeConfig(main, FIXTURE_CONFIG);
  await gitInit(main);
  await git(main, "config", "extensions.worktreeConfig", "true");
  const worktree = await addWorktree(main, "terminal-review");
  await Deno.writeTextFile(join(worktree, "visible-change.txt"), "visible\n");
  await git(worktree, "add", "-A");
  await git(
    worktree,
    "commit",
    "-q",
    "-m",
    "Add visible change",
    "--no-gpg-sign",
  );
  return worktree;
}

/** Capture every flagship from a fresh scenario; no command inherits prior proof. */
export async function captureFlagshipTerminalScreens(
  executable: string,
): Promise<Readonly<Record<string, TerminalCommandCapture>>> {
  const main = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "discern-terminal-fixture-",
  });
  const worktreeRoot = `${main}.worktrees`;
  try {
    const worktree = await createFixtureWorktree(main);
    const captures: Record<string, TerminalCommandCapture> = {};
    for (const command of FLAGSHIP_COMMANDS) {
      captures[command.name] = await captureDiscernCommand({
        executable,
        name: command.name,
        args: command.args,
        cwd: worktree,
        geometry: TERMINAL_CAPTURE_GEOMETRIES.canonical,
        color: true,
        env: { DISCERN_TEMPLATES_DIR: join(REPO_ROOT, "templates") },
        normalizers: FLAGSHIP_CAPTURE_NORMALIZERS,
      });
    }
    return captures;
  } finally {
    await Deno.remove(worktreeRoot, { recursive: true }).catch(() => undefined);
    await Deno.remove(main, { recursive: true }).catch(() => undefined);
  }
}
