/**
 * `discern mcp` — expose the verbs to an agent over the Model Context Protocol.
 *
 * This is the THIRD rendering of the one result spine (ADR 0028): where the CLI
 * prints a {@link DiscernResult} as human text or `--json`, the MCP server returns
 * the SAME object as a tool result. Because every verb already computes a
 * DiscernResult, the server is `serializeResult` over stdio — a renderer, not a
 * reimplementation. New tools are a few lines each as their result-returning core
 * is factored out.
 *
 * The wire is the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`) over
 * its {@link StdioServerTransport} (ADR 0038): the SDK owns the JSON-RPC framing,
 * the `initialize`/`ping` handshake, protocol-version negotiation, and the tool
 * dispatch; discern owns only the tool table and the result rendering. The SDK
 * bundles cleanly into the single `deno compile` binary under least privilege, so
 * "one self-contained binary" still holds — the earlier hand-rolled loop traded
 * that off needlessly.
 *
 * Transport: the MCP stdio convention — stdout carries ONLY protocol messages;
 * every verb routes its human narration to stderr (json semantics), so the channel
 * stays clean (the ADR 0030 `--json` purity rule, here over MCP).
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "process";
import { isAbsolute } from "@std/path";
import { z } from "@zod/zod";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { type DiscernResult, serializeResult } from "../../shared/result.ts";
import {
  type AcceptData,
  AcceptOutputSchema,
  CouplingOutputSchema,
  type DocsData,
  DoctorOutputSchema,
  FinishOutputSchema,
  HelpOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  MapOutputSchema,
  PrepareOutputSchema,
  RefreshOutputSchema,
  StandardsOutputSchema,
  type StartData,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  UpdateOutputSchema,
} from "../../shared/result_schemas.ts";
import {
  configSchema,
  type DiscernConfig,
  loadConfig,
} from "../../shared/config_schema.ts";
import {
  type GuidanceContext,
  renderGuidanceTemplate,
} from "../guidance_template.ts";
import {
  NOT_SET_UP_MESSAGE,
  verbNeedsSetup,
} from "../../shared/setup_state.ts";
import { Logger } from "../../lib/log.ts";
import { finishResult } from "../gate/finish.ts";
import { prepareResult } from "../gate/prepare.ts";
import { testResult } from "../gate/test.ts";
import { standardsResult } from "../gate/standards.ts";
import { improvementResult } from "../improve/improve.ts";
import { CATEGORY_NAMES } from "../improve/rules.ts";
import { impactResult } from "../scopes/scopes.ts";
import { couplingResult } from "../coupling/coupling.ts";
import { statusResult } from "../status/status.ts";
import { refreshResult } from "../guidelines.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { helpResult, mapResult } from "../../commands/docs.ts";
import {
  acceptResult,
  lifecycleContext,
  startResult,
  updateResult,
  worktreeErrorResult,
} from "../worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";
import { KIT_VERSION } from "../../lib/version.ts";
import {
  createInstalledVersionResolver,
  versionMismatchHint,
} from "./version_check.ts";

const SERVER_NAME = "discern";

/**
 * Honest behavioural hints for a tool — the MCP `ToolAnnotations`. Mirrors the
 * SDK's type (which `registerTool` accepts) field-for-field; declared here because
 * the SDK keeps that type behind a `types.js` subpath its package `exports` map
 * doesn't expose. All properties are hints, never guarantees.
 */
interface ToolAnnotations {
  /** A short human label (the SDK also accepts a top-level `title`). */
  title?: string;
  /** The tool does not modify its environment (pure observation). */
  readOnlyHint?: boolean;
  /** The tool may perform irreversible updates (only meaningful when not read-only). */
  destructiveHint?: boolean;
  /** Repeated calls with the same args have no effect beyond the first. */
  idempotentHint?: boolean;
  /** The tool interacts with an open/external world (e.g. the network). */
  openWorldHint?: boolean;
}

/** A pure observation — reads project state, mutates nothing, and reaches nothing
 * external (git/file reads only), so the world is closed. Trivially idempotent. */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
/** Runs the project's own configured commands (and may rewrite files), but
 * reclaims/destroys nothing. `openWorldHint` is left UNSET (it defaults to true):
 * those commands are arbitrary and may reach the network, so claiming a closed
 * world would be dishonest. */
const MUTATING: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
};
/** Rewrites discern-owned generated/co-managed artifacts only. It mutates the
 * filesystem, but it is safe to re-run and does not execute project commands. */
const REFRESH: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Tears down per-worktree resources (running their configured destroy commands)
 * and moves the branch — a one-way operation. Like {@link MUTATING}, those commands
 * are arbitrary, so `openWorldHint` is left unset. */
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};
/** Merges the integration branch in and re-materializes — mutates, but is not
 * destructive (it only adds a merge + regenerates build artifacts) and is safe to
 * re-run: a no-op once the branch already contains main, hence `idempotentHint`. */
const UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

/** A tool handler's `args`: the object the SDK validates each call against and hands
 * the handler, inferred from the tool's own Zod input shape. */
type ToolArgs<TShape extends z.ZodRawShape> = z.infer<z.ZodObject<TShape>>;

/** What a {@link McpTool.reaimOnSuccess} hook decides the re-aim from. `heldRootMissing`
 * is true when the server's held working root does not exist after the call — the signal
 * that a destructive verb (accept) removed the directory it pointed at, so the held
 * root is dangling and must move even though `path` was passed. */
interface ReaimContext {
  readonly heldRootMissing: boolean;
}

/** A tool: its advertised schema + metadata plus the handler that runs the verb.
 * The SDK converts {@link inputSchema}/{@link outputSchema} (Zod raw shapes, the
 * former registered closed via {@link strictInput}, the latter the per-verb schema
 * from result_schemas.ts) to the JSON Schemas it advertises in `tools/list`, and
 * validates a call's `structuredContent` against the output schema. Generic over its input shape (`TShape`) so {@link defineTool} types
 * each handler's `args` from that tool's own `inputSchema` — the SDK has already
 * validated the call against it, so the handler reads typed fields instead of
 * re-checking an untyped `Record`. The heterogeneous {@link TOOLS} table holds the
 * widened default. */
interface McpTool<TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  /** A short human label shown by clients alongside the tool. */
  title?: string;
  description: string;
  /** The verb's arguments as a Zod raw shape. Required: a schema-less tool skips
   * SDK argument validation entirely, so whatever a caller sends is silently
   * ignored — the same hole {@link strictInput} closes for undeclared keys. A
   * genuinely argument-less verb declares an empty shape and faces that trade-off
   * explicitly. */
  inputSchema: TShape;
  /** The result shape this tool advertises (a Zod raw shape — a per-verb output
   * schema's `.shape`). The SDK validates every call's `structuredContent` against
   * it, so it MUST match what the verb actually returns (ADR 0041). */
  outputSchema?: z.ZodRawShape;
  /** Honest behavioural hints (read-only / destructive / …). */
  annotations?: ToolAnnotations;
  /** This verb's result does not depend on WHICH project it runs in — it serves the
   * same answer from anywhere, so it must stay reachable even when the server spawned
   * outside any discern project. {@link runTool}'s `not_initialized` guard reads this
   * declared property (the single source of truth the surface guards walk) instead of
   * special-casing a tool name: a root-independent tool with no resolvable root runs
   * against the process cwd rather than being refused. `discern_help` is the sole
   * member — it serves discern's OWN bundled docs, which every install carries; every
   * other tool operates on the project and genuinely needs a root. Omitted (falsey)
   * for all the rest. */
  rootIndependent?: boolean;
  /** After a SUCCESSFUL, non-preview call, compute the server's new working root —
   * the data-driven re-aim (ADR 0062), so {@link runTool} needs no per-tool name
   * switch. `discern_start` points it at the worktree it just created
   * (`result.data.path`); `discern_accept` points it at the main checkout the branch
   * landed in (`result.data.root`) — but ONLY when its own held root is now gone
   * (`ctx.heldRootMissing`), i.e. accept removed the worktree the root pointed at.
   * That guard is what lets the re-aim run even on a `path` override (accept can
   * delete the held root, unlike a one-call read) without disturbing a held root that
   * points at a DIFFERENT, still-live worktree (§2). Return undefined to leave the
   * working root unchanged — the default for every other tool, which never moves it. */
  reaimOnSuccess?(
    result: DiscernResult,
    ctx: ReaimContext,
  ): string | undefined;
  /** Run the verb in `root` with the call's arguments → the result to render.
   * `signal` aborts when the client cancels this request or the server is
   * shutting down; a long-running verb (the gate tools) forwards it so its
   * spawned jobs die with the call instead of running on as orphans. */
  run(
    root: string,
    args: ToolArgs<TShape>,
    signal: AbortSignal,
  ): Promise<DiscernResult>;
}

/** Collect one tool with its handler's `args` typed from its own `inputSchema`
 * (`TShape` inferred per call), then stored in the heterogeneous {@link TOOLS} table
 * widened to the default shape. An identity at runtime; its only job is to carry the
 * per-tool shape into the handler's signature so a field typo or a drift from the
 * declared schema is a compile error. */
function defineTool<TShape extends z.ZodRawShape>(
  tool: McpTool<TShape>,
): McpTool<TShape> {
  return tool;
}

/**
 * The schema a tool call is validated against: the tool's declared raw shape as a
 * CLOSED object (`strictObject`), so an argument the tool does not declare fails
 * the call with a loud "Unrecognized key" validation error. The SDK's default is
 * an open object that silently STRIPS unknown keys — for a mutating verb that is
 * the worst failure shape an agent-facing surface can have: the caller's intent
 * (e.g. a `path` aimed at another project) is discarded and the verb runs with
 * different semantics, reporting success. Exported so the unknown-argument guard
 * (`tests/engine_mcp_test.ts`) exercises the exact schema production registers.
 */
export function strictInput(shape: z.ZodRawShape): z.ZodType {
  return z.strictObject(shape);
}

const TOOL_PRIORITY = [
  "discern_status",
  "discern_start",
  "discern_done",
  "discern_prepare",
  "discern_test",
  "discern_update",
  "discern_standards",
  "discern_accept",
  "discern_impact",
  "discern_coupling",
  "discern_refresh",
  "discern_map",
  "discern_help",
  "discern_doctor",
  "discern_improvement",
] as const;

function orderTools(tools: McpTool[]): McpTool[] {
  const priority = new Map<string, number>(
    TOOL_PRIORITY.map((name, index) => [name, index]),
  );
  return [...tools].sort((a, b) =>
    (priority.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
    (priority.get(b.name) ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * The optional `path` override every root-operating tool carries (ADR 0062 §2): an
 * explicit project to act on instead of the server's current working root, resolved
 * through `findRoot(path)` in {@link runTool} (so any directory inside a worktree
 * resolves to its root, and a non-project path falls through to `not_initialized`).
 * `path` wins over the working root for that one call. The resolution is not fenced
 * to the spawn project: the target may be ANY discern project on disk, which is what
 * makes the surface work across a multi-repo setup (ADR 0111). Spread into each
 * root-operating tool's `inputSchema`; NOT on `discern_help` (discern's own bundled
 * docs are root-independent). `discern_start` declares its own `path` instead — same
 * resolution, but there it names the project to CREATE the worktree for, and this
 * generic text ("rarely needed — discern_start re-aims automatically") would read
 * wrong on start itself. The describe text carries no `{{var}}`, so it is not
 * interpolated. */
const PATH_PARAM = {
  path: z.string().optional().describe(
    "operate on the discern project containing this absolute path instead of the " +
      "server's current working root; rarely needed — discern_start re-aims " +
      "automatically. Must be ABSOLUTE — a relative path is refused (the server's " +
      "working directory is not yours), never resolved against the server's cwd",
  ),
};

/** The exposed tool set — each a thin adapter over a verb's result-returning core.
 * Exported so the verb-parity guard (`tests/engine_verb_parity_test.ts`) can
 * reconcile the tool slugs against the CLI verb SSOT via {@link verbOf} — every
 * MCP tool is a real verb, no dead slugs. */
export const TOOLS: McpTool[] = orderTools([
  defineTool({
    name: "discern_status",
    title: "Orient with discern_status",
    outputSchema: StatusOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Start here: call discern_status to report what is true right now and what " +
      "to do next — pure observation, never runs the gate (the project's full " +
      "quality check), tests, or standards (quality numbers that can never get " +
      "worse), and never touches anything. data.location is " +
      '"worktree" (a separate checkout and branch for one change) or "main"; data.git carries ' +
      "branch, Git-clean state, changed-files, and ahead/behind the trunk " +
      "(`{{main_branch}}`), the shared landing branch — and, when " +
      "behind, data.git.incoming_overlap names the files YOU changed that the incoming " +
      "`{{main_branch}}` also changed (the hot zone to re-read on updating, since a " +
      "clean merge can still break them); data.gate " +
      "lists what the gate WOULD fire (wired capabilities, checks, triggered scope " +
      "gates); data.gate_receipt explains whether the current clean HEAD already " +
      "has an honored receipt from discern_done (when honored, data.gate_receipt.receipt " +
      "carries the receipt markdown to relay to your owner at the review moment); " +
      "data.worktree carries this worktree's id/port/db and provisioned " +
      "resources; data.standards lists the configured quality standards — numbers " +
      "that can never get worse. " +
      "data.stale_generated flags generated agent files, data.stale_materialized " +
      "the materialized skills, and data.stale_integrations provider integration " +
      "files, that have drifted from their sources (call " +
      "discern_refresh for any of them); data.setup_unfinished is present while the project's " +
      "one-time setup is still incomplete. From the " +
      "main checkout it leads with data.fleet (a cheap row per worktree: branch, " +
      "Git-clean state, ahead/behind, a last_activity timestamp, is_current marking the row " +
      "this call is rooted in, and broken flagging a checkout whose creation never " +
      "completed — every other row is a separate line of work, not a " +
      "workspace to claim, and a clean tree never means one is free); " +
      "data.unlanded_branches lists branches holding unlanded work with no " +
      "worktree. Set all=true " +
      "to include the fleet from a worktree, or local=true to suppress it. hints[] are " +
      "advisory next-steps (e.g. run discern_done, ready for owner review, or — when on " +
      "the trunk — run discern_start to begin in your own isolated worktree) — never " +
      "an unverified pass/fail.",
    inputSchema: {
      all: z.boolean().optional().describe(
        "Include the fleet survey even from a worktree (default false).",
      ),
      local: z.boolean().optional().describe(
        "Local view only — suppress the fleet survey even in the main checkout (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      statusResult(root, {
        all: args.all === true,
        local: args.local === true,
      }),
  }),
  defineTool({
    name: "discern_refresh",
    title: "Refresh generated artifacts",
    outputSchema: RefreshOutputSchema.shape,
    annotations: REFRESH,
    description:
      "Refresh the generated agent files, materialized skills, and provider " +
      "integration artifacts. It rewrites discern-generated or co-managed artifacts " +
      "only; edit guidance sources, skill sources, or explicit provider config for " +
      "durable changes. Idempotent: a second call with the same inputs writes nothing. " +
      "Use discern_update for this branch; use `discern upgrade` for discern itself.",
    inputSchema: { ...PATH_PARAM },
    run: (root) => refreshResult(root),
  }),
  defineTool({
    name: "discern_done",
    title: "Verify the claim that the change is done",
    outputSchema: FinishOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Claim this change is done: run finishing steps, including format, which may " +
      "rewrite files; then verify lint, type-check, tests, and scope gates. A scope is " +
      "a named region of the repository with its own check. Return the structured result " +
      "with per-step outcomes plus normalized diagnostics " +
      "(tool, file/line when available, message, and the exact command to reproduce " +
      "each failure). A green run over a clean committed tree ahead of the trunk — " +
      "the shared landing branch (`{{main_branch}}`) — " +
      "also carries data.receipt — the compact review summary (data.receipt.markdown) " +
      "to relay VERBATIM to your owner when the task is complete, waiting for their " +
      "explicit instruction before calling discern_accept. Set dry_run to preview the plan without " +
      "running anything.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the gate plan and touch nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args, signal) =>
      finishResult(root, { dryRun: args.dry_run === true, signal }),
  }),
  defineTool({
    name: "discern_prepare",
    title: "Run the fast gate",
    outputSchema: PrepareOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Run the fast inner-loop gate — the project's quick quality check — with the " +
      "fix-stage fixers, then the read-only " +
      "check-stage jobs (no build, no tests) — and return the result envelope. The " +
      "quick check to run while iterating, before the full discern_done. NOTE: the " +
      "fixers MUTATE the working tree (e.g. a formatter rewrites files).",
    inputSchema: { ...PATH_PARAM },
    run: (root, _args, signal) => prepareResult(root, signal),
  }),
  defineTool({
    name: "discern_test",
    title: "Run the tests",
    outputSchema: TestOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Run the project's test capability — its configured test command — on its own " +
      "(the `test` stage, outside the " +
      "full gate) and return the result envelope. When no test command is configured " +
      "it is a trivial pass carrying a hint that says so.",
    inputSchema: { ...PATH_PARAM },
    run: (root, _args, signal) => testResult(root, signal),
  }),
  defineTool({
    name: "discern_standards",
    title: "Check the standards",
    outputSchema: StandardsOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Check every configured quality standard — numbers that can never get worse. " +
      "Run each measurement command, compare it to its limit, and assert that the " +
      "limits may only improve versus `{{main_branch}}`. Returns the per-standard " +
      "steps[]. This is the ON-DEMAND pass: discern_done already verifies every " +
      "limit and measures each standard alongside the tests on every run, so " +
      'reach for this to measure a deferred (measure = "on-demand") standard, ' +
      "to re-measure explicitly (it always measures — never replays), or to pin. " +
      "Non-dry-run calls require a clean worktree " +
      "(a separate checkout and branch for one change) " +
      "unless force is set while authoring or debugging standards. Set dry_run to " +
      "preview which standards would run — it measures nothing, with or without " +
      "pin. Set pin to " +
      "capture measured improvements INSTEAD of just checking: it tightens each " +
      "limit to the measured value (the pin_names standards, or every one with " +
      "slack), commits that change on its own, and carries the gate receipt " +
      "forward so accept skips the redundant gate re-run — the ergonomic way to " +
      "tighten a standard, never hand-edit discern.toml. Pin needs a clean worktree " +
      "and pins nothing while any standard is failing. A green check's hints[] " +
      "already name any pinnable slack with measured values, so the whole flow is " +
      "check then pin — never spend a call just to see whether a pin is worthwhile.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the plan and touch nothing — measures nothing, with or without pin (default false).",
      ),
      force: z.boolean().optional().describe(
        "Override the clean-worktree guard while authoring or debugging standards; ignored with pin (default false).",
      ),
      pin: z.boolean().optional().describe(
        "Capture measured improvements: tighten each limit to the measured value, commit it alone, and carry the gate receipt forward. Requires a clean worktree (default false).",
      ),
      pin_names: z.array(z.string()).optional().describe(
        "With pin, restrict pinning to these standards (default: every standard with slack).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      standardsResult(root, {
        dryRun: args.dry_run === true,
        force: args.force === true,
        pin: args.pin === true,
        ...(args.pin_names !== undefined ? { pinNames: args.pin_names } : {}),
      }),
  }),
  defineTool({
    name: "discern_doctor",
    title: "Check the install",
    outputSchema: DoctorOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared capability commands — " +
      "configured project commands such as format, lint, and test — " +
      "resolve on PATH, and advisories. data.checks lists every check with its detail " +
      "and — on failure — the exact fix. data.execution_model lists, per configurable " +
      "verb, the ordered steps it runs — each marked project (your configured command) " +
      "or discern (a built-in step), with its expectation — so you can see what runs " +
      "when, and catch a real config mistake (e.g. a slow command " +
      "in the fast inner loop).",
    inputSchema: { ...PATH_PARAM },
    run: (root) => doctorResult(root),
  }),
  defineTool({
    name: "discern_impact",
    title: "Show change impact",
    outputSchema: ImpactOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Show this change's impact: list which configured scopes — named regions of " +
      "the repository with their own checks — the current branch and working tree " +
      "wake. This decides which extra checks the gate, the project's full quality " +
      "check, runs.",
    inputSchema: { ...PATH_PARAM },
    run: (root) => impactResult(root),
  }),
  defineTool({
    name: "discern_coupling",
    title: "Co-change partners",
    outputSchema: CouplingOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Surface the files that historically change TOGETHER — a co-change advisory mined " +
      "from git history — so a touched file's habitual sibling isn't forgotten. Three " +
      "forms: with NO file it is DIFF-AWARE, reporting the files that co-change with your " +
      "current change set but are MISSING from it (the primary surface); pass `file` to " +
      "query ONE file's top co-change partners (its blast radius); pass `file` AND `with` " +
      "to drill into the shared history of TWO files — the commits where both changed, " +
      "with dates and subjects, to judge a coupling essential vs incidental. The partners " +
      "(data.partners) and the shared commits (data.commits) carry their evidence in plain " +
      "counts, and the human-readable advisory rides in hints[]. Strictly ADVISORY: it " +
      "points at where to look and NEVER blocks — you decide whether a strong coupling is " +
      "an essential invariant to lock with a forcing-function, or incidental and " +
      "ignorable. The list is not exhaustive.",
    inputSchema: {
      file: z.string().optional().describe(
        "Query ONE file's co-change partners (its blast radius). Omit for the diff-aware " +
          "view: what co-changes with your current change set but is missing from it.",
      ),
      with: z.string().optional().describe(
        "A SECOND file to compare with `file`: returns their shared co-change history — " +
          "the commits where BOTH changed (dates + subjects), plus each file's own commit " +
          "count, to weigh a coupling as one decision or incidental. Requires `file`.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) => {
      if (args.with !== undefined && args.file === undefined) {
        return Promise.resolve({
          ok: false,
          verb: "coupling",
          error: "invalid_arguments",
          message:
            "`with` requires `file`; pass both for evidence mode, or omit both for diff mode.",
        });
      }
      return couplingResult(root, {
        paths: [args.file, args.with].filter((p): p is string =>
          p !== undefined
        ),
      });
    },
  }),
  defineTool({
    name: "discern_improvement",
    title: "Find the next improvement",
    outputSchema: ImprovementOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Return the ranked next action for improving the project, plus the full health " +
      "audit and open qualitative reviews behind it for agent and owner to evaluate " +
      "together. data.next_action is the single highest-value improvement to make " +
      "now; data.categories carries the deterministic findings and review material. " +
      "A score of 100 means nothing objectively weak, not that the project is done. " +
      "Pass a category to focus one area.",
    inputSchema: {
      category: z.string().optional().describe(
        `Restrict to one area: ${CATEGORY_NAMES.join(", ")}.`,
      ),
      min_score: z.number().optional().describe(
        "Mark the result failed (isError) when the overall score is below this floor.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      improvementResult(root, {
        category: args.category,
        minScore: args.min_score,
      }),
  }),
  defineTool({
    name: "discern_map",
    title: "Read the project map",
    outputSchema: MapOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Read the project map — its agent-maintained documentation tree and the " +
      "grounded source for documented project behaviour. With no argument, return the index — " +
      "every doc's path, section, slug, and title — plus a regions digest with " +
      "file-linked freshness facts. Pass `target` (a slug, " +
      "`section/slug`, or path) to return that one doc's full Markdown content. The " +
      "source to consult before reasoning about this project.",
    inputSchema: {
      target: z.string().optional().describe(
        "A specific doc to fetch (slug, section/slug, or path). Omit for the index.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      mapResult(root, {
        target: args.target,
      }),
  }),
  defineTool({
    name: "discern_help",
    title: "Read discern's docs",
    outputSchema: HelpOutputSchema.shape,
    annotations: READ_ONLY,
    // discern's own bundled documentation is the same in every install and needs no
    // project — so help stays reachable from a server spawned outside any discern
    // project, matching the CLI, which serves `discern help` from anywhere (B38).
    rootIndependent: true,
    description:
      "Read discern's OWN documentation — the discern.toml config reference, " +
      "concepts, and gate/worktree/standard pages — bundled " +
      "into every install. Distinct from discern_map, which reads the host " +
      "PROJECT's map: call this to learn how discern itself works, before editing " +
      "discern.toml or reasoning about the gate. With no argument, return the index " +
      "(every doc's path, section, slug, and title); pass `target` (a slug, " +
      "`section/slug`, or path) for that one doc's full Markdown content. Always " +
      "available — it is discern's own help — and serves only " +
      "the public docs (the internal ADR/maintainer trees are never exposed here).",
    inputSchema: {
      target: z.string().optional().describe(
        "A specific doc to fetch (slug, section/slug, or path). Omit for the index.",
      ),
    },
    run: (root, args) =>
      helpResult(root, {
        target: args.target,
      }),
  }),
  defineTool({
    name: "discern_accept",
    title: "Accept and land the worktree",
    outputSchema: AcceptOutputSchema.shape,
    annotations: DESTRUCTIVE,
    description:
      "Use only when the user explicitly asks to hand off or land this branch. " +
      "Accept THIS worktree's branch onto the trunk (`{{main_branch}}`) — the shared " +
      "landing branch. A worktree is a separate checkout and branch for one change. " +
      "Tear down the worktree's resources, advance the trunk directly to the branch " +
      "tip, remove the clean worktree, and delete the " +
      "now-merged branch. It then refreshes the trunk checkout it leaves behind, " +
      "so generated guidance, skills, and provider integrations match the landed " +
      "tree. This is the single deterministic implementation — " +
      "run it rather than reproducing the steps with git; commit the work with a real " +
      "message first so it lands as a proper review commit, then relay the result " +
      "(a green landing carries data.receipt — the landing record, pasteable into a " +
      "PR body). " +
      "Requires this branch already contains the latest `{{main_branch}}`, this worktree " +
      "is clean, and the main checkout is clean and sitting on `{{main_branch}}` " +
      '— refuses (error:"precondition_failed") otherwise, naming the exact next ' +
      "step (e.g. call discern_update first). Also requires `confirmed`: absent, it " +
      "refuses read-only and re-serves the review moment (relay the receipt, wait " +
      "for the owner) instead of landing. Set dry_run to preview " +
      "the plan without touching anything. " +
      "Operates only on the worktree the server runs in; it cannot reach another.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the acceptance plan and touch nothing (default false).",
      ),
      confirmed: z.boolean().optional().describe(
        "Attestation that the owner has accepted this landing in this " +
          "conversation, or gave standing pre-authorization. Set it only then; a " +
          "pre-authorized landing still takes one call.",
      ),
      ...PATH_PARAM,
    },
    // A successful acceptance removes the worktree the server operated on — re-aim the
    // working root to the MAIN CHECKOUT the branch landed in (`result.data.root`), the
    // path subsequent calls should operate on. NOT the spawn root: that is the trunk
    // only when the server was launched from the trunk (Claude Code) — a server launched
    // INSIDE a worktree (Codex's app-managed worktree) has the just-removed worktree as
    // its spawn root, and re-aiming there would strand it in a grave (ADR 0062).
    reaimOnSuccess: (result, ctx) =>
      ctx.heldRootMissing
        ? (result.data as AcceptData | undefined)?.root
        : undefined,
    run: (root, args) =>
      acceptToolResult(root, {
        dryRun: args.dry_run === true,
        confirmed: args.confirmed === true,
      }),
  }),
  defineTool({
    name: "discern_update",
    title: "Update this branch",
    outputSchema: UpdateOutputSchema.shape,
    annotations: UPDATE,
    description:
      "Update this branch: merge the trunk's latest (`{{main_branch}}`) into THIS " +
      "worktree's branch and " +
      "re-materialize the " +
      "generated agent files + skills, in one deterministic step — the inverse of " +
      "discern_accept, and the action that resolves discern_done's merge check " +
      "(which refuses a branch behind `{{main_branch}}`). Run it whenever the branch " +
      "is behind. The source is always `{{main_branch}}` unless you pass `from` — " +
      "nothing to look up or confirm for the routine call. " +
      "Just call it: you do NOT need to run git to check first — it performs every " +
      "precondition itself and returns exactly what to do next. It is idempotent and " +
      "safe to call anytime: when the branch already contains the source nothing is " +
      "merged and the worktree is still re-converged (agent files re-materialized, " +
      "[worktree.setup].ensure re-run) — which also makes a plain re-run the recovery " +
      "after you resolve a merge conflict by hand; it merges into a tracked-clean tree only, so " +
      'it refuses (error:"precondition_failed") on uncommitted tracked changes; and on a merge ' +
      "conflict it aborts cleanly (leaving the tree untouched) and refuses, naming the " +
      "conflicted files and the manual path to resolve them. " +
      "On a merge it returns `data` summarizing what landed BENEATH your work: the " +
      "commits and files brought in (each capped, with a `*_total` and `*_truncated`), " +
      "which of your own files `overlap` them (RE-READ those — a clean merge can still " +
      "conflict semantically), the `scopes_incoming` touched, and a `range` of commit " +
      "SHAs (`range.main` is the incoming tip — the source ref's, whichever it was). " +
      "When a list is capped, pull the full set in ONE git call from the range " +
      "rather than guessing it — e.g. `git diff --stat <range.before>..<range.after>`, " +
      "or `git diff <range.before>..<range.after> -- <path>` for one file; the hints " +
      "carry the exact command. Set dry_run to preview the " +
      "plan (and the SAME predicted `data`, computed read-only without merging) without " +
      "touching anything. Never touches the main checkout; operates only " +
      "on the worktree the server runs in. This updates the branch; run " +
      "`discern upgrade` to update discern itself, or use discern_refresh to " +
      "refresh generated agent files alone.",
    inputSchema: {
      from: z.string().optional().describe(
        "Pull this ref (a branch, tag, or commit) into the worktree instead of the " +
          "trunk. OMIT for the routine call — the default is always the trunk " +
          "(`{{main_branch}}`), so there is nothing to check first. Pass a ref only " +
          "to compose on unlanded work (e.g. pull another worktree's agent/* branch " +
          "into this one).",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the update plan and touch nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      updateToolResult(root, {
        dryRun: args.dry_run === true,
        from: args.from,
      }),
  }),
  defineTool({
    name: "discern_start",
    title: "Start a worktree",
    outputSchema: StartOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Create a fresh ISOLATED worktree — a separate checkout and branch for one " +
      "change — from the main checkout, set it up, and return where it landed " +
      "(data.path). The new branch forks from the trunk (`{{main_branch}}`), the " +
      "shared landing branch, regardless of what " +
      "branch the main checkout is sitting on — you do NOT need to check or pass " +
      "anything for the normal case. " +
      "Use this when you are on the trunk (the main checkout) and about to start work: " +
      "it is the first-class way to get your own workspace, so you NEVER adopt an " +
      "existing idle worktree (each belongs to another line of work; a clean working " +
      "tree doesn't mean it's free). On success it RE-AIMS these discern tools at the " +
      "new worktree automatically — your later discern_done / discern_update / " +
      "discern_accept operate on it with nothing for you to thread. But that moves " +
      "only the discern tools: you MUST still move your OWN file operations into " +
      "data.path — re-root there, or if you can't change your working root, prefix " +
      "every shell command with `cd <path> &&` and pass `path` to every discern tool " +
      "— so your edits land in the worktree, not the trunk; otherwise your edits and " +
      "the gate diverge. Optionally pass `name` — a few words describing the task " +
      "you're about to start (e.g. `fix-upload-retry`, or a phrase like `fix the " +
      "upload retry path`) — and discern normalises it into the branch name so the " +
      "worktree is identifiable at a glance instead of an opaque codename; omit it " +
      "and you get a random codename as before. Starting work in a DIFFERENT " +
      "discern project (a dependency's repo, another component of a multi-repo " +
      "app)? Pass `path` — any absolute path inside that project — and the " +
      "worktree is created for THAT project, the re-aim following it exactly as " +
      "for a same-project start. Each call " +
      "mints a NEW worktree (not idempotent) — call it once per line of work. If you " +
      "are already inside a worktree, do NOT call this (you'd create a pointless " +
      'sibling): it refuses (error:"precondition_failed") if invoked anyway. Set ' +
      "dry_run to preview the plan without creating anything.",
    inputSchema: {
      name: z.string().optional().describe(
        "Optional name for the worktree — a short slug or a few words describing this " +
          "task (e.g. `fix-upload-retry` or `fix the upload retry path`). You don't need " +
          "to format it: discern normalises whatever you pass into a branch-safe slug " +
          "(case, spaces, and punctuation are fixed; an over-long name is shortened; an " +
          "unusable one — all punctuation, emoji — falls back to a random codename). " +
          "Omit for a random codename. data.name_note reports any normalisation or " +
          "fallback so you can retry with a cleaner name if you care.",
      ),
      from: z.string().optional().describe(
        "Branch the new worktree from this ref (a branch, tag, or commit) instead " +
          "of the trunk. OMIT for everyday starts — the default is always the trunk " +
          "(`{{main_branch}}`), so there is nothing to look up or confirm. Pass a ref " +
          "only for the special case of building on unlanded or experimental work " +
          "(e.g. another worktree's agent/* branch).",
      ),
      path: z.string().optional().describe(
        "Create the worktree FOR the discern project containing this absolute " +
          "path — the cross-project entry point (e.g. a dependency's repo that runs " +
          "its own discern). Any path inside that project resolves to its root; the " +
          "new worktree forks from THAT project's trunk, and on success the re-aim " +
          "follows it exactly as for a same-project start. Omit for the everyday " +
          "case: this server's own project.",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the start plan and touch nothing (default false).",
      ),
    },
    // A successful start re-aims the working root at the worktree it just created, so
    // the subsequent done/update/accept calls operate on it with nothing to thread.
    reaimOnSuccess: (result) => (result.data as StartData | undefined)?.path,
    run: (root, args) =>
      startToolResult(root, {
        dryRun: args.dry_run === true,
        name: args.name ?? "",
        from: args.from,
      }),
  }),
]);

/**
 * The `discern_accept` tool core: build a lifecycle context with a quiet logger
 * (accept narrates through its logger as it runs — silence it so the stdio
 * channel carries only protocol messages), perform the acceptance, and map a
 * precondition / identity refusal to the same error envelope the CLI returns.
 * Unexpected errors propagate to {@link runTool}'s catch-all.
 */
async function acceptToolResult(
  root: string,
  opts: { dryRun?: boolean; confirmed?: boolean },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    return await acceptResult(ctx, opts);
  } catch (e) {
    const mapped = worktreeErrorResult("accept", e);
    if (mapped !== undefined) {
      return mapped;
    }
    throw e;
  }
}

/**
 * The `discern_update` tool core: build a lifecycle context with a quiet logger
 * (update narrates through its logger as it merges + re-materializes — silence
 * it so the stdio channel carries only protocol messages), perform the
 * integration, and map a precondition refusal (main checkout, dirty tree, merge
 * conflict) to the same error envelope the CLI returns. Unexpected errors
 * propagate to {@link runTool}'s catch-all.
 */
async function updateToolResult(
  root: string,
  opts: { dryRun?: boolean; from?: string | undefined },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    return await updateResult(ctx, {
      dryRun: opts.dryRun ?? false,
      ...(opts.from !== undefined ? { from: opts.from } : {}),
    });
  } catch (e) {
    const mapped = worktreeErrorResult("update", e);
    if (mapped !== undefined) {
      return mapped;
    }
    throw e;
  }
}

/**
 * The `discern_start` tool core: build a lifecycle context with a quiet logger
 * (start narrates through its logger as it creates + sets up the worktree — silence
 * it so the stdio channel carries only protocol messages), mint + create the new
 * worktree, and map a precondition refusal (called from inside a worktree) to the
 * same error envelope the CLI returns. The placement root is resolved HERE (the
 * feature-layer convention) and passed into the engine core, mirroring the
 * dispatcher. On a real apply it overrides the shared engine hint with the
 * MCP-specific re-aim story (see {@link mcpStartHint}). Unexpected errors propagate
 * to {@link runTool}'s catch-all.
 */
async function startToolResult(
  root: string,
  opts: { dryRun?: boolean; name?: string; from?: string | undefined },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    const result = await startResult(ctx, {
      dryRun: opts.dryRun ?? false,
      worktreeRoot: resolveWorktreeRoot(ctx.root, ctx.config),
      name: opts.name ?? "",
      ...(opts.from !== undefined ? { from: opts.from } : {}),
    });
    // Over MCP, start ALSO re-aims the live server's working root at the new worktree
    // (runTool applies the re-aim once this returns) — the CLI can't, having no
    // persistent server, so the shared engine hint ("nothing relocated — cd there")
    // is wrong here. Replace THAT hint with the MCP story: the discern tools follow
    // automatically, but the agent must still move its OWN file context in. Only on a
    // real apply (a dry-run created nothing and moves nothing). A naming note (if any)
    // leads, so the agent still sees what the worktree was actually named; every other
    // engine hint (e.g. the dirty-main-checkout advisory) is carried through.
    const data = result.data;
    if (result.ok && result.dry_run !== true && data !== undefined) {
      const carried = (result.hints ?? []).filter((h) =>
        h !== data.name_note && !h.startsWith(`Created worktree '`)
      );
      result.hints = [
        ...(data.name_note !== undefined ? [data.name_note] : []),
        mcpStartHint(data.path),
        ...carried,
      ];
    }
    return result;
  } catch (e) {
    const mapped = worktreeErrorResult("start", e);
    if (mapped !== undefined) {
      return mapped;
    }
    throw e;
  }
}

/**
 * The result hint `discern_start` surfaces over MCP (ADR 0062 §4): the two
 * load-bearing halves the server cannot enforce on its own. (1) The discern tools are
 * now aimed at the new worktree automatically — done/update/accept follow.
 * (2) The agent must STILL move its own file operations into `path`, because the
 * server cannot relocate the client's session — and if it doesn't, its edits land on
 * the trunk while the gate runs in the worktree, so the two diverge. Written for the
 * _class_ — an agent that cannot change its working root — not per vendor: re-root
 * if you can, else prefix shell commands with `cd <path> &&` and pass `path` to
 * every discern tool. The same pattern the compiled guidance teaches; keep them
 * aligned (`version_check.ts` sibling aside, this is the one hint the two surfaces
 * share). Exported so the parity guard can hold it to that shared wording.
 */
export function mcpStartHint(path: string): string {
  return `discern's tools are now aimed at the new worktree at ${path} — your ` +
    `discern_done / discern_update / discern_accept calls operate on it ` +
    `automatically hereafter. You must STILL move your own file operations into ` +
    `${path}: re-root there (cd in, or use your environment's worktree-entering ` +
    `capability). If you can't change your working root: prefix every shell ` +
    `command with \`cd ${path} && …\`, and pass path="${path}" to every discern ` +
    `MCP tool. You MUST do this, otherwise your edits will land on the trunk ` +
    `whilst the gate runs in the worktree, and the two states will diverge.`;
}

/** The verb slug behind a tool name (`discern_impact` → `impact`),
 * for the envelope every failure path renders. Exported as the tool→verb bridge the
 * verb-parity guard uses to tie {@link TOOLS} back to the CLI verb SSOT. */
export function verbOf(toolName: string): string {
  return toolName.replace(/^discern_/, "").replace(/_/g, "-");
}

/** One MCP tool result: the serialized DiscernResult mirrored across the text and
 * structured channels, with `isError` reflecting the verb's `ok`. */
interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

/** Render a DiscernResult as an MCP tool result (text + structured, isError on !ok). */
function renderResult(result: DiscernResult): ToolResult {
  const serialized = serializeResult(result);
  return {
    content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
    structuredContent: serialized,
    isError: !result.ok,
  };
}

/** Append one hint to a result without clobbering the verb's own — it adds the
 * stale-server restart hint on top of whatever the verb already returned. */
function appendHint(result: DiscernResult, hint: string): DiscernResult {
  return { ...result, hints: [...(result.hints ?? []), hint] };
}

/**
 * The process-wide version resolver used when {@link runTool} is called without an
 * explicit one (the direct-call test path). Lazily created so importing this
 * module has no stat/exec side effect; the live server passes its own resolver,
 * created once at startup in {@link runMcpServer}.
 */
let sharedInstalledVersion: (() => Promise<string | undefined>) | undefined;
function defaultInstalledVersion(): Promise<string | undefined> {
  sharedInstalledVersion ??= createInstalledVersionResolver();
  return sharedInstalledVersion();
}

/**
 * The MCP server's **working root** — the directory its verbs operate on, held as one
 * mutable value because the OS process cwd is frozen at spawn and unusable for this
 * (ADR 0062). Initialized to the spawn root (`findRoot()`), and re-pointed on exactly
 * two lifecycle transitions: `discern_start` aims it at the worktree it just created,
 * `discern_accept` resets it to the spawn root. `undefined` when the server spawned
 * outside a discern project — {@link runTool}'s `not_initialized` guard handles that.
 * The verb cores stay pure functions of an explicit `root`; this is only the
 * server-layer default they receive, resolved per call in {@link runTool}.
 */
export class WorkingRoot {
  #root: string | undefined;
  constructor(spawnRoot: string | undefined) {
    this.#root = spawnRoot;
  }
  /** The current working root — the directory the next verb call operates on. */
  get(): string | undefined {
    return this.#root;
  }
  /** Re-point the working root (a lifecycle re-aim). */
  set(root: string): void {
    this.#root = root;
  }
}

/**
 * Run one verb in `root` and normalize an unexpected throw to an `internal_error`
 * result — so a single tool blowing up can never take the whole stdio server down.
 * The single place {@link runTool} invokes a verb (both the normal path and the
 * root-independent fallback), so the catch-all lives once. A never-aborting default
 * keeps the verb contract simple (a verb always receives a signal).
 */
async function runVerb(
  tool: McpTool,
  root: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DiscernResult> {
  try {
    return await tool.run(root, args, signal ?? new AbortController().signal);
  } catch (e) {
    return {
      ok: false,
      verb: verbOf(tool.name),
      error: "internal_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run one tool call and render its DiscernResult. The per-call root is the explicit
 * `path` argument when given (ADR 0062 §2 — resolved through `findRoot`, so any
 * directory inside a worktree resolves to its root and a non-project path falls
 * through to `not_initialized`), else the server's current working root — re-pointed
 * by `discern_start` / reset by `discern_accept` via {@link McpTool.reaimOnSuccess},
 * applied here after a successful, non-preview call. Every refusal is rendered as a
 * normal (error) {@link DiscernResult} — a missing project, or an unexpected throw
 * from the verb (caught here so a single tool error can never take the whole stdio
 * server down). `signal` (optional — a direct caller may omit it) aborts when the
 * client cancels the request or the server shuts down; it is forwarded to the verb
 * so a long-running gate dies with the call instead of running on as an orphan.
 */
export async function runTool(
  tool: McpTool,
  working: WorkingRoot,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  resolveInstalledVersion: () => Promise<string | undefined> =
    defaultInstalledVersion,
): Promise<ToolResult> {
  // Version handshake: if the discern binary on disk was replaced with a different
  // version since this long-lived server started, its engine and embedded templates
  // are stale, so every result carries a restart hint (see version_check.ts). Cheap
  // — a single stat per call, only spawning `--version` on the replace itself — so
  // it runs on every path, refusals included.
  const stale = versionMismatchHint(
    KIT_VERSION,
    await resolveInstalledVersion(),
  );
  const render = (result: DiscernResult): ToolResult =>
    renderResult(stale === undefined ? result : appendHint(result, stale));

  // The explicit `path` override wins over the working root for this one call; any dir
  // inside a worktree resolves to its root, a non-project path → undefined → refusal.
  const pathArg = typeof args.path === "string" ? args.path : undefined;
  // The `path` argument MUST be absolute — its own schema says "this absolute path".
  // The server's OS cwd is frozen at spawn and is not the caller's directory, so a
  // relative `path` would resolve against that stale cwd and silently operate on the
  // WRONG project while reporting success. Refuse it here — the one choke point every
  // tool's `path` flows through — with an actionable error, so no verb inherits the
  // confidently-wrong answer (B40).
  if (pathArg !== undefined && !isAbsolute(pathArg)) {
    return render({
      ok: false,
      verb: verbOf(tool.name),
      error: "invalid_arguments",
      message:
        `\`path\` must be an absolute path, but got "${pathArg}". The MCP server's ` +
        `working directory is fixed at spawn and is not your current directory, so a ` +
        `relative path can't be resolved reliably — pass the absolute path to the ` +
        `project (or a directory inside it) you mean to act on.`,
    });
  }
  const root = pathArg ? await findRoot(pathArg) : working.get();
  if (root === undefined) {
    // A root-independent tool (discern_help) serves the same answer from anywhere —
    // discern's OWN bundled docs, present in every install — so it must not be refused
    // just because the server spawned outside a project. Run it against the process cwd
    // (which its verb core doesn't consult for the bundled tree). Every other tool
    // genuinely needs a project and refuses (B38). The property is declared on the tool
    // (the TOOLS-table single source of truth) — no per-name special case here.
    if (tool.rootIndependent === true) {
      return render(
        await runVerb(tool, Deno.cwd(), args, signal),
      );
    }
    return render({
      ok: false,
      verb: verbOf(tool.name),
      error: "not_initialized",
      message: NO_PROJECT_MESSAGE,
    });
  }
  // Pre-setup gate — the MCP mirror of the CLI redirect: a setup-gated verb
  // (the setup-gated verbs, including `discern_map`) refuses until the project records
  // `[meta].bootstrapped`, so an agent never reads a false all-green or an empty
  // doc tree. `discern_help`/`discern_status`/`discern_doctor`/`discern_improvement` are
  // not gated — they are exactly what you reach for before setup is done.
  if (
    verbNeedsSetup(verbOf(tool.name)) && !(await setupGatePasses(root))
  ) {
    return render({
      ok: false,
      verb: verbOf(tool.name),
      error: "not_set_up",
      message: NOT_SET_UP_MESSAGE,
    });
  }
  const result = await runVerb(tool, root, args, signal);
  // Data-driven re-aim (ADR 0062): on a successful, non-preview lifecycle call, move
  // the working root per the tool's own hook (start → the new worktree it created;
  // accept → the main checkout it landed in). A `path` override is normally a
  // one-call steer that does NOT move the held root (§2) — but accept can REMOVE the
  // directory the held root points at, so the hook re-roots when that root is now gone
  // (`heldRootMissing`), even on a path override; otherwise the next no-path call would
  // resolve a deleted worktree (the Codex failure mode). A dry-run never moves it.
  if (
    result.ok && result.dry_run !== true && tool.reaimOnSuccess !== undefined
  ) {
    const heldRoot = working.get();
    const heldRootMissing = heldRoot !== undefined &&
      !(await pathExists(heldRoot));
    const next = tool.reaimOnSuccess(result, { heldRootMissing });
    if (next !== undefined) {
      working.set(next);
    }
  }
  return render(result);
}

/** True when `path` exists on disk — the held-working-root liveness check the re-aim
 * reads to tell "accept removed my root" from a still-live root (ADR 0062 §2). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the pre-setup gate should let a setup-gated tool run: true once the
 * project records `[meta].bootstrapped`, and also true when the config cannot be
 * read — so the verb's own core surfaces the real config error rather than a
 * misleading `not_set_up` (the MCP mirror of the CLI's `configOk` guard). Resolved
 * per call, not once at startup, so a project set up mid-session (via the
 * CLI, alongside a long-lived server) is picked up without a restart.
 */
async function setupGatePasses(root: string): Promise<boolean> {
  try {
    return (await loadConfig(root)).meta.bootstrapped;
  } catch {
    return true;
  }
}

/**
 * Resolve the config the server renders + gates against: the project's real
 * `discern.toml`, or — outside a project, or when the config can't be parsed — the
 * fully-defaulted config (`configSchema.parse({})`). Resolved ONCE at startup for
 * the text rendering below. The defaulted fallback
 * gives {@link mcpContext} a sane fallback
 * `main_branch` ("main") instead of leaving a raw `{{main_branch}}` token on the wire.
 */
async function resolveServerConfig(
  root: string | undefined,
): Promise<DiscernConfig> {
  if (root !== undefined) {
    try {
      return await loadConfig(root);
    } catch {
      // A missing / mid-edit / invalid config falls through to the defaults below;
      // the verb cores still surface the real config error when actually invoked.
    }
  }
  return configSchema.parse({});
}

/**
 * The template context the MCP agent-facing text renders against — the
 * `discern.toml`-configurable values its tool descriptions, titles, and instructions
 * may name, so a project that customised one reads its real value rather than
 * discern's default. The MCP sibling of `guidanceContext` (`guidance_render.ts`):
 * the SAME `{{var}}` engine, a different surface. PURE function of config. Keep it
 * minimal — add a var only when a description/instruction actually interpolates it;
 * every exposed var is held to that by the surface guard (`engine_mcp_surface_test`).
 */
export function mcpContext(config: DiscernConfig): GuidanceContext {
  return {
    vars: {
      main_branch: config.repository.trunk,
    },
    preds: {},
  };
}

/**
 * Render one piece of MCP agent-facing text (a tool description/title, or the
 * instructions block) against the project's config via {@link mcpContext}. The
 * SINGLE interpolation shared by {@link runMcpServer}'s tool registration and the
 * surface guard, so the guard can never test a different render than ships. Text
 * with no `{{var}}` passes through untouched; an unknown `{{var}}` throws (the
 * engine's strictness — a typo'd token fails loudly, never reaches the wire blank).
 */
export function renderMcpText(text: string, config: DiscernConfig): string {
  return renderGuidanceTemplate(text, mcpContext(config));
}

// ── resources (readable context, paired with the tools; ADR 0041) ────────────
// Resources are application-driven and NOT reliably auto-injected across the 80% of
// clients, so the tools stay the reliable path; resources are the elegant
// attachable surface alongside them. Each is computed FRESH on every read (no
// subscriptions, no listChanged) and serves the verb's `data` payload — not the
// full DiscernResult envelope.

const JSON_MIME = "application/json";
const MARKDOWN_MIME = "text/markdown";

/** One resource read: a single text part carrying `text` at `uri` with `mimeType`. */
function resourceText(
  uri: URL,
  mimeType: string,
  text: string,
): { contents: { uri: string; mimeType: string; text: string }[] } {
  return { contents: [{ uri: uri.href, mimeType, text }] };
}

/** Pretty-print a value as the JSON a resource serves. */
function asJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Throw the canonical not-set-up refusal when a setup-gated resource is read
 * before the project records `[meta].bootstrapped` — the resource mirror of the
 * tool's pre-setup gate. */
async function assertResourceSetUp(root: string): Promise<void> {
  if (!(await setupGatePasses(root))) {
    throw new Error(NOT_SET_UP_MESSAGE);
  }
}

/**
 * Register the doc-tree resources for one scheme (`map` = the project's tree,
 * `help` = discern's own): a fixed index (`discern://<scheme>` → the JSON index)
 * and a `{+target}` template (`discern://<scheme>/{+target}` → that one doc's
 * Markdown; the `+` is RFC 6570 reserved-expansion so the target may contain `/`
 * and resolve a slug, `section/slug`, OR a path — see the template below).
 * `index`/`single` are the verb cores (the caller pre-guards them); a
 * not-found or refused read throws, which the SDK renders as a resource-read error.
 */
function registerDocTree(
  server: McpServer,
  scheme: "map" | "help",
  label: string,
  index: () => Promise<DiscernResult<DocsData>>,
  single: (target: string) => Promise<DiscernResult<DocsData>>,
): void {
  server.registerResource(
    `discern-${scheme}-index`,
    `discern://${scheme}`,
    {
      description:
        `The index of ${label} — every doc's path, section, slug, and title.`,
      mimeType: JSON_MIME,
    },
    async (uri: URL) => {
      const result = await index();
      if (!result.ok) {
        throw new Error(result.message ?? `cannot read ${scheme}.`);
      }
      return resourceText(uri, JSON_MIME, asJson(result.data));
    },
  );
  server.registerResource(
    `discern-${scheme}-doc`,
    // `{+target}` is RFC 6570 reserved-expansion: the bare `{target}` the SDK
    // compiles stops its capture at a `/` (and a `,`), so only a slug-shaped target
    // ever matched — `section/slug` and a path (both containing `/`) fell through to
    // a not-found. The `+` operator captures the reserved set, `/` included, so all
    // three forms the description advertises (and the discern_map/discern_help tools
    // accept) resolve as resources too. The variable is still named `target`, so the
    // read handler's `variables.target` is unchanged.
    new ResourceTemplate(`discern://${scheme}/{+target}`, { list: undefined }),
    {
      description:
        `One document from ${label}, by slug, section/slug, or path.`,
      mimeType: MARKDOWN_MIME,
    },
    async (uri: URL, variables: { [key: string]: string | string[] }) => {
      const raw = variables.target;
      const target = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
      const result = await single(target);
      const data = result.data;
      if (!result.ok || data?.doc === undefined) {
        throw new Error(result.message ?? `no doc matches "${target}".`);
      }
      return resourceText(uri, MARKDOWN_MIME, data.doc.content);
    },
  );
}

/**
 * Register the readable resources, mirroring the tools' pre-setup gating:
 * `discern://status`, `discern://impact`, `discern://config`, and
 * `discern://help` (+ a `{+target}` template) are always available;
 * `discern://map` (+ template)
 * refuses per read until the project is bootstrapped — exactly as the matching tools
 * do. Every read recomputes from the verb core against the server's CURRENT working
 * root (resolved per read via {@link WorkingRoot}, ADR 0062), so the resources follow
 * `discern_start` / `discern_accept` exactly as the tools do — never a spawn root
 * frozen at registration.
 */
function registerResources(
  server: McpServer,
  working: WorkingRoot,
): void {
  // Resolve the working root AT READ TIME (not captured), so a resource read reflects
  // the latest re-aim. Defensive throw only: resources are registered solely when the
  // spawn root was defined, and the working root never moves to undefined, so a read
  // always sees a real project root.
  const currentRoot = (): string => {
    const root = working.get();
    if (root === undefined) {
      throw new Error(NO_PROJECT_MESSAGE);
    }
    return root;
  };
  server.registerResource(
    "discern-status",
    "discern://status",
    {
      description:
        "A live discern_status snapshot: the git situation, what the gate would fire, the configured standards, and (from the main checkout) the worktree fleet.",
      mimeType: JSON_MIME,
    },
    async (uri: URL) =>
      resourceText(
        uri,
        JSON_MIME,
        asJson((await statusResult(currentRoot())).data),
      ),
  );

  server.registerResource(
    "discern-impact",
    "discern://impact",
    {
      description:
        "The project scopes the current branch and working tree changed — what decides which scope gates fire.",
      mimeType: JSON_MIME,
    },
    async (uri: URL) =>
      resourceText(
        uri,
        JSON_MIME,
        asJson((await impactResult(currentRoot())).data),
      ),
  );

  server.registerResource(
    "discern-config",
    "discern://config",
    {
      description:
        "The resolved discern.toml configuration for this project (fully defaulted).",
      mimeType: JSON_MIME,
    },
    async (uri: URL) =>
      resourceText(uri, JSON_MIME, asJson(await loadConfig(currentRoot()))),
  );

  // help — discern's OWN documentation, always available (the pre-setup surface).
  registerDocTree(
    server,
    "help",
    "discern's own documentation",
    () => helpResult(currentRoot()),
    (target) => helpResult(currentRoot(), { target }),
  );

  // map — the project's agent-maintained documentation, gated (per read) on setup completion,
  // mirroring the discern_map tool.
  registerDocTree(
    server,
    "map",
    "the project map — its agent-maintained documentation",
    async () => {
      const root = currentRoot();
      await assertResourceSetUp(root);
      return mapResult(root);
    },
    async (target) => {
      const root = currentRoot();
      await assertResourceSetUp(root);
      return mapResult(root, { target });
    },
  );
}

/**
 * The server's `instructions` — the native "when to use which tool" block capable
 * clients load when MCP connects (it rides in the `initialize` result). discern's
 * operating model in a few imperative lines, carrying the strong MCP-first stance:
 * these tools are the primary surface, not the CLI.
 * The worktree lifecycle is listed LINEARLY — start, then update, then accept —
 * not branched on the server's location: every lifecycle tool is always registered
 * (ADR 0062 retired the location-based hiding), and the server re-aims its working
 * root on `discern_start`, so an agent that starts on the trunk can drive the whole
 * lifecycle through this one connection.
 */
export function buildInstructions(): string {
  const lines = [
    "discern supplies this project's quality gate (its full quality check) and " +
    "worktree workflow (a separate checkout and branch for each change), and these tools are the primary " +
    "surface for working in it — prefer them over shelling out to the `discern` " +
    "CLI; each returns a structured result you can read directly.",
    "",
    "- Orient at the start of a session with discern_status: the branch's " +
    "situation, what the gate would fire, and advisory next steps.",
    "- If generated agent files or materialized skills are missing/stale, call " +
    "discern_refresh. It rewrites discern-generated and co-managed artifacts only.",
    "- Before calling any change done, run discern_done on the final tree (the full gate). While " +
    "iterating, use discern_prepare (the fast fix-then-check loop) and discern_test " +
    "(just the tests). On a failure, read the result's diagnostics[] — the tool, " +
    "the command to reproduce it, the captured output — and fix from those rather " +
    "than re-running and scraping.",
    "- Learn how discern itself works (the gate, discern.toml, worktrees) with " +
    "discern_help.",
    "- Verify the install with discern_doctor when something looks misconfigured " +
    "(bad config, a command not on PATH, a stale schema).",
    "- Read THIS project's map — its agent-maintained documentation tree — with discern_map.",
    "- Ask discern_improvement for the ranked next action, health audit, and open reviews.",
    "- Quality standards — numbers that can never get worse — are enforced by " +
    "discern_done itself: every run verifies no limit loosened versus the " +
    "trunk and measures each standard alongside the tests. Use " +
    "discern_standards for the on-demand pass: deferred standards, and " +
    "capturing a gain with pin. Non-dry-run standards require a " +
    "clean worktree unless force=true while authoring standards.",
    "- Starting work from the main checkout, which holds the trunk (the shared " +
    "landing branch)? Run discern_start to " +
    "create your own isolated worktree: it returns the new worktree's path and " +
    "re-aims these tools at it, so your later done/update/accept calls operate " +
    "on the new worktree automatically. You must still move your OWN file " +
    "operations into that path: re-root there, or if you can't change your " +
    "working root, prefix every shell command with `cd <path> &&` and pass `path` " +
    "to every discern tool. Otherwise edits land on the trunk while the gate runs " +
    "in the worktree. NEVER adopt an existing idle worktree; each is another line " +
    "of work, and a clean working tree doesn't mean it's free.",
    "- When the branch is behind `{{main_branch}}` (the gate's merge check " +
    "points here), bring `{{main_branch}}` in with discern_update: it " +
    "merges `{{main_branch}}` into this worktree's branch " +
    "and re-materializes the agent files + skills in one step. Just call it — you " +
    "don't need to run git to check first. It is idempotent (a no-op when already " +
    "up to date), never touches the main checkout, and performs every precondition " +
    "itself, refusing cleanly with the exact next step (e.g. a dirty tree or a " +
    "merge conflict). Reproducing its steps by hand is slower and usually " +
    "unnecessary.",
    "- Only when the user explicitly asks to hand off or land a finished branch " +
    '("accept this", "I\'ll take it from here", "move this back to {{main_branch}}") ' +
    "should you use discern_accept. Do not treat a green gate run or status hint as " +
    "permission to accept; if no handoff was requested, stop and report the " +
    "branch ready for review. Commit the work with a real message, run the final " +
    "clean discern_done for that commit, then just call the tool (the single deterministic implementation — " +
    "don't reproduce its git steps, and don't pre-flight preconditions with git: " +
    "it refuses cleanly with the exact next step, e.g. run discern_update " +
    "first) and relay its structured result. Landing is trunk-only and " +
    "destructive: it fast-forwards `{{main_branch}}` to the branch tip, removes " +
    "the worktree, and deletes the merged branch — set dry_run to preview the " +
    "plan without touching anything.",
  ];
  return lines.join("\n");
}

/**
 * Run the MCP server over stdio via the official SDK. The spawn root is resolved
 * once at startup; it seeds the mutable
 * {@link WorkingRoot} the verbs actually operate on (re-aimed by `discern_start` /
 * `discern_accept`, ADR 0062). Every tool is registered unconditionally
 * (ADR 0101: the subsystems are all core).
 * `connect` starts the transport; the server then runs until stdin closes (the
 * transport's `onclose`), at which point this resolves and the process exits.
 */
export async function runMcpServer(): Promise<number> {
  const spawnRoot = await findRoot();
  const cfg = await resolveServerConfig(spawnRoot);
  // The server's logical cwd, made explicit: seeded from the spawn root, then
  // re-pointed on discern_start / discern_accept. Both the tools and the readable
  // resources resolve it per call/read, so the whole surface follows the re-aim.
  const working = new WorkingRoot(spawnRoot);
  // The version handshake's resolver, created once so it seeds its baseline stat at
  // server start (this process IS KIT_VERSION); every tool call reuses it to detect
  // the on-disk binary being replaced mid-session.
  const installedVersion = createInstalledVersionResolver();
  const server = new McpServer(
    { name: SERVER_NAME, version: KIT_VERSION },
    {
      instructions: renderMcpText(buildInstructions(), cfg),
    },
  );

  // Aborted when the client closes the pipe, so an in-flight gate run dies with
  // the server instead of orphaning its jobs. Each call's effective signal is
  // this OR the SDK's per-request signal (aborted on `notifications/cancelled`
  // when the client cancels that one call).
  const shutdown = new AbortController();
  const callSignal = (extra: { signal: AbortSignal }): AbortSignal =>
    AbortSignal.any([extra.signal, shutdown.signal]);

  for (const tool of TOOLS) {
    // The shared config: description plus the honest metadata (title, the per-verb
    // outputSchema the SDK validates structuredContent against, and the behavioural
    // annotations). Built with conditional keys so an absent field is omitted rather
    // than set to `undefined` (exactOptionalPropertyTypes).
    const config = {
      description: renderMcpText(tool.description, cfg),
      ...(tool.title !== undefined
        ? { title: renderMcpText(tool.title, cfg) }
        : {}),
      ...(tool.outputSchema !== undefined
        ? { outputSchema: tool.outputSchema }
        : {}),
      ...(tool.annotations !== undefined
        ? { annotations: tool.annotations }
        : {}),
    };
    // The input schema registers CLOSED (strictInput), so a call carrying an
    // argument the tool doesn't declare is refused with a validation error —
    // never accepted with the stray key silently stripped.
    server.registerTool(
      tool.name,
      { ...config, inputSchema: strictInput(tool.inputSchema) },
      (args: Record<string, unknown>, extra: { signal: AbortSignal }) =>
        runTool(tool, working, args, callSignal(extra), installedVersion),
    );
  }

  // Resources — readable context paired with the tools (ADR 0041). Registered only
  // when the server spawned inside a project; each read recomputes fresh against the
  // CURRENT working root (so the resources follow discern_start / discern_accept
  // exactly as the tools do — ADR 0062).
  if (spawnRoot !== undefined) {
    registerResources(server, working);
  }

  const transport = new StdioServerTransport();
  // The SDK's stdio transport closes only on an explicit `close()` — it does not
  // react to stdin EOF. Bridge that here so the server shuts down cleanly when the
  // client closes the pipe (and `runMcpServer` returns rather than deadlocking the
  // top-level await): on stdin `end`, cancel any in-flight verb (tree-killing its
  // gate jobs) and close the transport, whose `onclose` resolves.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = (): void => resolve();
  });
  process.stdin.once("end", () => {
    shutdown.abort();
    void transport.close();
  });
  await server.connect(transport);
  await closed;
  return 0;
}
