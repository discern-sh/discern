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
import {
  findRoot,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
} from "../../shared/env.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { serializeResult } from "../../shared/result_serialization.ts";
import {
  observeResult,
  takeObservedResult,
  takeShownTipIds,
  takeSupplementalHintIds,
  takeVerbTarget,
} from "../../shared/result_capture.ts";
import {
  captureCrashReport,
  type CrashSignature,
  internalErrorResult,
  throwIfCrashProbe,
  writeCrashArtifact,
} from "../crash.ts";
import { beginRecording, type Recording } from "../logbook/record.ts";
import type { DriverFacts } from "../logbook/schema.ts";
import {
  type AgentSignal,
  detectAgentSignals,
  type RecordedMcpClient,
  resolveMcpClientInfo,
} from "../logbook/agent_signals.ts";
import {
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_STRICT_CALL_SECONDS,
  type AwaitCallProfile,
} from "../../shared/mcp_timeout_policy.ts";
import {
  type AcceptData,
  AcceptOutputSchema,
  AwaitOutputSchema,
  CouplingOutputSchema,
  type DocsData,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  MapOutputSchema,
  PatternsOutputSchema,
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
import { awaitResult } from "../await/await.ts";
import { patternsResult } from "../logbook/patterns.ts";
import { statusResult } from "../status/status.ts";
import { refreshResult } from "../guidelines.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { docsResult, mapResult } from "../../commands/docs.ts";
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
  appendHintTexts,
  fire,
  type FiredHint,
  firedHintsFromTexts,
  HINTS,
  hintTexts,
  resolveResultHintsForSurface,
  withFailureRecoveryHint,
} from "../../shared/hints.ts";
import { renderCommandRefsMcp } from "../../shared/command_reference.ts";
import {
  createInstalledVersionResolver,
  versionMismatchHint,
} from "./version_check.ts";
import {
  AWAIT_WATCH_POLICY,
  operatingPolicyStatementsFor,
  worktreeContinuityPolicy,
} from "../../shared/operating_policies.ts";

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

/** A safe observation — changes no project data, Git ref, or external system.
 * Internal protocol and logbook records may change without changing the
 * observed domain, so the world remains closed. */
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

/** What a {@link McpTool.reaimAfterResult} hook decides the re-aim from. `heldRootMissing`
 * is true when the server's held working root does not exist after the call — the signal
 * that a destructive verb (accept) removed the directory it pointed at, so the held
 * root is dangling and must move even though `path` was passed. */
interface ReaimContext {
  readonly heldRootMissing: boolean;
}

/** Per-invocation protocol context available to handlers but not user input. */
interface McpToolContext {
  readonly awaitCallProfile: AwaitCallProfile;
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
   * against the process cwd rather than being refused. `discern_docs` is the sole
   * member — it serves discern's OWN bundled docs, which every install carries; every
   * other tool operates on the project and genuinely needs a root. Omitted (falsey)
   * for all the rest. */
  rootIndependent?: boolean;
  /** After a non-preview call, compute the server's new working root from the
   * result's effect evidence. The data-driven re-aim (ADR 0062) means
   * {@link runTool} needs no per-tool name switch. `discern_start` points it at the
   * worktree it just created (`result.data.path`); `discern_accept` points it at the
   * main checkout the branch landed in (`result.data.root`) when its landing state
   * says that it removed the worktree and its own held root is now gone
   * (`ctx.heldRootMissing`).
   * That guard is what lets the re-aim run even on a `path` override (accept can
   * delete the held root, unlike a one-call read) without disturbing a held root that
   * points at a DIFFERENT, still-live worktree (§2). Return undefined to leave the
   * working root unchanged — the default for every other tool, which never moves it. */
  reaimAfterResult?(
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
    context: McpToolContext,
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

/** The exclusive UTF-8 byte limit for Claude Code's server instructions. */
export const MCP_INSTRUCTIONS_BYTE_LIMIT = 2 * 1024;

/** The startup-visible lifecycle, in the order an agent should follow it. */
export const MCP_CORE_LIFECYCLE = [
  "discern_status",
  "discern_start",
  "discern_prepare",
  "discern_test",
  "discern_done",
  "discern_update",
  "discern_await",
  "discern_accept",
] as const;

const TOOL_PRIORITY = [
  ...MCP_CORE_LIFECYCLE,
  "discern_standards",
  "discern_impact",
  "discern_coupling",
  "discern_patterns",
  "discern_refresh",
  "discern_map",
  "discern_docs",
  "discern_doctor",
  "discern_improvement",
] as const;

/** Sort tool definitions by the verb registry while retaining MCP-only tools. */
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
 * root-operating tool's `inputSchema`; NOT on `discern_docs` (discern's own bundled
 * docs are root-independent). `discern_start` declares its own `path` instead — same
 * resolution, but there it names the project to CREATE the worktree for, and this
 * generic text ("rarely needed — discern_start re-aims automatically") would read
 * wrong on start itself. The describe text carries no `{{var}}`, so it is not
 * interpolated. */
const PATH_PARAM = {
  path: z.string().optional().describe(
    "Run this call against a specific discern project or worktree. Pass an " +
      "ABSOLUTE filesystem path inside the intended checkout, including another " +
      "repository in a multi-repo workspace; discern resolves its project root. " +
      "Omit it to use the checkout this MCP server currently targets. Use it when " +
      "you cannot re-root into a worktree or are coordinating multiple repositories. " +
      "The override applies to this call only; relative paths are rejected.",
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
      '"worktree" (a separate checkout and branch for one effort) or "main"; data.git carries ' +
      "branch, Git-clean state, changed-files, and ahead/behind the trunk " +
      "(`{{main_branch}}`), the shared landing branch — and, when " +
      "behind, data.git.incoming_overlap names the files YOU changed that the incoming " +
      "`{{main_branch}}` also changed (the hot zone to re-read on updating, since a " +
      "clean merge can still break them); data.gate " +
      "lists what the gate WOULD fire (declared jobs and triggered scope " +
      "gates); data.gate_receipt explains whether the current clean HEAD already " +
      "has an honored receipt from discern_done (when honored, data.gate_receipt.receipt_line " +
      "carries the one-line receipt you copy verbatim to end your report at the review moment — " +
      "data.gate_receipt.receipt is the full page, for your owner to read, never to paste " +
      "into a message); data.landing_authority is present when a recorded standing " +
      "or effort grant exists, resolving the exact tree as authorized or naming " +
      "the uncovered paths that still need conversation consent; " +
      "data.worktree carries this worktree's id/port/db and provisioned " +
      "resources; data.standards lists the configured quality standards — numbers " +
      "that can never get worse. " +
      "data.stale_generated flags agent files, data.stale_materialized " +
      "the materialized skills, data.stale_integrations provider integration " +
      "files, and data.stale_adr_index the maintained ADR index, " +
      "that have drifted from their sources (call " +
      "discern_refresh for any of them); data.setup_unfinished is present while the project's " +
      "one-time setup is still incomplete. From the " +
      "main checkout it leads with data.fleet (a cheap row per worktree: branch, " +
      "Git-clean state, ahead/behind, last_action naming the newest completed " +
      "logbook verb, running naming fresh work in flight with elapsed and typical " +
      "duration, and last_activity taking the later of Git or logbook activity; " +
      "is_current marks the row this call is rooted in, and broken flags a checkout whose creation never " +
      "completed; each row also carries its landing_authority when a grant exists — " +
      "every other row is a separate line of work, not a " +
      "workspace to claim, and a clean tree never means one is free); " +
      "data.unlanded_branches lists branches holding unlanded work with no " +
      "worktree; data.fleet_collisions lists pairs of fleet branches whose " +
      "changes touch the same files — both may merge cleanly and still " +
      "conflict semantically, so whoever lands second updates with extra " +
      "care. Set all=true " +
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
    description: "Refresh the agent files, materialized skills, provider " +
      "integration artifacts, and the maintained ADR index (the record lists " +
      "between markers in the map's ADR README, regenerated from the record " +
      "files on disk). It rewrites discern-generated or co-managed artifacts " +
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
      "also carries data.receipt and resolves any recorded grant into " +
      "data.landing_authority. Follow the resolution-gated hints: an uncovered " +
      "landing is reported to the owner in your own words and ends with " +
      "data.receipt.line verbatim before you wait; a covered landing names the " +
      "verified source and routes straight to discern_accept. Never paste " +
      "the full page (data.receipt.markdown) into a message — your owner pulls it from " +
      "discern directly. Set dry_run to preview the plan without " +
      "running anything.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the gate plan and touch nothing (default false).",
      ),
      confirmed: z.boolean().optional().describe(
        "Attest this rerun: run the full gate again on the exact tree it last " +
          "judged — a flake probe, or a re-measure — and record it. Without " +
          "the flag, an unchanged-tree rerun refuses read-only (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args, signal) =>
      finishResult(root, {
        surface: { kind: "quiet" },
        dryRun: args.dry_run === true,
        confirmed: args.confirmed === true,
        signal,
      }),
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
    description: "Run the project's configured test job on its own " +
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
      "(a separate checkout and branch for one effort) " +
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
      "check then pin — never spend a call just to see whether a pin is worthwhile. " +
      "Authoring a NEW standard? Sort the number first: an invariant a healthy " +
      "project never adds holds the raw count; a quality that scales holds a " +
      "rate (per); a total that grows with the product needs margin and an owner " +
      "willing to raise the limit as it grows — a ceiling pinned at today's value " +
      "fails the next legitimate change and invites offsetting edits from " +
      "unrelated code.",
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
    run: (root, args, signal) =>
      standardsResult(root, {
        dryRun: args.dry_run === true,
        force: args.force === true,
        pin: args.pin === true,
        ...(args.pin_names !== undefined ? { pinNames: args.pin_names } : {}),
        signal,
      }),
  }),
  defineTool({
    name: "discern_doctor",
    title: "Check the install",
    outputSchema: DoctorOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared job commands — " +
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
    title: "Coupling",
    outputSchema: CouplingOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Surface the files that historically change TOGETHER as a read-only advisory " +
      "mined from git history, so a touched file's habitual sibling isn't forgotten. Three " +
      "forms: with NO file it is DIFF-AWARE, reporting the files that co-change with your " +
      "current change set but are MISSING from it (the primary surface); pass `file` to " +
      "query ONE file's top co-change partners (its blast radius); pass `file` AND `with` " +
      "to drill into the shared history of TWO files — the commits where both changed, " +
      "with dates and subjects, to judge a coupling essential vs incidental. The partners " +
      "(data.partners) and the shared commits (data.commits) carry their evidence in plain " +
      "counts, and the human-readable finding rides in hints[]. You decide whether a strong coupling is " +
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
    name: "discern_await",
    title: "Await a fleet condition",
    outputSchema: AwaitOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Block until a fleet condition holds, then return the observed state and " +
      "the next step — one call instead of guessed polling while a sibling " +
      "worktree finishes. Pass exactly ONE condition: `green` (a branch name) " +
      "waits until that branch's worktree holds an honored gate receipt — a " +
      "green `discern_done` on its current clean HEAD (the work landing on " +
      "`{{main_branch}}` also satisfies it, since only a validated tree " +
      "lands); `landed` (a branch name) waits until that branch's work — its " +
      "latest observed tip after it has work — is reachable from `{{main_branch}}`; `trunk_moved` " +
      "waits until `{{main_branch}}` moves at all. Conditions ground in git " +
      "ancestry, gate receipts, and landed receipt notes, never in recorded " +
      "activity. If the bound expires, the result stays ok with data.met false. " +
      "Pass data.resume by itself on the next call: it preserves the original " +
      "branch transition or trunk baseline, so a condition crossed between calls is " +
      `not lost. ${AWAIT_WATCH_POLICY} ` +
      `Omit timeout to hold one call for up to ${AWAIT_LONG_CALL_SECONDS}s on ` +
      "a known configurable client, or " +
      `${AWAIT_STRICT_CALL_SECONDS}s on a strict or unknown client. A larger ` +
      "request is sliced to that transport-safe bound and reported in " +
      "data.requested_timeout_seconds. The condition returns as soon as it holds. " +
      "On success the hint chooses `discern_start` from the main checkout or " +
      "`discern_update` from an existing worktree, including the green " +
      "result's immutable commit as `from` when composing below the trunk.",
    inputSchema: {
      green: z.string().optional().describe(
        "Branch whose worktree must hold an honored gate receipt (e.g. an " +
          "agent/* sibling this task builds on). Its landing also satisfies " +
          "the wait.",
      ),
      landed: z.string().optional().describe(
        "Branch whose work must become reachable from the trunk. The latest " +
          "observed tip and landing transition survive the branch's deletion.",
      ),
      trunk_moved: z.boolean().optional().describe(
        "Wait until the trunk ref moves from its position at call start.",
      ),
      resume: z.string().optional().describe(
        "Short continuation handle returned by a previous not-met wait. Pass " +
          "it by itself instead of green, landed, or trunk_moved so the " +
          "original branch transition or trunk baseline survives between calls.",
      ),
      timeout: z.number().optional().describe(
        'Seconds before answering "not yet". Omit for the longest reliable ' +
          "bound this MCP client supports; a larger request is sliced " +
          "losslessly and 0 checks once.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args, signal, context) =>
      awaitResult(
        root,
        {
          ...(args.green !== undefined ? { green: args.green } : {}),
          ...(args.landed !== undefined ? { landed: args.landed } : {}),
          ...(args.trunk_moved === true ? { trunkMoved: true } : {}),
          ...(args.resume !== undefined ? { resume: args.resume } : {}),
          ...(args.timeout !== undefined
            ? { timeoutSeconds: args.timeout }
            : {}),
        },
        signal,
        {
          callProfile: context.awaitCallProfile,
        },
      ),
  }),
  defineTool({
    name: "discern_patterns",
    title: "Read the practice patterns",
    outputSchema: PatternsOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Report the patterns in how this project's agents drive discern, read " +
      "from the local logbook — discern's on-machine record of its own verb " +
      "runs (metadata only; nothing leaves the machine). The diagnostic " +
      "ladder's third question: discern_doctor asks whether the install is " +
      "valid, discern_improvement whether the setup follows best practice, " +
      "discern_patterns whether the practice is actually healthy. Named " +
      "detectors cover agent behaviour (red-gate thrash, refusal loops, " +
      "skipped prepare, work landing on the trunk), gate fit (a dominant " +
      "stage, duration creep, same-tree flakes, recurring diagnostic " +
      "classes), the task funnel (loops to green, cycle time, update " +
      "friction), and each quality standard's measured trajectory against " +
      "its limit's own history. data.findings is ranked by evidence " +
      "strength — each carries plain counts, a scope, and a recommended " +
      "next step; data.detectors reports every detector including the ones " +
      "with insufficient evidence, so a young logbook reads as young, never " +
      "as healthy. Trends compare only runs sharing one config epoch and " +
      "release — matched by equality, so runs from other setups interleaved " +
      "through the stream are named and excluded, never blended in. Strictly " +
      "ADVISORY: findings never block and never gate — standards remain the " +
      "only enforcement surface. Distinct from discern_coupling, which mines " +
      "git history for files that change together; patterns reads discern's " +
      "own run history. An empty logbook is a normal state with a helpful " +
      "message. The reset action (`discern patterns reset`, CLI only) " +
      "deletes the recorded history. Pass stats: true when the owner asks for " +
      "their stats: data.stats adds practice stats — changes accepted, green " +
      "streaks, cycle times, standards trends, agent cohorts — counted from " +
      "the same local evidence, for the owner to share, never for steering " +
      "work.",
    inputSchema: {
      stats: z.boolean().optional().describe(
        "Also compute data.stats — practice stats: changes accepted and " +
          "their scale, green-gate streaks, start-to-accept cycle times, " +
          "standards trends, agent cohorts, and breadth, as plain counts. " +
          "For the owner's own use; nothing is compared to anyone else's " +
          "numbers.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) => patternsResult(root, { stats: args.stats === true }),
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
      "Read or search the project map, the agent-maintained source for documented " +
      "project behaviour. With no input, return the document index and top-level " +
      "regions digest with file-linked freshness facts. Pass `target` to read one " +
      "document or list one region. Pass " +
      "`search` to return up to five ranked documents with context and a canonical " +
      "target for the follow-up read; combine it with `target` to search only that " +
      "region or document. Complete matches lead; strong partial matches fill unused " +
      "result slots and identify themselves. Search covers the map visible to agents. " +
      "`path` selects the project or worktree to inspect; it never selects a map " +
      "subtree.",
    inputSchema: {
      target: z.string().optional().describe(
        "An exact document or top-level region target. Without `search`, a document " +
          "returns its Markdown and a region returns its compact index. With " +
          "`search`, it limits the search to that document or region.",
      ),
      search: z.string().optional().describe(
        "Task language, a command, a config key, or error text to find in the map. " +
          "Complete matches lead, and strong partial matches can fill the five result " +
          "slots. Each result identifies its match kind and carries a canonical " +
          "target. The query is used for this call and is not recorded in discern's " +
          "logbook.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      mapResult(root, {
        target: args.target,
        search: args.search,
      }),
  }),
  defineTool({
    name: "discern_docs",
    title: "Read discern's docs",
    outputSchema: DocsOutputSchema.shape,
    annotations: READ_ONLY,
    // discern's own bundled documentation is the same in every install and needs no
    // project — so docs stays reachable from a server spawned outside any discern
    // project, matching the CLI, which serves `discern docs` from anywhere (B38).
    rootIndependent: true,
    description:
      "Read or search discern's own bundled documentation: concepts, configuration, " +
      "the gate, worktrees, and standards. This is distinct from discern_map, which " +
      "reads the current project's map. With no input, return the public document " +
      "index. Pass `target` to read one document or list one region. Pass `search` " +
      "to return up to five ranked documents with context and a canonical target; " +
      "combine it with `target` to search only that region or document. Complete " +
      "matches lead; strong partial matches fill unused result slots and identify " +
      "themselves. Internal decision and maintainer trees are never exposed here.",
    inputSchema: {
      target: z.string().optional().describe(
        "An exact document or top-level region target. Without `search`, a document " +
          "returns its Markdown and a region returns its compact index. With " +
          "`search`, it limits the search to that document or region.",
      ),
      search: z.string().optional().describe(
        "Task language, a command, a config key, or error text to find in discern's " +
          "public docs. Complete matches lead, and strong partial matches can fill " +
          "the five result slots. Each result identifies its match kind and carries " +
          "a canonical target. The query is used for this call and is not recorded " +
          "in discern's logbook.",
      ),
    },
    run: (root, args) =>
      docsResult(root, {
        target: args.target,
        search: args.search,
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
      "landing branch. A worktree is a separate checkout and branch for one effort. " +
      "Tear down the worktree's resources, advance the trunk directly to the branch " +
      "tip, remove the clean worktree, and delete the " +
      "now-merged branch. It then refreshes the trunk checkout it leaves behind, " +
      "so generated guidance, skills, and provider integrations match the landed " +
      "tree. This is the single deterministic implementation — " +
      "run it rather than reproducing the steps with git; commit the work with a real " +
      "message first so it lands as a proper review commit. After a green landing, " +
      "report it in your own words and end with data.receipt_line verbatim; " +
      "data.receipt is the full landing record, pasteable into a PR body. " +
      "Requires this branch already contains the latest `{{main_branch}}`, this worktree " +
      "is clean, and the main checkout is clean and sitting on `{{main_branch}}` " +
      '— refuses (error:"precondition_failed") otherwise, naming the exact next ' +
      "step (e.g. call discern_update first). Landing authority comes from either " +
      "a `confirmed` conversation or a machine-verified grant recorded on the " +
      "trunk or at the desk. Before recovering an interrupted acceptance, it " +
      "also accepts consent bound to that recorded transaction. Journal-bound " +
      "consent finishes only that transaction; it never authorizes a new trunk " +
      "transition. Without current or journal-bound authority, it refuses " +
      "read-only and re-serves the review moment (relay the receipt, wait for " +
      "the owner) instead of landing. Set dry_run to preview " +
      "the plan without touching anything. " +
      "Operates on the worktree this call selects: the server's current target by " +
      "default, or the discern worktree containing an explicit absolute `path`.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the acceptance plan and touch nothing (default false).",
      ),
      confirmed: z.boolean().optional().describe(
        "Attestation that the owner has accepted this landing in the current " +
          "conversation. Set it only then. Recorded standing and effort grants " +
          "are checked directly; do not assert them through this flag.",
      ),
      ...PATH_PARAM,
    },
    // Acceptance can remove the worktree before a later cleanup fails. Re-aim from
    // the typed landing state rather than `ok`, so both complete and partial landings
    // leave the server at the main checkout. The held-root guard preserves a live
    // worktree selected by a one-call `path` override (ADR 0062).
    reaimAfterResult: (result, ctx) => {
      const data = result.data as AcceptData | undefined;
      return ctx.heldRootMissing &&
          data?.landing?.worktree_removed === true
        ? data.root
        : undefined;
    },
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
      "agent files + skills, in one deterministic step — the inverse of " +
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
      "touching anything. Never touches the main checkout; it updates the worktree " +
      "this call selects, using the current target by default or an explicit " +
      "absolute `path`. This updates the branch; run " +
      "`discern upgrade` to update discern itself, or use discern_refresh to " +
      "refresh agent files alone.",
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
      `${
        worktreeContinuityPolicy("`discern_start`")
      } Create a fresh ISOLATED ` +
      "worktree — a separate checkout and branch for one " +
      "effort — from the main checkout, set it up, and return where it landed " +
      "(data.path). When the trunk records standing landing scopes, " +
      "data.landing_authority and the matching hint name them prospectively; final " +
      "coverage is always rechecked against the changed paths. The new branch forks " +
      "from the trunk (`{{main_branch}}`), the " +
      "shared landing branch, regardless of what " +
      "branch the main checkout is sitting on — you do NOT need to check or pass " +
      "anything for the normal case. " +
      "Use this when you are on the trunk (the main checkout) and beginning a new " +
      "effort that has no worktree. Never adopt a worktree created for another " +
      "effort because it is idle or clean. On success it RE-AIMS these discern tools at the " +
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
      "for a same-project start. Each call mints a NEW worktree and is not " +
      "idempotent. If you " +
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
        "Create the worktree for a specific discern project. Pass an ABSOLUTE " +
          "filesystem path inside the intended checkout, including another repository " +
          "in a multi-repo workspace; discern resolves its project root. Omit it to " +
          "use the project this MCP server currently targets. A successful start " +
          "re-aims later discern calls at the new worktree.",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the start plan and touch nothing (default false).",
      ),
    },
    // A successful start re-aims the working root at the worktree it just created, so
    // the subsequent done/update/accept calls operate on it with nothing to thread.
    reaimAfterResult: (result) =>
      result.ok ? (result.data as StartData | undefined)?.path : undefined,
    run: (root, args) =>
      startToolResult(root, {
        dryRun: args.dry_run === true,
        name: args.name ?? "",
        from: args.from,
      }),
  }),
]);

/**
 * The verbs deliberately NOT exposed as MCP tools, each with its reason —
 * the shell-only half of the verb→tool decision, declared beside {@link TOOLS}
 * so the two together cover the whole verb vocabulary. The parity guard
 * asserts exactly that split, so a new verb must either register a tool or
 * record itself here the day it is born; and the command-reference renderer's
 * shell-instruction fallback is the documented posture for these, never an
 * accident.
 */
export const MCP_SHELL_ONLY_VERBS: ReadonlyMap<string, string> = new Map([
  // Engine verbs.
  [
    "worktree",
    "a hook-driven command group; an agent must never operate on its own footing",
  ],
  ["identity", "identity-resolution plumbing"],
  ["skills", "a command group (skills list/eject)"],
  ["mcp", "the server itself — it cannot expose itself as one of its tools"],
  ["scripts", "arbitrary project executables own their arguments and output"],
  [
    "queue",
    "a shell command wrapper whose child owns its arguments, streams, and exit status",
  ],
  ["tidy", "embedded formatting is CLI-only for now"],
  [
    "desk",
    "the interactive human surface; it wields supervisory actions over other efforts",
  ],
  // Installer verbs (doctor/map/docs are the tool-backed exceptions).
  ["setup", "the one-time interactive setup flow, driven at a terminal"],
  ["upgrade", "operates on the discern install itself, not a project state"],
  ["uninstall", "operates on the discern install itself, not a project state"],
  ["preset", "install-time configuration authoring"],
  ["config", "config plumbing; agents read and edit discern.toml directly"],
  [
    "help",
    "human-readable CLI reference; MCP tool schemas carry their own help",
  ],
  ["licenses", "license-text dump for humans"],
]);

/**
 * Resolve a verb's tool name from the {@link TOOLS} table — the single
 * verb→tool source the parity guard ties to the CLI verb list. Multi-word
 * command paths (`setup begin`) never match a tool and fall through to the
 * shell-instruction rendering.
 */
export function mcpToolNameForVerb(words: string): string | undefined {
  return TOOLS.find((tool) => verbOf(tool.name) === words)?.name;
}

/** Re-render one authored hint text for the MCP surface. */
function renderMcpHintText(authored: string): string {
  return renderCommandRefsMcp(authored, mcpToolNameForVerb);
}

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
      const fired = firedHintsFromTexts(result.hints).map((hint) =>
        hint.id === HINTS["start-re-root"].id
          ? fire(HINTS["start-mcp-re-root"], { path: data.path })
          : hint
      );
      result.hints = hintTexts(fired);
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
  const fired = fire(HINTS["start-mcp-re-root"], { path });
  return renderMcpHintText(fired.authored ?? fired.text);
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
function appendHint(result: DiscernResult, hint: FiredHint): DiscernResult {
  return { ...result, hints: appendHintTexts(result.hints, [hint]) };
}

/**
 * The process-wide version resolver used when {@link runTool} is called without an
 * explicit one (the direct-call test path). Lazily created so importing this
 * module has no stat/exec side effect; the live server passes its own resolver,
 * created once at startup in {@link runMcpServer}.
 */
let sharedInstalledVersion: (() => Promise<string | undefined>) | undefined;
/** Read the running binary's version for setup calls that omit an override. */
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

/** One opaque id per server INSTANCE — the MCP session grouping hint: every
 * invocation this long-lived process serves belongs to one client conversation,
 * which is exactly the grouping a session reader wants. */
const MCP_SESSION = `mcp:${crypto.randomUUID().slice(0, 8)}`;

/** The MCP surface's raw driver signals: the per-instance session id, CI marker,
 * advisory catalogue matches, and the bounded protocol client declaration when
 * present. `json`/`tty` are CLI concepts; an MCP client is programmatic by
 * construction, and the absence of those fields says so honestly. */
async function mcpDriverFacts(
  mcpClient?: RecordedMcpClient,
): Promise<DriverFacts> {
  let ci = false;
  try {
    const marker = Deno.env.get("CI");
    ci = marker !== undefined && marker !== "" && marker !== "false";
  } catch {
    // No env permission reads as not-CI.
  }
  let agentSignals: AgentSignal[] | undefined;
  try {
    agentSignals = await detectAgentSignals(
      mcpClient === undefined ? {} : { mcpClient },
    );
  } catch {
    // Driver enrichment is best-effort and must never affect the tool result.
  }
  return {
    session: MCP_SESSION,
    ci,
    ...(agentSignals !== undefined && agentSignals.length > 0
      ? { agent_signals: agentSignals }
      : {}),
    ...(mcpClient !== undefined ? { mcp_client: mcpClient } : {}),
  };
}

/** The argument NAMES a tool call provided — the MCP mirror of CLI flag names,
 * already registry-vetted by the tool's input schema. Values never land; names
 * are normalized to the CLI's hyphenated spelling so readers see one
 * vocabulary. `path` (plumbing) and `dry_run` (a first-class field) drop out;
 * a string-valued `target` argument is lifted as the verb's target instead. */
function mcpCallFacts(
  args: Record<string, unknown>,
): { flags: string[] | undefined; target: string | undefined } {
  const names = Object.keys(args)
    .filter((k) => k !== "path" && k !== "dry_run" && k !== "target")
    .map((k) => k.replaceAll("_", "-"))
    .sort();
  const target = typeof args.target === "string" && args.target !== ""
    ? args.target
    : undefined;
  return { flags: names.length > 0 ? names : undefined, target };
}

/** Recording state opened as soon as a call's project root is known. Context
 * gathering runs beside the verb so a lifecycle call that removes its worktree
 * still records the branch it began on. */
interface McpRecording {
  recorder: Recording;
  driver: Promise<DriverFacts>;
  started: number;
}

/** Start the known-root half of an MCP invocation. Finishing remains centralized
 * at {@link completeToolCall}, after every delivered hint has been attached. */
function beginMcpRecording(
  root: string,
  verb: string,
  args: Record<string, unknown>,
  mcpClient?: RecordedMcpClient,
): McpRecording {
  const driver = mcpDriverFacts(mcpClient);
  const { flags } = mcpCallFacts(args);
  return {
    recorder: beginRecording(root, {
      verb,
      surface: "mcp",
      driver,
      ...(flags !== undefined ? { flags } : {}),
    }),
    driver,
    started: performance.now(),
  };
}

/** A dispatch result plus the optional recording opened once its root was known.
 * Dispatch may refuse early; {@link runTool} still sends every member through the
 * same completion boundary. */
interface VerbRun {
  result: DiscernResult;
  crash?: CrashSignature | undefined;
}

interface PendingToolCall extends VerbRun {
  recording: McpRecording | undefined;
}

/**
 * Run one verb in `root` and normalize an unexpected throw to an `internal_error`
 * result — so a single tool blowing up can never take the whole stdio server down.
 * This is the single place tool handlers are invoked (normal and root-independent
 * paths alike). A throw is a crash — a bug in discern (ADR 0248) — so it also
 * tries to save a crash report beside the logbook (the envelope's message
 * names the file when written) and returns the logbook-safe signature beside
 * that call's result.
 * {@link completeToolCall} records the same request-owned signature. Observation and recording
 * deliberately happen later, at {@link completeToolCall}, because dispatch
 * refusals never enter a handler and delivery can still append a stale-server
 * hint after the handler returns.
 */
async function runVerb(
  tool: McpTool,
  root: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
): Promise<VerbRun> {
  try {
    throwIfCrashProbe();
    return {
      result: await tool.run(
        root,
        args,
        signal ?? new AbortController().signal,
        { awaitCallProfile },
      ),
    };
  } catch (e) {
    const report = captureCrashReport(verbOf(tool.name), e);
    const artifact = await writeCrashArtifact(root, report);
    return {
      result: internalErrorResult(verbOf(tool.name), report, artifact),
      crash: report.signature,
    };
  }
}

/** Finish the one result the caller will receive. This is the MCP observation and
 * recording chokepoint: final delivery hints are attached first, the shared result
 * seam is fed and drained once, a known-root invocation records once, and only
 * then is that same envelope rendered on the wire. */
async function completeToolCall(
  tool: McpTool,
  args: Record<string, unknown>,
  pending: PendingToolCall,
  stale: FiredHint | undefined,
): Promise<ToolResult> {
  const prepared = withFailureRecoveryHint(pending.result);
  const withStale = stale === undefined
    ? prepared
    : appendHint(prepared, stale);
  // Surface-faithful hints: re-render each hint's command references for the
  // MCP surface (tool spellings, owner commands CLI-spelled, shell-only verbs
  // marked) BEFORE the envelope is observed, recorded, and rendered — one
  // envelope, identically worded everywhere it lands.
  const result = resolveResultHintsForSurface(withStale, renderMcpHintText);
  observeResult(result);
  const observed = takeObservedResult();
  // Supplemental ids describe CLI-only output such as a session-start
  // `ctx.log` line, tips are shown only by the interactive desk, and the
  // verb-target mailbox is fed by CLI positionals (MCP targets arrive as
  // arguments). A long-lived MCP server drains stale state defensively and
  // never attributes that output to a tool call.
  takeSupplementalHintIds();
  takeShownTipIds();
  takeVerbTarget();
  const recording = pending.recording;
  if (recording !== undefined) {
    const { flags, target } = mcpCallFacts(args);
    await recording.recorder.finish({
      verb: verbOf(tool.name),
      surface: "mcp",
      outcome: result.ok ? "ok" : "failed",
      durationMs: performance.now() - recording.started,
      ...(result.waitedMs !== undefined ? { waitedMs: result.waitedMs } : {}),
      result,
      hintIds: observed?.hintIds ?? [],
      driver: await recording.driver,
      ...(result.dry_run === true ? { dryRun: true } : {}),
      ...(flags !== undefined ? { flags } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(pending.crash !== undefined ? { crash: pending.crash } : {}),
    });
  }
  return renderResult(result);
}

/**
 * Resolve and run one tool call. The per-call root is the explicit
 * `path` argument when given (ADR 0062 §2 — resolved through `findRoot`, so any
 * directory inside a worktree resolves to its root and a non-project path falls
 * through to `not_initialized`), else the server's current working root — re-pointed
 * by `discern_start` / reset by `discern_accept` via {@link McpTool.reaimAfterResult},
 * applied here after a non-preview call with matching effect evidence. Every refusal returns a normal
 * error {@link DiscernResult} to {@link runTool}'s one completion boundary — a
 * missing project, a dispatch refusal, or an unexpected throw from the verb.
 * `signal` (optional — a direct caller may omit it) aborts when the
 * client cancels the request or the server shuts down; it is forwarded to the verb
 * so a long-running gate dies with the call instead of running on as an orphan.
 */
async function dispatchToolCall(
  tool: McpTool,
  working: WorkingRoot,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  mcpClient?: RecordedMcpClient,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
): Promise<PendingToolCall> {
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
    const heldRoot = working.get();
    return {
      result: {
        ok: false,
        verb: verbOf(tool.name),
        error: "invalid_arguments",
        message:
          `\`path\` must be an absolute path, but got "${pathArg}". The MCP server's ` +
          `working directory is not the caller's directory, so it cannot resolve a ` +
          `relative path safely. Pass an absolute path inside the discern project or ` +
          `worktree this call should use.`,
      },
      recording: heldRoot === undefined ? undefined : beginMcpRecording(
        heldRoot,
        verbOf(tool.name),
        args,
        mcpClient,
      ),
    };
  }
  const root = pathArg ? await findRoot(pathArg) : working.get();
  if (root === undefined) {
    // A root-independent tool (discern_docs) serves the same answer from anywhere —
    // discern's OWN bundled docs, present in every install — so it must not be refused
    // just because the server spawned outside a project. Run it against the process cwd
    // (which its verb core doesn't consult for the bundled tree). Every other tool
    // genuinely needs a project and refuses (B38). The property is declared on the tool
    // (the TOOLS-table single source of truth) — no per-name special case here.
    if (tool.rootIndependent === true) {
      const run = await runVerb(
        tool,
        Deno.cwd(),
        args,
        signal,
        awaitCallProfile,
      );
      return {
        ...run,
        recording: undefined,
      };
    }
    return {
      result: notInitializedResult(verbOf(tool.name)),
      recording: undefined,
    };
  }
  const recording = beginMcpRecording(
    root,
    verbOf(tool.name),
    args,
    mcpClient,
  );
  // Pre-setup gate — the MCP mirror of the CLI redirect: a setup-gated verb
  // (the setup-gated verbs, including `discern_map`) refuses until the project records
  // `[meta].bootstrapped`, so an agent never reads a false all-green or an empty
  // doc tree. `discern_docs`/`discern_status`/`discern_doctor`/`discern_improvement` are
  // not gated — they are exactly what you reach for before setup is done.
  if (
    verbNeedsSetup(verbOf(tool.name)) && !(await setupGatePasses(root))
  ) {
    return {
      result: {
        ok: false,
        verb: verbOf(tool.name),
        error: "not_set_up",
        message: NOT_SET_UP_MESSAGE,
      },
      recording,
    };
  }
  const run = await runVerb(
    tool,
    root,
    args,
    signal,
    awaitCallProfile,
  );
  // Data-driven re-aim (ADR 0062): after a non-preview lifecycle call, move the
  // working root per the tool's own effect-aware hook (start → the new worktree it
  // created; accept → the main checkout it landed in). A `path` override is normally a
  // one-call steer that does NOT move the held root (§2) — but accept can REMOVE the
  // directory the held root points at, so the hook re-roots when that root is now gone
  // (`heldRootMissing`), even on a path override; otherwise the next no-path call would
  // resolve a deleted worktree (the Codex failure mode). A dry-run never moves it.
  if (run.result.dry_run !== true && tool.reaimAfterResult !== undefined) {
    const heldRoot = working.get();
    const heldRootMissing = heldRoot !== undefined &&
      !(await pathExists(heldRoot));
    const next = tool.reaimAfterResult(run.result, { heldRootMissing });
    if (next !== undefined) {
      working.set(next);
    }
  }
  return { ...run, recording };
}

/**
 * Run one tool call and render its final DiscernResult. Dispatch may return from
 * several branches, but every result crosses {@link completeToolCall} exactly
 * once. The version handshake is resolved before dispatch and attached before
 * that boundary records, so the logbook's hint identities match the envelope
 * delivered to the client.
 */
export async function runTool(
  tool: McpTool,
  working: WorkingRoot,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  resolveInstalledVersion: () => Promise<string | undefined> =
    defaultInstalledVersion,
  mcpClient?: RecordedMcpClient,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
): Promise<ToolResult> {
  // Drain state left by CLI-only output in this long-lived process before this
  // call starts. The final boundary drains again after observing this result.
  takeSupplementalHintIds();
  takeShownTipIds();
  // If the binary on disk changed since this server started, every result needs
  // the restart hint — including dispatch refusals.
  const stale = versionMismatchHint(
    KIT_VERSION,
    await resolveInstalledVersion(),
  );
  const pending = await dispatchToolCall(
    tool,
    working,
    args,
    signal,
    mcpClient,
    awaitCallProfile,
  );
  return await completeToolCall(tool, args, pending, stale);
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
 * `docs` = discern's own): a fixed index (`discern://<scheme>` → the JSON index)
 * and a `{+target}` template (`discern://<scheme>/{+target}` → that one doc's
 * Markdown; the `+` is RFC 6570 reserved-expansion so the target may contain `/`
 * and resolve a slug, `section/slug`, OR a path — see the template below).
 * `index`/`single` are the verb cores (the caller pre-guards them); a
 * not-found or refused read throws, which the SDK renders as a resource-read error.
 */
function registerDocTree(
  server: McpServer,
  scheme: "map" | "docs",
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
    // three forms the description advertises (and the discern_map/discern_docs tools
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
 * `discern://docs` (+ a `{+target}` template) are always available;
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

  // docs — discern's OWN documentation, always available (the pre-setup surface).
  registerDocTree(
    server,
    "docs",
    "discern's own documentation",
    () => docsResult(currentRoot()),
    (target) => docsResult(currentRoot(), { target }),
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
 * Capability-existence lines stay here for clients that load tool schemas only on
 * demand; tool mechanics live in the descriptions. Core operating-policy lines
 * render from the shared registry. Every lifecycle tool is always registered (ADR
 * 0062 retired the location-based hiding), and the server re-aims its working root
 * on `discern_start`, so an agent that starts on the trunk can drive the whole
 * lifecycle through this one connection.
 */
export function buildInstructions(): string {
  const lines = [
    "discern provides the gate and isolated worktrees. Use its MCP tools and " +
    "read their results.",
    "",
    "- Start with discern_status for state and next step.",
    ...operatingPolicyStatementsFor("mcp-instructions").map(
      (statement) => `- ${statement}`,
    ),
    "",
    "- Use discern_refresh for stale files/skills, discern_map for the map, " +
    "discern_docs for the manual, and discern_doctor for install faults.",
    "- Use discern_standards for deferred measures, discern_patterns for " +
    "history, and discern_improvement for next work.",
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
export async function runMcpServer(
  awaitCallProfile: AwaitCallProfile = "unknown-client",
): Promise<number> {
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
  interface McpCallExtra {
    readonly signal: AbortSignal;
    readonly _meta?: Record<string, unknown>;
  }
  const callSignal = (extra: McpCallExtra): AbortSignal =>
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
      (args: Record<string, unknown>, extra: McpCallExtra) => {
        const mcpClient = resolveMcpClientInfo(
          extra._meta,
          server.server.getClientVersion(),
        );
        return runTool(
          tool,
          working,
          args,
          callSignal(extra),
          installedVersion,
          mcpClient,
          awaitCallProfile,
        );
      },
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
