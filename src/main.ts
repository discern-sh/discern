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

/** Build the root command with its global flags and subcommands. */
function buildCli(): RootCommand {
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
    .option("--force", "Proceed even if .icculus/config.toml already exists.")
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
      "Refresh managed engine files (hash-aware; never clobbers edits).",
    )
    .option("--dry-run", "Print the plan and write nothing.")
    .option(
      "--check",
      "Report drift (managed files out of sync) and exit non-zero; write nothing.",
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

  const config = new Command()
    .description(
      "Programmatically edit .icculus/config.toml (comment-preserving).",
    )
    .action(function (): void {
      this.showHelp();
    })
    .command("set-capability", setCapability)
    .command("set-check", setCheck)
    .command("set-scope", setScope)
    .command("set-ratchet", setRatchet)
    .command("set", setScalar);

  root.command("config", config);

  return root;
}

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  await buildCli().parse(args);
}

if (import.meta.main) {
  await main(Deno.args);
}
