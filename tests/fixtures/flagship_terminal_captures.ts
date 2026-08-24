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
import { withTempDir } from "../temp_dir.ts";

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
  "[instructions]",
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

/** Replace measured durations and their load-sensitive display unit. */
const durations: TerminalCaptureNormalizer = {
  name: "durations",
  normalize: (output: string): string =>
    output.replace(
      /\b(in|after|waited|took) (<?\d+(?:\.\d+)?(?:ms|s|m|h))\b/gu,
      (_match: string, prefix: string): string => `${prefix} <0s`,
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

/** Strip per-line trailing padding so right-edge alignment cannot encode an
 * environment-variable width the earlier scalar normalizers preserved. */
const trailingWhitespace: TerminalCaptureNormalizer = {
  name: "trailing-whitespace",
  normalize: (output: string): string => output.replace(/[ \t]+$/gmu, ""),
};

/** Ordered, documented scalar normalizers applied at capture time. */
export const FLAGSHIP_CAPTURE_NORMALIZERS = [
  absolutePaths,
  timestamps,
  durations,
  versions,
  runtimePlatform,
  commitIdentifiers,
  trailingWhitespace,
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

/** One canonical fixture-root width for every platform. Temp roots differ per
 * OS (`/tmp` vs macOS's `/private/tmp`), and the narrator wraps and pads by
 * content width — so an unequal path length shifts layout between the
 * recording machine and CI replays. Renaming the root to one shared width
 * makes the rendered geometry platform-independent by construction, and the
 * width keeps the derived worktree path
 * (`<root>.worktrees/terminal-review`) inside the canonical 80-column
 * capture geometry. */
const FIXTURE_ROOT_WIDTH = 48;

/** Compute the canonical-width replacement path for one created fixture root. */
async function lengthNormalizedPath(created: string): Promise<string> {
  const canonical = await Deno.realPath(created);
  const parent = canonical.slice(0, canonical.lastIndexOf("/"));
  const suffix = canonical.slice(canonical.lastIndexOf("-") + 1);
  const stem = `${parent}/discern-tcf-${suffix}`;
  if (stem.length > FIXTURE_ROOT_WIDTH) {
    throw new Error(
      `fixture root ${stem} is wider than the shared ` +
        `${FIXTURE_ROOT_WIDTH}-column budget; raise FIXTURE_ROOT_WIDTH and ` +
        `re-record the flagship captures on every platform`,
    );
  }
  return stem + "x".repeat(FIXTURE_ROOT_WIDTH - stem.length);
}

/** Refuse a capture that still carries the fixture path: a wrapped or
 * style-interrupted occurrence dodges whole-string replacement and would
 * re-encode a machine path into the reviewed fixture. */
function assertNoResidualPath(
  name: string,
  screen: string,
  root: string,
): void {
  const flattened = screen
    .replaceAll(/\u001b\[[0-9;]*m/gu, "")
    .replaceAll(/\s+/gu, "");
  if (flattened.includes(root)) {
    throw new Error(
      `flagship capture '${name}' still contains the fixture path after ` +
        `normalization — a wrapped occurrence dodged the absolute-paths ` +
        `normalizer; adjust the scenario or the normalizer before recording`,
    );
  }
}

/** Capture every flagship from a fresh scenario; no command inherits prior proof. */
export async function captureFlagshipTerminalScreens(
  executable: string,
): Promise<Readonly<Record<string, TerminalCommandCapture>>> {
  return await withTempDir(async (main) => {
    const worktree = await createFixtureWorktree(main);
    const captures: Record<string, TerminalCommandCapture> = {};
    for (const command of FLAGSHIP_COMMANDS) {
      const capture = await captureDiscernCommand({
        executable,
        name: command.name,
        args: command.args,
        cwd: worktree,
        geometry: TERMINAL_CAPTURE_GEOMETRIES.canonical,
        color: true,
        env: { DISCERN_TEMPLATES_DIR: join(REPO_ROOT, "templates") },
        normalizers: FLAGSHIP_CAPTURE_NORMALIZERS,
      });
      assertNoResidualPath(command.name, capture.screen, main);
      captures[command.name] = capture;
    }
    return captures;
  }, {
    parent: "/tmp",
    prefix: "discern-terminal-fixture-",
    renamedPath: lengthNormalizedPath,
  });
}
