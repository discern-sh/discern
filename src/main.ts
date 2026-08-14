/**
 * `discern` — the CLI entrypoint.
 *
 * Wires the Cliffy command tree, threads the global flags (`--json`, `--markdown`,
 * `--no-color`, `--help`, `--version`) into ordinary subcommands, and maps
 * each command's exit code onto the process. Each subcommand's logic lives in
 * `src/commands/*`; this file is routing only.
 */

import { Command, ValidationError } from "@cliffy/command";
import { setColorEnabled as setStdColorEnabled } from "@std/fmt/colors";
import { KIT_VERSION } from "./lib/version.ts";
import { operatorHelp } from "./cli_help.ts";
import { Logger } from "./lib/log.ts";
import {
  emitResult,
  setResultMarkdownRenderer,
  setResultOutputFormat,
} from "./shared/emit.ts";
import { resultPresenterForVerb } from "./shared/result_contracts.ts";
import { renderResultMarkdown } from "./shared/result_markdown.ts";
import { observeVerbTarget } from "./shared/result_capture.ts";
import {
  AGENT_NAMES,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
} from "./shared/config_schema.ts";
import { findRoot } from "./shared/env.ts";
import { knownJobList } from "./shared/capabilities.ts";
import { NOT_SET_UP_MESSAGE, verbNeedsSetup } from "./shared/setup_state.ts";
import {
  commandSynonymSuggestion,
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
  dispatchHelper,
  KNOWN_VERBS,
  reportUnknownCommand,
  reportUnknownOrSuggest,
  runConfigRead,
} from "./engine/dispatch.ts";
import { recordedExit, recordedRun } from "./engine/logbook/cli.ts";
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
  productionTerminalContext,
  setTerminalContext,
  type TerminalContext,
} from "./lib/terminal.ts";

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
 * Thread the one resolved terminal context to every surface that emits colour:
 *  - package-backed Logger and engine output consume the installed context;
 *  - the `@std/fmt/colors` module-global remains synchronized for legacy
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
 * Extract the global result-format and `--no-color` flags. They reach every command at
 * runtime via root's `globalOption`, but a standalone subcommand instance (the
 * `config` group) doesn't carry them in its inferred option type, so we read them
 * through a narrow cast.
 */
function globalFlags(options: unknown): { json: boolean; noColor: boolean } {
  const o = options as {
    json?: boolean;
    markdown?: boolean;
    color?: boolean;
  };
  return {
    json: (o.json ?? false) || (o.markdown ?? false),
    noColor: noColorFrom(o.color),
  };
}

/** Root-global flag spellings, shared by early routing and Cliffy registration. */
export const ROOT_GLOBAL_FLAGS = {
  json: "--json",
  markdown: "--markdown",
  noColor: "--no-color",
  plain: "--plain",
} as const;

/** Root-global flag tokens available before the live command tree is built. */
export const ROOT_GLOBAL_FLAG_TOKENS: ReadonlySet<string> = new Set(
  Object.values(ROOT_GLOBAL_FLAGS),
);

/** The CLI routes whose child arguments begin before Cliffy owns the tail. */
export const CLI_CHILD_BOUNDARIES = {
  queue: { kind: "delimiter", token: "--" },
  scripts: { kind: "after-argument" },
} as const;

let activeDiscernArgv: readonly string[] = Deno.args;

/** Whether one discern-owned argv asks for either quiet result projection. */
function machineOutputRequested(argv: readonly string[]): boolean {
  return argv.includes(ROOT_GLOBAL_FLAGS.json) ||
    argv.includes(ROOT_GLOBAL_FLAGS.markdown);
}

/** Emit the machine-mode refusal for a bare root invocation. */
function emitRootMachineRefusal(argv: readonly string[]): void {
  const flag = argv.includes(ROOT_GLOBAL_FLAGS.markdown)
    ? ROOT_GLOBAL_FLAGS.markdown
    : ROOT_GLOBAL_FLAGS.json;
  emitResult({
    ok: false,
    verb: "discern",
    error: "invalid_arguments",
    message:
      `discern ${flag} needs a command. Run \`discern --help\` to list the available commands.`,
  });
}

/**
 * The type of `buildCli`'s root command. Cliffy threads the four `globalOption`
 * declarations into the command's generics, so the concrete type is impractical
 * to write by hand. We name it from a type-only `declare` (no runtime value is
 * emitted) whose chain mirrors the real root built in `buildCli`.
 */
declare function rootShape(): ReturnType<
  ReturnType<
    ReturnType<
      ReturnType<Command<void, void, void, []>["globalOption"]>["globalOption"]
    >["globalOption"]
  >["globalOption"]
>;
type RootCommand = ReturnType<typeof rootShape>;

/** Build the root command with its global flags and subcommands. Every verb is
 * attached unconditionally — the subsystems are all core (ADR 0101). Verbs the
 * operator help omits come from the hidden-verb registry
 * (`shared/hidden_verbs.ts`), applied at the end of the build; `bootstrapped`
 * selects which of its entries are in effect. */
export function buildCli(
  bootstrapped: boolean,
  mainBranch?: string,
): RootCommand {
  const trunkName = mainBranch === undefined ? "" : ` (\`${mainBranch}\`)`;
  const root = new Command()
    .name("discern")
    .version(KIT_VERSION)
    .usage("<command> [options]")
    .description(
      "Operate your project's quality gate (its full quality check) and Git " +
        "worktrees (a separate checkout and branch for each effort); `discern setup` " +
        "scaffolds the stack-neutral system the first time.",
    )
    .example(
      "Orient yourself",
      "discern status",
    )
    .example(
      "Agent in the main checkout?",
      "discern start  →  (move into provided worktree...)  →  discern status  →  (write code...)  →  discern done  →  report ready for review",
    )
    .example(
      "Agent in a worktree?",
      "(write code...)  →  discern done  →  report ready for review",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.json,
      "Emit machine-readable JSON instead of human output.",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.markdown,
      "Emit agent-readable Markdown instead of human output.",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.noColor,
      "Disable colour (also honours NO_COLOR and non-TTY output).",
    )
    .globalOption(
      ROOT_GLOBAL_FLAGS.plain,
      "Disable interactive input and paging; use static output. CI and non-terminal input imply this behavior.",
    )
    .error((error, command) => {
      if (
        !(error instanceof ValidationError) ||
        !machineOutputRequested(activeDiscernArgv)
      ) {
        return;
      }
      const fullPath = command.getPath();
      const commandPath = fullPath === "discern"
        ? ""
        : fullPath.replace(/^discern\s+/, "");
      const resultVerb = cliJsonResultVerb(commandPath) ??
        (commandPath === "" ? "discern" : commandPath);
      emitResult({
        ok: false,
        verb: resultVerb,
        error: "invalid_arguments",
        message: error.message,
      });
      Deno.exit(error.exitCode);
    })
    .action(function (options): void {
      if (globalFlags(options).json) {
        emitRootMachineRefusal(activeDiscernArgv);
        return;
      }
      // No subcommand: show the grouped, operator-oriented help.
      new Logger({ json: false, noColor: false }).line(
        operatorHelp(this as unknown as Command),
      );
    });

  // `setup` — the staged, zero-config project setup (ADR 0036, staged by ADR 0075).
  // A bare `discern setup` (no scaffold input) prints the read-only WELCOME; the
  // sub-verbs drive the handshake — `begin` (the first mutating step: scaffold +
  // brief) and `done` (prove + record). The declarative `--config`/flag path scaffolds
  // straight through `begin`, skipping the welcome (CI / presets). Bare `discern`
  // (pre-setup) routes to the welcome too (below). `begin` is canonical; the parent
  // mirrors its scaffold options so `discern setup --config …` still works, and both
  // map them through `beginOptsFrom`.
  const setupBegin = new Command()
    .description(
      "Scaffold discern, record provenance, and print the setup brief (the first mutating step).",
    )
    .option("--name <name:string>", "Project name (free text).")
    .option("--slug <slug:string>", "Project slug (^[a-z0-9][a-z0-9-]*$).")
    .option("--branch-prefix <prefix:string>", "Branch prefix for worktrees.", {
      default: undefined,
    })
    .option(
      "--source-globs <globs:string>",
      "Comma-separated primary source globs (e.g. 'src/**,app/**').",
    )
    .option(
      "--brief <brief:string>",
      "Free-text project description, or @path to read it from a file.",
    )
    .option(
      "--agents <agents:string>",
      `Comma-separated agent files to emit: ${AGENT_NAMES.join(", ")}.`,
    )
    .option(
      "--map <path:string>",
      "Project-relative directory for the project map — discern's agent-maintained documentation tree.",
    )
    .option(
      "--config <file:string>",
      "JSON answers file (or - for stdin) to scaffold declaratively.",
    )
    .option(
      "--model <model:string>",
      "The model you, the agent, are running as — recorded as setup provenance for support triage.",
    )
    .option(
      "-y, --yes",
      "Accepted for back-compat; setup is always non-interactive.",
      { hidden: true },
    )
    .option("--dry-run", "Print the plan and write nothing.")
    .option("--force", "Re-run even if already set up (re-scaffold + re-seed).")
    .option(
      "--allow-dirty",
      "Advanced/CI: set up on the current branch as-is, skipping the clean-tree check and the isolated discern-setup branch.",
    )
    .option(
      "--confirmed",
      "Attest you have held the setup consent conversation with your human — required for a fresh, non-declarative begin; its absence re-serves that conversation.",
    )
    .action(recordedExit("setup begin", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { beginOptsFrom, runSetupBegin } = await import(
        "./commands/setup.ts"
      );
      return await runSetupBegin(beginOptsFrom(options, json, noColor));
    }));

  const setupVerify = new Command()
    .description(
      "Preview what setup will do and the consent checklist to confirm with your human (read-only).",
    )
    .action(recordedExit("setup verify", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupVerify } = await import("./commands/setup_verify.ts");
      return await runSetupVerify({ json, noColor });
    }));

  const setupStep = new Command()
    .description(
      "Re-serve one numbered step of the setup brief (read-only; for a mid-setup re-focus).",
    )
    .arguments("<n:number>")
    .action(recordedExit("setup step", async (options, n: number) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupStep } = await import("./commands/setup.ts");
      return await runSetupStep(n, { json, noColor });
    }));

  const setupDone = new Command()
    .description("Validate setup and record [meta].bootstrapped.")
    .option("--force", "Record completion even if skeleton markers remain.")
    .action(recordedExit("setup done", async (options) => {
      const { runSetupDone } = await import("./commands/setup.ts");
      return await runSetupDone({
        json: globalFlags(options).json,
        force: options.force ?? false,
      });
    }));

  const setupAccept = new Command()
    .description(
      `Land the finished setup branch on the trunk${trunkName} — the shared landing branch.`,
    )
    .option("--dry-run", "Print the plan and change nothing.")
    .action(recordedExit("setup accept", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runSetupAccept } = await import("./commands/setup_accept.ts");
      return await runSetupAccept({
        json,
        noColor,
        dryRun: options.dryRun ?? false,
      });
    }));

  const setup = new Command()
    .description(
      "Set up discern here (run once; your coding agent does it for you).",
    )
    .option("--name <name:string>", "Project name (free text).")
    .option("--slug <slug:string>", "Project slug (^[a-z0-9][a-z0-9-]*$).")
    .option("--branch-prefix <prefix:string>", "Branch prefix for worktrees.", {
      default: undefined,
    })
    .option(
      "--source-globs <globs:string>",
      "Comma-separated primary source globs (e.g. 'src/**,app/**').",
    )
    .option(
      "--brief <brief:string>",
      "Free-text project description, or @path to read it from a file.",
    )
    .option(
      "--agents <agents:string>",
      `Comma-separated agent files to emit: ${AGENT_NAMES.join(", ")}.`,
    )
    .option(
      "--map <path:string>",
      "Project-relative directory for the project map — discern's agent-maintained documentation tree.",
    )
    .option(
      "--config <file:string>",
      "JSON answers file (or - for stdin) to scaffold declaratively.",
    )
    .option(
      "--model <model:string>",
      "The model you, the agent, are running as — recorded as setup provenance for support triage.",
    )
    .option(
      "-y, --yes",
      "Accepted for back-compat; setup is always non-interactive.",
      { hidden: true },
    )
    .option("--dry-run", "Print the plan and write nothing.")
    .option("--force", "Re-run even if already set up (re-scaffold + re-seed).")
    .option(
      "--allow-dirty",
      "Advanced/CI: set up on the current branch as-is, skipping the clean-tree check and the isolated discern-setup branch.",
    )
    .option(
      "--confirmed",
      "Attest you have held the setup consent conversation with your human — required for a fresh, non-declarative begin; its absence re-serves that conversation.",
    )
    .action(recordedExit("setup", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { beginOptsFrom, hasScaffoldIntent, runSetupBegin } = await import(
        "./commands/setup.ts"
      );
      // Bare `discern setup` → the read-only welcome; any scaffold/declarative input
      // (the CI/preset path) scaffolds straight through `begin` (ADR 0075).
      if (hasScaffoldIntent(options)) {
        return await runSetupBegin(beginOptsFrom(options, json, noColor));
      }
      const { runSetupWelcome } = await import("./commands/setup_welcome.ts");
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
      "Upgrade discern itself in this project: migrate its config and refresh bundled " +
        "skills and guidance. Use `discern update` for this branch; use `discern " +
        "refresh` for agent files alone.",
    )
    .option(
      "--dry-run",
      "Preview the pending migrations and skills refresh; write nothing.",
    )
    .option(
      "--check",
      "Report whether config-schema migrations are pending (exit non-zero if so); write nothing.",
    )
    .option(
      "--allow-dirty",
      "Upgrade even with uncommitted changes (skips the clean-tree check).",
    )
    .action(recordedExit("upgrade", async (options) => {
      const { runUpgrade } = await import("./commands/upgrade.ts");
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
      "Remove discern's wiring from this project (keeps your discern.toml, guidance, and map).",
    )
    .option(
      "--dry-run",
      "Preview what would be removed and kept; change nothing.",
    )
    .option("-y, --yes", "Skip the confirmation.")
    .action(recordedExit("uninstall", async (options) => {
      const { json, noColor } = globalFlags(options);
      const { runUninstall } = await import("./commands/uninstall.ts");
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
      "Check the install and Git safety settings, then print each verb's execution model.",
    )
    .option(
      "-v, --verbose",
      "Show the hint explaining each execution-model step (hidden by default).",
    )
    .action(recordedExit("doctor", async (options) => {
      const { runDoctor } = await import("./commands/doctor.ts");
      return await runDoctor({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        verbose: options.verbose ?? false,
      });
    }));

  root
    .command("licenses")
    .description(
      "Print discern's licenses and bundled third-party software notices.",
    )
    .action(recordedExit("licenses", async (options) => {
      const { runLicenses } = await import("./commands/licenses.ts");
      return runLicenses({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
      });
    }));

  // Out of the operator help — the hidden-verb registry records why and what
  // returns it to the listing.
  root
    .command("triangle")
    .description("Draw discern's mark as a triangle of triangles.")
    .action(recordedExit("triangle", async (options) => {
      const { runTriangle } = await import("./commands/triangle.ts");
      return await runTriangle({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        plain: options.plain ?? false,
      });
    }));

  // Out of the operator help — the hidden-verb registry records why and what
  // returns it to the listing.
  root
    .command("preset <name:string>")
    .description(
      "Overlay a reference preset from presets/<name>/ (ships none by default).",
    )
    .option("-y, --yes", "Non-interactive: skip confirmation.")
    .option("--dry-run", "Print the plan and write nothing.")
    .action(
      recordedExit(
        "preset",
        async (options, name: string) => {
          const { runPreset } = await import("./commands/preset.ts");
          return await runPreset(name, {
            json: options.json ?? false,
            noColor: noColorFrom(options.color),
            dryRun: options.dryRun ?? false,
            yes: options.yes ?? false,
          });
        },
      ),
    );

  root
    .command("map [target:string]")
    .description(
      "Browse and read the project map — its agent-maintained documentation tree.",
    )
    .option(
      "--raw",
      "Print a doc's pristine Markdown source instead of rendering it.",
    )
    .option(
      "--list",
      "Print a plain table of contents and exit without interaction.",
    )
    .option(
      "--search <query:string>",
      "Search the map with task language or exact text; use a target to narrow it.",
    )
    .option("--no-pager", "Don't page rendered output through $PAGER.")
    .option(
      "--dir <path:string>",
      "Map directory to browse (default: the project's [map].dir).",
    )
    .option("--width <cols:number>", "Wrap width for rendered output.")
    .option(
      "--export <scope:string>",
      "Concatenate Markdown: public, all, select, or a configured scope name.",
    )
    .option(
      "--output <path:string>",
      "Write an export to a file instead of stdout.",
    )
    .action(
      recordedExit("map", async (options, target?: string) => {
        if (target !== undefined && target !== "") {
          observeVerbTarget(target); // which page was read — a slug, never text
        }
        const { runMap } = await import("./commands/docs.ts");
        return await runMap({
          json: options.json ?? false,
          noColor: noColorFrom(options.color),
          raw: options.raw ?? false,
          list: options.list ?? false,
          // Cliffy maps `--no-pager` to a negatable `pager` boolean (like --no-color).
          noPager: options.pager === false,
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
  // it. Mirrors `map`'s read flags (target, --list/--raw/--json/--no-pager/--width)
  // plus a public-only `--export`.
  root
    .command("docs [target:string]")
    .description("Browse and read discern's own documentation.")
    .option(
      "--raw",
      "Print a doc's pristine Markdown source instead of rendering it.",
    )
    .option(
      "--list",
      "Print a plain table of contents and exit without interaction.",
    )
    .option(
      "--search <query:string>",
      "Search discern's docs with task language or exact text; use a target to narrow it.",
    )
    .option(
      "--adr",
      "Browse decision records in a source checkout, or show their public location.",
    )
    .option("--no-pager", "Don't page rendered output through $PAGER.")
    .option("--width <cols:number>", "Wrap width for rendered output.")
    .option(
      "--export <scope:string>",
      "Concatenate Markdown to stdout: public.",
    )
    .option(
      "--output <path:string>",
      "Write an export to a file instead of stdout.",
    )
    .action(recordedExit("docs", async (options, target?: string) => {
      if (target !== undefined && target !== "") {
        observeVerbTarget(target); // which topic was looked up — a slug, never text
      }
      const { runDocs } = await import("./commands/docs.ts");
      return await runDocs({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        raw: options.raw ?? false,
        list: options.list ?? false,
        adr: options.adr ?? false,
        noPager: options.pager === false,
        width: options.width,
        target,
        search: options.search,
        export: options.export,
        output: options.output,
      });
    }));

  // `help` is CLI reference, matching the conventional two spellings:
  // bare `discern help` mirrors `discern --help`, and `discern help <command>`
  // mirrors `discern <command> --help`. The bundled manual lives at `docs`.
  root
    .command("help [command:string]")
    .description("Show command-line help.")
    .action(recordedExit("help", function (
      _options,
      command?: string,
    ): number {
      if (command === undefined || command === "") {
        new Logger({ json: false, noColor: false }).line(
          operatorHelp(root as unknown as Command),
        );
        return 0;
      }
      const sub = root.getCommand(command, true);
      if (sub !== undefined && KNOWN_VERBS.has(command)) {
        sub.showHelp();
        return 0;
      }
      const successor = retiredCommandSuccessor(command);
      if (successor !== undefined) {
        new Logger({ json: false, noColor: false }).error(
          retiredCommandMessage(command, successor),
        );
        return 1;
      }
      reportUnknownCommand(
        command,
        commandSynonymSuggestion(command),
        { json: false },
      );
      return 1;
    }));

  // `config` — programmatic, comment-preserving edits to an existing
  // discern.toml. Each subcommand is a standalone Command instance attached via
  // `.command(name, instance)` (the reliable Cliffy form for a command group).
  const setJob = new Command()
    .description(
      `Set a declared gate job. Known names (${knownJobList()}) take a positional command and derive their stage; custom names take --stage and --run.`,
    )
    .arguments("<name:string> [command:string]")
    .option(
      "--stage <stage:string>",
      "Custom jobs only: when it runs (fix|build|check|test).",
    )
    .option("--run <cmd:string>", "Custom jobs only: the command to run.")
    .option("--provides <label:string>", "Custom jobs only: free-text label.")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(
      recordedExit(
        "config set-job",
        async (options, name: string, command?: string) => {
          const { runConfigSetJob } = await import("./commands/config.ts");
          return await runConfigSetJob(name, command, {
            ...globalFlags(options),
            dryRun: options.dryRun ?? false,
            stage: options.stage,
            run: options.run,
            provides: options.provides,
          });
        },
      ),
    );

  const setScope = new Command()
    .description(
      "Set a scope — a named region of the repository a change can touch.",
    )
    .arguments("<name:string> <globs...:string>")
    .option("--neutral", "Changes here need no gate.")
    .option("--previewable", "A person could see changes here.")
    .option("--gate <cmd:string>", "A command to run when this scope changed.")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(recordedExit(
      "config set-scope",
      async (options, name: string, ...globs: string[]) => {
        const { runConfigSetScope } = await import("./commands/config.ts");
        return await runConfigSetScope(name, globs, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          neutral: options.neutral ?? false,
          previewable: options.previewable ?? false,
          gate: options.gate,
        });
      },
    ));

  const setStandard = new Command()
    .description(
      "Set a quality standard — standards are numbers that can never get worse.",
    )
    .arguments("<name:string>")
    .option("--limit <n:string>", "The floor (up) or ceiling (down).", {
      required: true,
    })
    .option(
      "--metric <name:string>",
      "Metric name the run emits (default: <name>).",
    )
    .option("--direction <dir:string>", 'Either "up" or "down".', {
      required: true,
    })
    .option(
      "--run <cmd:string>",
      "The command that emits the metric line.",
      { required: true },
    )
    .option("--dry-run", "Print the edit and write nothing.")
    .action(
      recordedExit(
        "config set-standard",
        async (options, name: string) => {
          const { runConfigSetStandard } = await import(
            "./commands/config.ts"
          );
          return await runConfigSetStandard(name, {
            ...globalFlags(options),
            dryRun: options.dryRun ?? false,
            limit: options.limit,
            metric: options.metric,
            direction: options.direction,
            run: options.run,
          });
        },
      ),
    );

  const setScalar = new Command()
    .description(
      "Set a config key (section.key). The value's TOML type follows the schema; an array-of-strings key wraps a single value.",
    )
    .arguments("<key:string> <value:string>")
    .option("--number", "Treat the value as a number (union-typed keys only).")
    .option("--bool", "Treat the value as a boolean (union-typed keys only).")
    .option("--string", "Treat the value as a string (union-typed keys only).")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(recordedExit(
      "config set",
      async (options, key: string, value: string) => {
        const { runConfigSet } = await import("./commands/config.ts");
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
  const readJsonHelp =
    "Emit the read result as a JSON DiscernResult envelope on stdout.";
  const configGet = new Command()
    .description("Print a scalar config value.")
    .arguments("<key:string>")
    .option("--json", readJsonHelp)
    .action(
      recordedExit(
        "config get",
        async (o, key: string) =>
          await runConfigRead("get", key, { json: o.json ?? false }),
      ),
    );
  const configArray = new Command()
    .description("Print an array config value, one item per line.")
    .arguments("<key:string>")
    .option("--json", readJsonHelp)
    .action(
      recordedExit(
        "config array",
        async (o, key: string) =>
          await runConfigRead("array", key, { json: o.json ?? false }),
      ),
    );
  const configHas = new Command()
    .description(
      "Test whether a key or section exists. Bare: print nothing and exit 0/1. JSON: report `data.present` and exit 0.",
    )
    .arguments("<key:string>")
    .option("--json", readJsonHelp)
    .action(
      recordedExit(
        "config has",
        async (o, key: string) =>
          await runConfigRead("has", key, { json: o.json ?? false }),
      ),
    );
  const configSubsections = new Command()
    .description("Print the immediate child table names under a section.")
    .arguments("<key:string>")
    .option("--json", readJsonHelp)
    .action(
      recordedExit(
        "config subsections",
        async (o, key: string) =>
          await runConfigRead("subsections", key, { json: o.json ?? false }),
      ),
    );
  const configKeys = new Command()
    .description("Print the flat key names declared in a section.")
    .arguments("<key:string>")
    .option("--json", readJsonHelp)
    .action(
      recordedExit(
        "config keys",
        async (o, key: string) =>
          await runConfigRead("keys", key, { json: o.json ?? false }),
      ),
    );

  const config = new Command()
    .description(
      "Edit (set-*) or read (get/array/has/subsections/keys) discern.toml.",
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
    .command("keys", configKeys);

  root.command("config", config);

  // The project task-runner verbs (finish, prepare, accept, worktree command group, …) are
  // first-class `discern` subcommands. The cast drops
  // the threaded global-option generics (which the engine actions don't read) —
  // Cliffy's generic Command type is impractical to spell at this boundary.
  attachEngineCommands(root as unknown as Command, mainBranch);

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
 * The dry-run-capable verb class: every CLI command path whose registration
 * carries `--dry-run` — the effectful plan/apply verbs whose preview contract
 * (a dry run writes nothing; an apply performs nothing the plan never listed)
 * the class guard in `tests/engine_plan_parity_test.ts` holds per member. A
 * verb or command group that registers the flag enrols itself here.
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

/**
 * Return only the argv owned by discern's global interaction modes. A
 * delimiter-owned child starts after that token; a named Project Script starts
 * after its script name. The raw argv remains available to the child unchanged.
 */
export function discernOwnedArgv(
  argv: readonly string[],
  globalFlags: ReadonlySet<string>,
): string[] {
  let verbIndex = 0;
  while (globalFlags.has(argv[verbIndex] ?? "")) {
    verbIndex++;
  }
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
  let childNameIndex = verbIndex + 1;
  while (globalFlags.has(argv[childNameIndex] ?? "")) {
    childNameIndex++;
  }
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
 * Only KNOWN global flags are skipped: an unknown leading flag stays the
 * "verb" so it falls through to Cliffy, which owns the unknown-option error.
 */
export function resolveInvocation(
  argv: readonly string[],
  globalFlags: ReadonlySet<string>,
): CliInvocation {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined || !globalFlags.has(token)) {
      break;
    }
    i++;
  }
  const verb = argv[i];
  return {
    verb,
    argsWithoutVerb: verb === undefined
      ? [...argv]
      : [...argv.slice(0, i), ...argv.slice(i + 1)],
  };
}

/**
 * The root command's global flag tokens, read from the Cliffy registration
 * itself so {@link resolveInvocation}'s flag-skipping can never drift from
 * what Cliffy actually accepts before a subcommand. Every global flag must be
 * a valueless boolean — a value-taking one would need lookahead here, which
 * `tests/engine_flag_first_test.ts` enforces structurally.
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

/**
 * Split a `scripts` invocation after {@link resolveInvocation} removed the verb.
 * Root-global flags that preceded the verb remain at the front and belong to
 * discern; the first non-global token is the script name, and every token after
 * that name belongs to the child unchanged.
 */
function splitScriptInvocation(
  argsWithoutVerb: readonly string[],
  globalFlags: ReadonlySet<string>,
): { name: string | undefined; args: string[] } {
  let i = 0;
  while (
    i < argsWithoutVerb.length &&
    globalFlags.has(argsWithoutVerb[i] ?? "")
  ) {
    i++;
  }
  return {
    name: argsWithoutVerb[i],
    args: [...argsWithoutVerb.slice(i + 1)],
  };
}

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  let argv = args;
  const discernArgv = discernOwnedArgv(argv, ROOT_GLOBAL_FLAG_TOKENS);
  activeDiscernArgv = discernArgv;
  const jsonRequested = discernArgv.includes(ROOT_GLOBAL_FLAGS.json);
  const markdownRequested = discernArgv.includes(ROOT_GLOBAL_FLAGS.markdown);
  const machineOutput = jsonRequested || markdownRequested;
  if (markdownRequested) {
    // Every command already treats its `json` option as the quiet result-path
    // switch. Normalize only discern-owned tokens to that internal switch;
    // `emitResult` still selects Markdown, and child arguments after queue's
    // delimiter or a Project Script name remain byte-for-byte unchanged.
    argv = argv.map((token, index) =>
      index < discernArgv.length && token === ROOT_GLOBAL_FLAGS.markdown
        ? ROOT_GLOBAL_FLAGS.json
        : token
    );
  }
  // The raw first token — helper dispatch below is deliberately positional,
  // and it names the attempted verb in a pre-resolution config error.
  let verb = argv[0];

  try {
    // One global interaction decision feeds every input-capable surface. This
    // is set before helper/command dispatch so flag-first forms behave identically.
    setPlainMode(discernArgv.includes(ROOT_GLOBAL_FLAGS.plain));
    setResultMarkdownRenderer((result, resultVerb) =>
      renderResultMarkdown(result, resultPresenterForVerb(resultVerb))
    );
    setResultOutputFormat(
      markdownRequested && !jsonRequested ? "markdown" : "json",
    );
    setJsonMode(machineOutput);
    if (jsonRequested && markdownRequested) {
      emitResult({
        ok: false,
        verb: "discern",
        error: "invalid_arguments",
        message:
          "`--json` and `--markdown` cannot be combined. Choose one result format.",
      });
      Deno.exit(1);
      return;
    }
    // Resolve the ONE colour decision up front (flag + NO_COLOR + isatty) and
    // thread it to every colour-emitting surface, so `--no-color` is honoured
    // uniformly — engine verbs, the installer Loggers, and the root help alike —
    // rather than each path re-deciding and dropping the flag (B32/B36). Done
    // before helper dispatch so a helper's own output (`with-gotchas`' gotchas
    // hint) obeys it too.
    const terminal = productionTerminalContext({
      noColor: discernArgv.includes(ROOT_GLOBAL_FLAGS.noColor),
    });
    const color = terminal.color;
    applyColorMode(terminal);

    // Internal helper verbs (remove-worktree-safely, with-gotchas, …): handled
    // before Cliffy so a wrapped command's flags pass through raw. Keyed on the
    // FIRST token on purpose — helpers are internal plumbing always invoked
    // verb-first, and everything after the helper name must reach it untouched.
    if (verb !== undefined) {
      const helperCode = await dispatchHelper(verb, argv.slice(1));
      if (helperCode !== null) {
        Deno.exit(helperCode);
      }
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
    const invocation = resolveInvocation(argv, globalTokens);
    verb = invocation.verb;

    // No verb (bare `discern`, or global flags alone): pre-setup, this prints
    // the read-only WELCOME — the install message tells the user to "tell your
    // coding agent to run discern" (ADR 0036), and the welcome dual-addresses
    // both readers and funnels the agent into the staged handshake (ADR 0075).
    // It writes nothing, so it shows even in a non-git directory (leading with
    // the git-init step). Once the project is set up, an interactive terminal
    // gets the operator's desk — the bare invocation is the human's surface
    // (ADR 0119); the shared `canInteract` policy additionally honors --plain and
    // CI, so pipes, harnesses, and machine modes fall through to static help.
    if (verb === undefined) {
      if (machineOutput) {
        emitRootMachineRefusal(discernArgv);
        Deno.exit(1);
        return;
      }
      if (shouldWelcomeBare(inProject, bootstrapped)) {
        const { runSetupWelcome } = await import(
          "./commands/setup_welcome.ts"
        );
        Deno.exit(
          await runSetupWelcome({
            json: machineOutput,
            noColor: !color,
          }),
        );
      }
      if (inProject && configOk && bootstrapped) {
        const json = machineOutput;
        if (inDeskSession() || (!json && canInteract(false))) {
          const { runDesk } = await import("./engine/desk/desk.ts");
          // The bare invocation IS the desk, so it records through the same
          // interceptor as `discern desk`: the session's begin/verb pair and
          // its delivered tip ids land in the logbook from either spelling.
          Deno.exit(
            await recordedRun("desk", "cli", () => runDesk({ json })),
          );
        }
      }
      new Logger({ json: false, noColor: false }).line(
        operatorHelp(cli as unknown as Command, { color }),
      );
      Deno.exit(0);
      return;
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
      if (machineOutput) {
        emitResult({
          ok: false,
          verb: retiredCommand,
          error: "renamed_command",
          message,
        });
      } else {
        new Logger({ json: false, noColor: false }).error(message);
      }
      Deno.exit(1);
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
      Deno.exit(0);
    }

    // `queue` is an exec-style boundary: parse only the required `--`, then
    // hand every following token to the child unchanged. Help stays with Cliffy;
    // every run and usage error bypasses the result protocol because the wrapped
    // command owns stdout, stderr, and its exit status. An unmarked run still
    // enters the logbook through queue's direct recording boundary.
    if (verb === "queue") {
      const { parseQueueInvocation, reportQueueUsageError, runQueue } =
        await import("./engine/queue.ts");
      const queued = parseQueueInvocation(
        invocation.argsWithoutVerb,
        globalTokens,
      );
      if (queued.kind === "error") {
        Deno.exit(reportQueueUsageError(queued.message));
      }
      if (queued.kind === "run") {
        Deno.exit(await runQueue(queued.command, queued.args));
      }
    }

    // Pre-setup hard redirect (ADR 0036): until the project records
    // `[meta].bootstrapped`, the setup-gated verbs refuse and point at setup —
    // running an empty gate would report a false "all-green", and `map` would
    // browse an empty tree. A clean funnel, not a generic block: `help` (discern's
    // own docs), status/doctor/config and the setup/plumbing verbs stay open, and a
    // parse-broken config still surfaces its own TOML error (the configOk guard).
    // It fires in --json too, as a structured `not_set_up` result, so an agent
    // consuming JSON learns to set up rather than misreading an empty pass.
    if (
      inProject && configOk && !bootstrapped && verbNeedsSetup(verb)
    ) {
      if (machineOutput) {
        emitResult({
          ok: false,
          verb,
          error: "not_set_up",
          message: NOT_SET_UP_MESSAGE,
        });
      } else {
        new Logger({ json: false, noColor: false }).error(NOT_SET_UP_MESSAGE);
      }
      Deno.exit(1);
    }

    // Project scripts have one explicit namespace. Intercept before Cliffy so
    // everything after the name reaches the executable untouched; bare `scripts`
    // lists the directory. Only parent-level help stays with Cliffy.
    if (verb === "scripts") {
      const script = splitScriptInvocation(
        invocation.argsWithoutVerb,
        globalTokens,
      );
      if (script.name !== "-h" && script.name !== "--help") {
        // Pre-Cliffy dispatch still routes through the one recording point.
        const { runProjectScript } = await import(
          "./engine/project_scripts.ts"
        );
        Deno.exit(
          await recordedRun(
            "scripts",
            "cli",
            async () =>
              await runProjectScript(script.name, script.args, {
                json: machineOutput,
              }),
          ),
        );
      }
    }

    // An unknown top-level word never executes a project script. The suggestion
    // path may point at `discern scripts <name>`, preserving discoverability while
    // keeping the root command vocabulary closed.
    if (!verb.startsWith("-") && !KNOWN_VERBS.has(verb)) {
      Deno.exit(
        await reportUnknownOrSuggest(verb, {
          json: machineOutput,
        }),
      );
    }

    await cli.parse(argv);
  } catch (err) {
    // An unparseable or schema-invalid discern.toml must read as a clean
    // diagnostic, not a raw stack trace — in both human and `--json` modes (a
    // CI/agent consuming JSON gets a structured error, not garbage). A syntax
    // error reads `invalid_toml`; a schema violation reads `invalid_config` and
    // carries the per-issue list. Anything else is a crash — a bug in discern
    // reaching the surface — and exits through the crash frame (ADR 0248).
    if (
      err instanceof ConfigParseError || err instanceof ConfigValidationError
    ) {
      const isValidation = err instanceof ConfigValidationError;
      if (machineOutput) {
        // Route through the one envelope/chokepoint (ADR 0030) so even a
        // pre-verb config error is the uniform DiscernResult an agent expects —
        // carrying the attempted verb, with the per-issue list under `data`.
        emitResult({
          ok: false,
          verb: verb ?? "discern",
          error: isValidation ? "invalid_config" : "invalid_toml",
          message: err.message,
          ...(isValidation ? { data: { issues: err.issues } } : {}),
        });
      } else {
        new Logger({ json: false, noColor: false }).error(err.message);
      }
      Deno.exit(1);
    }
    await exitWithCrashFrame(
      verb,
      err,
      machineOutput,
    );
  }
}

/** Re-entrancy latch for {@link exitWithCrashFrame}: a throw from inside the
 * crash path itself must exit rather than recurse through the last-resort
 * listeners. */
let crashFrameActive = false;

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
    Deno.exit(CRASH_EXIT_CODE);
  }
  crashFrameActive = true;
  const report = captureCrashReport(verb, err);
  let cwd = ".";
  try {
    cwd = Deno.cwd();
  } catch {
    // A deleted working directory still gets a report, via the temp fallback.
  }
  const artifact = await writeCrashArtifact(cwd, report);
  if (json) {
    emitResult(internalErrorResult(report.verb, report, artifact));
  }
  console.error(renderCrashFrame(report, artifact));
  Deno.exit(CRASH_EXIT_CODE);
}

if (import.meta.main) {
  // Last-resort crash handlers, registered only for the real binary (never for
  // tests importing `main`): a stray rejection or uncaught error outside
  // `main`'s own catch — a fire-and-forget promise, a listener throw — still
  // leaves a saved report and the frame instead of a raw runtime dump.
  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    void exitWithCrashFrame(
      undefined,
      event.reason,
      machineOutputRequested(activeDiscernArgv),
    );
  });
  globalThis.addEventListener("error", (event) => {
    event.preventDefault();
    void exitWithCrashFrame(
      undefined,
      event.error ?? event.message,
      machineOutputRequested(activeDiscernArgv),
    );
  });
  await main(Deno.args);
}
