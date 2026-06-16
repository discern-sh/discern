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
import { runAddAdapter } from "./commands/add_adapter.ts";

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

/** Build the root command with its global flags and subcommands. */
function buildCli() {
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
    .action(function () {
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
      });
      Deno.exit(code);
    });

  root
    .command("upgrade")
    .description(
      "Refresh managed engine files (hash-aware; never clobbers edits).",
    )
    .option("--dry-run", "Print the plan and write nothing.")
    .action(async (options) => {
      const code = await runUpgrade({
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
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
    .command("add-adapter <name:string>")
    .description(
      "Overlay a reference adapter from adapters/<name>/ (ships none by default).",
    )
    .option("-y, --yes", "Non-interactive: skip the confirm prompt.")
    .option("--dry-run", "Print the plan and write nothing.")
    .action(async (options, name: string) => {
      const code = await runAddAdapter(name, {
        json: options.json ?? false,
        noColor: noColorFrom(options.color),
        dryRun: options.dryRun ?? false,
        yes: options.yes ?? false,
      });
      Deno.exit(code);
    });

  return root;
}

/** Parse argv and dispatch. Exported for tests; called below when run directly. */
export async function main(args: string[]): Promise<void> {
  await buildCli().parse(args);
}

if (import.meta.main) {
  await main(Deno.args);
}
