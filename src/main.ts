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
import { Config, ConfigParseError } from "./shared/config_read.ts";
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
import { runBootstrap, runBootstrapDone } from "./commands/bootstrap.ts";
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
 * (worktree, ratchets, refresh, skills, docs) are attached only when their
 * feature is enabled, so `--help` lists exactly the active verbs. `bootstrap` is
 * hidden from help once the project records `[meta].bootstrapped` (it stays
 * callable with `--force`). */
function buildCli(
  enabled: ReadonlySet<Feature>,
  hideBootstrap: boolean,
): RootCommand {
  const root = new Command()
    .name("discern")
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
    .option("--force", "Proceed even if discern.toml already exists.")
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

  // `bootstrap` — seed a freshly-installed harness from the project brief. The
  // agent in the loop runs it, reads the printed instructions, authors the docs +
  // guidance, then runs `bootstrap done` to validate and record completion. Not a
  // materialized skill (ADR 0024), so nothing lingers in the project tree.
  const bootstrap = new Command()
    .description(
      "Seed a freshly-installed harness from the project brief (run once, after init).",
    )
    .option("--force", "Re-run even if already bootstrapped.")
    .action(async (options) => {
      Deno.exit(
        await runBootstrap({
          json: globalFlags(options).json,
          force: options.force ?? false,
        }),
      );
    })
    .command(
      "done",
      new Command()
        .description("Validate the bootstrap and record [meta].bootstrapped.")
        .option("--force", "Record completion even if skeleton markers remain.")
        .action(async (options) => {
          Deno.exit(
            await runBootstrapDone({
              json: globalFlags(options).json,
              force: options.force ?? false,
            }),
          );
        }),
    );
  // Hide on the REGISTERED command, not the pre-registration instance: the
  // instance form of `.command()` re-parents, so `bootstrap.hidden()` wouldn't
  // take. `bootstrap` stays reachable (and `--force`-able) when hidden.
  const bootstrapCmd = root.command("bootstrap", bootstrap);
  if (hideBootstrap) {
    bootstrapCmd.hidden();
  }

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
  // discern.toml. Each subcommand is a standalone Command instance attached via
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
  // discern.toml (replacing the shell config_* helpers).
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

  // The project task-runner verbs (finish, prepare, graduate, worktree:*, …) — the former
  // shell `agent` recipes, now first-class `discern` subcommands. The cast drops
  // the threaded global-option generics (which the engine actions don't read) —
  // Cliffy's generic Command type is impractical to spell at this boundary.
  attachEngineCommands(root as unknown as Command, enabled);

  return root;
}

/** The cwd project's resolved CLI state: enabled features, whether we are inside a
 * project at all, and whether it has recorded `[meta].bootstrapped`. */
interface ProjectState {
  enabled: ReadonlySet<Feature>;
  inProject: boolean;
  bootstrapped: boolean;
}

/**
 * Resolve the CLI state for the project the cwd is in, with a single config read.
 * When not inside a project, every feature is reported enabled so `--help` and the
 * core verbs behave normally (a verb that needs a project still errors with "no
 * project"), and `bootstrapped`/`inProject` are false (so the bootstrap nudge and
 * self-hiding never fire outside a project). An unparseable config degrades the
 * same way — never block the CLI on a config the user is mid-edit on.
 */
async function resolveProjectState(): Promise<ProjectState> {
  const root = await findRoot();
  if (root === undefined) {
    return {
      enabled: new Set(FEATURES),
      inProject: false,
      bootstrapped: false,
    };
  }
  try {
    const cfg = await Config.load(root);
    return {
      enabled: new Set(enabledFeatures(cfg)),
      inProject: true,
      bootstrapped: cfg.bool("meta.bootstrapped"),
    };
  } catch {
    return { enabled: new Set(FEATURES), inProject: true, bootstrapped: false };
  }
}

/** Verbs that earn the one-time "not bootstrapped yet" nudge: the engine work
 * verbs plus `docs`. Excludes setup/config/help verbs (init, upgrade, doctor,
 * migrate, add-preset, bootstrap, config) so the reminder never spams a recipe's
 * `config get` calls or the setup path itself. */
const NUDGE_VERBS: ReadonlySet<string> = new Set<string>([
  ...KNOWN_ENGINE_VERBS,
  "docs",
]);

/**
 * Installer verbs Cliffy owns; combined with the engine verbs to decide which
 * unknown first tokens fall through to a project recipe.
 */
const KNOWN_VERBS: ReadonlySet<string> = new Set<string>([
  "init",
  "bootstrap",
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

  try {
    // Internal helper verbs (remove-worktree-safely, with-gotchas, …): handled
    // before Cliffy so a wrapped command's flags pass through raw.
    if (verb !== undefined) {
      const helperCode = await dispatchHelper(verb, argv.slice(1));
      if (helperCode !== null) {
        Deno.exit(helperCode);
      }
    }

    // Resolve which features this project has enabled (all-on outside a project),
    // plus its bootstrap state — one config read, so help lists only active verbs,
    // a disabled verb errors clearly, and the bootstrap nudge/self-hiding know
    // whether setup is still outstanding.
    const { enabled, inProject, bootstrapped } = await resolveProjectState();
    const hideBootstrap = inProject && bootstrapped;

    // Root help: Cliffy's help plus the project-recipe listing (the shell `agent
    // --help` showed both).
    if (verb === undefined || verb === "-h" || verb === "--help") {
      console.log(buildCli(enabled, hideBootstrap).getHelp());
      await printProjectRecipes();
      Deno.exit(0);
    }

    // A verb that belongs to a disabled feature: a clear error, not a recipe
    // fallthrough or a bare "unknown command".
    const owningFeature = featureForVerb(verb);
    if (owningFeature !== undefined && !enabled.has(owningFeature)) {
      console.error(
        `discern: the "${owningFeature}" feature is disabled in this project ` +
          `(set [features].${owningFeature} = true in discern.toml to enable it).`,
      );
      Deno.exit(1);
    }

    // One-time setup nudge (ADR 0024): until the project records
    // `[meta].bootstrapped`, remind on the work verbs. A reminder, never a block —
    // nothing is unsafe pre-bootstrap, and a hard gate would punish the
    // manual-config and just-run-my-tests paths. Suppressed in --json so a
    // machine-readable stdout is never accompanied by chatter the caller didn't ask
    // for (the nudge goes to stderr regardless).
    if (
      inProject && !bootstrapped && !argv.includes("--json") &&
      NUDGE_VERBS.has(verb)
    ) {
      console.error(
        "discern: this project isn't bootstrapped yet — ask your agent to run " +
          "`discern bootstrap` (or run it yourself).",
      );
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

    await buildCli(enabled, hideBootstrap).parse(argv);
  } catch (err) {
    // An unparseable discern.toml must read as a clean diagnostic, not a raw
    // stack trace — in both human and `--json` modes (a CI/agent consuming JSON
    // gets a structured error, not garbage). Other errors propagate unchanged.
    if (err instanceof ConfigParseError) {
      if (argv.includes("--json")) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "invalid_toml",
            message: err.message,
          }),
        );
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
