/**
 * `discern` — the CLI entrypoint.
 *
 * Wires the Cliffy command tree, threads the global flags (`--json`,
 * `--no-color`, `--help`, `--version`) into every subcommand, and maps each
 * command's exit code onto the process. Each subcommand's logic lives in
 * `src/commands/*`; this file is routing only.
 */

import { Command } from "@cliffy/command";
import { KIT_VERSION } from "./lib/version.ts";
import { operatorHelp } from "./cli_help.ts";
import { emitResult } from "./shared/emit.ts";
import {
  AGENT_NAMES,
  ConfigParseError,
  ConfigValidationError,
  loadConfig,
} from "./shared/config_schema.ts";
import { findRoot } from "./shared/env.ts";
import { capabilityList } from "./shared/capabilities.ts";
import { NOT_SET_UP_MESSAGE, verbNeedsSetup } from "./shared/setup_state.ts";
import {
  beginOptsFrom,
  hasScaffoldIntent,
  runSetupBegin,
  runSetupDone,
  runSetupStep,
} from "./commands/setup.ts";
import { runSetupWelcome } from "./commands/setup_welcome.ts";
import { runSetupVerify } from "./commands/setup_verify.ts";
import { runSetupLand } from "./commands/setup_land.ts";
import { runUpgrade } from "./commands/upgrade.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runPreset } from "./commands/preset.ts";
import { runDocs, runHelp } from "./commands/docs.ts";
import {
  runConfigSet,
  runConfigSetCapability,
  runConfigSetCheck,
  runConfigSetRatchet,
  runConfigSetScope,
} from "./commands/config.ts";
import {
  attachEngineCommands,
  dispatchHelper,
  dispatchRecipeOrSuggest,
  KNOWN_ENGINE_VERBS,
  printProjectRecipes,
  runConfigRead,
  warnShadowedRecipe,
} from "./engine/dispatch.ts";

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
    Command<void, void, void, []>["globalOption"]
  >["globalOption"]
>;
type RootCommand = ReturnType<typeof rootShape>;

/** Build the root command with its global flags and subcommands. Every verb is
 * attached unconditionally — the subsystems are all core (ADR 0101). `setup` is
 * hidden from help once the project records `[meta].bootstrapped` (it stays
 * callable with `--force`). */
export function buildCli(hideSetup: boolean): RootCommand {
  const root = new Command()
    .name("discern")
    .version(KIT_VERSION)
    .usage("<command> [options]")
    .description(
      "Operate your project's quality gate and isolated git-worktree workflow " +
        "— the stack-neutral agentic-development harness (`discern setup` " +
        "scaffolds it the first time).",
    )
    .example(
      "Orient yourself",
      "discern status",
    )
    .example(
      "Agent on the trunk?",
      "discern start  →  (move into provided worktree...)  →  discern status  →  (write code...)  →  discern finish  →  report ready for review",
    )
    .example(
      "Agent in a worktree?",
      "(write code...)  →  discern finish  →  report ready for review",
    )
    .globalOption(
      "--json",
      "Emit machine-readable JSON instead of human output.",
    )
    .globalOption(
      "--no-color",
      "Disable colour (also honours NO_COLOR and non-TTY output).",
    )
    .action(function (): void {
      // No subcommand: show the grouped, operator-oriented help.
      console.log(operatorHelp(this as unknown as Command));
    });

  // `setup` — the staged, zero-config harness setup (ADR 0036, staged by ADR 0075).
  // A bare `discern setup` (no scaffold input) prints the read-only WELCOME; the
  // sub-verbs drive the handshake — `begin` (the first mutating step: scaffold +
  // brief) and `done` (prove + record). The declarative `--config`/flag path scaffolds
  // straight through `begin`, skipping the welcome (CI / presets). Bare `discern`
  // (pre-setup) routes to the welcome too (below). `begin` is canonical; the parent
  // mirrors its scaffold options so `discern setup --config …` still works, and both
  // map them through `beginOptsFrom`.
  const setupBegin = new Command()
    .description(
      "Scaffold the harness, record provenance, and print the setup brief (the first mutating step).",
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
      "--docs <path:string>",
      "Project-relative directory for discern's agent documentation tree.",
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

  const setupLand = new Command()
    .description(
      "Land the finished setup branch onto the integration branch (fast-forward or merge).",
    )
    .option("--dry-run", "Print the plan and change nothing.")
    .action(async (options) => {
      const { json, noColor } = globalFlags(options);
      Deno.exit(
        await runSetupLand({ json, noColor, dryRun: options.dryRun ?? false }),
      );
    });

  const setup = new Command()
    .description(
      "Set up the harness here (run once; your coding agent does it for you).",
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
      "--docs <path:string>",
      "Project-relative directory for discern's agent documentation tree.",
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
    .command("land", setupLand);
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
      "Refresh config schema, skills, and guidance to match the installed binary.",
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
    });

  root
    .command("docs [target:string]")
    .description("Browse and read the project's documentation tree.")
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
      "Docs directory to browse (default: the project's [docs].dir).",
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
      const code = await runDocs({
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
  // concepts, the gate/worktree/ratchet docs). Distinct from `docs`, which serves
  // the project's tree. The doc set is fixed and bundled, so there is no
  // `--dir`; `--help`/`-h` (Cliffy usage) is a separate surface and coexists with
  // it. Mirrors `docs`'s read flags (target, --list/--raw/--json/--no-pager/--width)
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
      const code = await runHelp({
        json: options.json ?? false,
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
      `Set a [capabilities] entry (${capabilityList()}).`,
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
    .description("Set or create a [checks.<name>] table (custom gate work).")
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
    .description("Set a [scopes.<name>] table (paths + optional attributes).")
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

  const setRatchet = new Command()
    .description("Set or create a [ratchets.<name>] table.")
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
        await runConfigSetRatchet(name, {
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
    .description("Set an arbitrary scalar key (section.key). Type is inferred.")
    .arguments("<key:string> <value:string>")
    .option("--number", "Treat the value as a number.")
    .option("--bool", "Treat the value as a boolean.")
    .option("--string", "Treat the value as a string (no inference).")
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
    .command("set-ratchet", setRatchet)
    .command("set", setScalar)
    .command("get", configGet)
    .command("array", configArray)
    .command("has", configHas)
    .command("subsections", configSubsections)
    .command("keys", configKeys);

  root.command("config", config);

  // The project task-runner verbs (finish, prepare, graduate, worktree command group, …) are
  // first-class `discern` subcommands. The cast drops
  // the threaded global-option generics (which the engine actions don't read) —
  // Cliffy's generic Command type is impractical to spell at this boundary.
  attachEngineCommands(root as unknown as Command);

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
    };
  } catch {
    return { inProject: true, configOk: false, bootstrapped: false };
  }
}

/**
 * Whether a bare `discern` (no verb) should print the setup WELCOME rather than help.
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

/**
 * Installer verbs Cliffy owns; combined with the engine verbs to decide which
 * unknown first tokens fall through to a project recipe. Exported as the universe of
 * known verbs the parity guard ties the setup / MCP satellites to
 * (`tests/engine_verb_parity_test.ts`).
 */
export const KNOWN_VERBS: ReadonlySet<string> = new Set<string>([
  "setup",
  "upgrade",
  "doctor",
  "preset",
  "docs",
  "help",
  "config",
  ...KNOWN_ENGINE_VERBS,
]);

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  const argv = args;
  const verb = argv[0];

  try {
    // Internal helper verbs (remove-worktree-safely, with-gotchas, …): handled
    // before Cliffy so a wrapped command's flags pass through raw.
    if (verb !== undefined) {
      const helperCode = await dispatchHelper(verb, argv.slice(1));
      if (helperCode !== null) {
        Deno.exit(helperCode);
      }
    }

    // Resolve the project's setup state — one config read, so the setup
    // redirect/self-hiding know whether setup is still outstanding.
    const { inProject, configOk, bootstrapped } = await resolveProjectState();
    const hideSetup = inProject && bootstrapped;

    // Bare `discern`: pre-setup, this prints the read-only WELCOME — the install
    // message tells the user to "tell your coding agent to run discern" (ADR 0036),
    // and the welcome dual-addresses both readers and funnels the agent into the
    // staged handshake (ADR 0075). It writes nothing, so it shows even in a non-git
    // directory (leading with the git-init step); once the project is set up, bare
    // `discern` falls through to help.
    if (verb === undefined) {
      if (shouldWelcomeBare(inProject, bootstrapped)) {
        Deno.exit(
          await runSetupWelcome({
            json: false,
            noColor: noColorFrom(undefined),
          }),
        );
      }
      console.log(
        operatorHelp(buildCli(hideSetup) as unknown as Command),
      );
      await printProjectRecipes();
      Deno.exit(0);
    }

    // Explicit help: Cliffy's help plus the project-recipe listing.
    if (verb === "-h" || verb === "--help") {
      console.log(
        operatorHelp(buildCli(hideSetup) as unknown as Command),
      );
      await printProjectRecipes();
      Deno.exit(0);
    }

    // Pre-setup hard redirect (ADR 0036): until the project records
    // `[meta].bootstrapped`, the setup-gated verbs refuse and point at setup —
    // running an empty gate would report a false "all-green", and `docs` would
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

    // A built-in engine verb with a same-named project recipe: warn it is shadowed.
    if (KNOWN_ENGINE_VERBS.has(verb)) {
      await warnShadowedRecipe(verb);
    }

    // Recipe fallthrough: an unknown verb (not a flag, not a known command) is a
    // project-owned executable recipe, or an "unknown recipe" suggestion.
    if (!verb.startsWith("-") && !KNOWN_VERBS.has(verb)) {
      Deno.exit(await dispatchRecipeOrSuggest(verb, argv.slice(1)));
    }

    await buildCli(hideSetup).parse(argv);
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
