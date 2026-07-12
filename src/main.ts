/**
 * `discern` — the CLI entrypoint.
 *
 * Wires the Cliffy command tree, threads the global flags (`--json`,
 * `--no-color`, `--help`, `--version`) into every subcommand, and maps each
 * command's exit code onto the process. Each subcommand's logic lives in
 * `src/commands/*`; this file is routing only.
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { KIT_VERSION } from "./lib/version.ts";
import { operatorHelp } from "./cli_help.ts";
import { emitResult } from "./shared/emit.ts";
import { setColorOverride } from "./engine/output.ts";
import {
  AGENT_NAMES,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
} from "./shared/config_schema.ts";
import type { EnvReader } from "./shared/env.ts";
import { findRoot } from "./shared/env.ts";
import { capabilityList } from "./shared/capabilities.ts";
import { NOT_SET_UP_MESSAGE, verbNeedsSetup } from "./shared/setup_state.ts";
import {
  commandSynonymSuggestion,
  normalizeVerbVariant,
  retiredCommandMessage,
  retiredCommandSuccessor,
} from "./shared/vocabulary.ts";
import {
  beginOptsFrom,
  hasScaffoldIntent,
  runSetupBegin,
  runSetupDone,
  runSetupStep,
} from "./commands/setup.ts";
import { runSetupWelcome } from "./commands/setup_welcome.ts";
import { canPrompt, setPlainMode } from "./lib/prompts.ts";
import { runDesk } from "./engine/desk/desk.ts";
import { runSetupVerify } from "./commands/setup_verify.ts";
import { runSetupAccept } from "./commands/setup_accept.ts";
import { runUpgrade } from "./commands/upgrade.ts";
import { runUninstall } from "./commands/uninstall.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runPreset } from "./commands/preset.ts";
import { runHelp, runMap } from "./commands/docs.ts";
import {
  runConfigSet,
  runConfigSetCapability,
  runConfigSetCheck,
  runConfigSetScope,
  runConfigSetStandard,
} from "./commands/config.ts";
import {
  attachEngineCommands,
  dispatchHelper,
  dispatchRecipeOrSuggest,
  KNOWN_VERBS,
  printProjectRecipes,
  reportUnknownCommand,
  runConfigRead,
  warnShadowedRecipe,
} from "./engine/dispatch.ts";

// The full built-in verb vocabulary (installer + engine) is defined once in the
// dispatcher — the recipe-shadow authority — and re-exported here as the CLI's
// `KNOWN_VERBS`, so the parity guard and existing importers keep this entry point.
export { KNOWN_VERBS };

/**
 * Resolve the effective "no colour" decision. Cliffy maps `--no-color` to a
 * negatable boolean `color` (true by default, false when the flag is passed);
 * we also honour the NO_COLOR env var as a hard off-switch.
 */
function noColorFrom(color: boolean | undefined): boolean {
  if (color === false) {
    return true;
  }
  const env = Deno.env.get("NO_COLOR");
  return env !== undefined && env !== "";
}

/**
 * The CLI's single colour decision — resolved ONCE, from the three inputs the
 * `--no-color` help text promises: the flag itself, the NO_COLOR env var, and
 * whether stdout is a TTY. Every colour-emitting path (engine verbs, the installer
 * Loggers, the root help) is threaded from this one value in {@link main}, so no
 * output path re-decides on its own and drops the flag. `noColorFlag` is read from
 * argv pre-Cliffy (the flag reaches the router before Cliffy parses it). `env` and
 * `isTerminal` are injectable so the decision is unit-testable without touching the
 * process (the codebase's EnvReader seam).
 */
export function resolveColorMode(
  noColorFlag: boolean,
  env: EnvReader = Deno.env,
  isTerminal: () => boolean = () => Deno.stdout.isTerminal(),
): boolean {
  if (noColorFlag) {
    return false;
  }
  const nc = env.get("NO_COLOR");
  if (nc !== undefined && nc !== "") {
    return false;
  }
  return isTerminal();
}

/**
 * Thread the one resolved colour decision to every surface that emits colour:
 *  - the standalone Cliffy `colors` chain (the installer + engine `Logger`s, and
 *    the help's own group headings) — `setColorEnabled` makes those a no-op when off;
 *  - the engine's `colorEnabled()` (the gate/status/desk/coupling output) — via the
 *    process-wide override.
 * The root help additionally strips Cliffy's `getHelp()` escapes when off (it honours
 * only `Deno.noColor`); {@link operatorHelp} does that from the `color` argument.
 */
function applyColorMode(color: boolean): void {
  colors.setColorEnabled(color);
  setColorOverride(color);
}

/**
 * Extract the global `--json` / `--no-color` flags. They reach every command at
 * runtime via root's `globalOption`, but a standalone subcommand instance (the
 * `config` group) doesn't carry them in its inferred option type, so we read them
 * through a narrow cast.
 */
function globalFlags(options: unknown): { json: boolean; noColor: boolean } {
  const o = options as { json?: boolean; color?: boolean };
  return { json: o.json ?? false, noColor: noColorFrom(o.color) };
}

/**
 * The type of `buildCli`'s root command. Cliffy threads the two `globalOption`
 * declarations into the command's generics, so the concrete type is impractical
 * to write by hand. We name it from a type-only `declare` (no runtime value is
 * emitted) whose chain mirrors the real root built in `buildCli`.
 */
declare function rootShape(): ReturnType<
  ReturnType<
    ReturnType<Command<void, void, void, []>["globalOption"]>["globalOption"]
  >["globalOption"]
>;
type RootCommand = ReturnType<typeof rootShape>;

/** Build the root command with its global flags and subcommands. Every verb is
 * attached unconditionally — the subsystems are all core (ADR 0101). `setup` is
 * hidden from help once the project records `[meta].bootstrapped` (it stays
 * callable with `--force`). */
export function buildCli(
  hideSetup: boolean,
  mainBranch?: string,
): RootCommand {
  const trunkName = mainBranch === undefined ? "" : ` (\`${mainBranch}\`)`;
  const root = new Command()
    .name("discern")
    .version(KIT_VERSION)
    .usage("<command> [options]")
    .description(
      "Operate your project's quality gate (its full quality check) and Git " +
        "worktrees (a separate checkout and branch for each change); `discern setup` " +
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
      "--json",
      "Emit machine-readable JSON instead of human output.",
    )
    .globalOption(
      "--no-color",
      "Disable colour (also honours NO_COLOR and non-TTY output).",
    )
    .globalOption(
      "--plain",
      "Never prompt or page; use static output. CI and non-terminal input imply this behavior.",
    )
    .action(function (): void {
      // No subcommand: show the grouped, operator-oriented help.
      console.log(operatorHelp(this as unknown as Command));
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
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(await runSetupBegin(beginOptsFrom(options, json, noColor)));
    });

  const setupVerify = new Command()
    .description(
      "Preview what setup will do and the consent checklist to confirm with your human (read-only).",
    )
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(await runSetupVerify({ json, noColor }));
    });

  const setupStep = new Command()
    .description(
      "Re-serve one numbered step of the setup brief (read-only; for a mid-setup re-focus).",
    )
    .arguments("<n:number>")
    .action(async (options, n: number) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(await runSetupStep(n, { json, noColor }));
    });

  const setupDone = new Command()
    .description("Validate setup and record [meta].bootstrapped.")
    .option("--force", "Record completion even if skeleton markers remain.")
    .action(async (options) => {
      Deno.exit(
        await runSetupDone({
          json: globalFlags(options).json,
          force: options.force ?? false,
        }),
      );
    });

  const setupAccept = new Command()
    .description(
      `Land the finished setup branch on the trunk${trunkName} — the shared landing branch.`,
    )
    .option("--dry-run", "Print the plan and change nothing.")
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(
        await runSetupAccept({
          json,
          noColor,
          dryRun: options.dryRun ?? false,
        }),
      );
    });

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
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      // Bare `discern setup` → the read-only welcome; any scaffold/declarative input
      // (the CI/preset path) scaffolds straight through `begin` (ADR 0075).
      Deno.exit(
        hasScaffoldIntent(options)
          ? await runSetupBegin(beginOptsFrom(options, json, noColor))
          : await runSetupWelcome({ json, noColor }),
      );
    })
    .command("verify", setupVerify)
    .command("begin", setupBegin)
    .command("step", setupStep)
    .command("done", setupDone)
    .command("accept", setupAccept);
  // Hide on the REGISTERED command, not the pre-registration instance: the
  // instance form of `.command()` re-parents, so `setup.hidden()` wouldn't take.
  // `setup` stays reachable (and `--force`-able) when hidden.
  const setupCmd = root.command("setup", setup);
  if (hideSetup) {
    setupCmd.hidden();
  }

  root
    .command("upgrade")
    .description(
      "Upgrade discern itself in this project: migrate its config and refresh bundled " +
        "skills and guidance. Use `discern update` for this branch; use `discern " +
        "refresh` for generated agent files alone.",
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
    .action(async (options) => {
      const code = await runUpgrade({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        check: options.check ?? false,
        allowDirty: options.allowDirty ?? false,
      });
      Deno.exit(code);
    });

  root
    .command("uninstall")
    .description(
      "Remove discern's wiring from this project (keeps your discern.toml, guidance, and map).",
    )
    .option(
      "--dry-run",
      "Preview exactly what would be removed and kept; change nothing.",
    )
    .option("-y, --yes", "Skip the confirmation prompt.")
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(
        await runUninstall({
          json,
          noColor,
          dryRun: options.dryRun ?? false,
          yes: options.yes ?? false,
        }),
      );
    });

  root
    .command("doctor")
    .description(
      "Check the install (config, schema, commands on PATH) and print each verb's execution model.",
    )
    .option(
      "-v, --verbose",
      "Show the hint explaining each execution-model step (hidden by default).",
    )
    .action(async (options) => {
      const code = await runDoctor({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        verbose: options.verbose ?? false,
      });
      Deno.exit(code);
    });

  // `preset` dispatches but stays out of the help listing: discern ships no
  // bundled presets yet, and advertising an empty mechanism hands a newcomer a
  // dead end. The verb keeps working for projects that lay their own
  // presets/<name>/ trees; it returns to the listing when something ships.
  root
    .command("preset <name:string>")
    .description(
      "Overlay a reference preset from presets/<name>/ (ships none by default).",
    )
    .option("-y, --yes", "Non-interactive: skip the confirm prompt.")
    .option("--dry-run", "Print the plan and write nothing.")
    .action(async (options, name: string) => {
      const code = await runPreset(name, {
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        yes: options.yes ?? false,
      });
      Deno.exit(code);
    })
    .hidden();

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
      "Print a plain table of contents and exit (never interactive).",
    )
    .option("--no-pager", "Don't page rendered output through $PAGER.")
    .option(
      "--dir <path:string>",
      "Map directory to browse (default: the project's [map].dir).",
    )
    .option("--width <cols:number>", "Wrap width for rendered output.")
    .option(
      "--export <scope:string>",
      "Concatenate Markdown: public, all, or select.",
    )
    .option(
      "--output <path:string>",
      "Write an export to a file instead of stdout.",
    )
    .action(async (options, target?: string) => {
      const code = await runMap({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        raw: options.raw ?? false,
        list: options.list ?? false,
        // Cliffy maps `--no-pager` to a negatable `pager` boolean (like --no-color).
        noPager: options.pager === false,
        dir: options.dir,
        width: options.width,
        target,
        export: options.export,
        output: options.output,
      });
      Deno.exit(code);
    });

  // `help` — browse discern's OWN bundled documentation (the config reference,
  // concepts, the gate/worktree/standard docs). Distinct from `map`, which serves
  // the project's tree. The doc set is fixed and bundled, so there is no
  // `--dir`; `--help`/`-h` (Cliffy usage) is a separate surface and coexists with
  // it. Mirrors `map`'s read flags (target, --list/--raw/--json/--no-pager/--width)
  // plus a public-only `--export`.
  root
    .command("help [target:string]")
    .description("Browse and read discern's own documentation.")
    .option(
      "--raw",
      "Print a doc's pristine Markdown source instead of rendering it.",
    )
    .option(
      "--list",
      "Print a plain table of contents and exit (never interactive).",
    )
    .option(
      "--adr",
      "Also surface discern's Architecture Decision Records (hidden by default).",
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
    .action(async (options, target?: string) => {
      const json = options.json ?? false;
      // `help <command>` mirrors `<command> --help` — git users type the two
      // interchangeably, and git itself forwards one to the other. Driven off
      // the verb registry (hidden commands included: they still dispatch), so
      // every registered verb resolves; a retired spelling or a familiar
      // synonym gets its usual one-line lesson instead of a doc miss.
      if (target !== undefined && KNOWN_VERBS.has(target)) {
        const sub = root.getCommand(target, true);
        if (sub !== undefined) {
          sub.showHelp();
          Deno.exit(0);
        }
      }
      if (target !== undefined) {
        const successor = retiredCommandSuccessor(target);
        if (successor !== undefined) {
          const message = retiredCommandMessage(target, successor);
          if (json) {
            emitResult({
              ok: false,
              verb: target,
              error: "renamed_command",
              message,
            });
          } else {
            console.error(`discern: ${message}`);
          }
          Deno.exit(1);
        }
        const synonym = commandSynonymSuggestion(target);
        if (synonym !== undefined) {
          reportUnknownCommand(target, synonym, { json });
          Deno.exit(1);
        }
      }
      const code = await runHelp({
        json,
        noColor: noColorFrom(options.color),
        raw: options.raw ?? false,
        list: options.list ?? false,
        adr: options.adr ?? false,
        noPager: options.pager === false,
        width: options.width,
        target,
        export: options.export,
        output: options.output,
      });
      Deno.exit(code);
    });

  // `config` — programmatic, comment-preserving edits to an existing
  // discern.toml. Each subcommand is a standalone Command instance attached via
  // `.command(name, instance)` (the reliable Cliffy form for a command group).
  const setCapability = new Command()
    .description(
      `Set a capability — a configured project command for one known kind of work (${capabilityList()}).`,
    )
    .arguments("<name:string> <command:string>")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(async (options, name: string, command: string) => {
      Deno.exit(
        await runConfigSetCapability(name, command, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
        }),
      );
    });

  const setCheck = new Command()
    .description(
      "Set a custom command in the gate — the project's full quality check.",
    )
    .arguments("<name:string>")
    .option(
      "--stage <stage:string>",
      "When it runs: fix|build|check|test.",
      { required: true },
    )
    .option("--run <cmd:string>", "The check command.", { required: true })
    .option("--provides <label:string>", "Optional free-text label.")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(async (options, name: string) => {
      Deno.exit(
        await runConfigSetCheck(name, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          stage: options.stage,
          run: options.run,
          provides: options.provides,
        }),
      );
    });

  const setScope = new Command()
    .description(
      "Set a scope — a named region of the repository a change can touch.",
    )
    .arguments("<name:string> <globs...:string>")
    .option("--neutral", "Changes here need no gate.")
    .option("--previewable", "A person could see changes here.")
    .option("--gate <cmd:string>", "A command to run when this scope changed.")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(async (options, name: string, ...globs: string[]) => {
      Deno.exit(
        await runConfigSetScope(name, globs, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          neutral: options.neutral ?? false,
          previewable: options.previewable ?? false,
          gate: options.gate,
        }),
      );
    });

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
    .option("--direction <dir:string>", 'Either "up" or "down" (default: up).')
    .option(
      "--run <cmd:string>",
      "The command that emits the metric line.",
      { required: true },
    )
    .option("--dry-run", "Print the edit and write nothing.")
    .action(async (options, name: string) => {
      Deno.exit(
        await runConfigSetStandard(name, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          limit: options.limit,
          metric: options.metric,
          direction: options.direction,
          run: options.run,
        }),
      );
    });

  const setScalar = new Command()
    .description(
      "Set a config key (section.key). The value's TOML type follows the schema; an array-of-strings key wraps a single value.",
    )
    .arguments("<key:string> <value:string>")
    .option("--number", "Treat the value as a number (union-typed keys only).")
    .option("--bool", "Treat the value as a boolean (union-typed keys only).")
    .option("--string", "Treat the value as a string (union-typed keys only).")
    .option("--dry-run", "Print the edit and write nothing.")
    .action(async (options, key: string, value: string) => {
      Deno.exit(
        await runConfigSet(key, value, {
          ...globalFlags(options),
          dryRun: options.dryRun ?? false,
          number: options.number ?? false,
          bool: options.bool ?? false,
          string: options.string ?? false,
        }),
      );
    });

  // Read-side config surface — what a project recipe uses to read scalar,
  // array, and membership values out of discern.toml.
  const configGet = new Command()
    .description("Print a scalar config value.")
    .arguments("<key:string>")
    .action(async (_o, key: string) => {
      Deno.exit(await runConfigRead("get", key));
    });
  const configArray = new Command()
    .description("Print an array config value, one item per line.")
    .arguments("<key:string>")
    .action(async (_o, key: string) => {
      Deno.exit(await runConfigRead("array", key));
    });
  const configHas = new Command()
    .description("Exit 0 if a key or section exists, 1 otherwise (silent).")
    .arguments("<key:string>")
    .action(async (_o, key: string) => {
      Deno.exit(await runConfigRead("has", key));
    });
  const configSubsections = new Command()
    .description("Print the immediate child table names under a section.")
    .arguments("<key:string>")
    .action(async (_o, key: string) => {
      Deno.exit(await runConfigRead("subsections", key));
    });
  const configKeys = new Command()
    .description("Print the flat key names declared in a section.")
    .arguments("<key:string>")
    .action(async (_o, key: string) => {
      Deno.exit(await runConfigRead("keys", key));
    });

  const config = new Command()
    .description(
      "Edit (set-*) or read (get/array/has/subsections/keys) discern.toml.",
    )
    .action(function (): void {
      this.showHelp();
    })
    .command("set-capability", setCapability)
    .command("set-check", setCheck)
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

  return root;
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
      mainBranch: cfg.project.main_branch,
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
 * for a non-Cliffy dispatch target (a project recipe) once that verb token is
 * removed — leading global flags preserved, in order. */
export interface CliInvocation {
  verb: string | undefined;
  argsWithoutVerb: string[];
}

/**
 * Resolve the verb a raw argv addresses the way Cliffy will: the FIRST token
 * that is not one of the root command's global flags. Cliffy accepts global
 * flags on either side of the subcommand (`discern --json map` ≡
 * `discern map --json`), so every pre-Cliffy routing decision — the setup
 * redirect (ADR 0036), the welcome/help split, shadow warnings, recipe
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

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  let argv = args;
  // The raw first token — helper dispatch below is deliberately positional,
  // and it names the attempted verb in a pre-resolution config error.
  let verb = argv[0];

  try {
    // One global interaction decision feeds every prompt-capable surface. This
    // is set before helper/Cliffy dispatch so flag-first forms behave identically.
    setPlainMode(argv.includes("--plain"));
    // Resolve the ONE colour decision up front (flag + NO_COLOR + isatty) and
    // thread it to every colour-emitting surface, so `--no-color` is honoured
    // uniformly — engine verbs, the installer Loggers, and the root help alike —
    // rather than each path re-deciding and dropping the flag (B32/B36). Done
    // before helper dispatch so a helper's own output (`with-gotchas`' gotchas
    // hint) obeys it too.
    const color = resolveColorMode(argv.includes("--no-color"));
    applyColorMode(color);

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
    // redirect/self-hiding know whether setup is still outstanding.
    const { inProject, configOk, bootstrapped, mainBranch } =
      await resolveProjectState();
    const hideSetup = inProject && bootstrapped;
    const cli = buildCli(hideSetup, mainBranch);

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
    // (ADR 0119); the shared `canPrompt` policy additionally honors --plain and
    // CI, so pipes, harnesses, and machine modes fall through to static help.
    if (verb === undefined) {
      if (shouldWelcomeBare(inProject, bootstrapped)) {
        Deno.exit(
          await runSetupWelcome({
            json: argv.includes("--json"),
            noColor: !color,
          }),
        );
      }
      if (
        inProject && configOk && bootstrapped &&
        !argv.includes("--json") && canPrompt(false)
      ) {
        Deno.exit(await runDesk({}));
      }
      console.log(operatorHelp(cli as unknown as Command, { color }));
      await printProjectRecipes();
      Deno.exit(0);
      return;
    }

    // A retired spelling is not an alias: it refuses before recipe fallthrough or
    // Cliffy dispatch and names the one canonical successor. JSON mode keeps the
    // same refusal in the uniform result envelope.
    const commandTokens = argv.filter((token) => !globalTokens.has(token));
    const nestedCommand = commandTokens.slice(0, 2).join(" ");
    const retiredCommand = retiredCommandSuccessor(nestedCommand) !== undefined
      ? nestedCommand
      : verb;
    const successor = retiredCommandSuccessor(retiredCommand);
    if (successor !== undefined) {
      const message = retiredCommandMessage(retiredCommand, successor);
      if (argv.includes("--json")) {
        emitResult({
          ok: false,
          verb: retiredCommand,
          error: "renamed_command",
          message,
        });
      } else {
        console.error(`discern: ${message}`);
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

    // Explicit help: Cliffy's help plus the project-recipe listing.
    if (verb === "-h" || verb === "--help") {
      console.log(operatorHelp(cli as unknown as Command, { color }));
      await printProjectRecipes();
      Deno.exit(0);
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
      if (argv.includes("--json")) {
        emitResult({
          ok: false,
          verb,
          error: "not_set_up",
          message: NOT_SET_UP_MESSAGE,
        });
      } else {
        console.error(`discern: ${NOT_SET_UP_MESSAGE}`);
      }
      Deno.exit(1);
    }

    // A built-in verb (installer OR engine) with a same-named project recipe: warn
    // it is shadowed and won't run. Keyed on the SAME KNOWN_VERBS the router refuses,
    // so every name help could list is covered — not just the engine subset (B34).
    // Silent under --json so the single-envelope stream stays pure (B35).
    if (KNOWN_VERBS.has(verb)) {
      await warnShadowedRecipe(verb, { json: argv.includes("--json") });
    }

    // Recipe fallthrough: an unknown verb (not a flag, not a known command) is a
    // project-owned executable recipe, or an unknown-command lesson with a
    // did-you-mean suggestion. The recipe receives the rest of argv verbatim — a
    // leading global flag included, exactly as if it had been passed after the
    // recipe name.
    if (!verb.startsWith("-") && !KNOWN_VERBS.has(verb)) {
      Deno.exit(
        await dispatchRecipeOrSuggest(verb, invocation.argsWithoutVerb, {
          json: argv.includes("--json"),
        }),
      );
    }

    await cli.parse(argv);
  } catch (err) {
    // An unparseable or schema-invalid discern.toml must read as a clean
    // diagnostic, not a raw stack trace — in both human and `--json` modes (a
    // CI/agent consuming JSON gets a structured error, not garbage). A syntax
    // error reads `invalid_toml`; a schema violation reads `invalid_config` and
    // carries the per-issue list. Other errors propagate unchanged.
    if (
      err instanceof ConfigParseError || err instanceof ConfigValidationError
    ) {
      const isValidation = err instanceof ConfigValidationError;
      if (argv.includes("--json")) {
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
        console.error(`discern: ${err.message}`);
      }
      Deno.exit(1);
    }
    throw err;
  }
}

if (import.meta.main) {
  await main(Deno.args);
}
