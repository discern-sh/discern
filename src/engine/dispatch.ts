/**
 * The engine-verb dispatcher: attaches the project task-runner verbs to the
 * `discern` CLI, including the `scripts` namespace for project-owned executables
 * under `[scripts].dir` (whose default comes from the paths registry).
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
  fire,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../shared/hints.ts";
import {
  observeResult,
  observeSupplementalHints,
} from "../shared/result_capture.ts";
import {
  findSkeletonMarkers,
  setupUnfinishedHint,
} from "../shared/setup_state.ts";
import {
  CONFIG_REL,
  findRoot,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
} from "../shared/env.ts";
import {
  resolveConfigPath,
  resolveScriptsDir,
  resolveWorktreeRoot,
} from "../lib/paths.ts";
import type {
  ConfigData,
  IdentityData,
  SkillsEjectData,
} from "../shared/result_schemas.ts";
import { Logger } from "../lib/log.ts";
import { plainModeEnabled } from "../lib/prompts.ts";
import { CATEGORY_NAMES } from "./improve/rules.ts";
import type { LifecycleContext } from "./worktree/lifecycle.ts";
import { colorEnabled } from "./output.ts";
import { commandSynonymSuggestion } from "../shared/vocabulary.ts";
import type { DiscernResult } from "../shared/result.ts";
import { reportUnknownCommand } from "./unknown_command.ts";
import { runOwnedChild } from "./owned_child.ts";
import { recordedExit } from "./logbook/cli.ts";
import { runCommandGroup } from "../shared/command_group.ts";
import {
  AWAIT_LONG_CALL_SECONDS,
  MCP_LONG_TOOL_CALLS_FLAG,
  MCP_STRICT_TOOL_CALLS_FLAG,
} from "../shared/mcp_timeout_policy.ts";

export { reportUnknownCommand } from "./unknown_command.ts";
export {
  KNOWN_ENGINE_VERBS,
  KNOWN_INSTALLER_VERBS,
  KNOWN_VERBS,
} from "../shared/verbs.ts";

// Verb BODIES load at dispatch time (`await import(…)` inside each action),
// never at registration: every invocation — `--help` included — builds the
// whole Cliffy tree through this module, so a static verb-body import would
// tax every spawn with that verb's entire subtree. The pattern is load-bearing
// for CLI startup; a new verb's action must lazy-import its implementation the
// same way. Type-only imports stay static (they are erased at runtime).

/** The worktree lifecycle module, loaded at verb-run time by
 * {@link runWorktreeOp} and handed to each operation callback so the callback
 * names its operation without re-importing. */
type LifecycleModule = typeof import("./worktree/lifecycle.ts");

/** Built-in command names considered by the typo suggester.
 * Intentionally NOT equal to {@link KNOWN_ENGINE_VERBS}: it drops command-group
 * verbs and adds the worktree subcommands. That deliberate relationship is
 * tied to the verb SSOT by `tests/engine_verb_parity_test.ts`, so a new engine verb
 * forces a conscious choice here rather than silently drifting. */
export const SUGGESTABLE_ENGINE_COMMANDS: readonly string[] = [
  "done",
  "prepare",
  "test",
  "await",
  "improvement",
  "standards",
  "refresh",
  "tidy",
  "impact",
  "coupling",
  "patterns",
  "status",
  "accept",
  "update",
  "start",
  "identity",
  "worktree-setup",
  "worktree-ensure",
  "worktree-teardown",
  "worktree-drop",
  "worktree-prune",
];

/** Render an internal command token in its user-facing form. */
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

/**
 * Resolve the project root, or refuse and exit 1. The refusal is the engine's
 * ONE not-initialized chokepoint: under `--json` it emits the uniform
 * `not_initialized` envelope on stdout — the machine slug an agent branches on —
 * and in human mode the canonical stderr line. Every engine verb that needs a
 * project passes its verb name and json flag here, so a new verb inherits the
 * structured refusal for free (`tests/engine_not_initialized_test.ts` holds the
 * whole verb surface to it).
 */
async function requireRoot(verb: string, json: boolean): Promise<string> {
  const root = await findRoot();
  if (root === undefined) {
    if (json) {
      emitResult(notInitializedResult(verb));
    } else {
      console.error(`discern: ${NO_PROJECT_MESSAGE}`);
    }
    Deno.exit(1);
  }
  return root;
}

/** Map a thrown worktree error to an exit code, logging its message. `lc` is
 * the already-loaded lifecycle module — the caller holds it, so the error
 * classes compared by `instanceof` are the same objects the operation threw. */
function handleWorktreeError(
  e: unknown,
  log: Logger,
  lc: Pick<LifecycleModule, "WorktreeGitError" | "IdentityError">,
): number {
  if (e instanceof lc.WorktreeGitError || e instanceof lc.IdentityError) {
    log.error(`discern: ${e.message}`);
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
  op: (ctx: LifecycleContext, lc: LifecycleModule) => Promise<void>,
  opts: { json?: boolean; verb?: string } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const root = await requireRoot(opts.verb ?? "worktree", json);
  const lc = await import("./worktree/lifecycle.ts");
  const log = new Logger({
    json,
    noColor: false,
    humanStream: json ? "stderr" : "stdout",
  });
  try {
    await op(await lc.lifecycleContext(root, log), lc);
    return 0;
  } catch (e) {
    if (json) {
      const mapped = lc.worktreeErrorResult(opts.verb ?? "worktree", e);
      if (mapped !== undefined) {
        emitResult(mapped);
        return 1;
      }
    }
    return handleWorktreeError(e, log, lc);
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
  ctx.log.line(`[discern] ${setupUnfinishedHint(pending).text}`);
}

/** Attach the engine task-runner verbs to the `discern` root command — every verb
 * unconditionally (ADR 0101: the subsystems are all core). */
export function attachEngineCommands(
  root: Command,
  mainBranch?: string,
): void {
  const trunkName = mainBranch === undefined ? "" : ` (\`${mainBranch}\`)`;
  root
    .command("done")
    .description(
      "Run finishing steps that may change files, then verify the gate — the project's " +
        "full quality check: format, lint, type-check, and tests.",
    )
    .option(
      "--json",
      "Emit the gate result as a JSON DiscernResult on stdout (steps + diagnostics).",
    )
    .option(
      "--dry-run",
      "Show the gate plan (the jobs and scope-gates that would run); touch nothing.",
    )
    .option(
      "--confirmed",
      "Attest this rerun: run the full gate again on the exact tree it last " +
        "judged — a flake probe, or a re-measure — and record it. Without the " +
        "flag, an unchanged-tree rerun refuses read-only; a dry-run never needs it.",
    )
    .action(
      recordedExit("done", async (o) => {
        const { runFinish } = await import("./gate/finish.ts");
        return await runFinish(await requireRoot("done", o.json ?? false), {
          json: o.json ?? false,
          dryRun: o.dryRun ?? false,
          confirmed: o.confirmed ?? false,
          plain: plainModeEnabled(),
        });
      }),
    );

  root
    .command("prepare")
    .description(
      "Fast inner loop: the fixers, then the read-only checks (no build, no tests).",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (output → stderr).",
    )
    .action(
      recordedExit("prepare", async (o) => {
        const { runPrepare } = await import("./gate/prepare.ts");
        return await runPrepare(
          await requireRoot("prepare", o.json ?? false),
          { json: o.json ?? false },
        );
      }),
    );

  root
    .command("test")
    .description(
      "Run the project's configured tests on their own, outside the full gate.",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (output → stderr).",
    )
    .action(
      recordedExit("test", async (o) => {
        const { runTestJob } = await import("./gate/test.ts");
        return await runTestJob(await requireRoot("test", o.json ?? false), {
          json: o.json ?? false,
        });
      }),
    );

  root
    .command("improvement")
    .description(
      "Find the highest-value next improvement, with the health audit and open reviews for agent and owner to evaluate together.",
    )
    .option(
      "--json",
      "Emit the coaching result as JSON (practice-health score, open reviews, and data.next_action).",
    )
    .option(
      "--category <name:string>",
      `Review a single area (${CATEGORY_NAMES.join(", ")}).`,
    )
    .option(
      "--min-score <n:number>",
      "Exit non-zero when the overall score is below this floor (a CI/agent gate).",
    )
    .action(
      recordedExit("improvement", async (o) => {
        const { runImprovement } = await import("./improve/improve.ts");
        return await runImprovement(
          await requireRoot("improvement", o.json ?? false),
          {
            json: o.json ?? false,
            category: o.category,
            minScore: o.minScore,
          },
        );
      }),
    );

  root
    .command("mcp")
    .description(
      "The stdio MCP server, exposing the verbs to an agent as tools. You don't usually need to run this; agents should connect automatically.",
    )
    .option(
      MCP_LONG_TOOL_CALLS_FLAG,
      "Use the configured long-call MCP transport profile.",
      { hidden: true },
    )
    .option(
      MCP_STRICT_TOOL_CALLS_FLAG,
      "Use the strict short-call MCP transport profile.",
      { hidden: true },
    )
    .action(recordedExit("mcp", async (o) => {
      // The server resolves the project root itself and reports a missing one
      // per tool-call, so it need not requireRoot up front.
      const { runMcpServer } = await import("./mcp/server.ts");
      const profile = o.strictToolCalls === true
        ? "strict-client"
        : o.longToolCalls === true
        ? "long-client"
        : "unknown-client";
      return await runMcpServer(profile);
    }));

  root
    .command("scripts")
    .description(
      "List the project's executable project scripts, or run one by name with every following argument forwarded unchanged.",
    )
    .arguments("[name:string] [...args:string]")
    .action(
      recordedExit(
        "scripts",
        async (_o, name: string | undefined, ...args: string[]) => {
          const { runProjectScript } = await import("./project_scripts.ts");
          return await runProjectScript(name, args);
        },
      ),
    );

  root
    .command("standards")
    .description(
      "Measure every quality standard: numbers that can never get worse. `discern done` already verifies and measures them on every run. Authoring one? Hold a rate (`per`) for a number that rises as the project grows, and give a drifting total a `margin` — a ceiling pinned at today's value fails the next legitimate change.",
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
      "Capture measured improvements: tighten each limit to the measured value (the named standards, or every one with slack), commit that change on its own, and carry the gate receipt forward. Requires a clean worktree.",
    )
    .action(
      recordedExit("standards", async (o, ...names: string[]) => {
        const { runStandards } = await import("./gate/standards.ts");
        return await runStandards(
          await requireRoot("standards", o.json ?? false),
          {
            json: o.json ?? false,
            dryRun: o.dryRun ?? false,
            force: o.force ?? false,
            pin: o.pin ?? false,
            pinNames: names,
          },
        );
      }),
    );

  root
    .command("refresh")
    .description(
      "Refresh the agent files, skills, provider integrations, and the " +
        "maintained ADR index. Use " +
        "`discern update` for this branch; use `discern upgrade` for discern itself.",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout (narration → stderr).",
    )
    .action(recordedExit("refresh", async (o) => {
      const json = o.json ?? false;
      const root = await requireRoot("refresh", json);
      const { refreshResult } = await import("./guidelines.ts");
      // --json: narration → stderr, the result envelope → stdout. Human: narrate
      // to stdout via the default logger.
      const log = json
        ? new Logger({ json: true, noColor: false, humanStream: "stderr" })
        : new Logger({ json: false, noColor: false, humanStream: "stdout" });
      const res = await refreshResult(root, log);
      observeResult(res);
      if (json) {
        emitResult(res);
      }
      return res.ok ? 0 : 1;
    }));

  root
    .command("tidy [type:string]")
    .description(
      "Canonically format discern's configured Markdown sources and root discern.toml, and check that fenced box-drawing diagrams stay aligned. Select `md` or `toml`; omit the type to run both. A Markdown file whose frontmatter is not valid YAML, or whose table rows would drop cells when formatted (escape pipes inside code spans as `\\|`), is refused and left unchanged.",
    )
    .option(
      "--json",
      "Emit the result as a JSON DiscernResult on stdout.",
    )
    .option(
      "--dry-run",
      "List the files that would change; touch nothing.",
    )
    .action(recordedExit("tidy", async (o, type: string | undefined) => {
      // Keep the formatter host and embedded WASMs off every other verb's module
      // path. The WASMs are read and instantiated only when tidy formats a file.
      const { runTidy } = await import("./tidy/tidy.ts");
      return await runTidy(await requireRoot("tidy", o.json ?? false), {
        ...(type !== undefined ? { type } : {}),
        json: o.json ?? false,
        dryRun: o.dryRun ?? false,
      });
    }));

  attachSkillsCommand(root);

  root
    .command("impact")
    .description(
      "Show which configured scopes the branch and working tree wake in the quality " +
        "gate. Scopes are named regions of the repository with their own gate jobs.",
    )
    .option(
      "--json",
      "Emit a JSON DiscernResult: changes in `data.scopes`; `--has` in `data.membership`.",
    )
    .option(
      "--has <scope:string>",
      "Test one scope. Bare: print nothing and exit 0/1. JSON: report `data.membership` and exit 0.",
    )
    .action(
      recordedExit("impact", async (o) => {
        const { runImpact } = await import("./scopes/scopes.ts");
        return await runImpact(await requireRoot("impact", o.json ?? false), {
          json: o.json ?? false,
          ...(o.has !== undefined ? { has: o.has } : {}),
        });
      }),
    );

  root
    .command("coupling")
    .description(
      "Report files that historically change together as a read-only advisory. " +
        "With no args, report likely siblings missing from the change. With file, " +
        "report its top partners. Add with to report commits where both changed.",
    )
    .option(
      "--json",
      "Emit a JSON DiscernResult.",
    )
    .arguments("[file:string] [with:string]")
    .action(recordedExit("coupling", async (o, file, withFile) => {
      const paths = [file, withFile].filter((p): p is string =>
        p !== undefined
      );
      const { runCoupling } = await import("./coupling/coupling.ts");
      return await runCoupling(await requireRoot("coupling", o.json ?? false), {
        json: o.json ?? false,
        ...(paths.length > 0 ? { paths } : {}),
      });
    }));

  root
    .command("await")
    .description(
      "Block until a fleet condition holds: a sibling branch is green (its " +
        "worktree holds an honored gate receipt), a branch's work has landed " +
        "on the trunk, or the trunk has moved. Timing out is not an error; " +
        "the result carries a short continuation handle that preserves the " +
        "original condition across calls.",
    )
    .option(
      "--json",
      "Emit a JSON DiscernResult (verdict in `data.met`, state in `data.observed`).",
    )
    .option(
      "--green <branch:string>",
      "Wait until this branch's worktree holds an honored gate receipt (a landing also satisfies it).",
    )
    .option(
      "--landed <branch:string>",
      "Wait until this branch has work and its latest observed tip reaches the trunk.",
    )
    .option(
      "--trunk-moved",
      "Wait until the trunk ref moves from its position at call start.",
    )
    .option(
      "--resume <handle:string>",
      "Continue a previous not-met wait without resetting its pinned state; pass no condition flag with it.",
    )
    .option(
      "--timeout <seconds:number>",
      `Seconds before answering "not yet". Omit to wait once for up to ${AWAIT_LONG_CALL_SECONDS}s; the condition returns early, and 0 checks once.`,
    )
    .action(recordedExit("await", async (o) => {
      const { runAwait } = await import("./await/await.ts");
      return await runAwait(await requireRoot("await", o.json ?? false), {
        json: o.json ?? false,
        ...(o.green !== undefined ? { green: o.green } : {}),
        ...(o.landed !== undefined ? { landed: o.landed } : {}),
        ...(o.trunkMoved === true ? { trunkMoved: true } : {}),
        ...(o.resume !== undefined ? { resume: o.resume } : {}),
        ...(o.timeout !== undefined ? { timeoutSeconds: o.timeout } : {}),
      });
    }));

  const patterns = new Command()
    .description(
      "Report the patterns in this project's discern use, read from the local " +
        "logbook of verb runs: agent behaviour, gate fit, the task funnel, and " +
        "each standard's trajectory. A read-only advisory.",
    )
    .option(
      "--json",
      "Emit the report as a JSON DiscernResult on stdout (data.findings ranked by evidence).",
    )
    .option(
      "--stats",
      "Report practice stats instead: changes accepted, green streaks, cycle times, " +
        "standards trends, and agent cohorts, counted from the same local evidence. " +
        "With --json, the counts join the result as data.stats.",
    )
    .action(
      recordedExit("patterns", async (o) => {
        const { runPatterns } = await import("./logbook/patterns.ts");
        return await runPatterns(
          await requireRoot("patterns", o.json ?? false),
          { json: o.json ?? false, stats: o.stats ?? false },
        );
      }),
    )
    .command(
      "reset",
      new Command()
        .description(
          "Delete the recorded history: every logbook month file and the epoch " +
            "sidecar. Local data only; nothing else is touched.",
        )
        .option(
          "--json",
          "Emit the result as a JSON DiscernResult object on stdout.",
        )
        .option("--dry-run", "List what would be removed; touch nothing.")
        .action(
          recordedExit("patterns reset", async (o) => {
            const { runPatternsReset } = await import(
              "./logbook/patterns.ts"
            );
            return await runPatternsReset(
              await requireRoot("patterns", o.json ?? false),
              {
                json: o.json ?? false,
                dryRun: o.dryRun ?? false,
              },
            );
          }),
        ),
    );
  root.command("patterns", patterns);

  // `status` — read-only situation/orientation: what's true right now and what to
  // do next. It resolves the root itself so the not-initialized case is the
  // uniform envelope under --json.
  root
    .command("status")
    .description(
      "Show what's true right now and what to do next (read-only; does not run the " +
        "gate, the project's full quality check).",
    )
    .option(
      "--all",
      "Include every worktree even when called from one (local view plus all worktrees).",
    )
    .option(
      "--local",
      "Show only this checkout, even in the main checkout.",
    )
    .option(
      "--verbose",
      "Also print the full receipt page for an honored branch (and each ready " +
        "fleet row). Interactive output only; --json always carries the receipt.",
    )
    .option(
      "--json",
      "Emit the status as a JSON DiscernResult on stdout (data.location/git/fleet…).",
    )
    .action(recordedExit("status", async (o) => {
      const { runStatus } = await import("./status/status.ts");
      return await runStatus({
        json: o.json ?? false,
        all: o.all ?? false,
        local: o.local ?? false,
        verbose: o.verbose ?? false,
      });
    }));

  root
    .command("desk")
    .description(
      "Open the interactive task list: start a task, open its worktree, update it, " +
        "land it, or drop it. Bare `discern` opens the desk.",
    )
    .option(
      "--json",
      "The desk is interactive only; use `status --json` to list every worktree.",
    )
    .action(
      recordedExit("desk", async (o) => {
        const { runDesk } = await import("./desk/desk.ts");
        return await runDesk({ json: o.json ?? false });
      }),
    );

  root
    .command("start")
    .description(
      "From the main checkout, create a worktree with a separate checkout and branch " +
        `for one effort. Base it on the trunk${trunkName}, the shared landing branch, ` +
        "then print its path.",
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
    .action(recordedExit("start", async (o) => {
      const json = o.json ?? false;
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.start(ctx, {
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
      );
    }));

  root
    .command("accept")
    .description(
      `Accept and land this worktree's finished branch on the trunk${trunkName}, ` +
        "the shared landing branch. Then remove the worktree and merged branch " +
        "and refresh the main checkout.",
    )
    .option(
      "--json",
      "Emit a machine-readable (plan, results) object on stdout.",
    )
    .option("--dry-run", "Show the acceptance plan; touch nothing.")
    .option(
      "--confirmed",
      "Attest that your owner accepted this landing in the current conversation. " +
        "Recorded standing and effort grants are checked directly. Consent bound " +
        "to an interrupted transaction may authorize recovery of that transaction " +
        "only. Without applicable evidence, acceptance refuses read-only; a " +
        "dry-run needs none.",
    )
    .action(recordedExit("accept", async (o) => {
      const json = o.json ?? false;
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.accept(ctx, {
            json,
            dryRun: o.dryRun ?? false,
            confirmed: o.confirmed ?? false,
          }),
        { json, verb: "accept" },
      );
    }));

  root
    .command("update")
    .description(
      `Update this branch: merge the trunk's latest${trunkName} into this branch and ` +
        "re-materialize the agent files. The trunk is the shared landing " +
        "branch. Use `discern upgrade` for discern itself; use `discern refresh` for " +
        "agent files alone.",
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
    .action(recordedExit("update", async (o) => {
      const json = o.json ?? false;
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.update(ctx, {
            json,
            dryRun: o.dryRun ?? false,
            ...(o.from !== undefined ? { from: o.from } : {}),
          }),
        { json, verb: "update" },
      );
    }));

  root
    .command("identity")
    .description(
      "Print stable values that keep each worktree's branch, development host, port, " +
        "database, and external resources separate.",
    )
    .option("--id", "Print the safe base name for this worktree (default).")
    .option("--site", "Print its development server's host name.")
    .option("--branch", "Print its branch name.")
    .option("--port", "Print its stable development-server port.")
    .option("--db", "Print its database-safe name.")
    .option(
      "--worktree",
      "Print its base resource handle — a stable project-prefixed external name.",
    )
    .option(
      "--resource <name:string>",
      "Print the stable external name for one declared resource.",
    )
    .option(
      "--resources",
      "Print every declared resource as name=stable-external-name lines.",
    )
    .option(
      "--json",
      "Emit the selected identity value as a JSON DiscernResult envelope on stdout.",
    )
    .arguments("[path:string]")
    .action(recordedExit("identity", async (o, path) => {
      const json = o.json ?? false;
      const root = await requireRoot("identity", json);
      const target = path ?? Deno.cwd();
      const {
        identityField,
        identityResourceHandle,
        identityResources,
        IdentityError,
      } = await import("./worktree/lifecycle.ts");
      const { WORKTREE_FIELDS } = await import("./worktree/identity.ts");
      const selectedFields = WORKTREE_FIELDS.filter((field) =>
        o[field] === true
      );
      const selectorCount = selectedFields.length +
        (o.resource === undefined ? 0 : 1) + (o.resources ? 1 : 0);
      if (selectorCount > 1) {
        const message =
          "choose one identity field, --resource <name>, or --resources.";
        if (json) {
          emitResult({
            ok: false,
            verb: "identity",
            error: "invalid_arguments",
            message,
          });
        } else {
          console.error(`discern: ${message}`);
        }
        return 1;
      }
      try {
        let data: IdentityData;
        if (o.resource !== undefined) {
          data = {
            kind: "resource",
            name: o.resource,
            value: await identityResourceHandle(root, o.resource, target),
          };
        } else if (o.resources) {
          data = {
            kind: "resources",
            resources: await identityResources(root, target),
          };
        } else {
          // Derive the selected field from the WORKTREE_FIELDS SSOT (id is the
          // default), so a new identity field is selectable here without editing this
          // branch — the CLI flags themselves are tied to the SSOT by a parity test.
          const field = selectedFields[0] ?? "id";
          data = {
            kind: "field",
            field,
            value: await identityField(root, field, target),
          };
        }
        if (json) {
          emitResult({ ok: true, verb: "identity", data });
        } else if (data.kind === "resources") {
          for (const [name, value] of Object.entries(data.resources)) {
            console.log(`${name}=${value}`);
          }
        } else {
          console.log(data.value);
        }
        return 0;
      } catch (e) {
        if (e instanceof IdentityError) {
          if (json) {
            emitResult({
              ok: false,
              verb: "identity",
              error: "identity_error",
              message: e.message,
            });
          } else {
            console.error(`discern: ${e.message}`);
          }
          return e.code;
        }
        throw e;
      }
    }));

  const worktreeSetupCommand = new Command()
    .description("Set up or re-sync the current worktree.")
    .option(
      "--json",
      "Emit a machine-readable (plan, results) object on stdout.",
    )
    .option("--dry-run", "Show the setup plan; touch nothing.")
    .action(recordedExit("worktree setup", async (o) => {
      const json = o.json ?? false;
      return await runWorktreeOp(
        (ctx, lc) => lc.worktreeSetup(ctx, { json, dryRun: o.dryRun ?? false }),
        { json, verb: "worktree setup" },
      );
    }));

  const worktree = new Command()
    .description(
      "Manage worktrees — separate checkouts and branches for individual changes.",
    )
    .action(recordedExit("worktree", function (
      this: Command,
      o,
    ): number {
      return runCommandGroup(
        this,
        "worktree",
        (o as { json?: boolean } | undefined)?.json ?? false,
      );
    }))
    .command("setup", worktreeSetupCommand)
    .command(
      "ensure",
      new Command()
        .description("Idempotent session-start worktree setup.")
        .action(
          recordedExit(
            "worktree ensure",
            async () =>
              await runWorktreeOp(async (ctx, lc) => {
                await remindIfSetupUnfinished(ctx);
                const ensured = await lc.worktreeEnsure(ctx);
                if (ensured.kind === "skipped") {
                  // Main-checkout side: the session hook injects this stdout
                  // as agent context, the only channel that can pre-empt a
                  // trunk edit (a file edit calls no verb first).
                  const orientation = fire(
                    HINTS["ensure-main-worktree-first"],
                  );
                  ctx.log.info(orientation.text);
                  observeSupplementalHints([orientation]);
                }
              }),
          ),
        ),
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
        .action(recordedExit("worktree teardown", async (o) => {
          const json = o.json ?? false;
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.worktreeTeardown(ctx, { json, dryRun: o.dryRun ?? false }),
            { json, verb: "worktree teardown" },
          );
        })),
    )
    .command(
      "drop",
      new Command()
        .description(
          "Discard a worktree from the main checkout: tear down its resources, remove " +
            "it, and delete its branch. Protects uncommitted work and commits not on " +
            "the trunk, the shared landing branch, unless --force is set.",
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
        .action(recordedExit("worktree drop", async (o, target) => {
          const json = o.json ?? false;
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.worktreeDrop(ctx, target, {
                json,
                dryRun: o.dryRun ?? false,
                force: o.force ?? false,
              }),
            { json, verb: "worktree drop" },
          );
        })),
    )
    .command(
      "prune",
      new Command()
        .description(
          "Sweep stale worktrees, fully-merged branches, and orphaned resources.",
        )
        .option("-y, --yes", "Non-interactive: skip the confirm prompt.")
        .option(
          "--contained",
          "Also reclaim contained worktrees — checkouts whose committed work is " +
            "fully contained in another live branch. Branch refs are always kept.",
        )
        .option(
          "--dry-run",
          "Report what would be removed/reclaimed without acting.",
        )
        .option(
          "--json",
          "Emit the result as a JSON DiscernResult object on stdout.",
        )
        .action(recordedExit("worktree prune", async (o) => {
          const json = o.json ?? false;
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.worktreePrune(ctx, {
                assumeYes: o.yes ?? false,
                dryRun: o.dryRun ?? false,
                json,
                contained: o.contained ?? false,
                // The engine sweeps git-derived worktree parents on its own; the
                // configured root (a location convention the engine does not know)
                // is passed so a FULLY-orphaned root is still reclaimed (ADR 0052).
                extraScanDirs: [resolveWorktreeRoot(ctx.root, ctx.config)],
              }),
            { json, verb: "worktree prune" },
          );
        })),
    );
  // The `hook` namespace holds the provider hook entry points — machine-invoked
  // verbs whose stdin/stdout belong to the provider hook protocol, not to an
  // operator. Namespacing keeps the payload plumbing callable for the generated
  // integration files while keeping protocol verbs out of the human `worktree`
  // vocabulary, where `remove` sat one typo from the destructive
  // `drop`/`teardown`/`prune` and read as the way to remove a worktree (ADR 0222).
  const worktreeHook = new Command()
    .description(
      "Provider hook entry points (machine-invoked; stdin carries the hook payload).",
    )
    .command(
      "create",
      new Command().action(
        recordedExit("worktree hook create", async () => {
          const { worktreeCreateHook } = await import(
            "../lib/worktree_hooks.ts"
          );
          return await worktreeCreateHook();
        }),
      ),
    )
    .command(
      "remove",
      new Command().action(
        recordedExit("worktree hook remove", async () => {
          const { worktreeRemoveHook } = await import(
            "../lib/worktree_hooks.ts"
          );
          return await worktreeRemoveHook();
        }),
      ),
    );
  worktree.command("hook", worktreeHook).hidden();
  root.command("worktree", worktree);
}

/** Attach the `skills` command group (list / eject). */
function attachSkillsCommand(root: Command): void {
  const skills = new Command()
    .description(
      "Manage skills: list the effective set, or eject a built-in to customize it.",
    )
    .action(recordedExit("skills", function (
      this: Command,
      o,
    ): number {
      return runCommandGroup(
        this,
        "skills",
        (o as { json?: boolean } | undefined)?.json ?? false,
      );
    }))
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
        .action(
          recordedExit(
            "skills list",
            async (o) => await runSkillsList({ json: o.json ?? false }),
          ),
        ),
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
        .action(
          recordedExit(
            "skills eject",
            async (o, name: string) =>
              await runSkillsEject(name, { json: o.json ?? false }),
          ),
        ),
    );
  root.command("skills", skills);
}

/** `discern skills list` — print the effective skill set. */
async function runSkillsList(opts: { json: boolean }): Promise<number> {
  const root = await requireRoot("skills list", opts.json);
  const cfg = await loadConfig(root);
  const { listSkills, skillsListResult } = await import("../lib/skills.ts");
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

/** Preserve an Error message and stringify non-Error failures at the CLI boundary. */
function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plan and apply authored copies for selected bundled skills. */
async function skillsEjectResult(
  root: string,
  name: string,
): Promise<DiscernResult<SkillsEjectData>> {
  const cfg = await loadConfig(root);
  const { ejectSkill, materializeSkills } = await import("../lib/skills.ts");
  const { skillsDirsForAgents } = await import("../lib/providers.ts");
  const { guidanceAgents } = await import("./guidance_render.ts");
  const { TomlEditor } = await import("../lib/toml_edit.ts");
  const { writeDiscernToml } = await import("../lib/tidy_format.ts");
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
      await writeDiscernToml(path, editor.toString());
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
    return {
      ok: true,
      verb: "skills eject",
      data,
      hints: hintTexts([fire(HINTS["skills-eject-edit-override"])]),
    };
  } catch (error) {
    return {
      ok: false,
      verb: "skills eject",
      error: "skills_eject_failed",
      message: thrownMessage(error),
    };
  }
}

/** Present ejected, skipped, and refused skill paths for the human CLI. */
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
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) log.group("next");
  for (const hint of hints) {
    log.info(hint);
  }
}

/** `discern skills eject <name>` — copy a built-in into `[skills].dir` to edit. */
async function runSkillsEject(
  name: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await requireRoot("skills eject", opts.json ?? false);
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

/** Names of the executable project scripts in one configured directory. */
async function projectScriptNames(scriptsAbs: string): Promise<string[]> {
  const { discoverProjectScripts } = await import("./project_scripts.ts");
  return (await discoverProjectScripts(scriptsAbs)).map((script) =>
    script.name
  );
}

/**
 * Suggest the command an unknown word most plausibly meant, or undefined. The
 * synonym table wins — a familiar word from another tool names its canonical
 * verb exactly — then near-match built-in commands and project scripts.
 */
async function suggestCommand(
  typo: string,
  scriptsAbs: string | undefined,
): Promise<string | undefined> {
  const synonym = commandSynonymSuggestion(typo);
  if (synonym !== undefined) {
    return synonym;
  }
  const folded = typo.replace(/:/g, "-");
  for (const name of SUGGESTABLE_ENGINE_COMMANDS) {
    if (matchCandidate(folded, name)) {
      return displayName(name);
    }
  }
  if (scriptsAbs !== undefined) {
    for (const name of await projectScriptNames(scriptsAbs)) {
      if (matchCandidate(folded, name)) {
        return `scripts ${name}`;
      }
    }
  }
  return undefined;
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
  const lc = await import("./worktree/lifecycle.ts");
  try {
    const { removeWorktreeSafely } = await import("./worktree/git.ts");
    await removeWorktreeSafely(target, Deno.cwd());
    return 0;
  } catch (e) {
    return handleWorktreeError(e, log, lc);
  }
}

/** `inherit-main-env-vars` — copy [worktree].inherit_env vars from main's env files. */
async function helperInheritEnv(): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT_MESSAGE}`);
    return 1;
  }
  const log = makeLogger();
  const cfg = await loadConfig(root);
  const lc = await import("./worktree/lifecycle.ts");
  try {
    const { inheritMainEnvVars } = await import("./worktree/git.ts");
    await inheritMainEnvVars({
      worktreeRoot: root,
      vars: cfg.worktree.inherit_env,
      files: cfg.worktree.env_files,
      log,
    });
    return 0;
  } catch (e) {
    return handleWorktreeError(e, log, lc);
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
  const child = await runOwnedChild(command, {
    args: rest,
  });
  const code = child.status.code;
  if (code !== 0) {
    const root = await findRoot();
    if (root !== undefined) {
      const { gotchasHint } = await import("./gate/gotchas.ts");
      gotchasHint(await loadConfig(root), root, colorEnabled());
    }
  }
  return code;
}

/**
 * `discern config <get|array|has|subsections|keys> <key>` — the READ side of the
 * config surface. This is what a project script uses to read `discern.toml`:
 * `has` answers via the exit code; the rest print to stdout.
 */
export async function runConfigRead(
  op: "get" | "array" | "has" | "subsections" | "keys",
  key: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await findRoot();
  if (root === undefined) {
    if (opts.json ?? false) {
      emitResult(notInitializedResult("config"));
    } else {
      console.error(`discern: ${NO_PROJECT_MESSAGE}`);
    }
    return 1;
  }
  // The Project-Script-facing passthrough reads arbitrary dotted keys verbatim, so it uses
  // the raw reader (no schema, no defaults) rather than the typed loader.
  const cfg = await RawConfig.load(root);
  let data: ConfigData;
  switch (op) {
    case "get":
      data = { operation: "get", key, value: cfg.get(key) };
      break;
    case "array":
      data = { operation: "array", key, values: cfg.array(key) };
      break;
    case "has":
      data = { operation: "has", key, present: cfg.has(key) };
      break;
    case "subsections":
      data = {
        operation: "subsections",
        key,
        values: cfg.subsections(key),
      };
      break;
    case "keys":
      data = { operation: "keys", key, values: cfg.keys(key) };
      break;
  }
  if (opts.json ?? false) {
    emitResult({ ok: true, verb: "config", data });
    return 0;
  }
  switch (data.operation) {
    case "get":
      console.log(data.value);
      return 0;
    case "array":
    case "subsections":
    case "keys":
      for (const value of data.values) {
        console.log(value);
      }
      return 0;
    case "has":
      return data.present ? 0 : 1;
  }
}

/** The configured project scripts directory and its absolute path. */
function scriptsDirOf(
  root: string,
  cfg: DiscernConfig,
): { rel: string; abs: string } {
  return resolveScriptsDir(root, cfg);
}

/**
 * Report an unknown top-level verb, considering project script names only as
 * namespaced suggestions. A project script never executes from this path.
 */
export async function reportUnknownOrSuggest(
  verb: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await findRoot();
  const cfg = root === undefined
    ? undefined
    : await loadConfig(root).catch(() => undefined);
  const scripts = root !== undefined && cfg !== undefined
    ? scriptsDirOf(root, cfg)
    : undefined;
  const suggestion = await suggestCommand(verb, scripts?.abs);
  reportUnknownCommand(verb, suggestion, opts);
  return 1;
}
