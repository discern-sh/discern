/**
 * `icculus` — the CLI entrypoint.
 *
 * Wires the Cliffy command tree, threads the global flags (`--json`,
 * `--no-color`, `--help`, `--version`) into every subcommand, and maps each
 * command's exit code onto the process. Each subcommand's logic lives in
 * `src/commands/*`; this file is routing only.
 */

import { Command } from "@cliffy/command";
import { KIT_VERSION } from "./lib/version.ts";
import { Config } from "./shared/config_read.ts";
import { findRoot } from "./shared/env.ts";
import {
  enabledFeatures,
  type Feature,
  featureForVerb,
  FEATURES,
} from "./shared/features.ts";
import { runInit } from "./commands/init.ts";
import { runUpgrade } from "./commands/upgrade.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runMigrate } from "./commands/migrate.ts";
import { runAddPreset } from "./commands/add_preset.ts";
import { runDocs } from "./commands/docs.ts";
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

/** Build the root command with its global flags and subcommands. Subsystem verbs
 * (worktree, ratchets, guidelines, skills, docs) are attached only when their
 * feature is enabled, so `--help` lists exactly the active verbs. */
function buildCli(enabled: ReadonlySet<Feature>): RootCommand {
  const root = new Command()
    .name("icculus")
    .version(KIT_VERSION)
    .description(
      "Scaffold a stack-neutral agentic development harness into any project.",
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
      // No subcommand: show help.
      this.showHelp();
    });

  root
    .command("init")
    .description("Scaffold the harness into the current directory.")
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
      "Comma-separated agent files to emit: claude_code, codex.",
    )
    .option(
      "--config <file:string>",
      "JSON answers file (or - for stdin). Drives a fresh install declaratively; implies non-interactive.",
    )
    .option("-y, --yes", "Non-interactive: use flags/defaults, no prompts.")
    .option("--dry-run", "Print the plan and write nothing.")
    .option("--force", "Proceed even if icculus.toml already exists.")
    .action(async (options) => {
      const code = await runInit({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        yes: options.yes ?? false,
        name: options.name,
        slug: options.slug,
        branchPrefix: options.branchPrefix,
        sourceGlobs: options.sourceGlobs,
        brief: options.brief,
        agents: options.agents,
        config: options.config,
      });
      Deno.exit(code);
    });

  root
    .command("upgrade")
    .description(
      "Refresh the project's config schema, materialized skills, and compiled guidance to match the installed binary.",
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
    .description("Verify the install and fold in the harness's own self-check.")
    .action(async (options) => {
      const code = await runDoctor({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
      });
      Deno.exit(code);
    });

  root
    .command("migrate")
    .description(
      "Report pending schema migrations (read-only); `upgrade` applies them.",
    )
    .option(
      "--check",
      "Exit non-zero when migrations are pending (a scripting signal).",
    )
    .action(async (options) => {
      const code = await runMigrate({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        check: options.check ?? false,
      });
      Deno.exit(code);
    });

  root
    .command("add-preset <name:string>")
    .description(
      "Overlay a reference preset from presets/<name>/ (ships none by default).",
    )
    .option("-y, --yes", "Non-interactive: skip the confirm prompt.")
    .option("--dry-run", "Print the plan and write nothing.")
    .action(async (options, name: string) => {
      const code = await runAddPreset(name, {
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        yes: options.yes ?? false,
      });
      Deno.exit(code);
    });

  if (enabled.has("docs")) {
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
        "Docs directory to browse (default: <project root>/docs).",
      )
      .option("--width <cols:number>", "Wrap width for rendered output.")
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
        });
        Deno.exit(code);
      });
  }

  // `config` — programmatic, comment-preserving edits to an existing
  // .icculus/config.toml. Each subcommand is a standalone Command instance attached via
  // `.command(name, instance)` (the reliable Cliffy form for a command group).
  const setCapability = new Command()
    .description(
      "Set a [capabilities] entry (format|build|lint|typecheck|test).",
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

  // Read-side config surface — what a project recipe uses to read
  // .icculus/config.toml (replacing the shell config_* helpers).
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
      "Edit (set-*) or read (get/array/has/subsections/keys) icculus.toml.",
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

  // The project task-runner verbs (finish, tidy, worktree:*, …) — the former
  // shell `agent` recipes, now first-class `icculus` subcommands. The cast drops
  // the threaded global-option generics (which the engine actions don't read) —
  // Cliffy's generic Command type is impractical to spell at this boundary.
  attachEngineCommands(root as unknown as Command, enabled);

  return root;
}

/**
 * Resolve the enabled features for the project the cwd is in. When not inside a
 * project, every feature is reported enabled so `--help` and the core verbs
 * behave normally (a verb that needs a project still errors with "no project").
 */
async function resolveEnabledFeatures(): Promise<ReadonlySet<Feature>> {
  const root = await findRoot();
  if (root === undefined) {
    return new Set(FEATURES);
  }
  try {
    return new Set(enabledFeatures(await Config.load(root)));
  } catch {
    return new Set(FEATURES);
  }
}

/**
 * Installer verbs Cliffy owns; combined with the engine verbs to decide which
 * unknown first tokens fall through to a project recipe.
 */
const KNOWN_VERBS: ReadonlySet<string> = new Set<string>([
  "init",
  "upgrade",
  "doctor",
  "migrate",
  "add-preset",
  "docs",
  "config",
  ...KNOWN_ENGINE_VERBS,
]);

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  // Normalise `worktree:<sub>` → `worktree <sub>` for the Cliffy group (Cliffy
  // forbids ':' in command names).
  let argv = args;
  const first = argv[0];
  if (first !== undefined && first.startsWith("worktree:")) {
    argv = ["worktree", first.slice("worktree:".length), ...argv.slice(1)];
  }
  const verb = argv[0];

  // Internal helper verbs (remove-worktree-safely, with-gotchas, …): handled
  // before Cliffy so a wrapped command's flags pass through raw.
  if (verb !== undefined) {
    const helperCode = await dispatchHelper(verb, argv.slice(1));
    if (helperCode !== null) {
      Deno.exit(helperCode);
    }
  }

  // Resolve which features this project has enabled (all-on outside a project),
  // so help lists only active verbs and a disabled verb errors clearly.
  const enabled = await resolveEnabledFeatures();

  // Root help: Cliffy's help plus the project-recipe listing (the shell `agent
  // --help` showed both).
  if (verb === undefined || verb === "-h" || verb === "--help") {
    console.log(buildCli(enabled).getHelp());
    await printProjectRecipes();
    Deno.exit(0);
  }

  // A verb that belongs to a disabled feature: a clear error, not a recipe
  // fallthrough or a bare "unknown command".
  const owningFeature = featureForVerb(verb);
  if (owningFeature !== undefined && !enabled.has(owningFeature)) {
    console.error(
      `icculus: the "${owningFeature}" feature is disabled in this project ` +
        `(set [features].${owningFeature} = true in icculus.toml to enable it).`,
    );
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

  await buildCli(enabled).parse(argv);
}

if (import.meta.main) {
  await main(Deno.args);
}
