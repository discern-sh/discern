/**
 * The engine-verb dispatcher: attaches the project task-runner verbs to the
 * `discern` CLI, and falls through to project-owned executable recipes under
 * `[recipes].dir` (default `./recipes`) for an unknown verb.
 *
 * Engine verbs operate on the project (found by walking up to `discern.toml`), so
 * each requires a project root.
 */

import { Command } from "@cliffy/command";
import { join } from "@std/path";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { RawConfig } from "../shared/config_read.ts";
import { emitResult } from "../shared/emit.ts";
import {
  findSkeletonMarkers,
  setupUnfinishedHint,
} from "../shared/setup_state.ts";
import {
  CONFIG_REL,
  findRoot,
  installedConfigRel,
  recipeEnvVars,
} from "../shared/env.ts";
import {
  resolveConfigPath,
  resolveRecipesDir,
  resolveWorktreeRoot,
} from "../lib/paths.ts";
import {
  ejectSkill,
  listSkills,
  materializeSkills,
  skillsListResult,
} from "../lib/skills.ts";
import type { SkillsEjectData } from "../shared/result_schemas.ts";
import { skillsDirsForAgents } from "../lib/providers.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import { Logger } from "../lib/log.ts";
import { runFinish } from "./gate/finish.ts";
import { runImprovement } from "./improve/improve.ts";
import { CATEGORY_NAMES } from "./improve/rules.ts";
import { runMcpServer } from "./mcp/server.ts";
import { runPrepare } from "./gate/prepare.ts";
import { runTestCapability } from "./gate/test.ts";
import { runStandards } from "./gate/standards.ts";
import { runImpact } from "./scopes/scopes.ts";
import { runCoupling } from "./coupling/coupling.ts";
import { runStatus } from "./status/status.ts";
import { runDesk } from "./desk/desk.ts";
import { refreshResult } from "./guidelines.ts";
import { guidanceAgents } from "./guidance_render.ts";
import {
  accept,
  IdentityError,
  identityField,
  identityResourceHandle,
  identityResourcesList,
  type LifecycleContext,
  lifecycleContext,
  start,
  update,
  worktreeDrop,
  worktreeEnsure,
  worktreeErrorResult,
  WorktreeGitError,
  worktreePrune,
  worktreeSetup,
  worktreeTeardown,
} from "./worktree/lifecycle.ts";
import { inheritMainEnvVars, removeWorktreeSafely } from "./worktree/git.ts";
import { WORKTREE_FIELDS } from "./worktree/identity.ts";
import {
  worktreeCreateHook,
  worktreeRemoveHook,
} from "../lib/worktree_hooks.ts";
import { gotchasHint } from "./gate/gotchas.ts";
import { colorEnabled } from "./output.ts";
import type { DiscernResult } from "../shared/result.ts";

/** The top-level engine verbs Cliffy owns (everything else → recipe fallthrough).
 * Every verb is attached unconditionally — the subsystems are all core (ADR 0101). */
export const KNOWN_ENGINE_VERBS: ReadonlySet<string> = new Set([
  "done",
  "prepare",
  "test",
  "improvement",
  "standards",
  "refresh",
  "impact",
  "coupling",
  "status",
  "desk",
  "accept",
  "update",
  "start",
  "worktree",
  "identity",
  "skills",
  "mcp",
]);

/** The installer verbs Cliffy owns (registered in `buildCli`, not the engine). Kept
 * beside the engine set so the FULL built-in vocabulary lives in one file — the
 * recipe dispatcher is exactly the component that must know every name a recipe can
 * collide with. `main.ts` re-exports the {@link KNOWN_VERBS} union it forms. */
export const KNOWN_INSTALLER_VERBS: ReadonlySet<string> = new Set([
  "setup",
  "upgrade",
  "uninstall",
  "doctor",
  "preset",
  "map",
  "help",
  "config",
]);

/**
 * Every built-in verb the router dispatches itself — installer + engine. This is
 * the SINGLE source of truth for "does a name shadow a built-in?", so the four
 * surfaces that must agree — the router's recipe fallthrough (`main.ts`), the
 * `--help` recipe listing ({@link printProjectRecipes}), the typo suggester's recipe
 * names ({@link projectRecipeNames}), and the shadow warning ({@link
 * warnShadowedRecipe}) — all read THIS set and cannot diverge. `main.ts` re-exports
 * it as its own `KNOWN_VERBS`; the parity guard ties it to the live registrations.
 */
export const KNOWN_VERBS: ReadonlySet<string> = new Set<string>([
  ...KNOWN_INSTALLER_VERBS,
  ...KNOWN_ENGINE_VERBS,
]);

/** Hyphenated engine recipe filenames plus their displayed command form, for the suggester.
 * Intentionally NOT equal to {@link KNOWN_ENGINE_VERBS}: it drops the command-group
 * verbs that have no recipe form (skills, mcp) and adds the worktree sub-recipes
 * (worktree-setup/create/remove/ensure/teardown/drop/prune). That deliberate relationship is
 * tied to the verb SSOT by `tests/engine_verb_parity_test.ts`, so a new engine verb
 * forces a conscious choice here rather than silently drifting. */
export const ENGINE_RECIPE_NAMES: readonly string[] = [
  "done",
  "prepare",
  "test",
  "improvement",
  "standards",
  "refresh",
  "impact",
  "coupling",
  "status",
  "accept",
  "update",
  "start",
  "identity",
  "worktree-setup",
  "worktree-create",
  "worktree-remove",
  "worktree-ensure",
  "worktree-teardown",
  "worktree-drop",
  "worktree-prune",
];

/** Render a recipe filename as the user-facing command (worktree-teardown -> worktree teardown). */
function displayName(name: string): string {
  if (name === "identity") {
    return "identity";
  }
  if (name.startsWith("worktree-")) {
    return "worktree " + name.slice("worktree-".length);
  }
  if (name.startsWith("done-")) {
    return `done:${name.slice("done-".length)}`;
  }
  return name;
}

/** Logger for engine human output — info/ok/heading → stdout; NO_COLOR /
 * non-TTY honoured by Logger. */
function makeLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

const NO_PROJECT =
  "not inside a discern project (no discern.toml in this directory or any parent).";

/** Resolve the project root, or print a not-found error and exit 1. */
async function requireRoot(): Promise<string> {
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT}`);
    console.error("       Run `discern setup` to scaffold one.");
    Deno.exit(1);
  }
  return root;
}

/** Map a thrown worktree error to an exit code, logging its message. */
function handleWorktreeError(e: unknown, log: Logger): number {
  if (e instanceof WorktreeGitError || e instanceof IdentityError) {
    log.error(e.message);
    return 1;
  }
  throw e;
}

/**
 * Build a lifecycle context and run a worktree operation, mapping errors to codes.
 * In `--json` mode the human narration is suppressed (Logger json mode) so stdout
 * carries only the verb's JSON object, and a thrown worktree error is emitted as a
 * `DiscernResult` (`{ok:false, verb, error, message}`) rather than a (suppressed)
 * human line — a precondition slug in `error`, the human sentence in `message`.
 */
async function runWorktreeOp(
  op: (ctx: LifecycleContext) => Promise<void>,
  opts: { json?: boolean; verb?: string } = {},
): Promise<number> {
  const root = await requireRoot();
  const json = opts.json ?? false;
  const log = new Logger({
    json,
    noColor: false,
    humanStream: json ? "stderr" : "stdout",
  });
  try {
    await op(await lifecycleContext(root, log));
    return 0;
  } catch (e) {
    if (json) {
      const mapped = worktreeErrorResult(opts.verb ?? "worktree", e);
      if (mapped !== undefined) {
        emitResult(mapped);
        return 1;
      }
    }
    return handleWorktreeError(e, log);
  }
}

/**
 * Defence in depth behind the `status` banner: the SessionStart hook runs
 * `discern worktree ensure` on every session start, so a session opened while
 * one-time setup is still outstanding ([meta].bootstrapped unset) is told — at the
 * top, before it does anything — to resume and finish it, rather than assuming the
 * earlier session completed it. Plain stdout, which a SessionStart hook injects as
 * context; provider-neutral (no hook-schema coupling). Gated on !bootstrapped, so a
 * finished project never walks the tree on session start.
 */
async function remindIfSetupUnfinished(ctx: LifecycleContext): Promise<void> {
  if (ctx.config.meta.bootstrapped) {
    return;
  }
  const pending = await findSkeletonMarkers(ctx.root);
  ctx.log.line(`[discern] ${setupUnfinishedHint(pending)}`);
}

/** Attach the engine task-runner verbs to the `discern` root command — every verb
 * unconditionally (ADR 0101: the subsystems are all core). */
export function attachEngineCommands(root: Command): void {
  root
    .command("done")
    .description(
      "Run your finishing steps (including formatters), then verify the full quality gate.",
    )
    .option(
      "--json",
      "Emit the gate result as a JSON DiscernResult on stdout (steps + diagnostics).",
    )
    .option(
      "--dry-run",
      "Show the gate plan (the jobs and scope-gates that would run); touch nothing.",
    )
    .action(async (o) => {
      Deno.exit(
        await runFinish(await requireRoot(), {
          json: o.json ?? false,
          dryRun: o.dryRun ?? false,
        }),
      );
    });

  root
    .command("prepare")
    .description(
      "Fast inner loop: the fixers, then the read-only checks (no build, no tests).",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (output → stderr).",
    )
    .action(async (o) => {
      Deno.exit(
        await runPrepare(await requireRoot(), { json: o.json ?? false }),
      );
    });

  root
    .command("test")
    .description(
      "Run the project's tests (the test stage) on their own, outside the full gate.",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (output → stderr).",
    )
    .action(async (o) => {
      Deno.exit(
        await runTestCapability(await requireRoot(), { json: o.json ?? false }),
      );
    });

  root
    .command("improvement")
    .description(
      "Find the highest-value next improvement, with the health audit and open reviews for agent and owner to evaluate together.",
    )
    .option(
      "--json",
      "Emit the coaching result as JSON (baseline score, open reviews, and data.next_action).",
    )
    .option(
      "--category <name:string>",
      `Review a single area (${CATEGORY_NAMES.join(", ")}).`,
    )
    .option(
      "--min-score <n:number>",
      "Exit non-zero when the overall score is below this floor (a CI/agent gate).",
    )
    .option(
      "--no-interactive",
      "Print the full static report instead of the interactive drill-down (also implied off a TTY).",
    )
    .action(async (o) => {
      Deno.exit(
        await runImprovement(await requireRoot(), {
          json: o.json ?? false,
          category: o.category,
          minScore: o.minScore,
          // Cliffy maps `--no-interactive` to a negatable `interactive` boolean.
          interactive: o.interactive,
        }),
      );
    });

  root
    .command("mcp")
    .description(
      "The stdio MCP server, exposing the verbs to an agent as tools. You don't usually need to run this; agents should connect automatically.",
    )
    .action(async () => {
      // The server resolves the project root itself and reports a missing one
      // per tool-call, so it need not requireRoot up front.
      Deno.exit(await runMcpServer());
    });

  root
    .command("standards")
    .description(
      "Check every quality standard — numbers that can never get worse (slow; on demand, outside `discern done`).",
    )
    .arguments("[names...:string]")
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult object on stdout.",
    )
    .option(
      "--dry-run",
      "Show the standards that would be measured; touch nothing.",
    )
    .option(
      "--force",
      "Run standards on a dirty worktree; intended only while authoring standards.",
    )
    .option(
      "--pin",
      "Capture measured improvements: tighten each limit to the value just measured (the named standards, or every one with slack), commit that change on its own, and carry the gate-pass receipt forward. Requires a clean worktree.",
    )
    .action(async (o, ...names: string[]) => {
      Deno.exit(
        await runStandards(await requireRoot(), {
          json: o.json ?? false,
          dryRun: o.dryRun ?? false,
          force: o.force ?? false,
          pin: o.pin ?? false,
          pinNames: names,
        }),
      );
    });

  root
    .command("refresh")
    .description(
      "Refresh the generated agent files, skills, and integration artifacts.",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (narration → stderr).",
    )
    .action(async (o) => {
      const root = await requireRoot();
      const json = o.json ?? false;
      // --json: narration → stderr, the result envelope → stdout. Human: narrate
      // to stdout via the default logger.
      const log = json
        ? new Logger({ json: true, noColor: false, humanStream: "stderr" })
        : new Logger({ json: false, noColor: false, humanStream: "stdout" });
      const res = await refreshResult(root, log);
      if (json) {
        emitResult(res);
      }
      Deno.exit(res.ok ? 0 : 1);
    });

  attachSkillsCommand(root);

  root
    .command("impact")
    .description(
      "Show this change's impact: classify which gate scopes the branch and working tree wake.",
    )
    .option(
      "--json",
      "Emit a JSON DiscernResult (data.scopes lists the changed scopes/markers).",
    )
    .option(
      "--has <scope:string>",
      "Exit 0/1 membership test for one scope (silent).",
    )
    .action(async (o) => {
      Deno.exit(
        await runImpact(await requireRoot(), {
          json: o.json ?? false,
          ...(o.has !== undefined ? { has: o.has } : {}),
        }),
      );
    });

  root
    .command("coupling")
    .description(
      "Surface files that historically change together (advisory; never blocks). " +
        "No args: what co-changes with your branch's changes but is missing. One file: " +
        "its top partners. Two files: the commits where both changed.",
    )
    .option(
      "--json",
      "Emit a JSON DiscernResult.",
    )
    .arguments("[file:string] [with:string]")
    .action(async (o, file, withFile) => {
      const paths = [file, withFile].filter((p): p is string =>
        p !== undefined
      );
      Deno.exit(
        await runCoupling(await requireRoot(), {
          json: o.json ?? false,
          ...(paths.length > 0 ? { paths } : {}),
        }),
      );
    });

  // `status` — read-only situation/orientation: what's true right now and what to
  // do next. It resolves the root itself so the not-initialized case is the
  // uniform envelope under --json.
  root
    .command("status")
    .description(
      "Show what's true right now and what to do next (read-only; never runs the gate).",
    )
    .option(
      "--all",
      "Include the fleet survey even from a worktree (local view PLUS the fleet).",
    )
    .option(
      "--local",
      "Local view only — suppress the fleet survey even in the main checkout.",
    )
    .option(
      "--json",
      "Emit the status as a JSON DiscernResult on stdout (data.location/git/fleet…).",
    )
    .action(async (o) => {
      Deno.exit(
        await runStatus({
          json: o.json ?? false,
          all: o.all ?? false,
          local: o.local ?? false,
        }),
      );
    });

  root
    .command("desk")
    .description(
      "Your interactive desk over the worktree fleet: pick an effort, land, update, drop, or jump in. Bare `discern` opens it.",
    )
    .option(
      "--json",
      "Refused — the desk is interactive-only; use `status --json` for the fleet survey.",
    )
    .action(async (o) => {
      Deno.exit(await runDesk({ json: o.json ?? false }));
    });

  root
    .command("start")
    .description(
      "Create a fresh isolated worktree from the main checkout and print where to move into it. Optionally --name it after the task you're starting.",
    )
    .option(
      "--json",
      "Emit a machine-readable (plan, result) object on stdout (data.path is the new worktree).",
    )
    .option("--dry-run", "Show the start plan; touch nothing.")
    .option(
      "--name <name:string>",
      "Name the worktree after this task (a slug or a few words — discern normalises it into a branch-safe name). Omit for a random codename.",
    )
    .option(
      "--from <ref:string>",
      "Branch the new worktree from this ref (a branch, tag, or commit) instead of the trunk. For building on unlanded work — omit it for everyday starts.",
    )
    .action(async (o) => {
      const json = o.json ?? false;
      Deno.exit(
        await runWorktreeOp(
          (ctx) =>
            start(ctx, {
              json,
              dryRun: o.dryRun ?? false,
              name: o.name ?? "",
              ...(o.from !== undefined ? { from: o.from } : {}),
              // WHERE the worktree lands is the feature-layer placement convention,
              // resolved here and passed in — the engine core bakes in none (ADR 0052),
              // exactly as the worktree prune wiring below does.
              worktreeRoot: resolveWorktreeRoot(ctx.root, ctx.config),
            }),
          { json, verb: "start" },
        ),
      );
    });

  root
    .command("accept")
    .description(
      "Accept and land this worktree's finished branch on the trunk: fast-forward it, remove the worktree, delete the merged branch, refresh the trunk checkout.",
    )
    .option(
      "--json",
      "Emit a machine-readable (plan, results) object on stdout.",
    )
    .option("--dry-run", "Show the acceptance plan; touch nothing.")
    .action(async (o) => {
      const json = o.json ?? false;
      Deno.exit(
        await runWorktreeOp(
          (ctx) =>
            accept(ctx, {
              json,
              dryRun: o.dryRun ?? false,
            }),
          { json, verb: "accept" },
        ),
      );
    });

  root
    .command("update")
    .description(
      "Update this branch: merge the trunk's latest into it and re-materialize the generated agent files. Use `discern upgrade` for discern itself; use `discern refresh` for generated agent files alone.",
    )
    .option(
      "--json",
      "Emit a machine-readable (plan, results) object on stdout.",
    )
    .option("--dry-run", "Show the update plan; touch nothing.")
    .option(
      "--from <ref:string>",
      "Pull this ref (a branch, tag, or commit) into the worktree instead of the trunk. For composing on unlanded work — omit it for the routine bring-the-trunk-in call.",
    )
    .action(async (o) => {
      const json = o.json ?? false;
      Deno.exit(
        await runWorktreeOp(
          (ctx) =>
            update(ctx, {
              json,
              dryRun: o.dryRun ?? false,
              ...(o.from !== undefined ? { from: o.from } : {}),
            }),
          { json, verb: "update" },
        ),
      );
    });

  root
    .command("identity")
    .description(
      "Resolve a worktree's stable identity (id/site/branch/port/db/worktree/resource).",
    )
    .option("--id", "Print the safe worktree id (default).")
    .option("--site", "Print the dev-server site/host name.")
    .option("--branch", "Print the default branch name.")
    .option("--port", "Print the deterministic dev-server port.")
    .option("--db", "Print the database-name-safe identity.")
    .option(
      "--worktree",
      "Print the worktree's base resource handle (slug-id).",
    )
    .option(
      "--resource <name:string>",
      "Print a named resource's handle (slug-id-name).",
    )
    .option(
      "--resources",
      "Print every declared resource as name=handle lines.",
    )
    .arguments("[path:string]")
    .action(async (o, path) => {
      const root = await requireRoot();
      const target = path ?? Deno.cwd();
      try {
        if (o.resource !== undefined) {
          console.log(await identityResourceHandle(root, o.resource, target));
        } else if (o.resources) {
          for (const line of await identityResourcesList(root, target)) {
            console.log(line);
          }
        } else {
          // Derive the selected field from the WORKTREE_FIELDS SSOT (id is the
          // default), so a new identity field is selectable here without editing this
          // branch — the CLI flags themselves are tied to the SSOT by a parity test.
          const field = WORKTREE_FIELDS.find((f) =>
            f !== "id" && o[f] === true
          ) ??
            "id";
          console.log(await identityField(root, field, target));
        }
        Deno.exit(0);
      } catch (e) {
        if (e instanceof IdentityError) {
          console.error(e.message);
          Deno.exit(1);
        }
        throw e;
      }
    });

  const worktreeSetupCommand = new Command()
    .description("Set up or re-converge the current linked worktree.")
    .option(
      "--json",
      "Emit a machine-readable (plan, results) object on stdout.",
    )
    .option("--dry-run", "Show the setup plan; touch nothing.")
    .action(async (o) => {
      const json = o.json ?? false;
      Deno.exit(
        await runWorktreeOp(
          (ctx) => worktreeSetup(ctx, { json, dryRun: o.dryRun ?? false }),
          { json, verb: "worktree setup" },
        ),
      );
    });

  const worktree = new Command()
    .description("Manage this checkout's linked worktree lifecycle.")
    .action(function (): void {
      this.showHelp();
    })
    .command("setup", worktreeSetupCommand)
    .command(
      "ensure",
      new Command()
        .description("Idempotent session-start worktree setup.")
        .action(async () => {
          Deno.exit(
            await runWorktreeOp(async (ctx) => {
              await remindIfSetupUnfinished(ctx);
              await worktreeEnsure(ctx);
            }),
          );
        }),
    )
    .command(
      "teardown",
      new Command()
        .description(
          "Discard this worktree's resources (destroy without accepting).",
        )
        .option(
          "--json",
          "Emit the result as a JSON DiscernResult object on stdout.",
        )
        .option("--dry-run", "Show the teardown plan; touch nothing.")
        .action(async (o) => {
          const json = o.json ?? false;
          Deno.exit(
            await runWorktreeOp(
              (ctx) =>
                worktreeTeardown(ctx, { json, dryRun: o.dryRun ?? false }),
              { json, verb: "worktree teardown" },
            ),
          );
        }),
    )
    .command(
      "create",
      new Command()
        .description(
          "WorktreeCreate hook entry: read {name, cwd} JSON on stdin, create the worktree, set it up, and print its path.",
        )
        .action(async () => {
          Deno.exit(await worktreeCreateHook());
        }),
    )
    .command(
      "remove",
      new Command()
        .description(
          "WorktreeRemove hook entry: read {worktree_path} JSON on stdin and tear the worktree down (never fails the event).",
        )
        .action(async () => {
          Deno.exit(await worktreeRemoveHook());
        }),
    )
    .command(
      "drop",
      new Command()
        .description(
          "Discard a worktree from the main checkout: tear down its resources, remove it, delete its branch. Refuses unmerged or uncommitted work without --force.",
        )
        .option(
          "--force",
          "Discard even when the worktree holds uncommitted changes or commits not on the trunk.",
        )
        .option("--dry-run", "Show the drop plan; touch nothing.")
        .option(
          "--json",
          "Emit the result as a JSON DiscernResult object on stdout.",
        )
        .arguments("<target:string>")
        .action(async (o, target) => {
          const json = o.json ?? false;
          Deno.exit(
            await runWorktreeOp(
              (ctx) =>
                worktreeDrop(ctx, target, {
                  json,
                  dryRun: o.dryRun ?? false,
                  force: o.force ?? false,
                }),
              { json, verb: "worktree drop" },
            ),
          );
        }),
    )
    .command(
      "prune",
      new Command()
        .description(
          "Sweep stale worktrees, fully-merged branches, and orphaned resources.",
        )
        .option("-y, --yes", "Non-interactive: skip the confirm prompt.")
        .option(
          "--dry-run",
          "Report what would be removed/reclaimed without acting.",
        )
        .option(
          "--json",
          "Emit the result as a JSON DiscernResult object on stdout.",
        )
        .action(async (o) => {
          const json = o.json ?? false;
          Deno.exit(
            await runWorktreeOp(
              (ctx) =>
                worktreePrune(ctx, {
                  assumeYes: o.yes ?? false,
                  dryRun: o.dryRun ?? false,
                  json,
                  // The engine sweeps git-derived worktree parents on its own; the
                  // configured root (a location convention the engine does not know)
                  // is passed so a FULLY-orphaned root is still reclaimed (ADR 0052).
                  extraScanDirs: [resolveWorktreeRoot(ctx.root, ctx.config)],
                }),
              { json, verb: "worktree prune" },
            ),
          );
        }),
    );
  root.command("worktree", worktree);
}

/** Attach the `skills` command group (list / eject). */
function attachSkillsCommand(root: Command): void {
  const skills = new Command()
    .description(
      "Manage skills: list the effective set, or eject a built-in to customize it.",
    )
    .action(function (): void {
      this.showHelp();
    })
    .command(
      "list",
      new Command()
        .description(
          "List the effective skills (built-ins + yours; which override which).",
        )
        .option(
          "--json",
          "Emit the listing as a JSON DiscernResult (data.skills).",
        )
        .action(async (o) => {
          Deno.exit(await runSkillsList({ json: o.json ?? false }));
        }),
    )
    .command(
      "eject",
      new Command()
        .description(
          "Copy a bundled built-in into [skills].dir so you can customize it.",
        )
        .option(
          "--json",
          "Emit the eject result as a JSON DiscernResult on stdout.",
        )
        .arguments("<name:string>")
        .action(async (o, name: string) => {
          Deno.exit(
            await runSkillsEject(name, { json: o.json ?? false }),
          );
        }),
    );
  root.command("skills", skills);
}

/** `discern skills list` — print the effective skill set. */
async function runSkillsList(opts: { json: boolean }): Promise<number> {
  const root = await requireRoot();
  const cfg = await loadConfig(root);
  if (opts.json) {
    emitResult(await skillsListResult(root, cfg));
    return 0;
  }
  const rows = await listSkills(root, cfg);
  if (rows.length === 0) {
    console.log("No skills (none bundled, none authored).");
    return 0;
  }
  console.log("Effective skills:");
  for (const r of rows) {
    const base = r.source === "authored"
      ? (r.overridesBundled ? "yours (overrides built-in)" : "yours")
      : "built-in";
    const tag = r.excluded ? `${base} — excluded ([skills].exclude)` : base;
    console.log(`  ${r.name.padEnd(24)} ${tag}`);
  }
  return 0;
}

function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function skillsEjectResult(
  root: string,
  name: string,
): Promise<DiscernResult<SkillsEjectData>> {
  const cfg = await loadConfig(root);
  try {
    const result = await ejectSkill(root, cfg, name);
    // Persist [skills].dir when it wasn't explicitly set, so the override is
    // found by the resolver on the next materialize. Presence is a raw question
    // ("is the key written?"), not a typed one (the typed value always defaults).
    const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
    const text = await Deno.readTextFile(path);
    let skillsDirPersisted = false;
    if (!new RawConfig(text).has("skills.dir")) {
      const editor = new TomlEditor(text);
      editor.setString("skills.dir", cfg.skills.dir);
      await Deno.writeTextFile(path, editor.toString());
      skillsDirPersisted = true;
    }
    // Re-materialize so each agent's skills dir reflects the ejected override now
    // (reloaded, since [skills].dir may have just been written above).
    const updated = await loadConfig(root);
    const materialized = await materializeSkills(
      root,
      updated,
      skillsDirsForAgents(guidanceAgents(updated)),
    );
    const data: SkillsEjectData = {
      name: result.name,
      dest_abs: result.destAbs,
      dest_rel: result.destRel,
      skills_dir_persisted: skillsDirPersisted,
      materialized,
    };
    if (materialized.errors.length > 0) {
      return {
        ok: false,
        verb: "skills eject",
        error: "partial_materialization",
        message:
          `ejected "${name}", but could not materialize every configured agent skill directory`,
        data,
      };
    }
    return { ok: true, verb: "skills eject", data };
  } catch (error) {
    return {
      ok: false,
      verb: "skills eject",
      error: "skills_eject_failed",
      message: thrownMessage(error),
    };
  }
}

function renderSkillsEjectResult(
  log: Logger,
  result: DiscernResult<SkillsEjectData>,
): void {
  if (!result.ok) {
    log.error(result.message ?? "skills eject failed");
    for (const error of result.data?.materialized.errors ?? []) {
      log.detail(error);
    }
    return;
  }
  const data = result.data;
  if (data === undefined) {
    log.error("skills eject returned no result data");
    return;
  }
  log.ok(
    `Ejected "${data.name}" -> ${data.dest_rel} (it now overrides the built-in).`,
  );
  log.info("Edit it there; `discern skills list` confirms the override.");
}

/** `discern skills eject <name>` — copy a built-in into `[skills].dir` to edit. */
async function runSkillsEject(
  name: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await requireRoot();
  const result = await skillsEjectResult(root, name);
  if (opts.json ?? false) {
    emitResult(result);
  } else {
    renderSkillsEjectResult(
      new Logger({ json: false, noColor: false, humanStream: "stdout" }),
      result,
    );
  }
  return result.ok ? 0 : 1;
}

/** Length of the common leading run of two strings. */
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) {
    n++;
  }
  return n;
}

/** Length of the common trailing run of two strings. */
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (
    n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]
  ) {
    n++;
  }
  return n;
}

/** Whether `name` is a plausible near-match for the folded typo. */
function matchCandidate(typo: string, name: string): boolean {
  if (name.includes(typo) || typo.includes(name)) {
    return true;
  }
  if (
    Math.abs(typo.length - name.length) <= 2 && commonPrefixLen(typo, name) >= 3
  ) {
    return true;
  }
  return commonSuffixLen(typo, name) >= 4;
}

/** Executable project recipes (file is executable) carrying a `# desc:` line. */
async function projectRecipeNames(recipesAbs: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(recipesAbs)) {
      if (!entry.isFile) {
        continue;
      }
      if (!(await isExecutable(join(recipesAbs, entry.name)))) {
        continue;
      }
      // Skip a recipe shadowed by ANY built-in (it would never run) — the same set
      // the router refuses, so listing/suggesting can't advertise an unrunnable name.
      if (KNOWN_VERBS.has(entry.name)) {
        continue;
      }
      names.push(entry.name);
    }
  } catch {
    // no recipes dir — nothing to suggest
  }
  return names;
}

/** Suggest a near-matching recipe for a typo, or undefined. */
async function suggestRecipe(
  recipesAbs: string,
  typo: string,
): Promise<string | undefined> {
  const folded = typo.replace(/:/g, "-");
  for (const name of ENGINE_RECIPE_NAMES) {
    if (matchCandidate(folded, name)) {
      return displayName(name);
    }
  }
  for (const name of await projectRecipeNames(recipesAbs)) {
    if (matchCandidate(folded, name)) {
      return displayName(name);
    }
  }
  return undefined;
}

/** Whether a path is an executable regular file. */
async function isExecutable(path: string): Promise<boolean> {
  try {
    const st = await Deno.stat(path);
    return st.isFile && ((st.mode ?? 0) & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Internal helper verbs — callable for scripts/tests, but collapsed out of the
 * main help listing. The SSOT for the helper
 * vocabulary: {@link HELPER_HANDLERS} is a total `Record<HelperVerb, …>` keyed by it,
 * so a helper added here without a handler (or vice versa) fails `deno check` — the
 * membership test ({@link isHelperVerb}) and the dispatch can never disagree on which
 * verbs are helpers. */
const HELPER_VERBS = [
  "remove-worktree-safely",
  "inherit-main-env-vars",
  "with-gotchas",
] as const;
/** One internal helper verb ({@link HELPER_VERBS}). */
type HelperVerb = (typeof HELPER_VERBS)[number];

const HELPER_VERB_SET: ReadonlySet<string> = new Set(HELPER_VERBS);

/** Whether `verb` is an internal helper verb (narrows it to {@link HelperVerb}). */
export function isHelperVerb(verb: string): verb is HelperVerb {
  return HELPER_VERB_SET.has(verb);
}

/** The handler for each helper verb — a TOTAL record, so a new {@link HELPER_VERBS}
 * member is a COMPILE error here until it is wired (and a handler for a non-helper
 * can't slip in). The dispatch derives from this, never a parallel switch. */
const HELPER_HANDLERS: Record<
  HelperVerb,
  (args: string[]) => Promise<number>
> = {
  "remove-worktree-safely": helperRemoveWorktree,
  "inherit-main-env-vars": helperInheritEnv,
  "with-gotchas": helperWithGotchas,
};

/**
 * Dispatch an internal helper verb, or return null if `verb` is not one. Handled
 * before Cliffy so a wrapped command's flags (`with-gotchas sh -c …`) pass raw.
 */
export async function dispatchHelper(
  verb: string,
  args: string[],
): Promise<number | null> {
  return isHelperVerb(verb) ? await HELPER_HANDLERS[verb](args) : null;
}

/** `remove-worktree-safely <path>` — robustly remove a worktree of this repo. */
async function helperRemoveWorktree(args: string[]): Promise<number> {
  const target = args[0];
  if (target === undefined) {
    console.error("remove-worktree-safely: a path argument is required.");
    return 1;
  }
  const log = makeLogger();
  try {
    await removeWorktreeSafely(target, Deno.cwd());
    return 0;
  } catch (e) {
    return handleWorktreeError(e, log);
  }
}

/** `inherit-main-env-vars` — copy [worktree].inherit_env vars from main's env files. */
async function helperInheritEnv(): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT}`);
    return 1;
  }
  const log = makeLogger();
  const cfg = await loadConfig(root);
  try {
    await inheritMainEnvVars({
      worktreeRoot: root,
      vars: cfg.worktree.inherit_env,
      files: cfg.worktree.env_files,
      log,
    });
    return 0;
  } catch (e) {
    return handleWorktreeError(e, log);
  }
}

/** `with-gotchas <command> [args…]` — run a command; on failure print the gotchas
 * pointer and propagate its exit code (no `set -e`: it observes the failure). */
async function helperWithGotchas(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined) {
    console.error("with-gotchas: no command given.");
    return 1;
  }
  const child = new Deno.Command(command, {
    args: rest,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const code = (await child.status).code;
  if (code !== 0) {
    const root = await findRoot();
    if (root !== undefined) {
      gotchasHint(await loadConfig(root), root, colorEnabled());
    }
  }
  return code;
}

/**
 * `discern config <get|array|has|subsections|keys> <key>` — the READ side of the
 * config surface. This is what a project recipe uses to read `discern.toml`:
 * `has` answers via the exit code; the rest print to stdout.
 */
export async function runConfigRead(
  op: "get" | "array" | "has" | "subsections" | "keys",
  key: string,
): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT}`);
    return 1;
  }
  // The recipe-facing passthrough reads ARBITRARY dotted keys verbatim, so it uses
  // the raw reader (no schema, no defaults) rather than the typed loader.
  const cfg = await RawConfig.load(root);
  switch (op) {
    case "get":
      console.log(cfg.get(key));
      return 0;
    case "array":
      for (const v of cfg.array(key)) {
        console.log(v);
      }
      return 0;
    case "has":
      return cfg.has(key) ? 0 : 1;
    case "subsections":
      for (const v of cfg.subsections(key)) {
        console.log(v);
      }
      return 0;
    case "keys":
      for (const v of cfg.keys(key)) {
        console.log(v);
      }
      return 0;
  }
}

/** Read a recipe's first `# desc:` line, or undefined when it has none. */
async function firstDescLine(file: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(file);
  } catch {
    return undefined;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^# desc:\s?(.*)$/);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

/** True when a path exists (any type). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** The project recipes directory: its configured name and absolute path
 * (`[recipes].dir`, default `./recipes`). */
function recipesDirOf(
  root: string,
  cfg: DiscernConfig,
): { rel: string; abs: string } {
  return resolveRecipesDir(root, cfg);
}

/**
 * Print the "Project recipes" help section: executables under the recipes dir
 * carrying a `# desc:` line, skipping any name shadowed by a built-in. No-op
 * outside a project or when there are no listable recipes.
 *
 * This runs on the `--help` / bare-`discern` path, so it must render and NEVER
 * throw on bad project state — help is exactly when a broken discern.toml most
 * needs to keep working. A config that can't be read (unparseable or
 * schema-invalid) degrades the recipe section to a one-line notice on stdout
 * (the help stream) instead of throwing out and truncating the help with a
 * non-zero exit.
 */
export async function printProjectRecipes(): Promise<void> {
  const root = await findRoot();
  if (root === undefined) {
    return;
  }
  let cfg: DiscernConfig;
  try {
    cfg = await loadConfig(root);
  } catch {
    // The recipe listing needs `[recipes].dir` from the typed config; without a
    // readable one, say so in a line and let the rest of the help stand.
    console.log(
      "\nProject recipes: unavailable (discern.toml could not be read).",
    );
    return;
  }
  const { rel, abs } = recipesDirOf(root, cfg);
  const lines: string[] = [];
  try {
    for await (const entry of Deno.readDir(abs)) {
      // Skip a recipe shadowed by ANY built-in — the same set the router refuses, so
      // help never lists a name that can never run.
      if (!entry.isFile || KNOWN_VERBS.has(entry.name)) {
        continue;
      }
      const file = join(abs, entry.name);
      if (!(await isExecutable(file))) {
        continue;
      }
      const desc = await firstDescLine(file);
      if (desc === undefined) {
        continue;
      }
      lines.push(`  ${displayName(entry.name).padEnd(20)} ${desc}`);
    }
  } catch {
    return; // no recipes dir
  }
  if (lines.length === 0) {
    return;
  }
  console.log(`\nProject recipes (from ${rel}):`);
  for (const line of lines) {
    console.log(line);
  }
}

/**
 * Warn (to stderr) when a project recipe is shadowed by the built-in `verb`. This is
 * advisory human narration, so it MUST stay silent under `--json`: the combined
 * stdout+stderr of any `<verb> --json` is exactly one envelope (ADR 0030), and a
 * stray warning line would pollute it (B35). `json` is passed from the router, which
 * knows the mode before the verb runs.
 */
export async function warnShadowedRecipe(
  verb: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  if (opts.json ?? false) {
    return;
  }
  const root = await findRoot();
  if (root === undefined) {
    return;
  }
  // Advisory only: without a loadable config the recipes dir is unknowable, so a
  // broken or schema-invalid config means "no shadow warning" — never a throw that
  // would abort the verb before its own handler (e.g. `doctor`) can run.
  const cfg = await loadConfig(root).catch(() => undefined);
  if (cfg === undefined) {
    return;
  }
  const { abs } = recipesDirOf(root, cfg);
  if (await pathExists(join(abs, verb.replace(/:/g, "-")))) {
    console.error(
      `discern: project recipe "${verb}" is shadowed by a built-in and was NOT run.`,
    );
  }
}

/**
 * Handle an unknown top-level verb: exec a matching project recipe under
 * `.discern/recipes/` (the engine always wins, so a recipe colliding with a
 * built-in is unreachable here), report an existing-but-non-executable recipe,
 * else print an "unknown recipe" message with a near-match suggestion. Returns
 * the process exit code.
 */
export async function dispatchRecipeOrSuggest(
  verb: string,
  args: string[],
): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT}`);
    console.error("       Run `discern setup` to scaffold one.");
    return 1;
  }
  const cfg = await loadConfig(root);
  const { rel: recipesDir, abs: recipesAbs } = recipesDirOf(root, cfg);
  const recipeFile = join(recipesAbs, verb.replace(/:/g, "-"));

  if (await isExecutable(recipeFile)) {
    const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
      cfg.project.main_branch;
    const tomlPath = join(root, (await installedConfigRel(root)) ?? CONFIG_REL);
    const child = new Deno.Command(recipeFile, {
      args,
      env: recipeEnvVars({
        root,
        tomlPath,
        recipesDir,
        recipesAbs,
        mainBranch,
      }),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    return (await child.status).code;
  }

  if (await pathExists(recipeFile)) {
    console.error(
      `discern: recipe "${verb}" exists but is not executable: ${recipeFile}`,
    );
    console.error(`       Run: chmod +x "${recipeFile}"`);
    return 1;
  }

  console.error(`discern: unknown recipe "${verb}".`);
  const guess = await suggestRecipe(recipesAbs, verb);
  if (guess !== undefined) {
    console.error(`       Did you mean \`${guess}\`?`);
  }
  return 1;
}
