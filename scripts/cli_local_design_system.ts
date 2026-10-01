/**
 * Run discern's CLI surfaces against a local design-system checkout without
 * changing the committed exact JSR dependency.
 *
 * Every process a mode starts, including the test-queue wrapper, runs this
 * checkout's source under the same temporary linked config, so no step mixes
 * the published package with the local one. The helper itself supervises
 * under the committed pin and imports nothing that renders with the package.
 */

import { join } from "@std/path";
import {
  CLI_DESIGN_SYSTEM_EXPORTS,
  inheritedCommand,
  LOCAL_DESIGN_SYSTEM_SURFACES,
  REPO_ROOT,
  resolveDesignSystemCheckout,
  runLocalDesignSystemTool,
  withLocalDesignSystem,
} from "./local_design_system.ts";
import { toolOptionValue } from "./tool_arguments.ts";

/** What the helper can run against the linked package. */
export const CLI_DESIGN_SYSTEM_MODES = [
  "desk",
  "capture",
  "check",
  "test",
] as const;

export type CliDesignSystemMode = typeof CLI_DESIGN_SYSTEM_MODES[number];

/** One parsed invocation. */
export interface CliDesignSystemRequest {
  readonly checkout?: string;
  readonly mode: CliDesignSystemMode;
  /** The project `desk` opens; relative paths start at this checkout. */
  readonly project?: string;
  readonly operands: readonly string[];
  /** The gallery journeys `capture` runs; every journey when absent. */
  readonly only?: string;
}

/** One planned child: Deno arguments and an optional working directory. */
export interface CliDesignSystemCommand {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const MAIN = join(REPO_ROOT, "src/main.ts");

/**
 * The modules `check` type-checks when none are named: every CLI surface's
 * entry module, and every Desk module.
 */
export const DESK_CHECK_TARGETS = [
  ...LOCAL_DESIGN_SYSTEM_SURFACES.cli.entrypoints,
  "src/engine/desk/",
] as const;

const USAGE = `Run discern's CLI against a local design-system checkout

Usage:
  deno task cli:design-system [--checkout <path>] desk [--project <dir>] [-- <desk arguments>]
  deno task cli:design-system [--checkout <path>] capture [--only <journeys>] [<output directory>]
  deno task cli:design-system [--checkout <path>] check [<module>...]
  deno task cli:design-system [--checkout <path>] test <test file>...

desk     opens the Desk from this checkout's source in --project, a path
         relative to this checkout (default: this checkout)
capture  runs the Desk gallery (scripts/desk_capture.ts) through the test queue;
         --only names the journeys to run, comma-separated
check    type-checks the CLI entry and the Desk surfaces, or the named modules
test     runs the named test files through the test queue

The checkout defaults to the discern-design-system repository beside discern's
Git main checkout. Every child runs under one untracked Deno config that links
the checkout; deno.json and deno.lock stay unchanged.`;

/** Whether an operand names one of the helper's modes. */
function isMode(value: string): value is CliDesignSystemMode {
  return CLI_DESIGN_SYSTEM_MODES.some((mode) => mode === value);
}

/** Parse `[--checkout <path>] <mode> [mode arguments]`. */
export function parseCliDesignSystemArgs(
  args: readonly string[],
): CliDesignSystemRequest {
  let at = args[0] === "--" ? 1 : 0;
  let checkout: string | undefined;
  while (args[at] === "--checkout") {
    checkout = toolOptionValue(args, at);
    at += 2;
  }
  const mode = args[at] ?? "";
  if (!isMode(mode)) {
    throw new TypeError(
      `choose a mode (${CLI_DESIGN_SYSTEM_MODES.join(", ")}); got ${
        mode === "" ? "nothing" : JSON.stringify(mode)
      }`,
    );
  }
  let rest = args.slice(at + 1);
  let project: string | undefined;
  let only: string | undefined;
  if (mode === "capture") {
    while (rest[0] === "--only") {
      only = toolOptionValue(rest, 0);
      rest = rest.slice(2);
    }
  }
  if (mode === "desk") {
    while (rest[0] === "--project") {
      project = toolOptionValue(rest, 0);
      rest = rest.slice(2);
    }
    if (rest.length > 0 && rest[0] !== "--") {
      throw new TypeError("pass Desk arguments after --");
    }
    rest = rest.slice(1);
  } else if (rest.some((argument) => argument.startsWith("-"))) {
    throw new TypeError(`${mode} takes no options`);
  }
  if (mode === "capture" && rest.length > 1) {
    throw new TypeError("capture takes at most one output directory");
  }
  if (mode === "test" && rest.length === 0) {
    throw new TypeError("name the test files to run");
  }
  return {
    mode,
    operands: rest,
    ...(checkout === undefined ? {} : { checkout }),
    ...(project === undefined ? {} : { project }),
    ...(only === undefined ? {} : { only }),
  };
}

/** Wrap a child in this checkout's test queue, under the same config. */
function queued(
  config: string,
  deno: string,
  child: readonly string[],
): string[] {
  return ["run", "--config", config, "-A", MAIN, "queue", "--", deno, ...child];
}

/** Plan the one child a request runs; `config` is the temporary linked config. */
export function cliDesignSystemCommand(
  request: CliDesignSystemRequest,
  config: string,
  deno: string,
): CliDesignSystemCommand {
  switch (request.mode) {
    case "desk":
      return {
        args: [
          "run",
          "--config",
          config,
          "-A",
          MAIN,
          "desk",
          ...request.operands,
        ],
        ...(request.project === undefined ? {} : { cwd: request.project }),
      };
    case "capture":
      return {
        args: queued(config, deno, [
          "run",
          "--config",
          config,
          "-A",
          join(REPO_ROOT, "scripts/desk_capture.ts"),
          ...request.operands,
          "--config",
          config,
          ...(request.only === undefined ? [] : ["--only", request.only]),
        ]),
      };
    case "check":
      return {
        args: [
          "check",
          "--config",
          config,
          ...(request.operands.length > 0
            ? request.operands
            : DESK_CHECK_TARGETS.map((target) => join(REPO_ROOT, target))),
        ],
      };
    case "test":
      return {
        args: queued(config, deno, [
          "run",
          "--config",
          config,
          "-A",
          join(REPO_ROOT, "scripts/run_tests.ts"),
          "--config",
          config,
          ...request.operands,
        ]),
      };
  }
}

/** Link the checkout, run the planned child, and prove the pin is untouched. */
async function main(): Promise<number> {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const request = parseCliDesignSystemArgs(Deno.args);
  return await withLocalDesignSystem(
    await resolveDesignSystemCheckout(request.checkout),
    CLI_DESIGN_SYSTEM_EXPORTS,
    async (link) => {
      const command = cliDesignSystemCommand(
        request,
        link.configPath,
        Deno.execPath(),
      );
      return await inheritedCommand(
        command.args,
        command.cwd === undefined ? {} : { cwd: command.cwd },
      );
    },
  );
}

if (import.meta.main) {
  await runLocalDesignSystemTool("cli-design-system", main);
}
