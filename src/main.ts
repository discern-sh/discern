/**
 * `discern` — the CLI entrypoint.
 *
 * Wires the Cliffy command tree, threads the global result, interaction, colour,
 * and theme flags into ordinary subcommands, and maps each command's exit code
 * onto the process. Each subcommand's logic lives in `src/commands/*`; this file
 * is routing only.
 */

import { loadModule } from "./shared/module_loading.ts";
import { Command, ValidationError } from "@cliffy/command";
import { setColorEnabled as setStdColorEnabled } from "@std/fmt/colors";
import { DISCERN_VERSION, humanVersion } from "./lib/version.ts";
import { operatorHelp } from "./cli_help.ts";
import { Logger } from "./lib/log.ts";
import {
  emitResult,
  setResultMarkdownPresenterResolver,
  setResultMarkdownTerminalRenderer,
  setResultOutputFormat,
} from "./shared/emit.ts";
import { resultPresenterForVerb } from "./shared/result_contracts.ts";
import { observeVerbTarget } from "./shared/result_capture.ts";
import {
  AGENT_NAMES,
  DEFAULT_AGENTS,
  loadConfig,
} from "./shared/config_schema.ts";
import { DEFAULT_WORKTREE_BRANCH_PREFIX } from "./shared/git_conventions.ts";
import { SOURCE_PATHS } from "./shared/paths_registry.ts";
import { configFailureResult } from "./shared/config_failure.ts";
import { interactiveHintTexts } from "./shared/hints.ts";
import { findRoot } from "./shared/env.ts";
import { isKnownJob, knownJobList } from "./shared/capabilities.ts";
import {
  SETUP_UNFINISHED_MESSAGE,
  verbNeedsSetup,
} from "./shared/setup_state.ts";
import {
  normalizeVerbVariant,
  retiredCommandMessage,
  retiredCommandSuccessor,
} from "./shared/vocabulary.ts";
import {
  canInteract,
  setJsonMode,
  setPlainMode,
} from "./lib/terminal_interaction.ts";
import { inDeskSession } from "./engine/desk/session.ts";
import {
  attachEngineCommands,
  KNOWN_VERBS,
  reportUnknownOrSuggest,
  runConfigExplain,
  runConfigRead,
} from "./engine/dispatch.ts";
import {
  recordedExit,
  recordedRun,
  setOperationResultVerbResolver,
} from "./engine/logbook/cli.ts";
import { hiddenVerbNames } from "./shared/hidden_verbs.ts";
import {
  captureCrashReport,
  CRASH_EXIT_CODE,
  internalErrorResult,
  renderCrashFrame,
  writeCrashArtifact,
} from "./engine/crash.ts";
import { runCommandGroup } from "./shared/command_group.ts";
import { cliJsonResultVerb } from "./shared/result_contracts.ts";
import {
  DEFAULT_TERMINAL_THEME_MODE,
  isTerminalThemeMode,
  productionTerminalContext,
  setTerminalContext,
  TERMINAL_THEME_MODES,
  type TerminalContext,
  type TerminalThemeMode,
} from "./lib/terminal.ts";
import { renderMarkdown } from "./lib/markdown.ts";
import { writeStderr, writeStdout } from "./engine/output.ts";
import { detachPromise } from "./shared/promise_effects.ts";
import { SYSTEM_CLOCK } from "./shared/clock.ts";
import { EXIT_USAGE } from "./shared/exit_codes.ts";
import { withSetupResultNextAction } from "./shared/setup_next_action.ts";
import {
  CLI_RESULT_FORMATS,
  CLI_RESULT_RENDER,
  type ResultOutputFormat,
} from "./shared/result_formats.ts";
import {
  type CliCommand,
  cliCommandModel,
  type CliModelProvider,
} from "./shared/cli_reference_codegen.ts";

// The full built-in verb vocabulary (installer + engine) is defined once in the
// dispatcher and re-exported here as the CLI's
// `KNOWN_VERBS`, so the parity guard and existing importers keep this entry point.
export { KNOWN_VERBS };

/**
 * Resolve Cliffy's negatable `color` flag only. NO_COLOR and process facts are
 * already part of the shared terminal context, so command callbacks must not
 * re-read them.
 */
function noColorFrom(color: boolean | undefined): boolean {
  return color === false;
}

/**
 * Thread the one resolved terminal context to every surface that emits colour or
 * makes a theme-dependent layout choice:
 *  - package-backed Logger and engine output consume the installed context;
 *  - the `@std/fmt/colors` module-global remains synchronized for remaining
 *    consumers outside the package-backed 2C surfaces;
 *  - the engine's `colorEnabled()` reads the installed context.
 * Root help strips Cliffy's generated presentation unconditionally and renders
 * semantic headings through the package context; {@link operatorHelp} accepts the
 * `color` argument only as a compatibility override of that context.
 */
function applyColorMode(context: TerminalContext): void {
  const color = context.color;
  setTerminalContext(context);
  setStdColorEnabled(color);
}

/**
 * Store the resolved colour decision in every command's help-generator options.
 * Cliffy's generator forces the std colour toggle on for the duration of each
 * render (its `colors` option defaults to true) and beneath that consults only
 * `Deno.noColor` — which FORCE_COLOR flips even when NO_COLOR is set — so the
 * stored option is the one lever that makes `<verb> --help` and `help <verb>`
 * honour the resolved decision. An options-object `.help()` keeps the default
 * generator (no custom handler), so `operatorHelp`'s `getHelp()` cannot recurse.
 */
function applyHelpColorOption(root: Command, color: boolean): void {
  root.help({ colors: color });
  for (const sub of root.getCommands(true)) {
    applyHelpColorOption(sub, color);
  }
}

/**
 * Extract the global result-output and `--no-color` flags. They reach every command at
 * runtime via root's `globalOption`, but a standalone subcommand instance (the
 * `config` group) doesn't carry them in its inferred option type, so we read them
 * through a narrow cast.
 */
function globalFlags(options: unknown): { json: boolean; noColor: boolean } {
  const o = options as {
    json?: boolean;
    markdown?: boolean;
    render?: boolean;
    color?: boolean;
  };
  return {
    json: (o.json ?? false) || (o.markdown ?? false) || (o.render ?? false),
    noColor: noColorFrom(o.color),
  };
}

/** Validate one root theme value through the terminal boundary's vocabulary. */
function terminalThemeValue(value: string): TerminalThemeMode {
  if (isTerminalThemeMode(value)) return value;
  const modes = TERMINAL_THEME_MODES.map((mode) => `\`${mode}\``).join(", ");
  throw new ValidationError(`--theme accepts ${modes}.`);
}

/** Root-global flag spellings, shared by early routing and Cliffy registration. */
export const ROOT_GLOBAL_FLAGS = {
  json: CLI_RESULT_FORMATS.json.flag,
  markdown: CLI_RESULT_FORMATS.markdown.flag,
  render: CLI_RESULT_RENDER.flag,
  noColor: "--no-color",
  plain: "--plain",
  theme: "--theme",
} as const;

/** Root-global flag tokens available before the live command tree is built. */
export const ROOT_GLOBAL_FLAG_TOKENS: ReadonlySet<string> = new Set(
  Object.values(ROOT_GLOBAL_FLAGS),
);

/** Root-global flags whose following token is their required value. */
export const ROOT_GLOBAL_VALUE_FLAG_TOKENS: ReadonlySet<string> = new Set([
  ROOT_GLOBAL_FLAGS.theme,
]);

/** The CLI routes whose child arguments begin before Cliffy owns the tail. */
export const CLI_CHILD_BOUNDARIES = {
  queue: { kind: "delimiter", token: "--" },
  scripts: { kind: "after-argument" },
} as const;

let activeDiscernArgv: readonly string[] = Deno.args;

/** Result-output flags selected from one discern-owned argv. */
function requestedResultFlags(argv: readonly string[]): string[] {
  return [
    ROOT_GLOBAL_FLAGS.json,
    ROOT_GLOBAL_FLAGS.markdown,
    ROOT_GLOBAL_FLAGS.render,
  ].filter((flag) => argv.includes(flag));
}

/** Whether one discern-owned argv asks for a quiet result projection. */
function quietResultRequested(argv: readonly string[]): boolean {
  return requestedResultFlags(argv).length > 0;
}

/** Whether raw JSON or Markdown makes terminal theme sensing unnecessary. */
function serializedResultRequested(argv: readonly string[]): boolean {
  return argv.includes(ROOT_GLOBAL_FLAGS.json) ||
    argv.includes(ROOT_GLOBAL_FLAGS.markdown);
}

/** Preserve which quiet projection was requested before CLI normalization. */
function requestedResultFormat(): ResultOutputFormat | "render" | undefined {
  if (activeDiscernArgv.includes(ROOT_GLOBAL_FLAGS.render)) return "render";
  if (activeDiscernArgv.includes(ROOT_GLOBAL_FLAGS.markdown)) return "markdown";
  if (activeDiscernArgv.includes(ROOT_GLOBAL_FLAGS.json)) return "json";
  return undefined;
}

/** Emit the selected-format refusal for a bare root invocation. */
function emitRootResultRefusal(argv: readonly string[]): void {
  const flag = requestedResultFlags(argv)[0] ?? ROOT_GLOBAL_FLAGS.json;
  emitResult({
    ok: false,
    verb: "discern",
    error: "invalid_arguments",
    message:
      `discern ${flag} needs a command. Run \`discern --help\` to list the available commands.`,
  });
}

/** Turn a Cliffy-level `config set-job` parse failure into the supported syntax.
 * These failures occur before the command planner can serve its own correction. */
function setJobValidationMessage(
  argv: readonly string[],
  message: string,
): string {
  const config = argv.findIndex((token, index) =>
    token === "config" && argv[index + 1] === "set-job"
  );
  const candidate = config === -1 ? undefined : argv[config + 2];
  const name = candidate !== undefined && !candidate.startsWith("-")
    ? candidate
    : "<name>";
  const correction = isKnownJob(name)
    ? `discern config set-job ${name} --run '<command>' --run '<next-command>'`
    : `discern config set-job ${name} --stage check --run '<command>'`;
  const condition = message.replace(/[.\s]+$/, "");
  return `${condition}. Run \`${correction}\`.`;
}

/**
 * Serve the one natural positional `start` mistake with a copyable correction.
 * Parsing stays strict: only one name-shaped positional token, with no
 * `--name`, qualifies. Every other Cliffy validation error remains untouched.
 */
function startValidationMessage(
  argv: readonly string[],
  message: string,
): string | undefined {
  const start = argv.indexOf("start");
  if (
    start === -1 ||
    argv.some((token) => token === "--name" || token.startsWith("--name="))
  ) {
    return undefined;
  }
  const valueOptions = new Set(["--from", "--theme"]);
  const positionals: string[] = [];
  for (let index = start + 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (valueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    positionals.push(token);
  }
  const candidate = positionals.length === 1 ? positionals[0] : undefined;
  if (
    candidate === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate)
  ) {
    return undefined;
  }
  const condition = message.replace(/[.\s]+$/, "");
  return `${condition}. Run:\n\`discern start --name ${candidate}\``;
}

const SET_JOB_OPTION_TOKENS = new Set([
  "-h",
  "--help",
  "--json",
  "--markdown",
  "--render",
  "--no-color",
  "--plain",
  "--theme",
  "--stage",
  "--run",
  "--provides",
  "--not-applicable",
  "--applicable",
  "--dry-run",
]);

/** Preserve raw repeatable-option shape that Cliffy normalizes away. In
 * particular, `--run --json` otherwise becomes the literal command `--json`. */
function setJobRunArgv(argv: readonly string[]): {
  count: number;
  missingValue: boolean;
} {
  let count = 0;
  let missingValue = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--run") {
      count++;
      const value = argv[index + 1];
      if (
        value === undefined || value === "" || SET_JOB_OPTION_TOKENS.has(value)
      ) {
        missingValue = true;
      }
    } else if (token?.startsWith("--run=") === true) {
      count++;
      if (token === "--run=") missingValue = true;
    }
  }
  return { count, missingValue };
}

/**
 * The type of `buildCli`'s root command. Cliffy threads the six `globalOption`
 * declarations into the command's generics, so the concrete type is impractical
 * to write by hand. We name it from a type-only `declare` (no runtime value is
 * emitted) whose chain mirrors the real root built in `buildCli`.
 */
declare function rootShape(): ReturnType<
  ReturnType<
    ReturnType<
      ReturnType<
        ReturnType<
          ReturnType<
            Command<void, void, void, []>["globalOption"]
          >["globalOption"]
        >["globalOption"]
      >["globalOption"]
    >["globalOption"]
  >["globalOption"]
>;
type RootCommand = ReturnType<typeof rootShape>;

/** Project and terminate one Cliffy validation refusal at its parser boundary. */
function handleCliValidationError(error: Error, command: Command): void {
  if (!(error instanceof ValidationError)) {
    return;
  }
  const fullPath = command.getPath();
  const commandPath = fullPath === "discern"
    ? ""
    : fullPath.replace(/^discern\s+/, "");
  const resultVerb = cliJsonResultVerb(commandPath) ?? "discern";
  const startMessage = commandPath === "start"
    ? startValidationMessage(activeDiscernArgv, error.message)
    : undefined;
  const setupMessage = commandPath === "setup"
    ? `${
      error.message.replace(/[.\s]+$/, "")
    }. Setup is read-only; run \`discern setup begin --help\` for scaffold options.`
    : undefined;
  const message = commandPath === "config set-job"
    ? setJobValidationMessage(activeDiscernArgv, error.message)
    : setupMessage ?? startMessage ?? error.message;
  if (quietResultRequested(activeDiscernArgv)) {
    emitResult(withSetupResultNextAction({
      ok: false,
      verb: resultVerb,
      error: "invalid_arguments",
      message,
    }, `discern ${resultVerb} --help`));
  } else if (
    commandPath === "config set-job" || startMessage !== undefined ||
    setupMessage !== undefined
  ) {
    const log = new Logger({ json: false, noColor: false });
    if (startMessage !== undefined) {
      log.errorBlock(message);
    } else {
      log.error(message);
    }
  } else {
    return;
  }
  Deno.exit(error.exitCode);
}

/** Build the root command with its global flags and subcommands. Every verb is
 * attached unconditionally — the subsystems are all core (ADR 0101). Verbs the
 * operator help omits come from the hidden-verb registry
 * (`shared/hidden_verbs.ts`), applied at the end of the build; `bootstrapped`
 * selects which of its entries are in effect.
 *
 * A command description's first line is its summary: `discern --help` lists
 * that line alone, while the command's own `--help` and the generated CLI
 * reference show the whole description. Keep the summary short and put detail
 * after a line break. */
export function buildCli(
  bootstrapped: boolean,
  mainBranch?: string,
): RootCommand {
  const trunkName = mainBranch === undefined ? "" : ` (\`${mainBranch}\`)`;
  const root = new Command()
    .name("discern")
    .version(DISCERN_VERSION)
    .versionOption(
      "-V, --version",
      "Print the installed discern version.",
      () => writeStdout(`${humanVersion()}\n`),
    )
    .usage("<command> [options]")
    .description(
      "Give each task its own worktree, a separate checkout and branch, and " +
        "check its work with your project's gate, its full quality check, " +
        "before it lands. New here? `discern setup` explains the first step, " +
        "and `discern setup begin` starts setting discern up in this project.",
    )
    .example(
      "Orient yourself",
      "discern status",
    )
    .example(
      "Agent in the main checkout?",
      "discern start  →  (move into the worktree path it prints...)  →  discern status  →  (write and commit code...)  →  discern done  →  report ready for review",
    )
    .example(
      "Agent in a worktree?",
      "(write and commit code...)  →  discern done  →  report ready for review",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.json,
      CLI_RESULT_FORMATS.json.description,
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.markdown,
      CLI_RESULT_FORMATS.markdown.description,
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.render,
      CLI_RESULT_RENDER.description,
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.noColor,
      "Turn off color. discern also leaves color off when `NO_COLOR` is set to any non-empty value, when `TERM` is `dumb`, or when output isn't a terminal.",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.plain,
      "Turn off prompts, paging, the full-screen reader, and live progress, and print static output. discern also skips prompts in CI, with `--json`, `--markdown`, or `--render`, and when input or output isn't a terminal.",
    )
    .globalOption(
      `${ROOT_GLOBAL_FLAGS.theme} <theme:string>`,
      "Choose colors for a `light` or `dark` terminal, or `auto`. Default: `auto`, which asks an interactive terminal for its background color and assumes dark when it can't tell. `--no-color` and `NO_COLOR` skip that check.",
      {
        value: terminalThemeValue,
      },
    )
    .error(handleCliValidationError)
    .action(function (options): void {
      if (globalFlags(options).json) {
        emitRootResultRefusal(activeDiscernArgv);
        return;
      }
      // No subcommand: show the grouped, operator-oriented help.
      new Logger({ json: false, noColor: false }).line(
        operatorHelp(this as unknown as Command),
      );
    });

  const cliModel: CliModelProvider = () => cliCommandModel(root);

  // `setup` is the read-only welcome. `setup begin` exclusively owns the first
  // mutating step and every option that can shape it.
  const setupBegin = new Command()
    .description(
      "Set discern up in this project: add its files and settings, and print the setup brief for your agent. This is the first setup step that changes files.\n" +
        "A fresh setup starts on the trunk with no uncommitted changes to " +
        "tracked files. It works on a new `discern-setup` branch, commits " +
        "discern's own wiring, and records which discern version and model " +
        "ran it. Without `--confirmed` or `--config`, it writes nothing and " +
        "shows the consent checklist again. Partway through setup, it prints " +
        "the brief again; once setup is complete, it does nothing unless you " +
        "pass `--reseed`.",
    )
    .option(
      "--name <name:string>",
      "The project's display name, in any words. Default: the current folder's name.",
    )
    .option(
      "--slug <slug:string>",
      "A short id for the project, used in each worktree's site, database, and resource names: lowercase letters, digits, and dashes, starting with a letter or digit (`^[a-z0-9][a-z0-9-]*$`). Default: derived from the name.",
    )
    .option(
      "--branch-prefix <prefix:string>",
      `The prefix for task branch names. Default: \`${DEFAULT_WORKTREE_BRANCH_PREFIX}\`.`,
      {
        default: undefined,
      },
    )
    .option(
      "--brief <brief:string>",
      "What the project is, in your own words, or `@path` to read it from a file. discern saves it as the project brief.",
    )
    .option(
      "--agents <agents:string>",
      `Which coding agents to set up, separated by commas: ${
        AGENT_NAMES.join(", ")
      }. Default: the agents installed on this machine, or ${
        DEFAULT_AGENTS.join(" and ")
      } when none are found. An empty value sets up none.`,
    )
    .option(
      "--map <path:string>",
      `Where to keep the project map, the documentation your agents maintain, relative to the project root. Default: \`${SOURCE_PATHS.map.defaultPath}\`.`,
    )
    .option(
      "--config <file:string>",
      "Read the setup answers from a JSON file, or `-` for stdin, instead of from the conversation. The file can also fill `discern.toml` sections such as jobs and scopes; options you pass win over it.",
    )
    .option(
      "--model <model:string>",
      "The provider and model running setup, as you'd name them, or `unreported`. discern records it for support and can't verify it.",
    )
    .option("--dry-run", "Show the plan without writing anything.")
    .option(
      "--reseed",
      "Run setup again on a project that has it: add any missing starter files, without overwriting existing ones, and refresh discern's settings and generated files.",
    )
    .option(
      "--allow-dirty",
      "For CI and advanced use: set up on the current branch as it is, even with uncommitted changes. discern skips the `discern-setup` branch and its own commit and needs no `--confirmed`; you commit and merge yourself, since `discern setup accept` won't land it.",
    )
    .option(
      "--confirmed",
      "Record that the owner agreed to setup in this conversation. A fresh setup needs it unless you use `--config`; without it, discern writes nothing and shows the consent checklist again.",
    )
    .action(recordedExit("setup begin", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { beginOptsFrom, runSetupBegin } = await loadModule(() =>
        import(
          "./commands/setup.ts"
        )
      );
      return await runSetupBegin(beginOptsFrom(options, json, noColor));
    }));

  const setupVerify = new Command()
    .description(
      "Preview what setup will change, and the checklist to agree with the owner first. It changes nothing.\n" +
        "It reports what it finds, such as existing agent instructions and " +
        "the coding agents installed here, and where worktrees will go. Then " +
        "it prints the consent checklist your agent goes through with the " +
        "owner before anything is written.",
    )
    .action(recordedExit("setup verify", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupVerify } = await loadModule(() =>
        import("./commands/setup_verify.ts")
      );
      return await runSetupVerify({ json, noColor });
    }));

  const setupStep = new Command()
    .description(
      "Show one numbered step of the setup brief again, to refocus partway through setup. It changes nothing.",
    )
    .arguments("<n:number>")
    .action(recordedExit("setup step", async (options, n: number) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupStep } = await loadModule(() =>
        import("./commands/setup.ts")
      );
      return await runSetupStep(n, { json, noColor });
    }));

  const setupDone = new Command()
    .description(
      "Finish setup: run the gate on the committed setup, record its Proof and a summary of what was set up, and mark setup complete (`[meta].bootstrapped`).\n" +
        "Everything must be committed, with every setup placeholder filled " +
        "in. discern commits the completion, checks it in a temporary " +
        "worktree, and runs the full gate; if that fails, it removes its own " +
        "commit. Then `discern setup accept` lands the setup.",
    )
    .option(
      "--unproven",
      "Mark setup complete without the checks or Proof. `discern setup accept` then refuses to land it; running `discern setup done` again later proves it.",
    )
    .action(recordedExit("setup done", async (options) => {
      const { runSetupDone } = await loadModule(() =>
        import("./commands/setup.ts")
      );
      return await runSetupDone({
        json: globalFlags(options).json,
        unproven: options.unproven ?? false,
        cliModel,
      });
    }));

  const setupAccept = new Command()
    .description(
      `Land the proven setup branch on the trunk${trunkName}, then list the checks that confirm each coding agent can reach discern.\n` +
        "Run it from the `discern-setup` branch. If the trunk has moved, " +
        "discern merges it in and runs the gate again first. It records a " +
        "Proof note, switches you to the trunk, and deletes the setup branch. " +
        "It doesn't push.",
    )
    .option(
      "--dry-run",
      "Show the plan without changing anything. It still needs a valid Proof.",
    )
    .action(recordedExit("setup accept", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupAccept } = await loadModule(() =>
        import("./commands/setup_accept.ts")
      );
      return await runSetupAccept({
        json,
        noColor,
        dryRun: options.dryRun ?? false,
        cliModel,
      });
    }));

  const setup = new Command()
    .description(
      "Start here to set up discern: see what setup involves and which step comes next.\n" +
        "It changes nothing, and it works even outside a Git repository. Run " +
        "`discern setup begin` only once the owner is ready for discern to " +
        "add its files.",
    )
    .action(recordedExit("setup", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupWelcome } = await loadModule(() =>
        import("./commands/setup_welcome.ts")
      );
      return await runSetupWelcome({ json, noColor });
    }))
    .command("verify", setupVerify)
    .command("begin", setupBegin)
    .command("step", setupStep)
    .command("done", setupDone)
    .command("accept", setupAccept);
  root.command("setup", setup);

  root
    .command("upgrade")
    .description(
      "Bring this project up to date with the discern you have installed. " +
        "To bring the trunk into a task branch, use `discern update`; to " +
        "regenerate agent files only, use `discern refresh`.\n" +
        "It runs any pending config migrations and restores discern's " +
        "sections, keys, and comment banners in `discern.toml` without " +
        "touching your values. It updates discern's blocks in `.gitignore` " +
        "and `.gitattributes`, and refreshes agent files, skills, and " +
        "integrations. Run it from the project root. It never installs a " +
        "newer discern, uses no network, and doesn't commit.",
    )
    .option(
      "--dry-run",
      "Show the pending migrations and changes without writing anything.",
    )
    .option(
      "--check",
      "Check whether this project needs an upgrade, without writing anything or using the network. It exits non-zero when migrations are pending, when the project hasn't adopted this discern version, or when discern's parts of `discern.toml`, `.gitignore`, or `.gitattributes` are out of date.",
    )
    .option(
      "--allow-dirty",
      "Upgrade even when tracked files have uncommitted changes.",
    )
    .action(recordedExit("upgrade", async (options) => {
      const { runUpgrade } = await loadModule(() =>
        import("./commands/upgrade.ts")
      );
      return await runUpgrade({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        check: options.check ?? false,
        allowDirty: options.allowDirty ?? false,
      });
    }));

  root
    .command("uninstall")
    .description(
      "Remove discern's wiring from this project, and keep the files you wrote.\n" +
        "It removes the generated agent files, installed skills, agent " +
        "integrations, and discern's blocks and settings. Your " +
        "`discern.toml`, instruction source, map, own skills, project " +
        "scripts, and TODO list stay. It asks before removing anything. It " +
        "refuses while task worktrees " +
        "or their resources exist. It keeps local Git refs such as Proof " +
        "notes, doesn't remove the discern program, and doesn't commit.",
    )
    .option(
      "--dry-run",
      "Show what would be removed and kept, without changing anything.",
    )
    .option(
      "-y, --yes",
      "Skip the confirmation. Without an interactive terminal, in CI, or with `--plain`, `--json`, `--markdown`, or `--render`, uninstall needs it whenever there's something to remove.",
    )
    .action(recordedExit("uninstall", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runUninstall } = await loadModule(() =>
        import("./commands/uninstall.ts")
      );
      return await runUninstall({
        json,
        noColor,
        dryRun: options.dryRun ?? false,
        yes: options.yes ?? false,
      });
    }));

  root
    .command("doctor")
    .description(
      "Check that discern is installed correctly and that Git is set up safely for it.\n" +
        "It checks the config, jobs, generated groups, agent integrations, " +
        "skills, worktree resources, and logbook, and Git settings such as " +
        "commit identity and history retention. Then it lists the steps each " +
        "workflow command runs. It changes nothing, and exits 1 only when a " +
        "check fails.",
    )
    .option(
      "-v, --verbose",
      "Explain each step the workflow commands run. With `--json`, include those steps in the result.",
    )
    .action(recordedExit("doctor", async (options) => {
      const { runDoctor } = await loadModule(() =>
        import("./commands/doctor.ts")
      );
      return await runDoctor({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        verbose: options.verbose ?? false,
      });
    }));

  root
    .command("releases")
    .description(
      "Open discern's release notes in your browser, to see what's new and whether a newer discern is out.\n" +
        "discern itself makes no network request: the page compares your " +
        "version with the latest. The browser opens only from an interactive " +
        "terminal. Inside a project, discern records when you last looked, " +
        "for its reminder to check for releases.",
    )
    .option(
      "--dry-run",
      "Show the address it would open, without opening a browser or recording anything.",
    )
    .action(recordedExit("releases", async (options) => {
      const { runReleases } = await loadModule(() =>
        import("./commands/releases.ts")
      );
      return await runReleases({
        json: options.json ?? false,
        markdown: options.markdown ?? false,
        dryRun: options.dryRun ?? false,
      });
    }));

  root
    .command("licenses")
    .description(
      "Print discern's licenses and notices, and the notices for the third-party software built into it.",
    )
    .action(recordedExit("licenses", async (options) => {
      const { runLicenses } = await loadModule(() =>
        import("./commands/licenses.ts")
      );
      return runLicenses({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
      });
    }));

  // Out of the operator help — the hidden-verb registry records why and what
  // returns it to the listing.
  root
    .command("triangle")
    .description("A small mystery for those who find it.")
    .action(recordedExit("triangle", async (options) => {
      const { runTriangle } = await loadModule(() =>
        import("./commands/triangle.ts")
      );
      return await runTriangle({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        plain: options.plain ?? false,
      });
    }));

  root
    .command("map [target:string]")
    .description(
      "Browse your project's map, the documentation your agents keep about how the project works, or read one page by name.",
    )
    .option(
      "--raw",
      "Print a page's Markdown source instead of rendering it.",
    )
    .option(
      "--list",
      "Print a plain table of contents instead of opening the reader.",
    )
    .option(
      "--search <query:string>",
      "Search the map by describing a task or quoting exact text. Add a target to search one page or section.",
    )
    .option(
      "--pager",
      "Show each rendered page in your pager: `$PAGER`, or `less -R` when it's unset.",
    )
    .option(
      "--dir <path:string>",
      "Browse this folder instead of the project's map folder (`[map].dir`).",
    )
    .option(
      "--width <cols:number>",
      "Wrap rendered output at this many columns.",
    )
    .option(
      "--export <scope:string>",
      "Join pages into one Markdown document: `public` for published pages, `all` for every page, `select` to choose sections in a terminal (with `--output`), or a configured scope's name for the pages it matches.",
    )
    .option(
      "--output <path:string>",
      "Write the export to this file instead of stdout. The file can't be inside the map folder.",
    )
    .action(
      recordedExit("map", async (options, target?: string) => {
        if (target !== undefined && target !== "") {
          observeVerbTarget(target); // which page was read — a slug, never text
        }
        const { runMap } = await loadModule(() => import("./commands/docs.ts"));
        return await runMap({
          json: options.json ?? false,
          resultFormat: requestedResultFormat(),
          noColor: noColorFrom(options.color),
          raw: options.raw ?? false,
          list: options.list ?? false,
          pager: options.pager ?? false,
          dir: options.dir,
          width: options.width,
          target,
          search: options.search,
          export: options.export,
          output: options.output,
        });
      }),
    );

  // `docs` — browse discern's OWN bundled documentation (the config reference,
  // concepts, the gate/worktree/standard docs). Distinct from `map`, which serves
  // the project's tree. The doc set is fixed and bundled, so there is no
  // `--dir`; `--help`/`-h` (Cliffy usage) is a separate surface and coexists with
  // it. Mirrors `map`'s read flags (target, --list/--raw/--json/--pager/--width)
  // plus a public-only `--export`.
  root
    .command("docs [target:string]")
    .description(
      "Browse discern's manual, which comes with discern, or read one page by name.",
    )
    .option(
      "--raw",
      "Print a page's Markdown source instead of rendering it.",
    )
    .option(
      "--list",
      "Print a plain table of contents instead of opening the reader.",
    )
    .option(
      "--search <query:string>",
      "Search the manual by describing a task or quoting exact text. Add a target to search one page or section.",
    )
    .option(
      "--adr",
      "Browse discern's own architecture decision records. An installed discern doesn't include them, so it shows where to read them online.",
    )
    .option(
      "--pager",
      "Show each rendered page in your pager: `$PAGER`, or `less -R` when it's unset.",
    )
    .option(
      "--width <cols:number>",
      "Wrap rendered output at this many columns.",
    )
    .option(
      "--export <scope:string>",
      "Join the manual's pages into one Markdown document. `public` is the only scope.",
    )
    .option(
      "--output <path:string>",
      "Write the export to this file instead of stdout.",
    )
    .action(recordedExit("docs", async (options, target?: string) => {
      if (target !== undefined && target !== "") {
        observeVerbTarget(target); // which topic was looked up — a slug, never text
      }
      const { runDocs } = await loadModule(() => import("./commands/docs.ts"));
      return await runDocs({
        json: options.json ?? false,
        resultFormat: requestedResultFormat(),
        noColor: noColorFrom(options.color),
        raw: options.raw ?? false,
        list: options.list ?? false,
        adr: options.adr ?? false,
        pager: options.pager ?? false,
        width: options.width,
        target,
        search: options.search,
        export: options.export,
        output: options.output,
      });
    }));

  // `help` selects any nested node in the live command model. Quiet output is
  // intercepted in `main` so every JSON-flag placement returns that same node.
  root
    .command("help [...command:string]")
    .description(
      "Show help for discern, or for one command, such as `discern help worktree prune`.",
    )
    .action(recordedExit("help", async function (
      _options,
      ...command: string[]
    ): Promise<number> {
      if (command.length === 0) {
        new Logger({ json: false, noColor: false }).line(
          operatorHelp(root as unknown as Command),
        );
        return 0;
      }
      const sub = findRegisteredCommand(root as unknown as Command, command);
      if (sub !== undefined) {
        sub.showHelp();
        return 0;
      }
      const attempted = command.join(" ");
      const successor = retiredCommandSuccessor(attempted);
      if (successor !== undefined) {
        new Logger({ json: false, noColor: false }).error(
          retiredCommandMessage(attempted, successor),
        );
        return 1;
      }
      return await reportUnknownOrSuggest(attempted, cliModel, {
        json: false,
      });
    }));

  // `config` — programmatic, comment-preserving edits to an existing
  // discern.toml. Each subcommand is a standalone Command instance attached via
  // `.command(name, instance)` (the reliable Cliffy form for a command group).
  const setJob = new Command()
    .description(
      "Add or change a gate job: one of the commands the gate runs.\n" +
        `A known name (${knownJobList()}) has a fixed stage: give its command ` +
        "as the argument, or with `--run`, repeated for commands that run in " +
        "order. A custom name needs `--stage` and `--run`. For a known job " +
        "this project doesn't have, use `--not-applicable`.",
    )
    .arguments("<name:string> [command:string]")
    .option(
      "--stage <stage:string>",
      "Custom jobs only: the stage it runs in, `fix`, `build`, `check`, or `test`.",
    )
    .option(
      "--run <command:string>",
      "A command to run, as written. Repeat it for more commands; they run in order, each only if the previous one succeeded.",
      { collect: true },
    )
    .option(
      "--provides <label:string>",
      "Custom jobs only: a short label saying what the job provides.",
    )
    .option(
      "--timeout <seconds:string>",
      "Time limit for the job, in seconds; 0 means no limit. Default: `[gate].timeout`.",
    )
    .option(
      "--not-applicable",
      "Known jobs: record that this project has no such step, so setup doesn't count it as missing. The gate's jobs don't change.",
    )
    .option(
      "--applicable",
      "Known jobs: undo `--not-applicable`, so setup counts the job again.",
    )
    .option(
      "--inputs <value:string>",
      "A file pattern the job reads. Repeat it until every input is listed; discern can then reuse an earlier result while those files are unchanged.",
      { collect: true },
    )
    .option(
      "--needs <value:string>",
      "Another job, scope gate, or standard that must succeed first, such as `jobs.build`. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--artifacts <value:string>",
      "A file the job produces, which discern keeps for later steps to read. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--environment <value:string>",
      "An environment variable that affects the result; a changed value stops discern reusing an earlier result. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--toolchain <value:string>",
      "A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier result. Repeat it for each one.",
      { collect: true },
    )
    .option("--dry-run", "Show the edit without writing it.")
    .action(
      recordedExit(
        "config set-job",
        async (options, name: string, command?: string) => {
          const { runConfigSetJob } = await loadModule(() =>
            import("./commands/config.ts")
          );
          const flags = globalFlags(options);
          const runArgv = setJobRunArgv(activeDiscernArgv);
          return await runConfigSetJob(name, command, {
            ...flags,
            json: flags.json || quietResultRequested(activeDiscernArgv),
            dryRun: options.dryRun ?? false,
            stage: options.stage,
            run: options.run,
            runCount: runArgv.count,
            runMissingValue: runArgv.missingValue,
            provides: options.provides,
            timeout: options.timeout,
            inputs: options.inputs,
            needs: options.needs,
            artifacts: options.artifacts,
            environment: options.environment,
            toolchain: options.toolchain,
            notApplicable: options.notApplicable,
            applicable: options.applicable,
          });
        },
      ),
    );

  const setScope = new Command()
    .description(
      "Add or change a scope: a named region of the repository, defined by path patterns.\n" +
        "The patterns you give replace the scope's `paths`, and options you " +
        "leave out keep their current values.",
    )
    .arguments("<name:string> <globs...:string>")
    .option(
      "--neutral",
      "Mark changes here as not code, as for documentation: they trigger no scope gate, and this scope's own gate never runs.",
    )
    .option(
      "--preview <cmd:string>",
      "A read-only command your agent can run to preview changes here. discern suggests it but never runs it.",
    )
    .option(
      "--gate <cmd:string>",
      "A command `discern done` runs when a change touches this scope.",
    )
    .option(
      "--timeout <seconds:string>",
      "Time limit for the scope's gate command, in seconds; 0 means no limit.",
    )
    .option(
      "--inputs <value:string>",
      "A file pattern the scope's gate reads. Repeat it until every input is listed; discern can then reuse an earlier result while those files are unchanged.",
      { collect: true },
    )
    .option(
      "--needs <value:string>",
      "A job, scope gate, or standard that must succeed before the scope's gate, such as `jobs.build`. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--artifacts <value:string>",
      "A file the scope's gate produces, which discern keeps for later steps to read. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--environment <value:string>",
      "An environment variable that affects the result; a changed value stops discern reusing an earlier result. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--toolchain <value:string>",
      "A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier result. Repeat it for each one.",
      { collect: true },
    )
    .option("--dry-run", "Show the edit without writing it.")
    .action(recordedExit(
      "config set-scope",
      async (options, name: string, ...globs: string[]) => {
        const { runConfigSetScope } = await loadModule(() =>
          import("./commands/config.ts")
        );
        return await runConfigSetScope(name, globs, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          neutral: options.neutral ?? false,
          preview: options.preview,
          gate: options.gate,
          timeout: options.timeout,
          inputs: options.inputs,
          needs: options.needs,
          artifacts: options.artifacts,
          environment: options.environment,
          toolchain: options.toolchain,
        });
      },
    ));

  const setStandard = new Command()
    .description(
      "Add or change a standard: a limit on a measured number, such as test coverage, that the gate holds.\n" +
        "Give exactly one of `--run` or `--producer`.",
    )
    .arguments("<name:string>")
    .option(
      "--limit <n:string>",
      "The limit: a floor when `--direction` is `up`, a ceiling when it's `down`.",
      {
        required: true,
      },
    )
    .option(
      "--metric <name:string>",
      "The metric name the measurement prints. Default: the standard's name.",
    )
    .option(
      "--direction <dir:string>",
      "`up` when higher is better, `down` when lower is better.",
      {
        required: true,
      },
    )
    .option(
      "--run <cmd:string>",
      "The command that measures the metric and prints its `DISCERN_METRIC <metric> <number>` line.",
    )
    .option(
      "--producer <selector:string>",
      "Measure from an existing job, scope gate, or standard, such as `jobs.test`, instead of `--run`.",
    )
    .option(
      "--extract <cmd:string>",
      "A command that reads the metric from the producer's output, or from `--artifact`, on stdin.",
    )
    .option(
      "--artifact <path:string>",
      "A file the producer lists in its artifacts, passed to `--extract` on stdin.",
    )
    .option(
      "--per <metric-or-extent:string>",
      "Hold a rate: divide by another metric, or by a count discern takes itself: `files=<glob>`, `lines=<glob>`, `words=<glob>`, or `bytes=<glob>`.",
    )
    .option(
      "--scale <n:string>",
      "Multiply a `--per` rate into readable units: 1000 gives a rate per 1,000. Default: 1.",
    )
    .option(
      "--margin <n:string>",
      "Headroom `discern standards --pin` keeps when it tightens the limit. Default: 0.",
    )
    .option(
      "--timeout <seconds:string>",
      "Time limit for the measuring command, in seconds; 0 means no limit.",
    )
    .option(
      "--inputs <value:string>",
      "A file pattern the measurement reads. Repeat it until every input is listed; discern can then reuse an earlier measurement while those files are unchanged.",
      { collect: true },
    )
    .option(
      "--needs <value:string>",
      "A job, scope gate, or standard that must succeed before the measurement, such as `jobs.build`. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--artifacts <value:string>",
      "A file the measuring command produces, which discern keeps for `--extract` to read. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--environment <value:string>",
      "An environment variable that affects the result; a changed value stops discern reusing an earlier measurement. Repeat it for each one.",
      { collect: true },
    )
    .option(
      "--toolchain <value:string>",
      "A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier measurement. Repeat it for each one.",
      { collect: true },
    )
    .option("--dry-run", "Show the edit without writing it.")
    .action(
      recordedExit(
        "config set-standard",
        async (options, name: string) => {
          const { runConfigSetStandard } = await loadModule(() =>
            import(
              "./commands/config.ts"
            )
          );
          return await runConfigSetStandard(name, {
            ...globalFlags(options),
            dryRun: options.dryRun ?? false,
            limit: options.limit,
            metric: options.metric,
            direction: options.direction,
            run: options.run,
            producer: options.producer,
            extract: options.extract,
            artifact: options.artifact,
            per: options.per,
            scale: options.scale,
            margin: options.margin,
            timeout: options.timeout,
            inputs: options.inputs,
            needs: options.needs,
            artifacts: options.artifacts,
            environment: options.environment,
            toolchain: options.toolchain,
          });
        },
      ),
    );

  const setScalar = new Command()
    .description(
      "Set one key in `discern.toml`, named as `section.key`, including keys in named tables.\n" +
        "discern takes the value's type from the schema, and turns a single " +
        "value into a one-item list for a key that takes a list of strings. " +
        "It refuses sections, unknown keys, and retired names, and writes " +
        "nothing if the result would be invalid.",
    )
    .arguments("<key:string> <value:string>")
    .option(
      "--number",
      "Treat the value as a number, for a key that accepts more than one type.",
    )
    .option(
      "--bool",
      "Treat the value as true or false, for a key that accepts more than one type.",
    )
    .option(
      "--string",
      "Treat the value as text, for a key that accepts more than one type.",
    )
    .option("--dry-run", "Show the edit without writing it.")
    .action(recordedExit(
      "config set",
      async (options, key: string, value: string) => {
        const { runConfigSet } = await loadModule(() =>
          import("./commands/config.ts")
        );
        return await runConfigSet(key, value, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          number: options.number ?? false,
          bool: options.bool ?? false,
          string: options.string ?? false,
        });
      },
    ));

  // Read-side config surface — what a project script uses to read scalar,
  // array, and membership values out of discern.toml.
  const configGet = new Command()
    .description(
      "Print one value as it's written in `discern.toml`, such as `repository.trunk`. It fails for a key the file doesn't set; use `discern config has` to check first.",
    )
    .arguments("<key:string>")
    .action(
      recordedExit(
        "config get",
        async (o, key: string) =>
          await runConfigRead("get", key, { json: globalFlags(o).json }),
      ),
    );
  const configArray = new Command()
    .description(
      "Print a list value from `discern.toml`, one item per line.",
    )
    .arguments("<key:string>")
    .action(
      recordedExit(
        "config array",
        async (o, key: string) =>
          await runConfigRead("array", key, { json: globalFlags(o).json }),
      ),
    );
  const configHas = new Command()
    .description(
      "Check whether `discern.toml` sets a key or section. On its own, it prints nothing and exits 0 if it does, 1 if not. With `--json`, it reports the answer in `data.present` and exits 0.",
    )
    .arguments("<key:string>")
    .action(
      recordedExit(
        "config has",
        async (o, key: string) =>
          await runConfigRead("has", key, { json: globalFlags(o).json }),
      ),
    );
  const configSubsections = new Command()
    .description(
      "Print the names of the tables directly under a section, such as each named table under `standards`.",
    )
    .arguments("<key:string>")
    .action(
      recordedExit(
        "config subsections",
        async (o, key: string) =>
          await runConfigRead("subsections", key, {
            json: globalFlags(o).json,
          }),
      ),
    );
  const configKeys = new Command()
    .description(
      "Print the names of the keys a section sets, without its nested tables.",
    )
    .arguments("<key:string>")
    .action(
      recordedExit(
        "config keys",
        async (o, key: string) =>
          await runConfigRead("keys", key, { json: globalFlags(o).json }),
      ),
    );
  const configExplain = new Command()
    .description(
      "Explain a section, a family of named tables, or one key of `discern.toml`: what it controls, why it matters, its keys and defaults, your current value, and examples. It works outside a project too.",
    )
    .arguments("<path:string>")
    .action(
      recordedExit(
        "config explain",
        async (o, path: string) =>
          await runConfigExplain(path, { json: globalFlags(o).json }),
      ),
    );

  const config = new Command()
    .description(
      "Read, explain, and edit `discern.toml`, keeping its comments.\n" +
        "`set-job`, `set-scope`, and `set-standard` edit those tables; `set " +
        "<section.key>` edits other keys, such as generated groups, " +
        "checkpoints, and resources. discern checks each edit against the " +
        "schema, writes nothing if the result would be invalid, and never " +
        "commits. Run edits from the project root.",
    )
    .action(recordedExit("config", function (
      this: Command,
      options,
    ): number {
      return runCommandGroup(this, "config", globalFlags(options).json);
    }))
    .command("set-job", setJob)
    .command("set-scope", setScope)
    .command("set-standard", setStandard)
    .command("set", setScalar)
    .command("get", configGet)
    .command("array", configArray)
    .command("has", configHas)
    .command("subsections", configSubsections)
    .command("keys", configKeys)
    .command("explain", configExplain);

  root.command("config", config);

  // The project task-runner verbs (finish, prepare, accept, worktree command group, …) are
  // first-class `discern` subcommands. The cast drops
  // the threaded global-option generics (which the engine actions don't read) —
  // Cliffy's generic Command type is impractical to spell at this boundary.
  attachEngineCommands(root as unknown as Command, cliModel, mainBranch);

  // A verb leaves the help listing only through the hidden-verb registry —
  // hiding is a recorded product decision, never an inline flourish. Applied
  // to the REGISTERED commands (the instance form of `.command()` re-parents,
  // so hiding a pre-registration instance wouldn't take); hidden verbs stay
  // dispatchable. The guard test holds the live hidden set equal to the
  // registry in both bootstrap states.
  for (const name of hiddenVerbNames(bootstrapped)) {
    (root as unknown as Command).getCommand(name, true)?.hidden();
  }

  return root;
}

/**
 * Every command path in `tree` that registers a `--dry-run` option, as
 * space-joined paths ("worktree drop"), sorted. Walks the BUILT command tree —
 * hidden commands and options included — so the set is derived from the real
 * registrations, never a hand-kept list.
 */
export function dryRunCapablePaths(tree: Command): string[] {
  const walk = (cmd: Command, prefix: string): string[] => {
    const self = cmd.getOptions(true).some((o) => o.name === "dry-run")
      ? [prefix]
      : [];
    return [
      ...self,
      ...cmd.getCommands(true).flatMap((sub) =>
        walk(sub, prefix === "" ? sub.getName() : `${prefix} ${sub.getName()}`)
      ),
    ];
  };
  return walk(tree, "").sort();
}

/**
 * The measured CLI surface that currently registers `--dry-run`. Preview
 * policy belongs to `OPERATION_EFFECTS`; the operation-effect parity guard
 * holds this live surface equal to its `preview: "required"` members.
 */
export function dryRunCapableVerbs(): readonly string[] {
  return dryRunCapablePaths(buildCli(false) as unknown as Command);
}

/** The cwd project's resolved CLI state: whether we are inside a project at all,
 * whether its config parsed, and whether it recorded `[meta].bootstrapped`. */
interface ProjectState {
  inProject: boolean;
  /** False when the config could not be parsed (so the nudge is suppressed and the
   * real ConfigParseError surfaces on its own, unobscured). */
  configOk: boolean;
  bootstrapped: boolean;
  /** The configured trunk's branch name, available when config parsed. */
  mainBranch?: string;
}

/**
 * Resolve the CLI state for the project the cwd is in, with a single config read.
 * When not inside a project, `bootstrapped`/`inProject` are false (so the setup
 * nudge and self-hiding never fire outside a project). An unparseable config
 * degrades the same way (`configOk: false`) — never block the CLI, and never nudge
 * over the real TOML error, on a config the user is mid-edit on.
 */
async function resolveProjectState(): Promise<ProjectState> {
  const root = await findRoot();
  if (root === undefined) {
    return { inProject: false, configOk: true, bootstrapped: false };
  }
  try {
    const cfg = await loadConfig(root);
    return {
      inProject: true,
      configOk: true,
      bootstrapped: cfg.meta.bootstrapped,
      mainBranch: cfg.repository.trunk,
    };
  } catch {
    return { inProject: true, configOk: false, bootstrapped: false };
  }
}

/**
 * Whether a verbless `discern` (bare, or global flags alone) should print the
 * setup WELCOME rather than help.
 * In a project: whenever setup is still outstanding (the resume path). Not in a
 * project: always — including outside a git work tree. That last case was once
 * restricted "to avoid touching a stray dir", but the welcome writes nothing, so
 * there was never anything to avoid — while the cost was real: the no-git novice
 * (the user the curated first contact exists for) got raw CLI help at exactly the
 * moment the install message said "run discern". The welcome now leads the non-git
 * case with the `git init` step; explicit help stays one `--help` away.
 */
function shouldWelcomeBare(
  inProject: boolean,
  bootstrapped: boolean,
): boolean {
  return inProject ? !bootstrapped : true;
}

/** A parsed CLI invocation: the verb Cliffy will dispatch, and the argv left
 * for a non-Cliffy dispatch target (a project script) once that verb token is
 * removed — leading global flags preserved, in order. */
export interface CliInvocation {
  verb: string | undefined;
  argsWithoutVerb: string[];
}

/** Match one exact global flag or the equals form of a value-taking flag. */
function globalFlagToken(
  token: string,
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
): { readonly flag: string; readonly inlineValue: boolean } | undefined {
  if (globalFlags.has(token)) return { flag: token, inlineValue: false };
  const equals = token.indexOf("=");
  if (equals < 1) return undefined;
  const flag = token.slice(0, equals);
  return valueFlags.has(flag) ? { flag, inlineValue: true } : undefined;
}

/** Skip a run of root-global options, including their required values. */
function skipGlobalOptions(
  argv: readonly string[],
  start: number,
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
): number {
  let index = start;
  while (index < argv.length) {
    const matched = globalFlagToken(
      argv[index] ?? "",
      globalFlags,
      valueFlags,
    );
    if (matched === undefined) break;
    index += matched.inlineValue || !valueFlags.has(matched.flag) ? 1 : 2;
  }
  return Math.min(index, argv.length);
}

/** Return the last explicit value for one root-global option. */
function globalOptionValue(
  argv: readonly string[],
  flag: string,
): string | undefined {
  let value: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === flag) {
      value = argv[index + 1];
      index += 1;
    } else if (token?.startsWith(`${flag}=`) === true) {
      value = token.slice(flag.length + 1);
    }
  }
  return value;
}

/**
 * Return only the argv owned by discern's global interaction modes. A
 * delimiter-owned child starts after that token; a named Project Script starts
 * after its script name. The raw argv remains available to the child unchanged.
 */
export function discernOwnedArgv(
  argv: readonly string[],
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string> = ROOT_GLOBAL_VALUE_FLAG_TOKENS,
): string[] {
  const verbIndex = skipGlobalOptions(argv, 0, globalFlags, valueFlags);
  const rawVerb = argv[verbIndex];
  if (rawVerb === undefined) {
    return [...argv];
  }
  const verb = normalizeVerbVariant(rawVerb, KNOWN_VERBS);
  const boundary = CLI_CHILD_BOUNDARIES[
    verb as keyof typeof CLI_CHILD_BOUNDARIES
  ];
  if (boundary === undefined) {
    return [...argv];
  }
  if (boundary.kind === "delimiter") {
    const boundaryIndex = argv.indexOf(boundary.token, verbIndex + 1);
    return boundaryIndex === -1 ? [...argv] : [...argv.slice(0, boundaryIndex)];
  }
  const childNameIndex = skipGlobalOptions(
    argv,
    verbIndex + 1,
    globalFlags,
    valueFlags,
  );
  return childNameIndex >= argv.length
    ? [...argv]
    : [...argv.slice(0, childNameIndex + 1)];
}

/**
 * Resolve the verb a raw argv addresses the way Cliffy will: the FIRST token
 * that is not one of the root command's global flags. Cliffy accepts global
 * flags on either side of the subcommand (`discern --json map` ≡
 * `discern map --json`), so every pre-Cliffy routing decision — the setup
 * redirect (ADR 0036), the welcome/help split, and project script
 * dispatch — must key on this resolved verb, never on `argv[0]`, or a leading
 * flag smuggles the invocation past the router and straight into Cliffy.
 *
 * Known value-taking flags skip their following value or accept `--flag=value`.
 * An unknown leading flag stays the "verb" so Cliffy owns the error.
 */
export function resolveInvocation(
  argv: readonly string[],
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string> = ROOT_GLOBAL_VALUE_FLAG_TOKENS,
): CliInvocation {
  const i = skipGlobalOptions(argv, 0, globalFlags, valueFlags);
  const verb = argv[i];
  return {
    verb,
    argsWithoutVerb: verb === undefined
      ? [...argv]
      : [...argv.slice(0, i), ...argv.slice(i + 1)],
  };
}

/** Resolve a canonical nested command path from the typed live command model. */
export function findCliCommand(
  model: CliCommand,
  words: readonly string[],
  requireComplete = true,
): CliCommand | undefined {
  let current = model;
  let consumed = 0;
  for (const word of words) {
    const child = current.children.find((candidate) => {
      const name = candidate.path[candidate.path.length - 1];
      return name === word || candidate.aliases.includes(word);
    });
    if (child === undefined) break;
    current = child;
    consumed += 1;
  }
  if (requireComplete && consumed !== words.length) return undefined;
  return consumed === 0 && words.length > 0 ? undefined : current;
}

/** Resolve the same nested path against Cliffy's command objects for human help. */
function findRegisteredCommand(
  root: Command,
  words: readonly string[],
): Command | undefined {
  let current = root;
  for (const word of words) {
    const child = current.getCommand(word, true);
    if (child === undefined) return undefined;
    current = child;
  }
  return current;
}

/** Command-shaped words after removing root-global options and help flags. */
function helpWords(
  argv: readonly string[],
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
): { words: string[]; helpFlag: boolean } {
  const words: string[] = [];
  let helpFlag = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const global = globalFlagToken(token, globalFlags, valueFlags);
    if (global !== undefined) {
      if (!global.inlineValue && valueFlags.has(global.flag)) index += 1;
      continue;
    }
    if (token === "-h" || token === "--help") {
      helpFlag = true;
      continue;
    }
    words.push(token);
  }
  return { words, helpFlag };
}

/** Select the command node requested by any supported quiet help spelling. */
function quietHelpCommand(
  argv: readonly string[],
  model: CliCommand,
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
): { requested: boolean; command?: CliCommand } {
  const parsed = helpWords(argv, globalFlags, valueFlags);
  if (parsed.words[0] === "help") {
    const command = findCliCommand(model, parsed.words.slice(1));
    return command === undefined
      ? { requested: true }
      : { requested: true, command };
  }
  if (!parsed.helpFlag) return { requested: false };
  const command = findCliCommand(model, parsed.words, false);
  return command === undefined
    ? { requested: true }
    : { requested: true, command };
}

/** Select the published result discriminator that owns one attempted verb. */
function resultVerbForInvocation(verb: string | undefined): string {
  if (verb === undefined) return "discern";
  const canonicalVerb = normalizeVerbVariant(verb, KNOWN_VERBS);
  return cliJsonResultVerb(canonicalVerb) ?? "discern";
}

/** Whether this invocation may pay the one bounded terminal-background query. */
export function backgroundSensingRequested(
  argv: readonly string[],
): boolean {
  if (serializedResultRequested(argv)) return false;
  if (argv.includes(ROOT_GLOBAL_FLAGS.noColor)) return false;
  const invocation = resolveInvocation(
    argv,
    ROOT_GLOBAL_FLAG_TOKENS,
    ROOT_GLOBAL_VALUE_FLAG_TOKENS,
  );
  if (
    invocation.verb !== undefined &&
    normalizeVerbVariant(invocation.verb, KNOWN_VERBS) === "mcp"
  ) return false;

  const rawTheme = globalOptionValue(argv, ROOT_GLOBAL_FLAGS.theme);
  const hasThemeOption = argv.some((token) =>
    token === ROOT_GLOBAL_FLAGS.theme ||
    token.startsWith(`${ROOT_GLOBAL_FLAGS.theme}=`)
  );
  return !hasThemeOption || rawTheme === DEFAULT_TERMINAL_THEME_MODE;
}

/**
 * The root command's global flag tokens, read from the Cliffy registration
 * itself so {@link resolveInvocation}'s flag-skipping can never drift from
 * what Cliffy actually accepts before a subcommand. Value arity comes from
 * {@link globalValueFlagTokens}; `tests/engine_flag_first_test.ts` keeps both
 * derived sets aligned with the early router.
 */
export function globalFlagTokens(root: Command): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const option of root.getOptions(true)) {
    if (option.global === true) {
      for (const flag of option.flags) {
        tokens.add(flag);
      }
    }
  }
  return tokens;
}

/** Value-taking root-global flags, derived from the same Cliffy registration. */
export function globalValueFlagTokens(root: Command): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const option of root.getOptions(true)) {
    if (option.global === true && option.args.length > 0) {
      for (const flag of option.flags) tokens.add(flag);
    }
  }
  return tokens;
}

/**
 * Split a `scripts` invocation after {@link resolveInvocation} removed the verb.
 * Root-global flags that preceded the verb remain at the front and belong to
 * discern; the first non-global token is the script name, and every token after
 * that name belongs to the child unchanged.
 */
function splitScriptInvocation(
  argsWithoutVerb: readonly string[],
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string>,
): { name: string | undefined; args: string[] } {
  const i = skipGlobalOptions(
    argsWithoutVerb,
    0,
    globalFlags,
    valueFlags,
  );
  return {
    name: argsWithoutVerb[i],
    args: [...argsWithoutVerb.slice(i + 1)],
  };
}

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<number> {
  let argv = args;
  const discernArgv = discernOwnedArgv(
    argv,
    ROOT_GLOBAL_FLAG_TOKENS,
    ROOT_GLOBAL_VALUE_FLAG_TOKENS,
  );
  activeDiscernArgv = discernArgv;
  const jsonRequested = discernArgv.includes(ROOT_GLOBAL_FLAGS.json);
  const markdownRequested = discernArgv.includes(ROOT_GLOBAL_FLAGS.markdown);
  const renderRequested = discernArgv.includes(ROOT_GLOBAL_FLAGS.render);
  const resultFlags = requestedResultFlags(discernArgv);
  const quietResult = resultFlags.length > 0;
  const rawTheme = globalOptionValue(discernArgv, ROOT_GLOBAL_FLAGS.theme);
  const theme = isTerminalThemeMode(rawTheme)
    ? rawTheme
    : DEFAULT_TERMINAL_THEME_MODE;
  if (markdownRequested || renderRequested) {
    // Every command already treats its `json` option as the quiet result-path
    // switch. Normalize only discern-owned tokens to that internal switch;
    // `emitResult` still selects the authored Markdown path, and child arguments
    // after queue's delimiter or a Project Script name remain byte-for-byte
    // unchanged.
    argv = argv.map((token, index) =>
      index < discernArgv.length &&
        (token === ROOT_GLOBAL_FLAGS.markdown ||
          token === ROOT_GLOBAL_FLAGS.render)
        ? ROOT_GLOBAL_FLAGS.json
        : token
    );
  }
  // Resolve the attempted command before project-state loading so even an
  // early config refusal carries a registered result discriminator. Internal
  // helper dispatch below remains deliberately keyed on the raw first token.
  let verb = resolveInvocation(
    argv,
    ROOT_GLOBAL_FLAG_TOKENS,
    ROOT_GLOBAL_VALUE_FLAG_TOKENS,
  ).verb;

  try {
    // One global interaction decision feeds every input-capable surface. This
    // is set before helper/command dispatch so flag-first forms behave identically.
    setPlainMode(discernArgv.includes(ROOT_GLOBAL_FLAGS.plain));
    setOperationResultVerbResolver(cliJsonResultVerb);
    setResultMarkdownPresenterResolver(resultPresenterForVerb);
    setResultMarkdownTerminalRenderer(undefined);
    setResultOutputFormat(
      (markdownRequested || renderRequested) && !jsonRequested
        ? "markdown"
        : "json",
    );
    setJsonMode(quietResult);
    // Resolve the ONE colour decision up front (flag + NO_COLOR + isatty) and
    // thread it to every colour-emitting surface, so `--no-color` is honoured
    // uniformly — engine verbs, the installer Loggers, and the root help alike —
    // rather than each path re-deciding and dropping the flag (B32/B36). Done
    // before ordinary dispatch so every command's output obeys it too.
    const terminal = await productionTerminalContext({
      noColor: discernArgv.includes(ROOT_GLOBAL_FLAGS.noColor),
      theme,
      backgroundSensing: backgroundSensingRequested(discernArgv),
    });
    const color = terminal.color;
    applyColorMode(terminal);
    if (renderRequested && resultFlags.length === 1) {
      setResultMarkdownTerminalRenderer((markdown) =>
        renderMarkdown(markdown, {
          width: terminal.size.columns,
          color: terminal.color,
          terminal,
        })
      );
    }
    if (resultFlags.length > 1) {
      emitResult({
        ok: false,
        verb: "discern",
        error: "invalid_arguments",
        message:
          "`--json`, `--markdown`, and `--render` cannot be combined. Choose one output mode.",
      });
      return 1;
    }
    if (
      quietResult &&
      discernArgv.some((token) => token === "-V" || token === "--version")
    ) {
      emitResult({
        ok: false,
        verb: "discern",
        error: "invalid_arguments",
        message:
          "`--version` does not have a result-envelope form. Run `discern --version` by itself.",
      });
      return EXIT_USAGE;
    }

    // Resolve the project's setup state — one config read, so the setup
    // redirect and the hidden-verb registry know whether setup is still
    // outstanding.
    const { inProject, configOk, bootstrapped, mainBranch } =
      await resolveProjectState();
    const cli = buildCli(inProject && bootstrapped, mainBranch);
    applyHelpColorOption(cli as unknown as Command, color);

    // Cliffy accepts the global flags BEFORE the subcommand, so resolve the
    // verb the way Cliffy will — the first non-global-flag token — and key
    // every routing decision below on it. Keying on argv[0] would let
    // `discern --json map` slip past the setup redirect that catches
    // `discern map --json`.
    const globalTokens = globalFlagTokens(cli as unknown as Command);
    const globalValueTokens = globalValueFlagTokens(
      cli as unknown as Command,
    );
    const invocation = resolveInvocation(
      argv,
      globalTokens,
      globalValueTokens,
    );
    verb = invocation.verb;

    if (quietResult) {
      const selectedHelp = quietHelpCommand(
        argv,
        cliCommandModel(cli),
        globalTokens,
        globalValueTokens,
      );
      if (selectedHelp.requested) {
        if (selectedHelp.command === undefined) {
          emitResult({
            ok: false,
            verb: "help",
            error: "unknown_command",
            message:
              "That help path is not a registered discern command. Run `discern help --json` for the command tree.",
          });
          return 1;
        }
        emitResult({
          ok: true,
          verb: "help",
          data: { command: selectedHelp.command },
        });
        return 0;
      }
    }

    // No verb (bare `discern`, or global flags alone): pre-setup, this prints
    // the read-only WELCOME — the install message tells the user to "tell your
    // coding agent to run discern" (ADR 0036), and the welcome dual-addresses
    // both readers and funnels the agent into the staged handshake (ADR 0075).
    // It writes nothing, so it shows even in a non-git directory (leading with
    // the git-init step). Once the project is set up, an interactive terminal
    // gets the operator's desk — the bare invocation is its terminal surface
    // (ADR 0119); the shared `canInteract` policy additionally honors --plain and
    // CI, so pipes, harnesses, and quiet result modes fall through to static help.
    if (verb === undefined) {
      if (quietResult) {
        emitRootResultRefusal(discernArgv);
        return EXIT_USAGE;
      }
      if (shouldWelcomeBare(inProject, bootstrapped)) {
        const { runSetupWelcome } = await loadModule(() =>
          import(
            "./commands/setup_welcome.ts"
          )
        );
        return await runSetupWelcome({
          json: quietResult,
          noColor: !color,
        });
      }
      if (inProject && configOk && bootstrapped) {
        const json = quietResult;
        if (inDeskSession() || (!json && canInteract(false))) {
          const { runDesk } = await loadModule(() =>
            import("./engine/desk/desk.ts")
          );
          // The bare invocation IS the desk, so it records through the same
          // interceptor as `discern desk`: the session's begin/verb pair and
          // its delivered tip ids land in the logbook from either spelling.
          return await recordedRun(
            "desk",
            "cli",
            () => runDesk({ json, cliModel: () => cliCommandModel(cli) }),
          );
        }
      }
      new Logger({ json: false, noColor: false }).line(
        operatorHelp(cli as unknown as Command, { color }),
      );
      return 0;
    }

    if (verb === "--") {
      const message =
        "`--` is only valid after `discern queue`, where it separates discern from the child command.";
      if (quietResult) {
        emitResult({
          ok: false,
          verb: "discern",
          error: "invalid_arguments",
          message,
        });
      } else {
        new Logger({ json: false, noColor: false }).error(message);
      }
      return EXIT_USAGE;
    }

    // A retired spelling is not an alias: it refuses before unknown-command or
    // Cliffy dispatch and names the one canonical successor. JSON mode keeps the
    // same refusal in the uniform result envelope.
    const commandTokens = discernArgv.filter((token) =>
      !globalTokens.has(token)
    );
    const nestedCommand = commandTokens.slice(0, 2).join(" ");
    const retiredCommand = retiredCommandSuccessor(nestedCommand) !== undefined
      ? nestedCommand
      : verb;
    const successor = retiredCommandSuccessor(retiredCommand);
    if (successor !== undefined) {
      const message = retiredCommandMessage(retiredCommand, successor);
      if (quietResult) {
        emitResult({
          ok: false,
          verb: "discern",
          error: "renamed_command",
          message,
        });
      } else {
        new Logger({ json: false, noColor: false }).error(message);
      }
      return 1;
    }

    // Grammatical variants are forgiveness, not aliases: rewrite only the verb
    // token, then let every normal canonical routing decision run unchanged.
    const canonicalVerb = normalizeVerbVariant(verb, KNOWN_VERBS);
    if (canonicalVerb !== verb) {
      const index = argv.indexOf(verb);
      if (index !== -1) {
        argv = [...argv];
        argv[index] = canonicalVerb;
      }
      verb = canonicalVerb;
    }

    // Explicit help: the grouped Cliffy help.
    if (verb === "-h" || verb === "--help") {
      new Logger({ json: false, noColor: false }).line(
        operatorHelp(cli as unknown as Command, { color }),
      );
      return 0;
    }

    // `queue` is an exec-style boundary: parse only the required `--`, then
    // hand every following token to the child unchanged. Help stays with Cliffy;
    // every run and usage error bypasses the result protocol because the wrapped
    // command owns stdout, stderr, and its exit status. An unmarked run still
    // enters the logbook through queue's direct recording boundary.
    if (verb === "queue") {
      const { parseQueueInvocation, reportQueueUsageError, runQueue } =
        await loadModule(() => import("./engine/queue.ts"));
      const queued = parseQueueInvocation(
        invocation.argsWithoutVerb,
        globalTokens,
        globalValueTokens,
      );
      if (queued.kind === "error") {
        return reportQueueUsageError(queued.message);
      }
      if (queued.kind === "run") {
        return await runQueue(queued.command, queued.args);
      }
    }

    // Pre-setup hard redirect (ADR 0036): until the project records
    // `[meta].bootstrapped`, the setup-gated verbs refuse and point at setup —
    // running an empty gate would report a false "all-green", and `map` would
    // browse an empty tree. A clean funnel, not a generic block: `help` (discern's
    // own docs), status/doctor/config and the setup/plumbing verbs stay open, and a
    // parse-broken config still surfaces its own TOML error (the configOk guard).
    // It fires in --json too, as a structured `setup_unfinished` result, so an agent
    // consuming JSON learns to set up rather than misreading an empty pass.
    if (
      inProject && configOk && !bootstrapped && verbNeedsSetup(verb)
    ) {
      if (quietResult) {
        emitResult({
          ok: false,
          verb,
          error: "setup_unfinished",
          message: SETUP_UNFINISHED_MESSAGE,
        });
      } else {
        new Logger({ json: false, noColor: false }).error(
          SETUP_UNFINISHED_MESSAGE,
        );
      }
      return 1;
    }

    // Project scripts have one explicit namespace. Intercept before Cliffy so
    // everything after the name reaches the executable untouched; bare `scripts`
    // lists the directory. Only parent-level help stays with Cliffy.
    if (verb === "scripts") {
      const script = splitScriptInvocation(
        invocation.argsWithoutVerb,
        globalTokens,
        globalValueTokens,
      );
      if (script.name !== "-h" && script.name !== "--help") {
        // Pre-Cliffy dispatch still routes through the one recording point.
        const { runProjectScript } = await loadModule(() =>
          import(
            "./engine/project_scripts.ts"
          )
        );
        return await recordedRun(
          "scripts",
          "cli",
          async () =>
            await runProjectScript(script.name, script.args, {
              json: quietResult,
            }),
          { hasOperands: script.name !== undefined },
        );
      }
    }

    // An unknown top-level word never executes a project script. The suggestion
    // path may point at `discern scripts <name>`, preserving discoverability while
    // keeping the root command vocabulary closed.
    if (!verb.startsWith("-") && !KNOWN_VERBS.has(verb)) {
      const attempted = [
        verb,
        ...invocation.argsWithoutVerb.filter((token) =>
          !globalTokens.has(token) && !token.startsWith("-")
        ).slice(0, 1),
      ].join(" ");
      return await reportUnknownOrSuggest(
        attempted,
        () => cliCommandModel(cli),
        {
          json: quietResult,
        },
      );
    }

    await cli.parse(argv);
    return 0;
  } catch (err) {
    // An unparseable or schema-invalid discern.toml must read as a clean
    // diagnostic, not a raw stack trace — in both human and `--json` modes (a
    // CI/agent consuming JSON gets a structured error, not garbage). A syntax
    // error reads `invalid_toml`; a schema violation reads `invalid_config` and
    // carries the per-issue list. Anything else is a crash — a bug in discern
    // reaching the surface — and exits through the crash frame (ADR 0248).
    const resultVerb = resultVerbForInvocation(verb);
    const configFailure = configFailureResult(resultVerb, err);
    if (configFailure !== undefined) {
      if (quietResult) {
        // Route through the one envelope/chokepoint (ADR 0030) so even a
        // pre-verb config error is the uniform DiscernResult a consumer expects —
        // carrying the attempted verb, with the per-issue list under `data`.
        emitResult(configFailure);
      } else {
        new Logger({ json: false, noColor: false }).failure(
          configFailure.message ?? "discern.toml could not be loaded.",
          interactiveHintTexts(configFailure.hints),
        );
      }
      return 1;
    }
    return await exitWithCrashFrame(
      resultVerb,
      err,
      quietResult,
    );
  }
}

/** Re-entrancy latch for {@link exitWithCrashFrame}: a throw from inside the
 * crash path itself must exit rather than recurse through the last-resort
 * listeners. */
let crashFrameActive = false;

/** Terminate after a crash frame, including re-entrant crash handling. */
function terminateCrash(): never {
  Deno.exit(CRASH_EXIT_CODE);
}

/**
 * The crash exit — the one path every unexpected throw leaves the process
 * through: try to save the report, print the stderr frame, emit the uniform
 * `internal_error` envelope in `--json` mode, and exit
 * {@link CRASH_EXIT_CODE}. Expected failures (config errors, refusals, red
 * gates) never come here; they have their own structured exits above.
 */
async function exitWithCrashFrame(
  verb: string | undefined,
  err: unknown,
  json: boolean,
): Promise<never> {
  if (crashFrameActive) {
    terminateCrash();
  }
  crashFrameActive = true;
  const report = captureCrashReport(verb, err, SYSTEM_CLOCK.wallNow());
  let cwd = ".";
  try {
    cwd = Deno.cwd();
  } catch {
    // discern-best-effort: main-crash-cwd-fallback
    // A deleted working directory still gets a report, via the temp fallback.
  }
  const artifact = await writeCrashArtifact(cwd, report);
  if (json) {
    emitResult(internalErrorResult(report.verb, report, artifact));
  }
  writeStderr(`${renderCrashFrame(report, artifact)}\n`);
  terminateCrash();
}

/** Convert the top-level dispatcher's typed status into process state. */
async function runMainProcess(): Promise<never> {
  Deno.exit(await main(Deno.args));
}

if (import.meta.main) {
  // Last-resort crash handlers, registered only for the real binary (never for
  // tests importing `main`): a stray rejection or uncaught error outside
  // `main`'s own catch — a fire-and-forget promise, a listener throw — still
  // leaves a saved report and the frame instead of a raw runtime dump.
  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    detachPromise(
      "main-unhandled-rejection-crash",
      () =>
        exitWithCrashFrame(
          undefined,
          event.reason,
          quietResultRequested(activeDiscernArgv),
        ),
      () => terminateCrash(),
    );
  });
  globalThis.addEventListener("error", (event) => {
    event.preventDefault();
    detachPromise(
      "main-error-event-crash",
      () =>
        exitWithCrashFrame(
          undefined,
          event.error ?? event.message,
          quietResultRequested(activeDiscernArgv),
        ),
      () => terminateCrash(),
    );
  });
  await runMainProcess();
}
