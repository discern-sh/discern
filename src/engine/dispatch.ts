/**
 * The engine-verb dispatcher: attaches the project task-runner verbs to the
 * `discern` CLI, including the `scripts` namespace for project-owned executables
 * under `[scripts].dir` (whose default comes from the paths registry).
 *
 * Engine verbs operate on the project (found by walking up to `discern.toml`), so
 * each requires a project root.
 */

import { loadModule } from "../shared/module_loading.ts";
import { Command, EnumType } from "@cliffy/command";
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
  noProjectResult,
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
import { ACCEPT_ACTIONS } from "../shared/verbs.ts";

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

// Verb BODIES load at dispatch time (`loadModule(() => import(…))` inside each action),
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
 * uniform `no_project` envelope on stdout — including the stable slug a
 * caller branches on — and in terminal mode the canonical stderr line. Every engine verb that needs a
 * project passes its verb name and json flag here, so a new verb inherits the
 * structured refusal for free (`tests/engine_no_project_test.ts` holds the
 * whole verb surface to it).
 */
async function requireRoot(verb: string, _json: boolean): Promise<string> {
  const root = await findRoot();
  if (root === undefined) {
    throw new CliRefusal(noProjectResult(verb));
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
  const lc = await loadModule(() => import("./worktree/lifecycle.ts"));
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
      "Run the gate on a clean, committed tree and record Proof when it passes. The gate is your project's full quality check: the jobs it configures, such as format, lint, type-check, and tests.\nUncommitted or untracked files stop it before anything runs. Its fixers may change files, and a change to a committed file fails the run without committing anything, so run `discern prepare` and commit first. discern asks any checkpoint questions before the checks run. If current Proof already covers this commit, `done` returns it without running the checks again.",
    )
    .option(
      "--dry-run",
      "Show which checks, jobs, and scope gates would run, without running them. It still needs a committed tree.",
    )
    .option(
      "--policy-base <ref:string>",
      "For a CI report, with `--ci` and `--standalone`: judge the change against the settings in this fetched commit instead of the trunk's current tip.",
    )
    .option(
      "--standalone",
      "Run every check for feedback, even with uncommitted changes. discern records no Proof and no results it can reuse.",
    )
    .option(
      "--rerun",
      "Run the checks again even when current passing Proof covers this commit, or retry a failure on unchanged code. discern records the rerun, and the newest result wins.",
    )
    .option(
      "--ci",
      "For continuous integration: run the checks and list any checkpoint questions, without waiting for or recording answers. Its Proof can't be used to land.",
    )
    .option(
      "--met <id:string>",
      "Answer a checkpoint question as met, as your recorded judgment (repeatable). It applies only to a question this worktree is waiting on. Once every waiting question has an answer, the checks run in the same call.",
      { collect: true },
    )
    .option(
      "--unmet <id:string>",
      "Answer one checkpoint question as unmet, with `--why`. The checks still run, but landing then needs the owner to approve a variance.",
      { collect: true },
    )
    .option(
      "--why <rationale:string>",
      "Why the question isn't met, for `--unmet`: one paragraph of 1–500 " +
        "characters, without line breaks or control characters. The Proof " +
        "keeps it, as written, for the owner's landing decision.",
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
        const { runFinish } = await loadModule(() =>
          import("./gate/finish.ts")
        );
        return await runFinish(await requireRoot("done", json), {
          ...(o.policyBase === undefined ? {} : { policyBase: o.policyBase }),
          ...(o.standalone === undefined ? {} : { standalone: o.standalone }),
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
      "Run the quick checks while you work: fix and regenerate files, then run the read-only checks, without tests.\nIn order, it runs the fix jobs, such as the formatter, the `[generated]` commands, and `discern refresh`, then the check jobs, such as lint and type-check. It works on uncommitted changes, may change files, and never commits. It skips build and test jobs, scope gates, and standards, and records no Proof. Run it before your final commit, so `discern done` has nothing left to rewrite.",
    )
    .action(
      recordedExit("prepare", async (o) => {
        const { runPrepare } = await loadModule(() =>
          import("./gate/prepare.ts")
        );
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
      "Run your project's tests on their own, without the rest of the gate.\nIt runs every test-stage job, such as `test` and `smoke`, and waits for a free test-run slot first. It works on uncommitted changes and records no Proof. You don't need it before `discern done`, which runs the tests itself.",
    )
    .action(
      recordedExit("test", async (o) => {
        const { runTestJob } = await loadModule(() =>
          import("./gate/test_job.ts")
        );
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
      "Run a command, such as a test suite, once a test-run slot is free, so parallel tasks don't overload this machine.\n`[gate].concurrent_test_runs` sets how many slots every checkout shares. Outside a project, or when that setting is 0, the command runs straight away. discern runs it directly, not through a shell, and passes its output and exit status through unchanged. Everything after `--` belongs to the command, and there's no `--json`, `--markdown`, or `--render` form. To wait for another task instead, use `discern await`.",
    );
  registerDirectRecordedCliCommandPath("queue");

  root
    .command("improvement")
    .description(
      "Find the most valuable improvement to make next in how this project uses discern.\nIt scores what discern can check automatically, lists the review questions it can't, for your agent and you to weigh together, and suggests one next step. It changes nothing.",
    )
    .option(
      "--category <name:string>",
      `Review one area only: ${CATEGORY_NAMES.join(", ")}.`,
    )
    .option(
      "--min-score <n:number>",
      "Exit non-zero when the score is below this number, for use as a CI check. With `--category`, it's that area's score.",
    )
    .action(
      recordedExit("improvement", async (o) => {
        const { runImprovement } = await loadModule(() =>
          import("./improve/improve.ts")
        );
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
      "Show the checkpoints that apply to this task, whether each question has an answer, and which ones the current change would trigger.\nIt also shows how often each checkpoint has fired, been answered unmet, and needed a variance. It runs no `when` commands and changes no checkpoint state.",
    )
    .action(
      recordedExit("checkpoints", async (o) => {
        const { runCheckpoints } = await loadModule(() =>
          import("./checkpoints/report.ts")
        );
        return await runCheckpoints(
          await requireRoot("checkpoints", jsonFrom(o)),
          { json: jsonFrom(o) },
        );
      }),
    );

  root
    .command("progress")
    .description(
      "Check on a long operation, such as `discern done`, after losing track of it.\nIt shows the operation's current phase, the counts and failures so far, and its result once it finishes. Pass the progress handle that an MCP call announced or `discern status` shows; without one, it reads this checkout's latest operation. It changes nothing and never reruns the operation.",
    )
    .arguments("[handle:string]")
    .action(
      recordedExit("progress", async (o, handle) => {
        const { runProgress } = await loadModule(() =>
          import("./completion/progress_result.ts")
        );
        return await runProgress(
          await requireRoot("progress", jsonFrom(o)),
          { json: jsonFrom(o), handle },
        );
      }),
    );

  root
    .command("mcp")
    .description(
      "Run discern's MCP (Model Context Protocol) server, which gives coding agents most of discern's commands as tools.\nYou don't need to run it yourself: setup and `discern refresh` configure each agent to start it. It talks over standard input and output.",
    )
    .option(
      MCP_LONG_TOOL_CALLS_FLAG,
      `For agents that allow long tool calls: let each await call wait up to ${AWAIT_LONG_CALL_SECONDS} seconds.`,
    )
    .option(
      MCP_STRICT_TOOL_CALLS_FLAG,
      `For agents that end long tool calls early: keep each await call to ${AWAIT_STRICT_CALL_SECONDS} seconds, and suggest the command line for long work. Without either option, await calls also stop at ${AWAIT_STRICT_CALL_SECONDS} seconds.`,
    )
    .action(recordedExit("mcp", async (o) => {
      // The server resolves the project root itself and reports a missing one
      // per tool-call, so it need not requireRoot up front.
      const { runMcpServer } = await loadModule(() =>
        import("./mcp/server.ts")
      );
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
      "List your project's scripts, or run one by name.\ndiscern looks the name up as written, with no partial matches. It runs the script from the project root with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK` set, passes every following argument through unchanged, and returns its exit status.",
    )
    .arguments("[name:string] [...args:string]")
    .action(
      recordedExit(
        "scripts",
        async (_o, name: string | undefined, ...args: string[]) => {
          const { runProjectScript } = await loadModule(() =>
            import("./project_scripts.ts")
          );
          return await runProjectScript(name, args);
        },
      ),
    );

  const standardsCommand = new Command()
    .description(
      "Measure your project's standards: limits on measured numbers, such as test coverage or bundle size. A change can tighten a limit, but loosening one needs the owner's approval.\nName standards to measure only those; otherwise discern measures them all. It first checks that no limit is looser than the trunk's, and saves each measurement so a later `--pin` or `discern done` can reuse it for the same commit. You don't need it before finishing: `discern done` checks every standard. For a number that grows with the project, hold a rate with `per`. Give a total that drifts a `margin`, or a limit pinned at today's value fails the next ordinary change.",
    )
    .arguments("[names...:string]")
    .option(
      "--dry-run",
      "List the standards that would be measured, without measuring them.",
    )
    .option(
      "--force",
      "Measure even with uncommitted changes. Use it only while writing a standard; `--pin` ignores it.",
    )
    .option(
      "--pin",
      "Lock in improvements: tighten each named standard's limit, or every limit with room to tighten, to its measured value, keeping its margin as headroom. It needs a clean worktree and reuses measurements already taken for this commit. With names, it measures only those standards when current Proof covers the commit; otherwise it measures them all. discern commits the new limits by themselves, and that commit needs a fresh `discern done` before it can land.",
    )
    .action(
      recordedExit("standards", async (o, ...names: string[]) => {
        const { runStandards } = await loadModule(() =>
          import("./gate/standards.ts")
        );
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
        "Propose a looser limit for a standard this change breaks, for the owner to approve.\nRun it on the branch's final, clean commit. discern measures the standard and commits a proposal that changes only its limit, set to the measured value. Rerun after later commits, with the same reason, to carry an unchanged proposal forward without a new commit. Landing still needs the owner's explicit approval of the value and reason.",
      )
      .arguments("<name:string>")
      .option(
        "--reason <reason:string>",
        "Why the limit should change, for the owner to read: 1–500 characters on one line, with no secrets and no claim that anyone has approved it.",
      )
      .option("--dry-run", "Show the proposal without making it.")
      .action(recordedExit(
        "standards propose",
        async (o, name: string) => {
          const { runStandardsPropose } = await loadModule(() =>
            import(
              "./gate/standard_proposals.ts"
            )
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
      "Regenerate your agent files, skills, agent integrations, and ADR index from their sources. To bring the trunk into this branch, use `discern update`; to update the project for a newer discern, use `discern upgrade`.\nIt also updates discern's block in `.gitattributes` and discern's settings in the repository's Git config. It writes files but never commits. It never removes an agent's files, even when you drop that agent from `[project].agents`.",
    )
    .option(
      "--dry-run",
      "List each file it would create, update, or remove, without changing anything.",
    )
    .action(recordedExit("refresh", async (o) => {
      const json = jsonFrom(o);
      const root = await requireRoot("refresh", json);
      const { refreshResult } = await loadModule(() =>
        import("./instructions.ts")
      );
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
      "Format the files discern manages: the map, the TODO list, your instruction files, and `discern.toml`.\nPass `md` or `toml` to format one kind; leave it out for both. It also checks that box-drawing diagrams in code blocks stay aligned: a misaligned diagram fails the run without stopping the formatting, and a fence marked `freeform` is skipped. If any file can't be parsed, such as Markdown with invalid YAML frontmatter, or formatting would drop cells from a table row, discern changes no files at all. Escape a pipe inside a code span as `\\|` to keep its cell.",
    )
    .option(
      "--dry-run",
      "List the files that would change, without changing them.",
    )
    .action(recordedExit("tidy", async (o, type: string | undefined) => {
      // Keep the formatter host and embedded WASMs off every other verb's module
      // path. The WASMs are read and instantiated only when tidy formats a file.
      const { runTidy } = await loadModule(() => import("./tidy/tidy.ts"));
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
      "Show which scopes this branch's changes touch, and so which scope gates `discern done` will run. Scopes are named regions of the repository, set in `discern.toml`.\nIt counts the branch's commits since it left the trunk, plus uncommitted and untracked files. Neutral scopes never appear. It also lists `code` when any file outside the neutral scopes changed, and `previewable` when a scope with a preview command changed.",
    )
    .option(
      "--has <scope:string>",
      "Check one scope, or `code` or `previewable`. On its own, it prints nothing and exits 0 if the change touches it, 1 if not. With `--json`, it reports the answer in `data.membership` and exits 0.",
    )
    .action(
      recordedExit("impact", async (o) => {
        const { runImpact } = await loadModule(() =>
          import("./scopes/scopes.ts")
        );
        return await runImpact(await requireRoot("impact", jsonFrom(o)), {
          json: jsonFrom(o),
          ...(o.has !== undefined ? { has: o.has } : {}),
        });
      }),
    );

  root
    .command("coupling")
    .description(
      "Find files that usually change together in your Git history, so a change doesn't miss one.\nWith no arguments, it lists files that often change with the ones you changed but are missing from your change. With one file, it lists that file's usual partners. With two files, it lists recent commits that changed both. It's advice only and always exits 0.",
    )
    .arguments("[file:string] [with:string]")
    .action(recordedExit("coupling", async (o, file, withFile) => {
      const paths = [file, withFile].filter((p): p is string =>
        p !== undefined
      );
      const { runCoupling } = await loadModule(() =>
        import("./coupling/coupling.ts")
      );
      return await runCoupling(await requireRoot("coupling", jsonFrom(o)), {
        json: jsonFrom(o),
        ...(paths.length > 0 ? { paths } : {}),
      });
    }));

  root
    .command("await")
    .description(
      "Wait for another task: until its work passes the gate, until it lands, or until the trunk moves.\n" +
        `By default it waits up to ${AWAIT_LONG_CALL_SECONDS} seconds and ` +
        "returns as soon as the condition holds. If time runs out first, it exits with status 124 and returns a short handle; pass it to `--resume` to keep waiting for the same thing. It doesn't change any work, and it blocks only the command that called it. To wait for a free test-run slot before running a command, use `discern queue -- <command> [args...]` instead.",
    )
    .option(
      "--green <worktree:string>",
      "Wait until that task's worktree has a current, passing Proof. Name it by worktree id, path, local branch, or full local ref. Its landing also counts.",
    )
    .option(
      "--landed <worktree:string>",
      "Wait until that task's work reaches the trunk. Name it by worktree id, path, local branch, or full local ref.",
    )
    .option(
      "--trunk-moved",
      "Wait until the trunk moves from where it was when the wait began.",
    )
    .option(
      "--resume <handle:string>",
      "Keep waiting for an earlier wait's condition, using the handle it returned. Don't add a condition option.",
    )
    .option(
      "--timeout <seconds:number>",
      `How many seconds to wait before answering "not yet". Default: up to ${AWAIT_LONG_CALL_SECONDS}. It returns early once the condition holds; 0 checks once without waiting.`,
    )
    .action(recordedExit("await", async (o) => {
      const { runAwait } = await loadModule(() => import("./await/await.ts"));
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
      "Show patterns in how this project uses discern, from its local logbook.\nFindings cover standard trends, how well the gate fits the work, habits such as repeated failures, and the path from start to landing. Each finding shows its counts and what the logbook couldn't see, and says when there isn't enough evidence. It's advice only.",
    )
    .option(
      "--stats",
      "Show usage statistics instead: changes landed, passing streaks, cycle times, standard trends, and results grouped by coding agent, from the same logbook. With `--json`, they're added to the result as `data.stats`.",
    )
    .option(
      "--all",
      "Show every finding. Without it, each kind of check shows its first few.",
    )
    .option(
      "--logbook-file <filename:string>",
      "Read a sealed archive instead of the active logbook. Give a file name that `discern patterns archives` lists.",
    )
    .action(
      recordedExit("patterns", async (o) => {
        const { runPatterns } = await loadModule(() =>
          import("./logbook/patterns.ts")
        );
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
          "List the logbook's sealed archives, with each one's event count, date range, and size.",
        )
        .action(
          recordedExit("patterns archives", async (o) => {
            const { runPatternsArchives } = await loadModule(() =>
              import(
                "./logbook/patterns.ts"
              )
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
          "--dry-run",
          "Show the full plan without asking for confirmation or changing any files.",
        )
        .action(
          recordedExit(invocation, async (o) => {
            const { runPatternsLifecycle } = await loadModule(() =>
              import(
                "./logbook/patterns.ts"
              )
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
      "Show where this checkout stands and what to do next.\nIt runs no checks, tests, or measurements, and changes nothing in your project. From the main checkout, it also lists the task worktrees.",
    )
    .option(
      "--all",
      "Also list every worktree when you run it from a task worktree. You can't combine it with `--local`.",
    )
    .option(
      "--local",
      "Show only this checkout, even in the main checkout.",
    )
    .option(
      "-v, --verbose",
      "Show everything: each worktree in full, its evidence, the configured checks, landing history, and full Proof pages. With `--json`, return the complete status instead of the shorter summary; full Proof pages stay out of JSON.",
    )
    .action(recordedExit("status", async (o) => {
      const { runStatus } = await loadModule(() =>
        import("./status/status.ts")
      );
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
      "Open the desk, your interactive view of every task in this project.\nFrom the desk you can start tasks and agents, run project scripts, review changes and Proof, land work or pre-approve it, and clean up worktrees. Run it from the main checkout; bare `discern` opens it too. It needs an interactive terminal. To list worktrees from a script, use `discern status --all --json`.",
    )
    .action(
      recordedExit("desk", async (o) => {
        const { runDesk } = await loadModule(() => import("./desk/desk.ts"));
        return await runDesk({ json: jsonFrom(o), cliModel });
      }),
    );

  root
    .command("enter")
    .description(
      "Open a shell in another worktree, in the same folder you're in now.\nPick the main checkout or a worktree from the list, and exit the shell to return. If that folder doesn't exist there, the shell opens in the nearest one that does. It changes nothing and needs an interactive terminal. To list worktrees from a script, use `discern status --all --json`.",
    )
    .action(
      recordedExit("enter", async (o) => {
        const { runEnter } = await loadModule(() =>
          import("./worktree/shell_picker.ts")
        );
        return await runEnter({ json: jsonFrom(o) });
      }),
    );

  root
    .command("start")
    .description(
      "Create a worktree for a new task: a separate checkout on its own " +
        `branch, started from the trunk${trunkName}, your project's shared branch.\n` +
        "Run it from the main checkout. discern sets the worktree up, including its resources and setup commands, then prints its path. Uncommitted work in the main checkout stays where it is.",
    )
    .option(
      "--dry-run",
      "Show what `start` would create, without creating anything. The real run picks a new id.",
    )
    .option(
      "--name <name:string>",
      "Name the task. discern keeps your text as the title and derives the worktree id from it. Without `--name` or `--title`, the id is a random codename.",
    )
    .option(
      "--title <title:string>",
      "Set a display title that differs from `--name`. Without `--name`, discern derives the id from the title.",
    )
    .option(
      "--brief <brief:string>",
      "Save a one-line description of the task, shown in task details and when an agent starts on it.",
    )
    .option(
      "--from <source:string>",
      "Start from something other than the trunk: a branch, tag, commit, or another worktree's id or path. To resume a parked task, pass its branch.",
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
    .command("accept [action:accept-action]")
    .type("accept-action", new EnumType(ACCEPT_ACTIONS))
    .description(
      `Land this worktree's proven commit on the trunk${trunkName}, your project's shared branch.\n` +
        "A proven commit is one that `discern done` passed. It lands only with the owner's approval in this conversation or a recorded grant; otherwise discern records it in the landing queue for the owner. If the trunk moved since the Proof, discern checks the combined code in a temporary integration worktree and lands exactly what passed. A second `accept` waits its turn. After landing, discern removes the worktree, its resources, and its branch, unless the branch has newer commits or the checkout has uncommitted changes. `discern accept queue` adds the commit to the landing queue without landing it. `discern accept emergency --reason <text>` starts an emergency landing of a repair whose checks haven't passed: it needs the owner's fresh, explicit approval and issues no passing Proof.",
    )
    .option(
      "--dry-run",
      "Show the landing plan without landing or recording anything. From the main checkout without `--target`, list the landing queue.",
    )
    .option(
      "--target <effort:string>",
      "Choose the task by id, path, or branch, from any checkout. From the main checkout, it's required. After that task lands, discern lands the rest of the queue in order, each under its own recorded grant. With `accept queue`, add the task's proven commit to the queue instead.",
    )
    .option(
      "--prepare",
      "Emergency only: answer checkpoint questions before an emergency landing. discern runs the checkpoint triggers and keeps the evidence for review, but runs no checks and lands nothing. Needs `--reason`.",
    )
    .option(
      "--preparation-receipt <receipt:string>",
      "Emergency only: the receipt `--prepare` returned for this repair and trunk.",
    )
    .option(
      "--met <id:string>",
      "Answer a checkpoint question as met (repeatable): a question about the combined code, with `--composition-receipt`, or an emergency question, with `accept emergency --prepare`.",
      { collect: true },
    )
    .option(
      "--unmet <id:string>",
      "Answer one checkpoint question as unmet, with `--why`: a question about the combined code, with `--composition-receipt`, or an emergency question, with `accept emergency --prepare`. Landing then needs the owner's variance.",
    )
    .option(
      "--why <rationale:string>",
      "Why the question isn't met, for `--unmet`, in one paragraph.",
    )
    .option(
      "--composition-receipt <receipt:string>",
      "The receipt that came with a question about the combined code. Pass it with `--met`, `--unmet`, or `--variance` so your answer applies to that exact combination. If discern has replaced the combination, it refuses the old receipt and asks its own question again.",
    )
    .option(
      "--reason <text:string>",
      "Emergency only: why the repair must land before its checks pass. The owner reviews it, and the approval token is tied to it.",
    )
    .option(
      "--approval-token <token:string>",
      "Emergency only: the preview token the owner approved, with `--confirmed`. It's valid only briefly, and only while the repair, trunk, and reason stay the same.",
    )
    .option(
      "--recover <id:string>",
      "Emergency only: finish an interrupted emergency landing, named by its landing id. discern records whether the trunk moved and cleans up; it lands nothing new and needs no new approval.",
    )
    .option(
      "--confirmed",
      "Record that the owner approved this landing in the current conversation. It covers only the selected landing. discern checks standing and task grants on its own. Approval given for an interrupted landing covers only finishing that landing. Without approval or a grant, discern lands nothing; `--dry-run` needs neither.",
    )
    .option(
      "--variance <id:string>",
      "Record that the owner approved landing despite this unmet checkpoint answer, without changing it (repeatable; needs `--confirmed`). The ids must match the current unmet answers exactly. No recorded grant can approve a variance.",
      { collect: true },
    )
    .option(
      "--approve-standard <token:string>",
      "Record that the owner approved a proposed standard limit (repeatable; needs `--confirmed`). Use the token from the refusal or the emergency plan: it binds one standard, value, and reason, and the tokens must match the current proposals exactly. No grant can approve a limit change.",
      { collect: true },
    )
    .action(recordedExit(
      "accept",
      async (o, action: unknown) => {
        const {
          acceptDeclarationArguments,
          acceptRequestFields,
          emergencyArguments,
        } = await loadModule(() => import("./emergency/arguments.ts"));
        const declarations = acceptDeclarationArguments(o.unmet, o.why);
        if (declarations.kind === "refusal") {
          throw new CliRefusal(declarations.result);
        }
        const parsed = emergencyArguments(
          typeof action === "string" ? action : undefined,
          { ...o, unmet: declarations.unmet },
        );
        if (parsed.kind === "refusal") throw new CliRefusal(parsed.result);
        const json = jsonFrom(o);
        return await runWorktreeOp(
          async (ctx) => {
            if (parsed.value.emergency !== undefined) {
              const { emergencyResult } = await loadModule(() =>
                import("./emergency/action.ts")
              );
              const { emitOrRenderWorktreeResult } = await loadModule(() =>
                import("./worktree/lifecycle.ts")
              );
              emitOrRenderWorktreeResult(
                ctx,
                await emergencyResult(ctx, parsed.value.emergency),
                json,
              );
              return;
            }
            const { acceptLanding } = await loadModule(() =>
              import("./worktree/accept.ts")
            );
            await acceptLanding(ctx, {
              ...acceptRequestFields(
                { ...o, queueOnly: parsed.value.queueOnly },
                declarations.unmet,
              ),
              json,
              cliModel,
            });
          },
          { json, verb: "accept" },
        );
      },
      (_o, action) => typeof action === "string" ? { action } : {},
    ));

  root
    .command("update")
    .description(
      `Merge the latest trunk${trunkName}, your project's shared branch, into this ` +
        "branch, and refresh what depends on it. For a newer discern, use `discern upgrade`; for agent files alone, use `discern refresh`.\nRun it in a task worktree with no uncommitted changes to tracked files. discern settles conflicts in generated files by regenerating them; any other conflict stops the merge and leaves your files as they were. Then it reruns the generators, refreshes agent files, and runs the `ensure` commands, even when there was nothing to merge. It lists the files both sides changed, so you can re-read them.",
    )
    .option(
      "--dry-run",
      "Show what the update would bring in and change, without changing anything.",
    )
    .option(
      "--from <source:string>",
      "Merge something other than the trunk: a branch, tag, commit, or another worktree's id or path. Use it to build on work that hasn't landed yet.",
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
      "Print a stable value discern derives for a checkout's branch, development host, port, database, and external resources.\nChoose one value per call; the default is the id. Name another checkout by id, path, local branch, or full local ref; the default is the checkout you're in.",
    )
    .option("--id", "Print the checkout's id (the default).")
    .option(
      "--site",
      "Print its development-server host name, safe to use in a web address.",
    )
    .option("--branch", "Print its branch name.")
    .option(
      "--port",
      "Print its stable development-server port. discern doesn't reserve the port.",
    )
    .option(
      "--db",
      "Print a name for it that's safe to use as a database name.",
    )
    .option("--seed", "Print its stable seed for ordering tests.")
    .option(
      "--worktree",
      "Print its resource handle: a stable name, starting with the project slug, for its external resources.",
    )
    .option(
      "--resource <name:string>",
      "Print the stable external name of one declared resource.",
    )
    .option(
      "--resources",
      "Print every declared resource as `name=handle` lines.",
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
      } = await loadModule(() => import("./worktree/lifecycle.ts"));
      const { WORKTREE_FIELDS } = await loadModule(() =>
        import("./worktree/identity.ts")
      );
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
              error: "identity_failed",
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
    .description(
      "Set up this worktree, or bring its setup up to date. `discern start` runs it for you.\nThe first run creates the worktree's resources, env values, and port, and runs its one-time setup steps. Later runs check the resources and rerun the `ensure` commands. Run it inside the worktree. If a setup step was interrupted, it stops and shows how to recover.",
    )
    .option("--dry-run", "Show the setup plan without changing anything.")
    .option(
      "--mark-step-complete <id:string>",
      "Recover an interrupted setup step that you've checked finished: mark it done without running it again. Needs `--confirmed`.",
    )
    .option(
      "--retry-step <id:string>",
      "Recover an interrupted setup step by running it again. Needs `--confirmed`.",
    )
    .option(
      "--confirmed",
      "Record that the owner checked what the interrupted step left behind and chose this recovery. Required with `--mark-step-complete` or `--retry-step`.",
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
        const { isSetupStepId } = await loadModule(() =>
          import(
            "./worktree/setup_step_journal.ts"
          )
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
      "Manage worktrees: separate checkouts, each on its own branch, for one task.",
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
        .description(
          "Make sure this worktree is set up; it's safe to run any number of times. Coding agents' session-start hooks run it.\nIn a worktree that isn't set up yet, it runs the full setup. In one that is, it checks the resources and reruns the `ensure` commands, and a failure never blocks the session. In the main checkout it changes nothing and reminds the agent to start a worktree before editing.",
        )
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
          "Change this worktree's title. Its id, branch, path, brief, and starting point stay the same.",
        )
        .option("--dry-run", "Show the change without making it.")
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
          "Remove this worktree's resources, such as its database, and keep everything else.\nThe checkout, branch, and Proof stay. Run it inside the worktree. To remove the worktree as well, use `discern worktree drop` from the main checkout.",
        )
        .option(
          "--dry-run",
          "Show what would be removed, without removing anything.",
        )
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
          "Set a task aside: remove its checkout and resources, and keep its branch, title, and brief so you can resume it.\nRun it from the main checkout. The worktree must have no uncommitted or untracked changes. Parking also removes the task's Proof, grant, and landing-queue entry. Resume with `discern start --from <branch>`. Name the worktree by id, path, local branch, or full local ref.",
        )
        .option(
          "--dry-run",
          "Show what parking would remove, without changing anything.",
        )
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
          "Delete a worktree, its resources, and its branch.\nRun it from the main checkout. discern refuses when the worktree has uncommitted changes or commits that aren't on the trunk, unless you pass `--force`, and it never drops a locked worktree. It first saves the branch's last commit to a recovery ref and prints it. It deletes the branch only if discern created it. Name the worktree by id, path, local branch, or full local ref.",
        )
        .option(
          "--force",
          "Drop the worktree even when it has uncommitted changes or commits that aren't on the trunk. Uncommitted work is lost for good.",
        )
        .option(
          "--dry-run",
          "Show what would be removed, without removing anything.",
        )
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
          "Clean up what finished work leaves behind: landed worktrees and their branches, stale records, folders that reappeared, and orphaned resources.\ndiscern removes only what it can show it created, such as a clean worktree whose branch is fully merged. Commits that haven't landed stay on their branches. Run it from the main checkout; it asks before changing anything unless you pass `--yes`.",
        )
        .option(
          "-y, --yes",
          "Skip the confirmation. Required without an interactive terminal.",
        )
        .option(
          "--contained",
          "Also remove clean, idle worktrees whose commits are all on another live branch. Their branches stay.",
        )
        .option(
          "--dry-run",
          "List what would be removed, without removing anything or asking.",
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
            const { worktreeCreateHook } = await loadModule(() =>
              import(
                "../lib/worktree_hooks.ts"
              )
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
            const { worktreeRemoveHook } = await loadModule(() =>
              import(
                "../lib/worktree_hooks.ts"
              )
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
      "Manage skills, the reusable playbooks your agents follow: list them, or copy a built-in one so you can edit it.",
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
          "List the skills your agents get: discern's built-in skills and yours, which of yours replace a built-in, and which are excluded.",
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
          "Copy a built-in skill into your skills folder, `[skills].dir`, so you can edit it; your copy then replaces the built-in.\nIf `discern.toml` doesn't set `[skills].dir` yet, discern adds it. It refuses a name that isn't a built-in skill, or one you've already copied, and it doesn't commit.",
        )
        .option(
          "--dry-run",
          "Show what would be copied and where agents would get it, without changing anything.",
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
  const { listSkills, skillsListResult } = await loadModule(() =>
    import("../lib/skills.ts")
  );
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
  const { planEjectSkill, planMaterializeSkills } = await loadModule(() =>
    import(
      "../lib/skills.ts"
    )
  );
  const { skillsDirsForAgents } = await loadModule(() =>
    import("../lib/providers.ts")
  );
  const { instructionAgents } = await loadModule(() =>
    import("./instruction_render.ts")
  );
  const { TomlEditor } = await loadModule(() => import("../lib/toml_edit.ts"));
  const { formatTomlText } = await loadModule(() =>
    import("../lib/tidy_format.ts")
  );
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
    await loadModule(() => import("../lib/skills.ts"));
  const { writeDiscernToml } = await loadModule(() =>
    import("../lib/tidy_format.ts")
  );
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
  const { discoverProjectScripts } = await loadModule(() =>
    import("./project_scripts.ts")
  );
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
      emitResult(noProjectResult("config"));
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
