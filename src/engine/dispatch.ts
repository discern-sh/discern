/**
 * The engine-verb dispatcher: attaches the project task-runner verbs to the
 * `discern` CLI, including the `scripts` namespace for project-owned executables
 * under `[scripts].dir` (whose default comes from the paths registry).
 *
 * Engine verbs operate on the project (found by walking up to `discern.toml`), so
 * each requires a project root.
 */

import { Command } from "@cliffy/command";
import { join, relative } from "@std/path";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { RawConfig } from "../shared/config_read.ts";
import { emitResult } from "../shared/emit.ts";
import {
  explainConfigPath,
  renderConfigExplanation,
} from "../shared/config_explain.ts";
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
import { Logger, loggerSink } from "../lib/log.ts";
import { renderAlignedRows } from "../lib/text.ts";
import { terminalLine } from "../lib/terminal.ts";
import {
  canInteract,
  type ConfirmationRequestOptions,
  isInteractionCancelled,
  plainModeEnabled,
  requestConfirmation,
} from "../lib/terminal_interaction.ts";
import type { ConfirmationLabels } from "../shared/confirmation.ts";
import { CATEGORY_NAMES } from "./improve/rules.ts";
import type { LifecycleContext } from "./worktree/lifecycle.ts";
import { writeStdout } from "./output.ts";
import { commandSynonymSuggestion } from "../shared/vocabulary.ts";
import {
  type DiscernResult,
  type EnginePlan,
  type PlanStep,
  renderPlan,
  type StepResult,
  verbatimStepLabel,
} from "../shared/result.ts";
import type {
  EjectSkillPlan,
  SkillMaterializationOperation,
  SkillMaterializationPlan,
} from "../lib/skills.ts";
import {
  type CliCommand,
  type CliModelProvider,
  walkCliCommands,
} from "../shared/cli_reference_codegen.ts";
import { reportUnknownCommand } from "./unknown_command.ts";
import {
  CliRefusal,
  recordedExit,
  registerDirectRecordedCliCommandPath,
} from "./logbook/cli.ts";
import { runCommandGroup } from "../shared/command_group.ts";
import {
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_STRICT_CALL_SECONDS,
  MCP_LONG_TOOL_CALLS_FLAG,
  MCP_STRICT_TOOL_CALLS_FLAG,
} from "../shared/mcp_timeout_policy.ts";
import { LOGBOOK_LIFECYCLE_ACTIONS } from "../shared/logbook_lifecycle.ts";
import { CLI_JSON_DESCRIPTION_OVERRIDES } from "../shared/result_formats.ts";

export { reportUnknownCommand } from "./unknown_command.ts";
export {
  KNOWN_ENGINE_VERBS,
  KNOWN_INSTALLER_VERBS,
  KNOWN_VERBS,
} from "../shared/verbs.ts";

type ConfirmationOperation = (
  message: string,
  options: ConfirmationRequestOptions,
) => Promise<boolean>;

/** Supply the Logbook core a boolean default-No contract at dispatch time. */
export async function logbookLifecycleConfirmation(
  message: string,
  labels: ConfirmationLabels,
  operation: ConfirmationOperation = requestConfirmation,
): Promise<boolean> {
  try {
    return await operation(message, { defaultTo: false, ...labels });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return false;
  }
}

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

/** Logger for engine terminal output — info/ok/heading → stdout; NO_COLOR /
 * non-TTY honoured by Logger. */
function makeLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

/** Read the inherited root JSON flag from a separately typed subcommand. */
function jsonFrom(options: unknown): boolean {
  return (options as { json?: boolean } | undefined)?.json ?? false;
}

/**
 * Resolve the project root, or refuse and exit 1. The refusal is the engine's
 * ONE not-initialized chokepoint: under either quiet result format it emits the
 * uniform `not_initialized` envelope on stdout — including the stable slug a
 * caller branches on — and in terminal mode the canonical stderr line. Every engine verb that needs a
 * project passes its verb name and json flag here, so a new verb inherits the
 * structured refusal for free (`tests/engine_not_initialized_test.ts` holds the
 * whole verb surface to it).
 */
async function requireRoot(verb: string, _json: boolean): Promise<string> {
  const root = await findRoot();
  if (root === undefined) {
    throw new CliRefusal(notInitializedResult(verb));
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
    // Worktree failures are product-composed accounts (a refusal's batched
    // questions, a post-landing step list); their newlines are deliberate
    // structure on the terminal.
    log.errorBlock(e.message);
    return 1;
  }
  throw e;
}

/**
 * Build a lifecycle context and run a worktree operation, mapping errors to codes.
 * In quiet result mode terminal narration is suppressed (Logger json mode) so
 * stdout carries only the selected projection, and a thrown worktree error is emitted as a
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
async function remindIfSetupUnfinished(
  ctx: LifecycleContext,
): Promise<string | undefined> {
  if (ctx.config.meta.bootstrapped) {
    return undefined;
  }
  const pending = await findSkeletonMarkers(ctx.root);
  const reminder = setupUnfinishedHint(pending);
  ctx.log.line(`[discern] ${reminder.text}`);
  observeSupplementalHints([reminder]);
  return reminder.text;
}

/** Attach the engine task-runner verbs to the `discern` root command — every verb
 * unconditionally (ADR 0101: the subsystems are all core). */
export function attachEngineCommands(
  root: Command,
  cliModel: CliModelProvider,
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
      "--dry-run",
      "Show the gate plan (the jobs and scope-gates that would run); touch nothing.",
    )
    .option(
      "--rerun",
      "Run the full Gate even when current green Proof covers this exact tree, or explicitly retry an unchanged red verdict. The rerun is recorded.",
    )
    .option(
      "--ci",
      "Run the machine Gate and report checkpoint questions without enforcing or recording review. The resulting Proof cannot be accepted.",
    )
    .option(
      "--met <id:string>",
      "Declare a served checkpoint's question met (repeatable). Valid only " +
        "for a checkpoint with an active open question here; the declaration is " +
        "recorded as your judgment, and the gate runs in the same invocation " +
        "once every awaiting checkpoint has a conclusion.",
      { collect: true },
    )
    .option(
      "--unmet <id:string>",
      "Declare a served checkpoint's question unmet (one per invocation; " +
        "requires --why). The gate still runs; landing then needs the owner " +
        "to authorize a variance for it.",
      { collect: true },
    )
    .option(
      "--why <rationale:string>",
      "The required rationale for --unmet: one paragraph, 1-500 characters, " +
        "no newlines or control characters. Recorded opaquely as Proof " +
        "evidence for the owner's landing decision.",
    )
    .action(
      recordedExit("done", async (o) => {
        const json = jsonFrom(o);
        const invalid = (message: string): number => {
          if (json) {
            emitResult({
              ok: false,
              verb: "done",
              error: "invalid_arguments",
              message,
            });
          } else {
            makeLogger().error(message);
          }
          return 1;
        };
        const unmetIds = o.unmet ?? [];
        if (
          o.ci === true &&
          ((o.met?.length ?? 0) > 0 || unmetIds.length > 0 ||
            o.why !== undefined)
        ) {
          return invalid(
            "--ci cannot be combined with --met, --unmet, or --why; CI reports checkpoint review and records no declaration.",
          );
        }
        if (unmetIds.length > 1) {
          return invalid(
            "--unmet accepts one checkpoint per invocation; declare the others in follow-up invocations.",
          );
        }
        const unmetId = unmetIds[0];
        if (unmetId !== undefined && o.why === undefined) {
          return invalid(
            '--unmet requires --why "<rationale>" — one paragraph on why the question is not satisfied.',
          );
        }
        if (unmetId === undefined && o.why !== undefined) {
          return invalid("--why accompanies --unmet <id>; pass both.");
        }
        const { runFinish } = await import("./gate/finish.ts");
        return await runFinish(await requireRoot("done", json), {
          json,
          cliModel,
          dryRun: o.dryRun ?? false,
          ci: o.ci ?? false,
          rerun: o.rerun ?? false,
          plain: plainModeEnabled(),
          ...(o.met === undefined ? {} : { met: o.met }),
          ...(unmetId === undefined || o.why === undefined
            ? {}
            : { unmet: { id: unmetId, why: o.why } }),
        });
      }),
    );

  root
    .command("prepare")
    .description(
      "Fast inner loop: fixers, [generated] regenerations, complete refresh, then read-only checks (no other build jobs, no tests).",
    )
    .action(
      recordedExit("prepare", async (o) => {
        const { runPrepare } = await import("./gate/prepare.ts");
        return await runPrepare(
          await requireRoot("prepare", jsonFrom(o)),
          {
            json: jsonFrom(o),
            plain: plainModeEnabled(),
          },
        );
      }),
    );

  root
    .command("test")
    .description(
      "Run the project's configured tests on their own, outside the full gate.",
    )
    .action(
      recordedExit("test", async (o) => {
        const { runTestJob } = await import("./gate/test_job.ts");
        return await runTestJob(await requireRoot("test", jsonFrom(o)), {
          json: jsonFrom(o),
          plain: plainModeEnabled(),
        });
      }),
    );

  root
    .command("queue")
    .noGlobals()
    .usage("-- <command> [args...]")
    .description(
      "Run a command while holding one configured concurrent test-run slot. " +
        "Use `discern await` to watch a fleet condition instead. " +
        "This command has no `--json`, `--markdown`, or `--render` mode; tokens after `--` belong to the child.",
    );
  registerDirectRecordedCliCommandPath("queue");

  root
    .command("improvement")
    .description(
      "Find the highest-value next improvement, with the health audit and open reviews for agent and owner to evaluate together.",
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
          await requireRoot("improvement", jsonFrom(o)),
          {
            json: jsonFrom(o),
            category: o.category,
            minScore: o.minScore,
          },
        );
      }),
    );

  root
    .command("checkpoints")
    .description(
      "Report the governing checkpoint policy, each open question's declaration state, and a read-only preview of what the current change would fire. Nothing runs and nothing is recorded.",
    )
    .action(
      recordedExit("checkpoints", async (o) => {
        const { runCheckpoints } = await import("./checkpoints/report.ts");
        return await runCheckpoints(
          await requireRoot("checkpoints", jsonFrom(o)),
          { json: jsonFrom(o) },
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
      `Use the long-call transport profile; await calls may run for ${AWAIT_LONG_CALL_SECONDS} seconds.`,
    )
    .option(
      MCP_STRICT_TOOL_CALLS_FLAG,
      `Use the strict transport profile; await calls may run for ${AWAIT_STRICT_CALL_SECONDS} seconds.`,
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
      return await runMcpServer(cliModel, profile);
    }));

  root
    .command("scripts")
    .description(
      "List executable Project Scripts, or run one literal name at the project root with the documented four-variable DISCERN_* environment and every following argument forwarded unchanged.",
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

  const standardsCommand = new Command()
    .description(
      "Measure the named quality standards, or every configured Standard when no names are given: numbers that can never get worse. `discern done` already verifies and measures them on every run. Authoring one? Hold a rate (`per`) for a number that rises as the project grows, and give a drifting total a `margin` — a ceiling pinned at today's value fails the next legitimate change.",
    )
    .arguments("[names...:string]")
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
      "Capture measured improvements for the named Standards, or every one with slack. Same-commit values are reused; named measurement narrows only when Gate Proof already validates the clean tree. Commit the limit change alone and carry Proof forward. Requires a clean worktree.",
    )
    .action(
      recordedExit("standards", async (o, ...names: string[]) => {
        const { runStandards } = await import("./gate/standards.ts");
        return await runStandards(
          await requireRoot("standards", jsonFrom(o)),
          {
            json: jsonFrom(o),
            dryRun: o.dryRun ?? false,
            force: o.force ?? false,
            pin: o.pin ?? false,
            pinNames: names,
          },
        );
      }),
    );

  standardsCommand.command(
    "propose",
    new Command()
      .description(
        "Finalize a proposed limit for a Standard breached by this change. On a clean final HEAD, measure the named Standard, then create its config-only proposal commit or renew an unchanged descendant binding. Acceptance still requires explicit approval for the value and reason.",
      )
      .arguments("<name:string>")
      .option(
        "--reason <reason:string>",
        "The exact non-empty owner-facing reason for the Standard limit proposal (1-500 visible, secret-free characters).",
      )
      .option("--dry-run", "Show the proposal plan; touch nothing.")
      .action(recordedExit(
        "standards propose",
        async (o, name: string) => {
          const { runStandardsPropose } = await import(
            "./gate/standard_proposals.ts"
          );
          return await runStandardsPropose(
            await requireRoot("standards propose", jsonFrom(o)),
            {
              name,
              reason: o.reason ?? "",
              dryRun: o.dryRun ?? false,
              json: jsonFrom(o),
            },
          );
        },
      )),
  );
  root.command("standards", standardsCommand);

  root
    .command("refresh")
    .description(
      "Refresh the agent files, skills, provider integrations, and the " +
        "maintained ADR index. Use " +
        "`discern update` for this branch; use `discern upgrade` for discern itself.",
    )
    .option(
      "--dry-run",
      "List every refresh target and create/update/remove effect; change nothing.",
    )
    .action(recordedExit("refresh", async (o) => {
      const json = jsonFrom(o);
      const root = await requireRoot("refresh", json);
      const { refreshResult } = await import("./instructions.ts");
      // Quiet result: narration → stderr, the selected result → stdout.
      // Terminal presentation narrates to stdout via the default logger.
      const log = json
        ? new Logger({ json: true, noColor: false, humanStream: "stderr" })
        : new Logger({ json: false, noColor: false, humanStream: "stdout" });
      const res = await refreshResult(root, log, {
        dryRun: o.dryRun ?? false,
      });
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
      "--dry-run",
      "List the files that would change; touch nothing.",
    )
    .action(recordedExit("tidy", async (o, type: string | undefined) => {
      // Keep the formatter host and embedded WASMs off every other verb's module
      // path. The WASMs are read and instantiated only when tidy formats a file.
      const { runTidy } = await import("./tidy/tidy.ts");
      return await runTidy(await requireRoot("tidy", jsonFrom(o)), {
        ...(type !== undefined ? { type } : {}),
        json: jsonFrom(o),
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
      CLI_JSON_DESCRIPTION_OVERRIDES.impact,
    )
    .option(
      "--has <scope:string>",
      "Test one scope. Bare: print nothing and exit 0/1. JSON: report `data.membership` and exit 0.",
    )
    .action(
      recordedExit("impact", async (o) => {
        const { runImpact } = await import("./scopes/scopes.ts");
        return await runImpact(await requireRoot("impact", jsonFrom(o)), {
          json: jsonFrom(o),
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
    .arguments("[file:string] [with:string]")
    .action(recordedExit("coupling", async (o, file, withFile) => {
      const paths = [file, withFile].filter((p): p is string =>
        p !== undefined
      );
      const { runCoupling } = await import("./coupling/coupling.ts");
      return await runCoupling(await requireRoot("coupling", jsonFrom(o)), {
        json: jsonFrom(o),
        ...(paths.length > 0 ? { paths } : {}),
      });
    }));

  root
    .command("await")
    .description(
      "Block until a fleet condition holds: a sibling branch is green (its " +
        "worktree holds an honored gate proof), a branch's work has landed " +
        "on the trunk, or the trunk has moved. Timing out is not an error; " +
        "the result carries a short continuation handle that preserves the " +
        "original condition across calls. To wrap a command behind the " +
        "concurrent test-run cap, use `discern queue -- <command> [args...]`.",
    )
    .option(
      "--green <worktree:string>",
      "Select a sibling by worktree id, path, local branch, or full local ref; wait until its checkout holds an honored gate proof (a landing also satisfies it).",
    )
    .option(
      "--landed <worktree:string>",
      "Select a sibling by worktree id, path, local branch, or full local ref; wait until its work reaches the trunk.",
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
      return await runAwait(await requireRoot("await", jsonFrom(o)), {
        json: jsonFrom(o),
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
      "--stats",
      "Report practice stats instead: changes accepted, green streaks, cycle times, " +
        "standards trends, and agent cohorts, counted from the same local evidence. " +
        "With --json, the counts join the result as data.stats.",
    )
    .option(
      "--all",
      "Report every finding from every detector.",
    )
    .option(
      "--logbook-file <filename:string>",
      "Read one sealed archive basename listed by `discern patterns archives` instead of the active Logbook.",
    )
    .action(
      recordedExit("patterns", async (o) => {
        const { runPatterns } = await import("./logbook/patterns.ts");
        return await runPatterns(
          await requireRoot("patterns", jsonFrom(o)),
          {
            json: jsonFrom(o),
            stats: o.stats ?? false,
            all: o.all ?? false,
            ...(o.logbookFile !== undefined
              ? { logbookFile: o.logbookFile }
              : {}),
          },
        );
      }),
    )
    .command(
      "archives",
      new Command()
        .description(
          "List sealed Logbook archives with their event counts, date spans, and byte sizes.",
        )
        .action(
          recordedExit("patterns archives", async (o) => {
            const { runPatternsArchives } = await import(
              "./logbook/patterns.ts"
            );
            return await runPatternsArchives(
              await requireRoot("patterns", jsonFrom(o)),
              { json: jsonFrom(o) },
            );
          }),
        ),
    );
  for (const action of LOGBOOK_LIFECYCLE_ACTIONS) {
    const invocation = `patterns ${action.name}` as const;
    patterns.command(
      action.name,
      new Command()
        .description(action.description)
        .option(
          "--json",
          CLI_JSON_DESCRIPTION_OVERRIDES[invocation],
        )
        .option(
          "--dry-run",
          "Render the complete plan without requesting confirmation or changing files.",
        )
        .action(
          recordedExit(invocation, async (o) => {
            const { runPatternsLifecycle } = await import(
              "./logbook/patterns.ts"
            );
            return await runPatternsLifecycle(
              await requireRoot("patterns", jsonFrom(o)),
              action.name,
              {
                json: jsonFrom(o),
                dryRun: o.dryRun ?? false,
                interactive: canInteract(false),
                confirm: logbookLifecycleConfirmation,
              },
            );
          }),
        ),
    );
  }
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
      "Expand fleet attention, per-worktree evidence, configured checks, landing " +
        "history, and full Proof pages. With JSON, return complete structured " +
        "status; the default is the bounded orientation projection.",
    )
    .option(
      "--json",
      CLI_JSON_DESCRIPTION_OVERRIDES.status,
    )
    .action(recordedExit("status", async (o) => {
      const { runStatus } = await import("./status/status.ts");
      return await runStatus({
        json: jsonFrom(o),
        all: o.all ?? false,
        local: o.local ?? false,
        verbose: o.verbose ?? false,
      });
    }));

  root
    .command("desk")
    .description(
      "Open the interactive task list: follow one recommended action, review Proof " +
        "and changes, run final checks, or preview a lifecycle effect before " +
        "confirming it. Bare `discern` opens the desk.",
    )
    .option(
      "--json",
      CLI_JSON_DESCRIPTION_OVERRIDES.desk,
    )
    .action(
      recordedExit("desk", async (o) => {
        const { runDesk } = await import("./desk/desk.ts");
        return await runDesk({ json: jsonFrom(o), cliModel });
      }),
    );

  root
    .command("enter")
    .description(
      "Choose a worktree and open a child shell at the matching project-relative directory.",
    )
    .option(
      "--json",
      CLI_JSON_DESCRIPTION_OVERRIDES.enter,
    )
    .action(
      recordedExit("enter", async (o) => {
        const { runEnter } = await import("./worktree/shell_picker.ts");
        return await runEnter({ json: jsonFrom(o) });
      }),
    );

  root
    .command("start")
    .description(
      "From the main checkout, create a worktree with a separate checkout and branch " +
        `for one effort. Base it on the trunk${trunkName}, the shared landing branch, ` +
        "then print its path.",
    )
    .option("--dry-run", "Show the start plan; touch nothing.")
    .option(
      "--name <name:string>",
      "Set the task title and seed its worktree id. discern preserves this text as the title and normalizes the id. Omit for a random codename.",
    )
    .option(
      "--title <title:string>",
      "Set the display title separately from --name. With no --name, the title also seeds the worktree id.",
    )
    .option(
      "--brief <brief:string>",
      "Store an optional one-line brief for task detail and agent handoff.",
    )
    .option(
      "--from <source:string>",
      "Branch the new worktree from a ref or an unambiguous worktree id or path. Omit it to start from the trunk.",
    )
    .action(recordedExit("start", async (o) => {
      const json = jsonFrom(o);
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.start(ctx, {
            json,
            dryRun: o.dryRun ?? false,
            name: o.name ?? "",
            ...(o.title !== undefined ? { title: o.title } : {}),
            ...(o.brief !== undefined ? { brief: o.brief } : {}),
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
        "the shared landing branch. Tracked refresh artifacts must already be " +
        "current. After landing, materialize checkout-local Agent artifacts, then " +
        "remove the worktree and merged branch.",
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
    .option(
      "--variance <id:string>",
      "Record that your owner authorized landing this declared-unmet " +
        "checkpoint without changing it (repeatable; requires --confirmed). " +
        "The ids must equal the current declared-unmet set, id for id, and " +
        "recorded grants never authorize a variance.",
      { collect: true },
    )
    .option(
      "--approve-standard <token:string>",
      "Record that the owner approved the exact Standard/value/reason tuple " +
        "carried by the current Proof (repeatable; requires --confirmed). " +
        "Use the proposal-bound token served by the read-only refusal; the token " +
        "set must equal the current proposal set. Standing, effort, and " +
        "generic landing grants never authorize a Standard limit proposal.",
      { collect: true },
    )
    .action(recordedExit("accept", async (o) => {
      const json = jsonFrom(o);
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.accept(ctx, {
            json,
            dryRun: o.dryRun ?? false,
            confirmed: o.confirmed ?? false,
            variance: o.variance ?? [],
            approveStandard: o.approveStandard ?? [],
            cliModel,
          }),
        { json, verb: "accept" },
      );
    }));

  root
    .command("update")
    .description(
      `Update this branch: merge the trunk's latest${trunkName} into this branch and ` +
        "re-run generated groups and refresh Agent artifacts. The trunk is the shared landing " +
        "branch. Use `discern upgrade` for discern itself; use `discern refresh` for " +
        "agent files alone.",
    )
    .option("--dry-run", "Show the update plan; touch nothing.")
    .option(
      "--from <source:string>",
      "Pull a ref or an unambiguous worktree id or path into this worktree instead of the trunk. For composing on unlanded work — omit it for the routine bring-the-trunk-in call.",
    )
    .action(recordedExit("update", async (o) => {
      const json = jsonFrom(o);
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
      "Print stable values that keep each checkout's branch, development host, port, " +
        "database, and external resources separate.",
    )
    .option("--id", "Print the safe base name for this checkout (default).")
    .option("--site", "Print its development server's host name.")
    .option("--branch", "Print its branch name.")
    .option("--port", "Print its stable development-server port.")
    .option("--db", "Print its database-safe name.")
    .option("--seed", "Print its stable test-order seed.")
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
    .arguments("[worktree:string]")
    .action(recordedExit("identity", async (o, worktree) => {
      const json = jsonFrom(o);
      const root = await requireRoot("identity", json);
      const target = worktree ?? Deno.cwd();
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
          new Logger({ json: false, noColor: false }).error(message);
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
            writeStdout(`${name}=${value}\n`);
          }
        } else {
          writeStdout(`${data.value}\n`);
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
            new Logger({ json: false, noColor: false }).error(e.message);
          }
          return e.code;
        }
        throw e;
      }
    }));

  const worktreeSetupCommand = new Command()
    .description("Set up or re-sync the current worktree.")
    .option("--dry-run", "Show the setup plan; touch nothing.")
    .option(
      "--mark-step-complete <id:string>",
      "After observing an interrupted setup command's external state, mark its running journal entry complete without replaying it.",
    )
    .option(
      "--retry-step <id:string>",
      "After observing an interrupted setup command's external state, reset its running journal entry and run it again.",
    )
    .option(
      "--confirmed",
      "Attest that the owner observed the interrupted command's external state and chose this recovery. Required with either recovery option.",
    )
    .action(recordedExit("worktree setup", async (o) => {
      const json = jsonFrom(o);
      const invalid = (message: string): number => {
        if (json) {
          emitResult({
            ok: false,
            verb: "worktree setup",
            error: "invalid_arguments",
            message,
          });
        } else {
          makeLogger().error(message);
        }
        return 1;
      };
      const markStepComplete = o.markStepComplete;
      const retryStep = o.retryStep;
      if (markStepComplete !== undefined && retryStep !== undefined) {
        return invalid(
          "Choose exactly one setup-step recovery: --mark-step-complete or --retry-step. Nothing changed.",
        );
      }
      const stepId = markStepComplete ?? retryStep;
      if (o.confirmed === true && stepId === undefined) {
        return invalid(
          "--confirmed is valid only with --mark-step-complete or --retry-step. Nothing changed.",
        );
      }
      if ((o.dryRun ?? false) && stepId !== undefined) {
        return invalid(
          "Setup-step recovery cannot be combined with --dry-run. Nothing changed.",
        );
      }
      if (stepId !== undefined) {
        const { isSetupStepId } = await import(
          "./worktree/setup_step_journal.ts"
        );
        if (!isSetupStepId(stepId)) {
          return invalid(
            `Invalid setup-step identity ${stepId}. Re-run ordinary \`discern worktree setup\` to see the current recovery identity. Nothing changed.`,
          );
        }
      }
      return await runWorktreeOp(
        (ctx, lc) =>
          lc.worktreeSetup(ctx, {
            json,
            dryRun: o.dryRun ?? false,
            ...(stepId === undefined ? {} : {
              recovery: {
                stepId,
                decision: markStepComplete === undefined
                  ? "retry"
                  : "mark-complete",
                confirmed: o.confirmed ?? false,
              },
            }),
          }),
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
            async (o) => {
              const json = jsonFrom(o);
              const hints: string[] = [];
              const code = await runWorktreeOp(async (ctx, lc) => {
                const reminder = await remindIfSetupUnfinished(ctx);
                if (reminder !== undefined) hints.push(reminder);
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
                  hints.push(orientation.text);
                }
              }, { json, verb: "worktree ensure" });
              if (json && code === 0) {
                emitResult({
                  ok: true,
                  verb: "worktree ensure",
                  ...(hints.length === 0 ? {} : { hints }),
                });
              }
              return code;
            },
          ),
        ),
    )
    .command(
      "rename",
      new Command()
        .description(
          "Change this worktree's display title. Its id, branch, path, brief, and creation source stay unchanged.",
        )
        .option("--dry-run", "Show the title-change plan; touch nothing.")
        .arguments("<title:string>")
        .action(recordedExit("worktree rename", async (o, title) => {
          const json = jsonFrom(o);
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.taskRename(ctx, title, {
                json,
                dryRun: o.dryRun ?? false,
              }),
            { json, verb: "worktree rename" },
          );
        })),
    )
    .command(
      "teardown",
      new Command()
        .description(
          "Discard this worktree's resources (destroy without accepting).",
        )
        .option("--dry-run", "Show the teardown plan; touch nothing.")
        .action(recordedExit("worktree teardown", async (o) => {
          const json = jsonFrom(o);
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.worktreeTeardown(ctx, { json, dryRun: o.dryRun ?? false }),
            { json, verb: "worktree teardown" },
          );
        })),
    )
    .command(
      "park",
      new Command()
        .description(
          "Remove a clean task checkout and its resources while retaining its branch and task wording for resume. Select it by worktree id, path, local branch, or full local ref.",
        )
        .option("--dry-run", "Show the Park plan; touch nothing.")
        .arguments("<worktree:string>")
        .action(recordedExit("worktree park", async (o, target) => {
          const json = jsonFrom(o);
          return await runWorktreeOp(
            (ctx, lc) =>
              lc.worktreePark(ctx, target, {
                json,
                dryRun: o.dryRun ?? false,
              }),
            { json, verb: "worktree park" },
          );
        })),
    )
    .command(
      "drop",
      new Command()
        .description(
          "Discard a worktree from the main checkout: tear down its resources, remove " +
            "it, and delete its branch. Protects uncommitted work and commits not on " +
            "the trunk, the shared landing branch, unless --force is set. Select it by " +
            "worktree id, path, local branch, or full local ref.",
        )
        .option(
          "--force",
          "Discard even when the worktree holds uncommitted changes or commits not on the trunk.",
        )
        .option("--dry-run", "Show the drop plan; touch nothing.")
        .arguments("<worktree:string>")
        .action(recordedExit("worktree drop", async (o, target) => {
          const json = jsonFrom(o);
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
          "Reclaim positively-owned merged worktrees, stale state, reappeared paths, and orphaned resources.",
        )
        .option("-y, --yes", "Non-interactive: skip confirmation.")
        .option(
          "--contained",
          "Also reclaim contained worktrees — checkouts whose committed work is " +
            "fully contained in another live branch. Branch refs are always kept.",
        )
        .option(
          "--dry-run",
          "Report what would be removed/reclaimed without acting.",
        )
        .action(recordedExit("worktree prune", async (o) => {
          const json = jsonFrom(o);
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
    .action(recordedExit("worktree hook", function (
      this: Command,
      o,
    ): number {
      return runCommandGroup(
        this,
        "worktree hook",
        (o as { json?: boolean } | undefined)?.json ?? false,
      );
    }))
    .command(
      "create",
      new Command()
        .description(
          "Create a worktree from a provider WorktreeCreate payload on stdin.",
        )
        .action(
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
      new Command()
        .description(
          "Tear down the worktree named by a provider WorktreeRemove payload on stdin.",
        )
        .action(
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
        .action(
          recordedExit(
            "skills list",
            async (o) => await runSkillsList({ json: jsonFrom(o) }),
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
          "--dry-run",
          "Preview every ejection and materialization target without changing it.",
        )
        .arguments("<name:string>")
        .action(
          recordedExit(
            "skills eject",
            async (o, name: string) =>
              await runSkillsEject(name, {
                json: jsonFrom(o),
                dryRun: o.dryRun ?? false,
              }),
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
  const log = makeLogger();
  if (rows.length === 0) {
    log.line("No skills (none bundled, none authored).");
    return 0;
  }
  log.line("Effective skills:");
  for (
    const row of renderAlignedRows(rows.map((r) => {
      const base = r.source === "authored"
        ? (r.overrides_bundled ? "yours (overrides built-in)" : "yours")
        : "built-in";
      return {
        label: terminalLine(r.name),
        body: r.excluded ? `${base} — excluded ([skills].exclude)` : base,
      };
    }))
  ) log.line(row);
  return 0;
}

/** Preserve an Error message and stringify non-Error failures at the CLI boundary. */
function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One exact Discern-owned target in a bundled-skill ejection plan. */
type SkillsEjectEffect =
  | {
    readonly type: "eject";
    readonly target: string;
    readonly disposition: "create";
    readonly plan: EjectSkillPlan;
  }
  | {
    readonly type: "config";
    readonly target: string;
    readonly disposition: "update";
    readonly path: string;
    readonly text: string;
  }
  | {
    readonly type: "materialize";
    readonly target: string;
    readonly disposition: "create" | "update" | "remove";
    readonly operation: SkillMaterializationOperation;
  };

/** Complete read-only plan consumed by both skills-eject surfaces and apply. */
interface SkillsEjectPlan {
  readonly ejection: EjectSkillPlan;
  readonly materialization: SkillMaterializationPlan;
  readonly effects: readonly SkillsEjectEffect[];
}

/** Project one ejection target onto the uniform engine-plan vocabulary. */
function skillsEjectPlanStep(effect: SkillsEjectEffect): PlanStep {
  const note = effect.type === "eject"
    ? "create authored skill tree"
    : effect.type === "config"
    ? "persist the configured authored-skills directory"
    : `${effect.disposition} ${effect.operation.kind} skill target`;
  return {
    kind: "refresh",
    label: verbatimStepLabel(effect.target),
    disposition: "run",
    note,
    group: effect.type === "materialize" ? "materialized skills" : "ejection",
  };
}

/** Render the complete ejection plan in the common preview envelope. */
function skillsEjectEnginePlan(plan: SkillsEjectPlan): EnginePlan {
  return {
    title: "Skills eject plan",
    details: plan.materialization.errors.map((error) =>
      `Planning error: ${error}`
    ),
    steps: plan.effects.map(skillsEjectPlanStep),
  };
}

/** Count the materialization effects represented by one plan or apply. */
function plannedSkillsMaterialization(
  plan: SkillsEjectPlan,
): SkillsEjectData["materialized"] {
  const result = {
    copied: 0,
    linked: 0,
    pruned: 0,
    errors: [...plan.materialization.errors],
  };
  for (const effect of plan.effects) {
    if (effect.type !== "materialize") continue;
    if (effect.operation.kind === "bundled") result.copied++;
    if (effect.operation.kind === "authored") result.linked++;
    if (effect.operation.kind === "stale") result.pruned++;
  }
  return result;
}

/** Build the exact ejection, config, and provider-materialization effects. */
async function planSkillsEject(
  root: string,
  name: string,
): Promise<SkillsEjectPlan> {
  const cfg = await loadConfig(root);
  const { planEjectSkill, planMaterializeSkills } = await import(
    "../lib/skills.ts"
  );
  const { skillsDirsForAgents } = await import("../lib/providers.ts");
  const { instructionAgents } = await import("./instruction_render.ts");
  const { TomlEditor } = await import("../lib/toml_edit.ts");
  const { formatTomlText } = await import("../lib/tidy_format.ts");
  const ejection = await planEjectSkill(root, cfg, name);
  const effects: SkillsEjectEffect[] = [{
    type: "eject",
    target: ejection.destRel,
    disposition: "create",
    plan: ejection,
  }];

  // Persist [skills].dir when it was omitted. The typed value already carries
  // the same default, so materialization can plan against `cfg`; only the exact
  // canonical bytes written by apply need retaining here.
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  const text = await Deno.readTextFile(path);
  if (!new RawConfig(text).has("skills.dir")) {
    const editor = new TomlEditor(text);
    editor.setString("skills.dir", cfg.skills.dir);
    effects.push({
      type: "config",
      target: relative(root, path),
      disposition: "update",
      path,
      text: await formatTomlText(path, editor.toString()),
    });
  }

  const materialization = await planMaterializeSkills(
    root,
    cfg,
    skillsDirsForAgents(instructionAgents(cfg)),
    {
      prospectiveAuthoredSkill: {
        name,
        source: "authored",
        srcAbs: ejection.destAbs,
        overrides_bundled: true,
      },
    },
  );
  for (const directory of materialization.directories) {
    for (const operation of directory.operations) {
      effects.push({
        type: "materialize",
        target: operation.targetRel,
        disposition: operation.disposition,
        operation,
      });
    }
  }
  return { ejection, materialization, effects };
}

/** Apply only operations retained by the ejection plan. */
async function applySkillsEjectPlan(
  plan: SkillsEjectPlan,
): Promise<DiscernResult<SkillsEjectData>> {
  const { applyEjectSkillPlan, applySkillMaterializationOperation } =
    await import("../lib/skills.ts");
  const { writeDiscernToml } = await import("../lib/tidy_format.ts");
  const steps: StepResult[] = [];
  const materialized: SkillsEjectData["materialized"] = {
    copied: 0,
    linked: 0,
    pruned: 0,
    errors: [...plan.materialization.errors],
  };
  const blockedDirectories = new Set<string>();
  let fatal: string | undefined;
  let skillsDirPersisted = false;

  for (const effect of plan.effects) {
    const step = skillsEjectPlanStep(effect);
    if (
      fatal !== undefined ||
      (effect.type === "materialize" &&
        blockedDirectories.has(effect.operation.dirRel))
    ) {
      steps.push({ step, outcome: "cancelled" });
      continue;
    }
    try {
      if (effect.type === "eject") {
        await applyEjectSkillPlan(effect.plan);
      } else if (effect.type === "config") {
        await writeDiscernToml(effect.path, effect.text);
        skillsDirPersisted = true;
      } else {
        const result = await applySkillMaterializationOperation(
          effect.operation,
          plan.ejection.config,
        );
        materialized.copied += result.copied;
        materialized.linked += result.linked;
        materialized.pruned += result.pruned;
      }
      steps.push({ step, outcome: "ok" });
    } catch (error) {
      const message = thrownMessage(error);
      steps.push({ step, outcome: "failed" });
      if (effect.type === "materialize") {
        blockedDirectories.add(effect.operation.dirRel);
        materialized.errors.push(
          `could not materialize skills into ${effect.operation.dirRel}: ${message}`,
        );
      } else {
        fatal = message;
      }
    }
  }

  const data: SkillsEjectData = {
    name: plan.ejection.name,
    dest_abs: plan.ejection.destAbs,
    dest_rel: plan.ejection.destRel,
    skills_dir_persisted: skillsDirPersisted,
    materialized,
  };
  if (fatal !== undefined) {
    return {
      ok: false,
      verb: "skills eject",
      error: "skills_eject_failed",
      message: fatal,
      data,
      steps,
    };
  }
  if (materialized.errors.length > 0) {
    return {
      ok: false,
      verb: "skills eject",
      error: "partial_materialization",
      message:
        `ejected "${plan.ejection.name}", but could not materialize every configured agent skill directory`,
      data,
      steps,
      hints: hintTexts([
        fire(HINTS["skills-eject-finish-materialization"]),
      ]),
    };
  }
  return {
    ok: true,
    verb: "skills eject",
    data,
    steps,
    hints: hintTexts([fire(HINTS["skills-eject-edit-override"])]),
  };
}

/** Plan and optionally apply authored copies for selected bundled skills. */
async function skillsEjectResult(
  root: string,
  name: string,
  options: { dryRun?: boolean } = {},
): Promise<DiscernResult<SkillsEjectData>> {
  try {
    const plan = await planSkillsEject(root, name);
    if (options.dryRun === true) {
      const materialized = plannedSkillsMaterialization(plan);
      const fields = {
        verb: "skills eject",
        dry_run: true as const,
        plan: skillsEjectEnginePlan(plan),
        data: {
          name: plan.ejection.name,
          dest_abs: plan.ejection.destAbs,
          dest_rel: plan.ejection.destRel,
          skills_dir_persisted: plan.effects.some((effect) =>
            effect.type === "config"
          ),
          materialized,
        },
      };
      return materialized.errors.length > 0
        ? {
          ok: false,
          error: "partial_materialization",
          message:
            `${materialized.errors.length} skill materialization target(s) could not be planned.`,
          ...fields,
        }
        : { ok: true, ...fields };
    }
    return await applySkillsEjectPlan(plan);
  } catch (error) {
    return options.dryRun === true
      ? {
        ok: false,
        verb: "skills eject",
        error: "skills_eject_failed",
        message: thrownMessage(error),
        dry_run: true,
      }
      : {
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
  if (result.dry_run === true) {
    log.info("Dry run: nothing changed.");
    if (result.plan !== undefined) {
      renderPlan(loggerSink(log), result.plan);
    }
    if (!result.ok) {
      log.error(result.message ?? "skills eject preview failed");
      for (const error of result.data?.materialized.errors ?? []) {
        log.detail(error);
      }
    }
    return;
  }
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
  opts: { json?: boolean; dryRun?: boolean } = {},
): Promise<number> {
  const root = await requireRoot("skills eject", opts.json ?? false);
  const result = await skillsEjectResult(root, name, {
    dryRun: opts.dryRun ?? false,
  });
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

/** Fold CLI punctuation and nested spacing into one comparable token. */
function foldCommandName(value: string): string {
  return value.trim().toLowerCase().replace(/[:\s]+/g, "-");
}

/** Edit distance with adjacent transpositions, over the small live command registry. */
function editDistance(a: string, b: string): number {
  let beforePrevious: number[] | undefined;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      const substitution = (previous[j - 1] ?? 0) +
        (a[i - 1] === b[j - 1] ? 0 : 1);
      let distance = Math.min(insertion, deletion, substitution);
      if (
        i > 1 && j > 1 && a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        distance = Math.min(
          distance,
          (beforePrevious?.[j - 2] ?? 0) + 1,
        );
      }
      current.push(distance);
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

interface CommandSuggestionCandidate {
  readonly display: string;
  readonly folded: string;
}

/** Flatten the live Cliffy tree; aliases score but always name their canonical path. */
function commandSuggestionCandidates(
  model: CliCommand,
): CommandSuggestionCandidate[] {
  const candidates: CommandSuggestionCandidate[] = [];
  for (const command of walkCliCommands(model)) {
    if (command.path.length === 0 || command.hidden) continue;
    const display = command.path.join(" ");
    candidates.push({ display, folded: foldCommandName(display) });
    const parent = command.path.slice(0, -1);
    for (const alias of command.aliases) {
      candidates.push({
        display,
        folded: foldCommandName([...parent, alias].join(" ")),
      });
    }
  }
  return candidates;
}

/** Select the strongest unique live-registry match, never guessing on tiny input. */
function closestCommand(
  typo: string,
  candidates: readonly CommandSuggestionCandidate[],
): string | undefined {
  const folded = foldCommandName(typo);
  if (folded.length < 3) return undefined;
  const maximum = Math.min(3, Math.max(1, Math.floor(folded.length / 4)));
  const scored = candidates.map((candidate) => ({
    ...candidate,
    distance: editDistance(folded, candidate.folded),
    prefix: commonPrefixLen(folded, candidate.folded),
  })).filter((candidate) => candidate.distance <= maximum).sort((a, b) =>
    a.distance - b.distance || b.prefix - a.prefix ||
    a.display.localeCompare(b.display)
  );
  const best = scored[0];
  const runnerUp = scored[1];
  if (best === undefined) return undefined;
  if (
    runnerUp !== undefined && runnerUp.distance === best.distance &&
    runnerUp.prefix === best.prefix && runnerUp.display !== best.display
  ) return undefined;
  return best.display;
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
  cliModel: CliModelProvider,
  scriptsAbs: string | undefined,
): Promise<string | undefined> {
  const synonym = commandSynonymSuggestion(typo);
  if (synonym !== undefined) {
    return synonym;
  }
  const builtIn = closestCommand(
    typo,
    commandSuggestionCandidates(cliModel()),
  );
  if (builtIn !== undefined) return builtIn;
  if (scriptsAbs !== undefined) {
    const script = closestCommand(
      typo,
      (await projectScriptNames(scriptsAbs)).map((name) => ({
        display: `scripts ${name}`,
        folded: foldCommandName(name),
      })),
    );
    if (script !== undefined) return script;
  }
  return undefined;
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
      new Logger({ json: false, noColor: false }).error(NO_PROJECT_MESSAGE);
    }
    return 1;
  }
  // The Project-Script-facing passthrough reads arbitrary dotted keys verbatim, so it uses
  // the raw reader (no schema, no defaults) rather than the typed loader.
  const cfg = await RawConfig.load(root);
  if (op === "get" && !cfg.has(key)) {
    const message =
      `discern.toml has no value at "${key}". Run \`discern config has ${key}\` when absence is an expected predicate.`;
    if (opts.json ?? false) {
      emitResult({
        ok: false,
        verb: "config",
        error: "unknown_key",
        message,
      });
    } else {
      new Logger({ json: false, noColor: false }).error(message);
    }
    return 1;
  }
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
      writeStdout(`${data.value}\n`);
      return 0;
    case "array":
    case "subsections":
    case "keys":
      for (const value of data.values) {
        writeStdout(`${value}\n`);
      }
      return 0;
    case "has":
      return data.present ? 0 : 1;
  }
}

/**
 * `discern config explain <path>` — a section, a named-table family, or one
 * key, explained from the prose registry and the schema. Inside a project the
 * explanation carries the current value; outside one it still explains, since
 * the registry needs no config.
 */
export async function runConfigExplain(
  path: string,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await findRoot();
  const current = root === undefined
    ? undefined
    : (await RawConfig.load(root)).raw();
  const explanation = explainConfigPath(path, current);
  const json = opts.json ?? false;
  if (explanation === undefined) {
    const message =
      `"${path}" is not a discern.toml section, named-table family, or key. ` +
      "Name one such as `scopes`, `gate.timeout`, or `standards.<name>.limit`; " +
      "`discern docs config-reference` lists them all.";
    if (json) {
      emitResult({
        ok: false,
        verb: "config",
        error: "unknown_key",
        message,
      });
    } else {
      new Logger({ json: false, noColor: false }).error(message);
    }
    return 1;
  }
  if (json) {
    emitResult({ ok: true, verb: "config", data: explanation });
    return 0;
  }
  writeStdout(renderConfigExplanation(explanation));
  return 0;
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
  cliModel: CliModelProvider,
  opts: { json?: boolean } = {},
): Promise<number> {
  const root = await findRoot();
  const cfg = root === undefined
    ? undefined
    : await loadConfig(root).catch(() => {
      // discern-best-effort: dispatch-command-suggestion-config-fallback
      return undefined;
    });
  const scripts = root !== undefined && cfg !== undefined
    ? scriptsDirOf(root, cfg)
    : undefined;
  const suggestion = await suggestCommand(verb, cliModel, scripts?.abs);
  reportUnknownCommand(verb, suggestion, "discern", opts);
  return 1;
}
