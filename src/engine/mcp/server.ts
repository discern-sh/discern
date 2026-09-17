import {
  EMERGENCY_ACCEPT_ACTION,
  QUEUE_ACCEPT_ACTION,
} from "../../shared/verbs.ts";
import { emergencyArguments } from "../emergency/arguments.ts";
import { type EmergencyOptions, emergencyResult } from "../emergency/action.ts";
import { acceptLandingResult } from "../worktree/accept.ts";
import {
  type CompletionProgressNotification,
  withMcpCompletionProgress,
} from "./progress.ts";
/**
 * `discern mcp` — expose the verbs to an agent over the Model Context Protocol.
 *
 * This is the MCP rendering of the one result spine (ADR 0028): the server
 * returns compact structured data plus an authored Markdown projection of the
 * same prepared {@link DiscernResult}. Because every verb already computes a
 * DiscernResult, the server presents that result over stdio instead of
 * reimplementing the verb. New tools stay small as their result-returning core
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
 * every verb routes its human narration to stderr (quiet result semantics), so
 * the channel stays clean (the ADR 0030 purity rule, here over MCP).
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "process";
import { isAbsolute, join } from "@std/path";
import { z } from "@zod/zod";
import {
  CONFIG_REL,
  findRoot,
  NO_PROJECT_MESSAGE,
  notInitializedResult,
} from "../../shared/env.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { evaluateResultCompletion } from "../../shared/result_completion.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { operationEffectPolicy } from "../../shared/operation_effects.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { fileExists, pathExists } from "../../shared/fs_presence.ts";
import { detachPromise } from "../../shared/promise_effects.ts";
import {
  type CliModelProvider,
  walkCliCommands,
} from "../../shared/cli_reference_codegen.ts";
import { serializeResult } from "../../shared/result_serialization.ts";
import { resultPresenterForVerb } from "../../shared/result_contracts.ts";
import { renderResultMarkdown } from "../../shared/result_markdown.ts";
import { projectStatusData } from "../../shared/result_wire.ts";
import {
  observeResult,
  takeCheckpointActivity,
  takeMergeActivity,
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
  CheckpointsOutputSchema,
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
  ProgressOutputSchema,
  RefreshOutputSchema,
  StandardsOutputSchema,
  type StartData,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  UpdateOutputSchema,
} from "../../shared/result_schemas.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import {
  NOT_SET_UP_MESSAGE,
  verbNeedsSetup,
} from "../../shared/setup_state.ts";
import { Logger } from "../../lib/log.ts";
import { finishResult } from "../gate/finish.ts";
import { observedGateOperation } from "../gate/observed_operation.ts";
import { operationProgressResult } from "../completion/progress_result.ts";
import { prepareResult } from "../gate/prepare.ts";
import { testResult } from "../gate/test_job.ts";
import { standardsResult } from "../gate/standards.ts";
import { standardsProposeBatchResult } from "../gate/standard_proposals.ts";
import { improvementResult } from "../improve/improve.ts";
import { checkpointsResult } from "../checkpoints/report.ts";
import { CATEGORY_NAMES } from "../improve/rules.ts";
import { impactResult } from "../scopes/scopes.ts";
import { couplingResult } from "../coupling/coupling.ts";
import { awaitResult } from "../await/await.ts";
import { patternsResult } from "../logbook/patterns.ts";
import { statusResult } from "../status/status.ts";
import { refreshResult } from "../instructions.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { docsResult, mapResult } from "../../commands/docs.ts";
import {
  lifecycleContext,
  startResult,
  updateResult,
  worktreeErrorResult,
} from "../worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import {
  fire,
  type FiredHint,
  firedHintsFromTexts,
  HINTS,
  hintTexts,
  mergeHintTexts,
  resolveResultHintsForSurface,
  withFailureRecoveryHint,
} from "../../shared/hints.ts";
import { configFailureResult } from "../../shared/config_failure.ts";
import { renderCommandRefsMcp } from "../../shared/command_reference.ts";
import {
  createInstalledVersionResolver,
  resolveCommandPath,
  versionMismatchHint,
} from "./version_check.ts";
import {
  AWAIT_WATCH_POLICY,
  OPERATING_POLICIES,
  worktreeContinuityPolicy,
} from "../../shared/operating_policies.ts";
import { OperationLockError } from "../operation_lock.ts";
import { executeOperation } from "../operation_execution.ts";
import { DISCERN_MCP_SERVER } from "../../lib/providers.ts";

const SERVER_NAME = "discern";

/**
 * Honest behavioral hints for a tool — the MCP `ToolAnnotations`. Mirrors the
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
/** Rewrites discern-owned generated/shared artifacts only. It mutates the
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
 * destructive (it only adds a merge + regenerates build artifacts) and converges
 * on re-run, hence `idempotentHint`. */
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
  /** Fully attached live command tree supplied by the binary entry point. */
  readonly cliModel: CliModelProvider;
}

/** Direct-call fallback that fails only when a Gate-capable tool needs the model. */
const missingCliModel: CliModelProvider = () => {
  throw new Error("MCP gate execution requires a live CLI model provider");
};

/** A tool: its advertised schema + metadata plus the handler that runs the verb.
 * The SDK converts {@link inputSchema} (a raw shape registered closed via
 * {@link strictInput}) and {@link outputSchema} (the complete per-verb schema
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
  /** The complete result schema this tool advertises. The SDK validates every
   * call's `structuredContent` against it, including the envelope's structural
   * state contract, so it MUST match what the verb actually returns (ADR 0041). */
  outputSchema: z.ZodType;
  /** Honest behavioral hints (read-only / destructive / …). */
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
/** Every tool description, including a strict-client fallback, stays bounded. */
export const MCP_TOOL_DESCRIPTION_BYTE_LIMIT = 2 * 1024;
/** Codex indexes only this leading slice when choosing among many MCP servers. */
export const CODEX_INSTRUCTIONS_PREFIX_CHARS = 512;

const STRICT_CLIENT_GATE_FALLBACK =
  "This strict client stops MCP calls after 60 seconds. If the operation may " +
  "take longer, run its `discern … --markdown` equivalent in a shell; use " +
  "`discern done --markdown` for the gate.";

/** Render a profile-faithful description without changing the live tool table. */
export function toolDescriptionForProfile(
  tool: McpTool,
  profile: AwaitCallProfile,
): string {
  return profile === "strict-client" && tool.annotations?.readOnlyHint !== true
    ? `${tool.description} ${STRICT_CLIENT_GATE_FALLBACK}`
    : tool.description;
}

/**
 * The startup-visible lifecycle, in the order an agent should follow it.
 * Keep exactly 8 unique members: bounded clients may expose only a leading
 * slice of one server's tools, so the generally useful project map occupies
 * the final prioritized discovery position.
 */
export const MCP_CORE_LIFECYCLE = [
  "discern_status",
  "discern_start",
  "discern_prepare",
  "discern_done",
  "discern_update",
  "discern_await",
  "discern_accept",
  "discern_map",
] as const;

const TOOL_PRIORITY = [
  ...MCP_CORE_LIFECYCLE,
  "discern_progress",
  "discern_test",
  "discern_standards",
  "discern_impact",
  "discern_coupling",
  "discern_patterns",
  "discern_checkpoints",
  "discern_refresh",
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

/** Refuse cross-action arguments before either standards workflow begins. */
function standardsActionFailure(message: string): DiscernResult {
  return {
    ok: false,
    verb: "standards",
    error: "invalid_arguments",
    message,
  };
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
    outputSchema: StatusOutputSchema,
    annotations: READ_ONLY,
    description:
      "Start here: call discern_status. Read-only: reports the current project, Git, worktree, and fleet " +
      "situation without running gates, tests, standards, or setup effects. The " +
      "default structuredContent is a bounded orientation projection: data.projection " +
      "names the mode and true omitted counts, while data.fleet_total preserves fleet " +
      "size. Set verbose=true only when complete structured detail is genuinely needed. " +
      "data.location distinguishes the main checkout from a worktree; data.git reports " +
      "cleanliness and trunk divergence; data.gate lists checks that would run; " +
      "data.gate_proof reports existing Proof state; data.worktree carries identity; " +
      "and main checkout results sample data.fleet. Treat every other fleet row as a " +
      "separate effort. data.queue lists the landing queue in order: each row an " +
      "unlanded effort with its readiness and single waiting reason. " +
      "data.git.trunk is the selected project's configured trunk. " +
      "data.setup_unfinished carries pending markers, known-job applicability, " +
      "and assurance counts. data.pending_tracked_refresh names tracked paths an ordinary " +
      "discern_refresh would change; data.tracked_refresh_plan_errors names failures to derive " +
      "that plan. incoming_overlap previews what discern_update brings in, and " +
      "reappeared_worktree_paths need discern worktree prune in a shell. Owner decisions appear under Owner attention. " +
      "Next action belongs to the reading agent. Set all=true to include the fleet from a worktree, " +
      "or local=true to suppress it.",
    inputSchema: {
      all: z.boolean().optional().describe(
        "Include the fleet survey even from a worktree (default false).",
      ),
      local: z.boolean().optional().describe(
        "Local view only — suppress the fleet survey even in the main checkout (default false).",
      ),
      verbose: z.boolean().optional().describe(
        "Return complete structured status; the default is the bounded orientation projection.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      statusResult(root, {
        all: args.all === true,
        local: args.local === true,
        verbose: args.verbose === true,
      }),
  }),
  defineTool({
    name: "discern_refresh",
    title: "Refresh generated artifacts",
    outputSchema: RefreshOutputSchema,
    annotations: REFRESH,
    description: "Refresh the agent files, materialized skills, provider " +
      "integration artifacts, and the maintained ADR index (the record lists " +
      "between markers in the map's ADR README, regenerated from the record " +
      "files on disk). It rewrites discern-generated or shared artifacts " +
      "only; edit instruction sources, skill sources, or explicit provider config for " +
      "durable changes. Idempotent: a second call with the same inputs writes nothing. " +
      "Set dry_run to preview every target and change nothing. Use discern_update " +
      "for this branch; use `discern upgrade` for discern itself.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview every refresh create, update, and removal without changing project or Git state (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      refreshResult(
        root,
        new Logger({ json: true, noColor: true }),
        { dryRun: args.dry_run === true },
      ),
  }),
  defineTool({
    name: "discern_done",
    title: "Run the final gate and record Proof",
    outputSchema: FinishOutputSchema,
    annotations: MUTATING,
    description:
      "Run the final gate on a clean, committed tree. It runs the finishing steps " +
      "and the configured lint, type-check, tests, standards, and scope stages; a " +
      "successful ordinary run records Proof for the committed tip. While iterating, " +
      "use discern_prepare or a diagnostic's reproduce_cmd. After the final commit, " +
      "call discern_done directly. discern_test is a standalone diagnostic and " +
      "publishes no reusable completion evidence, so running it first repeats the " +
      "complete test stage. Finishing steps such as format may rewrite files. A scope is " +
      "a named region of the repository with its own check. Return the structured result " +
      "with per-step outcomes plus normalized diagnostics " +
      "(tool, file/line when available, message, and the exact command to reproduce " +
      "each failure). A green run over a clean committed tree ahead of the selected " +
      "project's configured trunk — its shared landing branch — " +
      "also carries data.proof and resolves any recorded grant into " +
      "data.landing_authority. Completion proves this worktree's committed tip; " +
      "it does not land on the trunk. Follow the resolution-gated hints: an uncovered " +
      "landing is reported to the owner in your own words and ends with " +
      "data.proof.line verbatim before you wait; a covered landing names the " +
      "verified source and routes straight to discern_accept. Never paste " +
      "the full Proof page into a message; your owner retrieves it with " +
      "`discern status --verbose`. Set dry_run to preview the plan without " +
      "running anything.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the gate plan and touch nothing (default false).",
      ),
      ci: z.boolean().optional().describe(
        "Run the machine gate and report checkpoint questions without enforcing or recording review. The resulting Proof cannot be accepted.",
      ),
      rerun: z.boolean().optional().describe(
        "Run the full gate even when current green Proof covers this exact tree, or deliberately retry an unchanged red verdict. The rerun is recorded.",
      ),
      met: z.array(z.string()).optional().describe(
        "Checkpoint ids whose served question your change satisfies — your " +
          "recorded judgment, valid only for checkpoints with an active " +
          "open question here (the awaiting_declaration refusal lists them). The " +
          "gate runs in the same call once every awaiting checkpoint has a " +
          "conclusion.",
      ),
      unmet: z.strictObject({
        id: z.string().describe("The checkpoint id declared unmet."),
        why: z.string().describe(
          "The required rationale: one paragraph, 1-500 characters, no " +
            "newlines or control characters. Recorded opaquely as Proof " +
            "evidence for the owner's landing decision.",
        ),
      }).optional().describe(
        "Declare ONE served checkpoint's question not satisfied. " +
          "The gate still runs; landing then needs the owner to authorize a " +
          "variance for it.",
      ),
      ...PATH_PARAM,
      policy_base: z.string().optional().describe(
        "Fetched policy base for a standalone CI report only.",
      ),
      standalone: z.boolean().optional().describe(
        "Run complete diagnostic feedback, including on a dirty tree. Results are transient and issue no Proof.",
      ),
    },
    run: (root, args, signal, context) =>
      finishResult(root, {
        ...(args.policy_base === undefined
          ? {}
          : { policyBase: args.policy_base }),
        ...(args.standalone === undefined
          ? {}
          : { standalone: args.standalone }),
        surface: { kind: "quiet" },
        cliModel: context.cliModel,
        dryRun: args.dry_run === true,
        ci: args.ci === true,
        rerun: args.rerun === true,
        ...(args.met === undefined ? {} : { met: args.met }),
        ...(args.unmet === undefined ? {} : { unmet: args.unmet }),
        signal,
      }),
  }),
  defineTool({
    name: "discern_prepare",
    title: "Run the fast gate",
    outputSchema: PrepareOutputSchema,
    annotations: MUTATING,
    description:
      "Run discern_prepare, the fast inner-loop gate — the project's quick quality check — with the " +
      "fix-stage fixers, then the [generated] artifact regenerations, then the read-only " +
      "check-stage jobs (no build jobs, no tests) — and return the result envelope. The " +
      "quick check to run while iterating, before the full discern_done — and the pass " +
      "to run before the FINAL commit, so the fixers and regenerations have nothing " +
      "left to rewrite when discern_done runs on the committed tree. NOTE: the " +
      "fixers and regenerations MUTATE the working tree (e.g. a formatter rewrites files). " +
      "It does not stage or commit your changes and requests no standard measurements.",
    inputSchema: { ...PATH_PARAM },
    run: (root, _args, signal) => prepareResult(root, signal),
  }),
  defineTool({
    name: "discern_test",
    title: "Run the standalone test stage",
    outputSchema: TestOutputSchema,
    annotations: MUTATING,
    description:
      "discern_test runs the complete test stage as a standalone diagnostic when that " +
      "stage itself is the requested result. This run issues no Proof " +
      "and publishes no reusable completion evidence. For normal completion, use " +
      "discern_prepare while iterating, commit, then call discern_done directly; " +
      "discern_done includes the same complete test stage, so the final gate needs no " +
      "standalone test preflight. After a failure, iterate with each diagnostic's " +
      "reproduce_cmd or a targeted project command. When no test command is configured, " +
      "discern_test returns a trivial pass with a hint that says so.",
    inputSchema: { ...PATH_PARAM },
    run: (root, _args, signal) => testResult(root, signal),
  }),
  defineTool({
    name: "discern_standards",
    title: "Measure or propose standard limits",
    outputSchema: StandardsOutputSchema,
    annotations: MUTATING,
    description:
      "Select action: measure to measure configured standards, compare their limits, " +
      "or pin measured improvements. names narrows measurement and pin candidates; " +
      "omit names for every standard. A plain measurement requests fresh readings; " +
      "pin may reuse applicable evidence, commits only tighter limits, and carries " +
      "Proof forward. Non-preview measurement requires a clean worktree unless force " +
      "is set; pin always requires one. discern_done already requires every configured standard. " +
      "Select action: propose only after owner agreement and after every required " +
      "preview, review, regeneration, edit, discern_prepare run, and ordinary commit. " +
      "Pass every simultaneous breach once in proposals; discern measures the same " +
      "clean final HEAD through the shared planner, applies all limits in one " +
      "config-only commit, and binds the set to that commit. Each reason is technical " +
      "justification only: never claim approval, consent, or landing authority. Keep " +
      "each reason within 500 characters; aim below 400. Repeat the same complete batch " +
      "to renew an unchanged descendant; a new batch refuses existing proposal state. " +
      "A changed value or reason is " +
      "a different decision: present the new value, delta, and reason to the owner and " +
      "obtain fresh agreement before recording it. Proposal landing still requires " +
      "exact approval at discern_accept. dry_run previews either action without effects.",
    inputSchema: {
      action: z.enum(["measure", "propose"]).describe(
        "Select measure for readings or pinning; select propose to record one atomic batch of owner-agreed breached limits.",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the selected action and touch nothing; proposal preview measures nothing (default false).",
      ),
      force: z.boolean().optional().describe(
        "Override the clean-worktree guard while authoring or debugging standards; ignored with pin (default false).",
      ),
      pin: z.boolean().optional().describe(
        "Capture measured improvements, commit the limit change alone, and carry gate Proof forward. Reuses available same-commit values and measures missing selected values (default false).",
      ),
      names: z.array(z.string()).optional().describe(
        "Measure action only: measure these standards and limit pin candidates to them (default: every standard).",
      ),
      proposals: z.array(z.strictObject({
        name: z.string().min(1).describe(
          "The exact configured standard name.",
        ),
        reason: z.string().min(1).describe(
          "Technical justification only, one visible secret-free paragraph with a hard 500-character maximum; aim below 400. Do not claim approval, consent, or landing authority.",
        ),
      })).min(1).optional().describe(
        "Propose action only: every simultaneously approved breach as one ordered array of unique standard names. The transaction measures one final HEAD and writes one config commit.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args, signal) => {
      if (args.action === "measure") {
        if (args.proposals !== undefined) {
          return Promise.resolve(standardsActionFailure(
            "action 'measure' does not accept proposals. Pass names for selected measurements, or change action to 'propose'.",
          ));
        }
        return standardsResult(root, {
          dryRun: args.dry_run === true,
          force: args.force === true,
          pin: args.pin === true,
          ...(args.names !== undefined ? { pinNames: args.names } : {}),
          signal,
        });
      }
      // Only a value that asks for measure-action behavior conflicts. A client
      // that sends its defaults has requested nothing, so `false` and an empty
      // selection pass through rather than costing the caller a schema retry.
      const incompatible = [
        ...(args.force === true ? ["force"] : []),
        ...(args.pin === true ? ["pin"] : []),
        ...((args.names?.length ?? 0) > 0 ? ["names"] : []),
      ];
      if (incompatible.length > 0) {
        return Promise.resolve(standardsActionFailure(
          `action 'propose' does not accept ${
            incompatible.join(", ")
          }. Pass only action, proposals, dry_run, and path.`,
        ));
      }
      if (args.proposals === undefined) {
        return Promise.resolve(standardsActionFailure(
          "action 'propose' requires a non-empty proposals array of { name, reason } entries.",
        ));
      }
      return standardsProposeBatchResult(root, {
        proposals: args.proposals,
        dryRun: args.dry_run === true,
        signal,
      });
    },
  }),
  defineTool({
    name: "discern_doctor",
    title: "Check the install",
    outputSchema: DoctorOutputSchema,
    annotations: READ_ONLY,
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared job commands — " +
      "configured project commands such as format, lint, and test — " +
      "resolve on PATH, producer coverage and evidence reuse under the " +
      "gate.concurrent_test_runs cap, which producers standards share or " +
      "duplicate and which are candidate-bound, completion-record readability " +
      "and outstanding emergency validation, and advisories. " +
      "data.checks lists every check with its detail " +
      "and — on failure — the exact fix. Set verbose=true only when you need " +
      "data.execution_model, which lists, per configurable " +
      "verb, the ordered steps it runs — each marked project (your configured command) " +
      "or discern (a built-in step), with its expectation — so you can see what runs " +
      "when, and catch a real config mistake (e.g. a slow command " +
      "in the fast inner loop).",
    inputSchema: {
      verbose: z.boolean().optional().describe(
        "Include the complete per-verb execution model (default false). Routine orientation omits it to keep the result bounded.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) => doctorResult(root, { verbose: args.verbose === true }),
  }),
  defineTool({
    name: "discern_impact",
    title: "Show change impact",
    outputSchema: ImpactOutputSchema,
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
    title: "Show co-change coupling",
    outputSchema: CouplingOutputSchema,
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
    outputSchema: AwaitOutputSchema,
    annotations: READ_ONLY,
    description:
      "Use this when your work depends on another task or new changes on the trunk. " +
      "Wait in one blocking call instead of repeatedly polling status or asking the " +
      "owner for updates. This tool does not run checks or land changes.\n\n" +
      "Pass one condition: `green` waits for the target's `discern_done` gate to pass " +
      "with valid Proof for its current checkout, or for its work to land on the trunk; " +
      "`landed` waits for the branch's latest changes to land on the trunk; " +
      "`trunk_moved` waits for the trunk to change from where this watch started.\n\n" +
      "Omit `timeout` for the longest supported wait: up to " +
      `${AWAIT_LONG_CALL_SECONDS}s when the client supports long calls, or ` +
      `${AWAIT_STRICT_CALL_SECONDS}s when its limit is short or unknown. ` +
      "The call returns as soon as the condition holds. Larger requests are shortened " +
      "to the supported duration and recorded in `data.requested_timeout_s`.\n\n" +
      "If the wait times out, `ok` stays true and `data.met` is false. " +
      "The returned `data.resume` (`C1-…`) preserves the original watch so changes " +
      "between calls are not missed.\n\n" +
      `${AWAIT_WATCH_POLICY}\n\n` +
      "If a call is lost, use its progress handle (`R1-…`) with `discern_progress` " +
      "to read the target, elapsed wait, and latest observation. Do not start another " +
      "watch while the original is running. The progress handle only reads; " +
      "`data.resume` continues the watch.\n\n" +
      "When the condition holds, follow the returned `discern_start` or `discern_update` " +
      "hint to bring the changes into your task.",
    inputSchema: {
      green: z.string().optional().describe(
        "Sibling selected by worktree id, path, local branch, or full local " +
          "ref. Its checkout must hold an honored gate Proof; its landing also " +
          "satisfies the wait.",
      ),
      landed: z.string().optional().describe(
        "Sibling selected by worktree id, path, local branch, or full local " +
          "ref. Its work must become reachable from the trunk. The latest " +
          "observed tip and landing transition survive branch deletion.",
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
    // The wait is journalled here at the transport most likely to lose its
    // observer: a timed-out or killed MCP call reconnects through the handle
    // and reads the same watch, including its retained resume continuation.
    run: (root, args, signal, context) =>
      observedGateOperation(
        root,
        "await",
        signal,
        () =>
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
        (value) => value,
      ),
  }),
  defineTool({
    name: "discern_progress",
    title: "Read a long operation back",
    outputSchema: ProgressOutputSchema,
    annotations: READ_ONLY,
    description:
      "Read a long operation's current state or retained result, read-only. Active waits " +
      "remain visible alongside independent checks: report what is waiting, elapsed time, " +
      "the latest observed capacity use and configured limit when available, and whether " +
      "resumption is automatic. A live process alone does not establish advancing work. Every " +
      "discern_done, discern_test, discern_standards, discern_accept, and " +
      "discern_await call announces a progress handle (`R1-…`) as its first " +
      "progress fact and records the same facts in a journal. Pass that " +
      "handle to read the operation's phase, the counts and failures known so " +
      "far, named timing boundaries, and the retained final result — nothing " +
      "re-runs. With no handle, read the most recently started operation of " +
      "the selected checkout; another checkout's operation is named with its " +
      "handle and refused, never substituted. data.executor says whether a " +
      "process with the recorded id is still alive; data.outcome is absent " +
      "while the executor has not finished. Reading starts, repairs, and " +
      "cancels nothing, and the journal carries no validation or landing " +
      "authority. A wait's own resume continuation (`C1-…`, returned by " +
      "discern_await) is what resumes the wait; this tool only reads.",
    inputSchema: {
      handle: z.string().optional().describe(
        "The progress handle the operation announced (`R1-XXXX-XXXX-XX`). " +
          "Omit to read the selected checkout's most recently started " +
          "operation.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      operationProgressResult(
        root,
        args.handle === undefined ? {} : { handle: args.handle },
      ),
  }),
  defineTool({
    name: "discern_patterns",
    title: "Read the practice patterns",
    outputSchema: PatternsOutputSchema,
    annotations: READ_ONLY,
    description:
      "Read the project's local, metadata-only logbook and return advisory " +
      "workflow findings without changing files, configuration, authority, " +
      "or retry policy. Each data.findings member carries a plain summary, " +
      "concrete observed evidence with the relevant counts and denominator, " +
      "its exact subject and scope, structured evidence, any material " +
      "limitations, and one next_step. " +
      "data.investigations connects eligible findings with the same " +
      "summary/observed distinction, " +
      "a bounded evidence boundary, one diagnostic_action, and a falsifier; " +
      "treat estimated values only as estimates, cohort findings as descriptive rather " +
      "than comparative judgments, and adjacency as non-causal. " +
      "data.detectors includes fired, quiet, and insufficient-evidence states; " +
      "do not treat limited history as a clean bill. The default keeps a " +
      "bounded set of findings; data.findings_total reports any omitted count " +
      "and all: true returns the larger complete set. Trends compare only " +
      "runs sharing recorded setup conditions and name excluded runs in their " +
      "evidence. Active history is the default; logbook_file selects one " +
      "sealed archive basename from `discern patterns archives` without " +
      "changing the active recorder. stats: true adds practice Stats from the " +
      "same local evidence. Findings never block the gate. Retry only after " +
      "the named evidence or precondition changes.",
    inputSchema: {
      stats: z.boolean().optional().describe(
        "Also compute data.stats — practice stats: changes accepted and " +
          "their scale, green gate streaks, start-to-accept cycle times, " +
          "standards trends, agent cohorts, and breadth, as plain counts. " +
          "For the owner's own use; nothing is compared to anyone else's " +
          "numbers.",
      ),
      all: z.boolean().optional().describe(
        "Report every finding instead of each detector's strongest few. " +
          "The result can be very large on a long history; prefer the " +
          "default bound unless the elided findings are the question.",
      ),
      logbook_file: z.string().optional().describe(
        "A sealed logbook archive basename from `discern patterns archives`. " +
          "Paths, active month files, and nonarchive names are rejected. " +
          "Omit to read the active logbook.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      patternsResult(root, {
        stats: args.stats === true,
        all: args.all === true,
        ...(args.logbook_file !== undefined
          ? { logbookFile: args.logbook_file }
          : {}),
      }),
  }),
  defineTool({
    name: "discern_improvement",
    title: "Find the next improvement",
    outputSchema: ImprovementOutputSchema,
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
    name: "discern_checkpoints",
    title: "Read the checkpoint contract",
    outputSchema: CheckpointsOutputSchema,
    annotations: READ_ONLY,
    description: "Report the checkpoint contract for this effort, read-only. " +
      "data.checkpoints lists each governing checkpoint: its question (the " +
      "judgment the caller records at the gate), one-line trigger summary, " +
      "mode (stop interlocks the gate; advise never blocks), a structural " +
      "preview of whether the current change fires it, and this effort's " +
      "open-question state — awaiting_declaration, declared_met, declared_unmet " +
      "(variance_required marks a conclusion only the owner can authorize a " +
      "variance for at landing), or reopened (a relevant change unbound the " +
      "recorded conclusion; declare again). data.policy is the merge-base " +
      "commit whose configuration governs — never the branch's own edits. " +
      "Nothing runs and nothing is recorded: a configured when command is " +
      "reported as undecided (when_pending), and conclusions are recorded " +
      "only by discern_done (met / unmet with why). Follow hints[] for the " +
      "valid next step.",
    inputSchema: {
      ...PATH_PARAM,
    },
    run: (root) => checkpointsResult(root),
  }),
  defineTool({
    name: "discern_map",
    title: "Read the project map",
    outputSchema: MapOutputSchema,
    annotations: READ_ONLY,
    description:
      "Read or search the configured project map, the agent-maintained source for " +
      "documented project behavior. With no input, return its full index and " +
      "top-level regions digest with file-linked freshness facts. Pass `target` to " +
      "read one page or list one region. Pass `search` to get the full match count " +
      "and up to five highest-ranked results with context and canonical targets; " +
      "combine it with `target` to scope the search. This local project surface is " +
      "distinct from discern_docs, which reads discern's product manual. `path` " +
      "selects the project or worktree to inspect; it never selects a map subtree.",
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
    title: "Read discern's manual",
    outputSchema: DocsOutputSchema,
    annotations: READ_ONLY,
    // discern's own bundled documentation is the same in every install and needs no
    // project — so docs stays reachable from a server spawned outside any discern
    // project, matching the CLI, which serves `discern docs` from anywhere (B38).
    rootIndependent: true,
    description:
      "Read or search discern's complete published product manual. With no input, " +
      "return every page's canonical target, stable identity, kind, title, and " +
      "summary. Pass `target` to retrieve one page's exact reader-visible Markdown " +
      "or list one region. Pass `search` to get the full match count and up to five " +
      "highest-ranked results with context and canonical targets; combine it with " +
      "`target` to scope the search. This manual is distinct from discern_map, which " +
      "reads the current project's map. Decision records and protected map tiers " +
      "are excluded.",
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
    title: "Accept or queue the worktree",
    outputSchema: AcceptOutputSchema,
    annotations: DESTRUCTIVE,
    description:
      "By default, submit the proven commit and start landing on the selected project's configured trunk under explicit owner consent or machine-verified authority. " +
      "Without either, the call records the submission and returns awaiting consent. " +
      "With action: queue, record the current clean, proven revision and return without checks or landing. " +
      "Queueing reuses recorded authority, grants no permission and schedules nothing; an active walk may pick it up immediately. " +
      "Ordinary accept with target starts a walk: the selected submission first, then other authorized submissions in queue order, stopping at refusal. data.landings records each attempt. " +
      "A trunk that moved after the Proof is composed and re-proven in a disposable integration worktree; conflicts or failed checks land nothing. " +
      "A served integration question retains that composition: answer with met or unmet and its composition receipt. " +
      "Landing records the Proof note and removes the worktree, branch and resources when no later work remains. A second accept waits its turn. " +
      "Recorded grants never cover a checkpoint variance or standard proposal. Use dry_run to preview the selected mode. " +
      "After landing, report the effects and unresolved cleanup, ending with data.proof_line verbatim. " +
      "The full review page remains available through `discern status --verbose`. " +
      "Use action: emergency with reason for an explicit exception. prepare with met records served judgments; preparation_receipt carries its receipt. " +
      "Review the failed, unrun and stale obligations, then pass the owner's exact confirmation token with confirmed. No grant covers this exception and no passing Proof is issued. recover reconciles an interrupted emergency landing. No mode pushes.",
    inputSchema: {
      target: z.string().optional().describe(
        "Select the effort by id, path, or branch, from any checkout. Queue mode records its current proven revision; ordinary acceptance starts landing under applicable authority.",
      ),
      action: z.enum([EMERGENCY_ACCEPT_ACTION, QUEUE_ACCEPT_ACTION]).optional()
        .describe(
          "Omit to submit and start landing. Select queue to record the current proven revision and return without starting checks or landing; it reuses recorded authority and starts no background run. Select emergency only for an explicit exception with fresh exact owner approval; ordinary grants do not cover it.",
        ),
      reason: z.string().optional().describe(
        "Emergency reason presented in the exact owner review.",
      ),
      prepare: z.boolean().optional().describe(
        "Emergency only: run checkpoint triggers, serve or record agent judgments, and retain exact review evidence. Runs no validation jobs or integration.",
      ),
      preparation_receipt: z.string().optional().describe(
        "Emergency preparation receipt for this exact repair and trunk; it conveys no owner approval.",
      ),
      met: z.array(z.string()).optional().describe(
        "Satisfied served checkpoint questions (repeatable): the continuation " +
          "of a landing whose combined result awaits your judgment, or " +
          "emergency preparation with prepare: true. Refused when nothing " +
          "served a question.",
      ),
      unmet: z.strictObject({
        id: z.string().describe("The served checkpoint id declared unmet."),
        why: z.string().describe(
          "The required rationale: one paragraph, 1-500 characters.",
        ),
      }).optional().describe(
        "Declare ONE served integration checkpoint question not satisfied. " +
          "The retained composition is still proved; landing then needs the " +
          "owner's variance decision.",
      ),
      composition: z.string().optional().describe(
        "The served composition receipt an answer or resumed variance " +
          "decision binds to; the judgment refusal serves it (also in " +
          "data.integration_judgment.composition). A replaced composition " +
          "refuses the receipt and re-serves its own question.",
      ),
      confirmation: z.string().optional().describe(
        "The owner's currently approved emergency preview token. Requires confirmed; changed subjects need a new review.",
      ),
      recover: z.string().optional().describe(
        "Emergency landing id to reconcile without a new transition or new approval.",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the landing plan and the queue; touch nothing (default false).",
      ),
      confirmed: z.boolean().optional().describe(
        "Attestation that the owner has approved this landing in the current " +
          "conversation. Set it only then. Recorded standing and effort grants " +
          "are checked directly; do not assert them through this flag.",
      ),
      variance: z.array(z.string()).optional().describe(
        "The owner's authorization to land each named declared-unmet " +
          "checkpoint without changing it (requires confirmed). The ids " +
          "must equal the current declared-unmet set, id for id — the " +
          "awaiting_variance refusal serves it with each question and " +
          "rationale — and recorded grants never authorize a variance.",
      ),
      approve_standard: z.array(z.string()).optional().describe(
        "The owner's exact approval tokens for the standard limit proposals " +
          "carried by the current Proof (requires confirmed). Use the tokens " +
          "served by the read-only refusal; they bind each standard, value, and " +
          "reason. Generic or recorded landing grants never authorize them.",
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
          (data?.landing?.worktree_removed === true ||
            data?.emergency?.cleanup === "removed")
        ? data.root
        : undefined;
    },
    run: (root, args, signal, context) => {
      const parsed = emergencyArguments(
        args.action === QUEUE_ACCEPT_ACTION ? undefined : args.action,
        {
          queueOnly: args.action === QUEUE_ACCEPT_ACTION,
          ...args,
          preparationReceipt: args.preparation_receipt,
          dryRun: args.dry_run === true,
        },
      );
      if (parsed.kind === "refusal") return Promise.resolve(parsed.result);
      if (
        parsed.value.emergency !== undefined &&
        (args.unmet !== undefined || args.composition !== undefined)
      ) {
        return Promise.resolve(
          {
            ok: false,
            verb: "accept",
            error: "invalid_arguments",
            message:
              "unmet and composition answer an ordinary landing's served integration question; emergency preparation records met conclusions only.",
          } satisfies DiscernResult,
        );
      }
      return acceptToolResult(root, {
        queueOnly: args.action === QUEUE_ACCEPT_ACTION,
        ...(parsed.value.emergency === undefined
          ? {}
          : { emergency: parsed.value.emergency }),
        ...(args.target === undefined ? {} : { target: args.target }),
        ...(signal === undefined ? {} : { signal }),
        dryRun: args.dry_run === true,
        confirmed: args.confirmed === true,
        cliModel: context.cliModel,
        ...(args.variance === undefined ? {} : { variance: args.variance }),
        ...(args.approve_standard === undefined
          ? {}
          : { approveStandard: args.approve_standard }),
        ...(parsed.value.emergency !== undefined || args.met === undefined
          ? {}
          : { met: args.met }),
        ...(args.unmet === undefined ? {} : { unmet: args.unmet }),
        ...(args.composition === undefined
          ? {}
          : { composition: args.composition }),
      });
    },
  }),
  defineTool({
    name: "discern_update",
    title: "Update this branch",
    outputSchema: UpdateOutputSchema,
    annotations: UPDATE,
    description:
      "Update this branch: merge the selected project's configured trunk into the " +
      "selected worktree and run the complete refresh reconciliation. This is the " +
      "inverse of discern_accept and resolves discern_done's behind-trunk check. Omit " +
      "from for the configured trunk; pass from only to compose on a different ref or " +
      "worktree. The operation is idempotent and never changes the main checkout. It " +
      "requires a tracked-clean tree, aborts a conflicting merge without leaving conflict " +
      "state, and remains the recovery after conflicts are resolved. Even when no merge " +
      "is needed it reruns refresh and [worktree.setup].ensure; review and commit any " +
      "tracked result. data.commits, data.files, data.overlap, data.scopes_incoming, and " +
      "data.range report what arrived beneath this work. Capped lists carry their totals. " +
      "Set dry_run to return the same predicted data without changing anything. Use " +
      "discern_refresh for refresh alone and `discern upgrade` to update discern itself.",
    inputSchema: {
      from: z.string().optional().describe(
        "Pull a ref (branch, tag, or commit) or an unambiguous worktree id or path " +
          "into this worktree instead of the trunk. OMIT for the routine call — " +
          "the default is always the selected project's configured trunk, so there is nothing " +
          "to check first. Use this only to compose on unlanded work.",
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
    outputSchema: StartOutputSchema,
    annotations: MUTATING,
    description:
      `${
        worktreeContinuityPolicy("`discern_start`")
      } Create a fresh ISOLATED ` +
      "worktree — a separate checkout and branch for one effort — from the selected " +
      "project's configured trunk. The result reports that trunk and data.path. Run " +
      "this only from a main checkout when the effort has no worktree; it refuses from " +
      "a linked worktree. The call sets up the checkout and re-aims later discern tools " +
      "at it, but you must also move your own file operations to data.path. Pass an " +
      "absolute path to start in another discern project. name seeds a normalized, " +
      "readable worktree id; title and brief carry task metadata. from deliberately " +
      "selects a non-trunk starting point. data.landing_authority reports any prospective " +
      "standing grant, whose final coverage is rechecked against changed paths. Each " +
      "non-preview call creates a new worktree and is not idempotent. Set dry_run to " +
      "preview the plan without creating anything.",
    inputSchema: {
      name: z.string().optional().describe(
        "Optional task title and worktree-id seed. discern preserves the supplied " +
          "text in data.task.title and normalizes the id. Omit for a random codename.",
      ),
      title: z.string().optional().describe(
        "Optional display title when it should differ from `name`. With no `name`, " +
          "this title also seeds the worktree id.",
      ),
      brief: z.string().optional().describe(
        "Optional one-line task brief. The new worktree stores it for status, desk " +
          "detail, and visible agent handoff.",
      ),
      from: z.string().optional().describe(
        "Branch the new worktree from a ref (branch, tag, or commit) or an " +
          "unambiguous worktree id or path instead of the trunk. OMIT for everyday " +
          "starts — the default is always the selected project's configured trunk, so there is " +
          "nothing to look up or confirm. Use this only to build on unlanded or " +
          "experimental work.",
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
        title: args.title,
        brief: args.brief,
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
  [
    "tidy",
    "embedded formatter output belongs to the interactive terminal boundary",
  ],
  [
    "desk",
    "the interactive human surface; it wields supervisory actions over other efforts",
  ],
  [
    "enter",
    "an interactive child-shell handoff across the worktree fleet",
  ],
  // Installer verbs (doctor/map/docs are the tool-backed exceptions).
  ["setup", "the one-time interactive setup flow, driven at a terminal"],
  ["upgrade", "operates on the discern install itself, not a project state"],
  ["uninstall", "operates on the discern install itself, not a project state"],
  ["config", "config plumbing; agents read and edit discern.toml directly"],
  [
    "help",
    "human-readable CLI reference; MCP tool schemas carry their own help",
  ],
  [
    "releases",
    "The CLI supplies offline release URLs; agents use their approved network tool for the external check.",
  ],
  ["licenses", "license-text dump for humans"],
  ["triangle", "some mysteries belong to the shell"],
]);

/**
 * Resolve a verb's tool name from the {@link TOOLS} table — the single
 * verb→tool source the parity guard ties to the CLI verb list. Multi-word
 * command paths (`setup begin`) never match a tool and fall through to the
 * shell-instruction rendering.
 */
export function mcpToolNameForVerb(words: string): string | undefined {
  if (words === "standards propose") return "discern_standards";
  return TOOLS.find((tool) => verbOf(tool.name) === words)?.name;
}

/** Re-render one authored hint text for the MCP surface. */
function renderMcpHintText(authored: string): string {
  return renderCommandRefsMcp(authored, mcpToolNameForVerb);
}

/**
 * The `discern_accept` tool core: build a lifecycle context with a quiet logger
 * (accept narrates through its logger as it runs — silence it so the stdio
 * channel carries only protocol messages), perform the landing or the emergency
 * exchange, and map a precondition / identity refusal to the same error
 * envelope the CLI returns. Unexpected errors propagate to {@link runTool}'s
 * catch-all.
 */
async function acceptToolResult(
  root: string,
  opts: {
    target?: string;
    queueOnly?: boolean;
    emergency?: EmergencyOptions;
    signal?: AbortSignal;
    dryRun: boolean;
    confirmed: boolean;
    variance?: string[];
    approveStandard?: string[];
    met?: string[];
    unmet?: { id: string; why: string };
    composition?: string;
    cliModel: CliModelProvider;
  },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    if (opts.emergency !== undefined) {
      return await emergencyResult(ctx, {
        ...opts.emergency,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
    }
    return await acceptLandingResult(ctx, {
      ...(opts.queueOnly ? { queueOnly: true } : {}),
      ...(opts.target === undefined ? {} : { target: opts.target }),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      dryRun: opts.dryRun,
      confirmed: opts.confirmed,
      variance: opts.variance ?? [],
      approveStandard: opts.approveStandard ?? [],
      met: opts.met ?? [],
      ...(opts.unmet === undefined ? {} : { unmet: opts.unmet }),
      ...(opts.composition === undefined
        ? {}
        : { composition: opts.composition }),
      cliModel: opts.cliModel,
    });
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
  opts: {
    dryRun?: boolean;
    name?: string;
    title?: string | undefined;
    brief?: string | undefined;
    from?: string | undefined;
  },
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
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.brief !== undefined ? { brief: opts.brief } : {}),
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
 * every discern tool. The same pattern the compiled instructions teaches; keep them
 * aligned (`version_check.ts` sibling aside, this is the one hint the two surfaces
 * share). Exported so the parity guard can hold it to that shared wording.
 */
export function mcpStartHint(path: string): string {
  const fired = fire(HINTS["start-mcp-re-root"], { path });
  return renderMcpHintText(fired.authored ?? fired.text);
}

/** The command path behind a tool name (`discern_impact` → `impact`),
 * for the envelope every failure path renders. Exported as the tool→command
 * bridge the verb-parity guard uses to tie {@link TOOLS} back to the CLI SSOT. */
export function verbOf(toolName: string): string {
  return toolName.replace(/^discern_/, "").replace(/_/g, "-");
}

/** One MCP tool result: independently sufficient text and structured projections,
 * with `isError` reflecting the verb's `ok`. */
interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

/** Render one result as authored Markdown plus compact structured data. */
export function renderMcpResult(result: DiscernResult): ToolResult {
  const completed = withFailureRecoveryHint(
    evaluateResultCompletion(result),
  );
  const serialized = serializeResult(completed);
  return {
    content: [{
      type: "text",
      text: renderResultMarkdown(
        serialized,
        resultPresenterForVerb(completed.verb),
        resultPresenterForVerb,
      ),
    }],
    structuredContent: serialized,
    isError: !completed.ok,
  };
}

/** Lead with one delivery-level hint without clobbering the verb's own hints. */
function prependHint(result: DiscernResult, hint: FiredHint): DiscernResult {
  return {
    ...result,
    hints: mergeHintTexts(hintTexts([hint]), result.hints ?? []),
  };
}

/** Direct-call fallback: only the live server owns an installed-version resolver. */
function unresolvedInstalledVersion(): Promise<undefined> {
  return Promise.resolve(undefined);
}

/**
 * The MCP server's **working root** — the directory its verbs operate on, held as one
 * mutable value because the OS process cwd is frozen at spawn and unusable for this
 * (ADR 0062). Initialized to the spawn root (`findRoot()`), and re-pointed on two
 * lifecycle transitions: `discern_start` aims it at the worktree it just created,
 * `discern_accept` resets it to the spawn root. One repair exists besides those:
 * when the held root's checkout vanishes between calls, dispatch refuses and
 * re-aims back at the spawn root while it remains a live project. `undefined`
 * when the server spawned outside a discern project — {@link runTool}'s
 * `not_initialized` guard handles that.
 * The verb cores stay pure functions of an explicit `root`; this is only the
 * server-layer default they receive, resolved per call in {@link runTool}.
 */
export class WorkingRoot {
  #root: string | undefined;
  readonly #spawn: string | undefined;
  constructor(spawnRoot: string | undefined) {
    this.#root = spawnRoot;
    this.#spawn = spawnRoot;
  }
  /** The current working root — the directory the next verb call operates on. */
  get(): string | undefined {
    return this.#root;
  }
  /** Re-point the working root (a lifecycle re-aim). */
  set(root: string): void {
    this.#root = root;
  }
  /** The immutable spawn-time root — the recovery target when the held root's
   * checkout vanishes between calls (its worktree removed by another session). */
  spawnRoot(): string | undefined {
    return this.#spawn;
  }
}

/** One opaque id per server INSTANCE — the MCP session grouping hint: every
 * invocation this long-lived process serves belongs to one client conversation,
 * which is exactly the grouping a session reader wants. */
export function mcpSessionId(
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): string {
  return `mcp:${entropy.uuid().slice(0, 8)}`;
}

const MCP_SESSION = mcpSessionId();

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
    // discern-best-effort: mcp-ci-marker-fallback
    // No env permission reads as not-CI.
  }
  let agentSignals: AgentSignal[] | undefined;
  try {
    agentSignals = await detectAgentSignals(
      mcpClient === undefined ? {} : { mcpClient },
    );
  } catch {
    // discern-best-effort: mcp-agent-signals-fallback
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

/**
 * Tools whose `action` input selects WHICH operation runs, mapped to the command
 * each value resolves to. One declaration behind both {@link operationCommand}
 * and {@link ACTION_SELECTED_COMMANDS}, so a recorded operation and the flags
 * recorded beside it can never disagree about what `action` meant.
 * `discern_accept`'s `action` is a CLI positional, not a selector: it is
 * recorded as that operation's target through the live CLI model.
 */
export const ACTION_SELECTED_OPERATIONS: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map([
  ["discern_standards", new Map([["propose", "standards propose"]])],
]);

/** Resolve one MCP tool invocation to the CLI operation it performs. */
function operationCommand(
  tool: McpTool,
  args: Record<string, unknown>,
): string {
  const selected = ACTION_SELECTED_OPERATIONS.get(tool.name);
  const resolved = selected === undefined || typeof args.action !== "string"
    ? undefined
    : selected.get(args.action);
  return resolved ?? verbOf(tool.name);
}

/** Every command an action selector resolves to. Their `action` chose the
 * operation already, so recording it again as a flag would double-count it. */
const ACTION_SELECTED_COMMANDS: ReadonlySet<string> = new Set(
  [...ACTION_SELECTED_OPERATIONS].flatMap(([tool, values]) => [
    verbOf(tool),
    ...values.values(),
  ]),
);

/** The argument facts a tool call provided, projected through the live CLI model.
 * Positional values become the operation target; only actual CLI options become
 * flags. Values for options never land. `path` is plumbing and `dry_run` has its
 * own field. A missing model retains the historic target behavior for direct
 * test calls, while the live server always supplies its attached model. */
function mcpCallFacts(
  verb: string,
  args: Record<string, unknown>,
  cliModel: CliModelProvider,
): { flags: string[] | undefined; target: string | undefined } {
  if (verb === "standards propose" && Array.isArray(args.proposals)) {
    const targets = args.proposals.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || !("name" in entry)) {
        return [];
      }
      return typeof entry.name === "string" && entry.name !== ""
        ? [entry.name]
        : [];
    });
    return {
      flags: ["reason"],
      target: targets.length === 0 ? undefined : targets.join(" "),
    };
  }
  let positionalNames: readonly string[] = [];
  if (cliModel !== missingCliModel) {
    positionalNames = [...walkCliCommands(cliModel())]
      .find((command) => command.path.join(" ") === verb)?.args
      .map((arg) => arg.name) ?? [];
  }
  const positional = new Set(positionalNames);
  const names = Object.keys(args)
    .filter((key) =>
      key !== "path" && key !== "dry_run" && key !== "target" &&
      !(ACTION_SELECTED_COMMANDS.has(verb) && key === "action") &&
      !positional.has(key)
    )
    .map((k) => k.replaceAll("_", "-"))
    .sort();
  const targets = positionalNames.flatMap((name) => {
    if (
      verb === "accept" && name === "action" &&
      args.action === QUEUE_ACCEPT_ACTION
    ) return [];
    const value = args[name];
    if (typeof value === "string" && value !== "") return [value];
    if (Array.isArray(value)) {
      return value.filter((item): item is string =>
        typeof item === "string" && item !== ""
      );
    }
    return [];
  });
  if (
    !positional.has("target") && typeof args.target === "string" &&
    args.target !== ""
  ) {
    targets.push(args.target);
  }
  if (verb === "accept" && args.action === QUEUE_ACCEPT_ACTION) {
    names.push("queue-only");
  }
  const target = targets.length > 0 ? targets.join(" ") : undefined;
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
  cliModel: CliModelProvider = missingCliModel,
): McpRecording {
  const driver = mcpDriverFacts(mcpClient);
  const { flags } = mcpCallFacts(verb, args, cliModel);
  const dryRun = args.dry_run === true;
  const operationFacts = {
    ...(flags === undefined ? {} : { flags }),
    dryRun,
  };
  const lockBoundary = operationEffectPolicy(verb, operationFacts)?.lock;
  return {
    recorder: beginRecording(root, {
      verb,
      surface: "mcp",
      driver,
      ...(flags !== undefined ? { flags } : {}),
      dryRun,
      ...(lockBoundary === undefined ? {} : { lockBoundary }),
    }),
    driver,
    started: SYSTEM_CLOCK.monotonicNow(),
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
 * Run one verb in `root`. Config parse and validation failures are expected
 * project-input refusals and keep their structured config result. Any other throw
 * becomes an `internal_error`, so one tool cannot take down the stdio server.
 * This is the single place tool handlers are invoked (normal and root-independent
 * paths alike). An unexpected throw is a crash — a bug in discern (ADR 0248) —
 * so it also tries to save a crash report beside the logbook (the envelope's
 * message names the file when written) and returns the logbook-safe signature
 * beside that call's result.
 * {@link completeToolCall} records the same request-owned signature. Observation and recording
 * deliberately happen later, at {@link completeToolCall}, because dispatch
 * refusals never enter a handler and delivery can still prepend a stale-server
 * hint after the handler returns.
 */
async function runVerb(
  tool: McpTool,
  root: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
  cliModel: CliModelProvider = missingCliModel,
): Promise<VerbRun> {
  try {
    throwIfCrashProbe();
    const command = operationCommand(tool, args);
    const { flags } = mcpCallFacts(command, args, cliModel);
    return {
      result: await executeOperation(
        root,
        {
          command,
          ...(flags === undefined ? {} : { flags }),
          ...(args.dry_run === true ? { dryRun: true } : {}),
        },
        (operationSignal) =>
          tool.run(
            root,
            args,
            operationSignal,
            { awaitCallProfile, cliModel },
          ),
        (value) => value,
        signal,
      ),
    };
  } catch (e) {
    if (e instanceof OperationLockError) {
      return { result: e.result };
    }
    const configFailure = configFailureResult(verbOf(tool.name), e);
    if (configFailure !== undefined) {
      return { result: configFailure };
    }
    const report = captureCrashReport(
      verbOf(tool.name),
      e,
      SYSTEM_CLOCK.wallNow(),
    );
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
  cliModel: CliModelProvider,
): Promise<ToolResult> {
  const prepared = withFailureRecoveryHint(
    evaluateResultCompletion(pending.result),
  );
  const withStale = stale === undefined
    ? prepared
    : prependHint(prepared, stale);
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
  // Checkpoint observations belong to THIS call's recording; the take also
  // guarantees nothing can leak into the next call on this long-lived server.
  const checkpointActivity = takeCheckpointActivity();
  const merges = takeMergeActivity();
  const recording = pending.recording;
  if (recording !== undefined) {
    const command = operationCommand(tool, args);
    const { flags, target } = mcpCallFacts(command, args, cliModel);
    await recording.recorder.finish({
      verb: command,
      surface: "mcp",
      outcome: result.ok ? "ok" : "failed",
      durationMs: SYSTEM_CLOCK.monotonicNow() - recording.started,
      ...(result.waitedMs !== undefined ? { waitedMs: result.waitedMs } : {}),
      result,
      hintIds: observed?.hintIds ?? [],
      driver: await recording.driver,
      ...(result.dry_run === true ? { dryRun: true } : {}),
      ...(flags !== undefined ? { flags } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(checkpointActivity !== undefined
        ? { checkpoints: checkpointActivity }
        : {}),
      ...(merges === undefined ? {} : { merges }),
      ...(pending.crash !== undefined ? { crash: pending.crash } : {}),
    });
  }
  return renderMcpResult(result);
}

/** The refusal served when the held working root stopped being a discern
 * project between calls: the worktree it named was removed — typically because
 * that effort landed. States the vanished path, then the live next action. */
function vanishedHeldRootMessage(
  gone: string,
  home: string | undefined,
): string {
  const state =
    `The checkout these tools were aimed at is gone: ${gone} no longer holds ` +
    `a discern.toml — usually because that effort landed and its worktree was ` +
    `removed.`;
  return home === undefined
    ? `${state} Pass an absolute \`path\` inside the intended discern project ` +
      `or worktree.`
    : `${state} The tools now target ${home}, the checkout this server ` +
      `started in. Retry there, or pass an absolute \`path\` to aim this ` +
      `call at another project or worktree.`;
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
  cliModel: CliModelProvider = missingCliModel,
): Promise<PendingToolCall> {
  const command = operationCommand(tool, args);
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
        command,
        args,
        mcpClient,
        cliModel,
      ),
    };
  }
  let root = pathArg ? await findRoot(pathArg) : working.get();
  // The held working root is remembered state, not caller input: the worktree
  // it names can vanish between calls of this long-lived server — a sibling
  // session lands the effort, or the directory is dropped by hand. Trusting it
  // blindly hands the verb a vanished directory, so a routine "that effort is
  // over" state reads as a crash inside discern. Verify the marker first (an
  // explicit `path` was already vetted by findRoot), refuse with the story, and
  // repair the held root to the spawn checkout when that is still a project.
  if (
    root !== undefined && pathArg === undefined &&
    !(await fileExists(join(root, CONFIG_REL)))
  ) {
    const spawn = working.spawnRoot();
    const home = spawn !== undefined && spawn !== root &&
        (await fileExists(join(spawn, CONFIG_REL)))
      ? spawn
      : undefined;
    if (home !== undefined) {
      working.set(home);
    }
    if (tool.rootIndependent !== true) {
      return {
        result: notInitializedResult(
          verbOf(tool.name),
          vanishedHeldRootMessage(root, home),
        ),
        recording: home === undefined ? undefined : beginMcpRecording(
          home,
          command,
          args,
          mcpClient,
          cliModel,
        ),
      };
    }
    // A root-independent answer never depended on the vanished root: continue
    // against the repaired home, or with no root at all — the branch below
    // serves it from the process cwd exactly as when no root resolves.
    root = home;
  }
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
        cliModel,
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
    command,
    args,
    mcpClient,
    cliModel,
  );
  // Pre-setup gate — the MCP mirror of the CLI redirect: a setup-gated verb
  // (the setup-gated verbs, including `discern_map`) refuses until the project records
  // `[meta].bootstrapped`, so an agent never reads a false all-green or an empty
  // doc tree. `discern_docs`/`discern_status`/`discern_doctor`/`discern_improvement` are
  // not gated — they are exactly what you reach for before setup is done.
  if (
    verbNeedsSetup(command) && !(await setupGatePasses(root))
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
  const run = await recording.recorder.run(() =>
    runVerb(
      tool,
      root,
      args,
      signal,
      awaitCallProfile,
      cliModel,
    )
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
    unresolvedInstalledVersion,
  mcpClient?: RecordedMcpClient,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
  cliModel: CliModelProvider = missingCliModel,
): Promise<ToolResult> {
  // Drain state left by CLI-only output in this long-lived process before this
  // call starts. The final boundary drains again after observing this result.
  takeSupplementalHintIds();
  takeShownTipIds();
  takeCheckpointActivity();
  takeMergeActivity();
  // If the binary on disk changed since this server started, every result needs
  // the restart hint — including dispatch refusals.
  const stale = versionMismatchHint(
    DISCERN_VERSION,
    await resolveInstalledVersion(),
  );
  const pending = await dispatchToolCall(
    tool,
    working,
    args,
    signal,
    mcpClient,
    awaitCallProfile,
    cliModel,
  );
  return await completeToolCall(tool, args, pending, stale, cliModel);
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
    // discern-best-effort: mcp-setup-gate-config-fallback
    return true;
  }
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
        `The index of ${label}: every page's canonical target, title, and summary${
          scheme === "docs" ? ", with stable manual identity and kind" : ""
        }.`,
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
 * `discern://status`, `discern://impact`, and `discern://config` are available
 * inside a project; `discern://map` (+ template)
 * refuses per read until the project is bootstrapped — exactly as the matching tools
 * do. Every read recomputes from the verb core against the server's CURRENT working
 * root (resolved per read via {@link WorkingRoot}, ADR 0062), so the resources follow
 * `discern_start` / `discern_accept` exactly as the tools do — never a spawn root
 * frozen at registration.
 */
function registerProjectResources(
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
        asJson(
          projectStatusData((await statusResult(currentRoot())).data ?? {}),
        ),
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

  // map — the project's agent-maintained documentation, gated (per read) on setup completion,
  // mirroring the discern_map tool.
  registerDocTree(
    server,
    "map",
    "the configured project map and its agent-maintained project knowledge",
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

/** Register discern's own manual resources independently of project discovery. */
function registerDocsResources(server: McpServer, processCwd: string): void {
  registerDocTree(
    server,
    "docs",
    "discern's complete published product manual",
    () => docsResult(processCwd),
    (target) => docsResult(processCwd, { target }),
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
  const prefixPolicyIds = new Set([
    "iterate-fast-loop",
    "done-is-the-bar",
    "update-behind",
    "accept-on-handoff",
  ]);
  const statement = (id: string): string =>
    OPERATING_POLICIES.find((policy) => policy.id === id)?.statement ?? "";
  const firstParagraph = [
    "Call discern_status first.",
    "On trunk, discern_start opens a worktree.",
    statement("iterate-fast-loop"),
    statement("done-is-the-bar"),
    statement("update-behind"),
    "Use discern_await for dependencies.",
    statement("accept-on-handoff"),
    "Use discern_map to read project context.",
  ].join(" ");
  const remainingPolicies = OPERATING_POLICIES
    .filter((policy) =>
      policy.surfaces.includes("mcp-instructions") &&
      !prefixPolicyIds.has(policy.id)
    )
    .map((policy) => `- ${policy.statement}`);
  const named = new Set(
    [firstParagraph, ...remainingPolicies]
      .join("\n")
      .match(/\bdiscern_[a-z_]+\b/g) ?? [],
  );
  const remainingTools = TOOLS.map((tool) => tool.name)
    .filter((name) => !named.has(name));
  const lines = [
    firstParagraph,
    "",
    ...remainingPolicies,
    "",
    `- Other tools: ${remainingTools.join(", ")}.`,
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
  cliModel: CliModelProvider,
  awaitCallProfile: AwaitCallProfile = "unknown-client",
  processCwd: string = Deno.cwd(),
): Promise<number> {
  const spawnRoot = await findRoot(processCwd);
  // The server's logical cwd, made explicit: seeded from the spawn root, then
  // re-pointed on discern_start / discern_accept. Both the tools and the readable
  // resources resolve it per call/read, so the whole surface follows the re-aim.
  const working = new WorkingRoot(spawnRoot);
  // The version handshake's resolver, created once so it seeds its baseline stat at
  // server start (this process IS DISCERN_VERSION); every tool call reuses it to detect
  // the on-disk binary being replaced mid-session.
  const commandPath = await resolveCommandPath(DISCERN_MCP_SERVER.command);
  const installedVersion = createInstalledVersionResolver(
    commandPath === undefined ? {} : { commandPath },
  );
  const server = new McpServer(
    { name: SERVER_NAME, version: DISCERN_VERSION },
    {
      instructions: buildInstructions(),
    },
  );

  // Aborted when the client closes the pipe, so an in-flight gate run dies with
  // the server instead of orphaning its jobs. Each call's effective signal is
  // this OR the SDK's per-request signal (aborted on `notifications/cancelled`
  // when the client cancels that one call).
  const shutdown = new AbortController();
  const activeCalls = new Set<Promise<unknown>>();
  interface McpCallExtra {
    readonly sendNotification: (
      notification: CompletionProgressNotification,
    ) => Promise<void>;
    readonly signal: AbortSignal;
    readonly _meta?: Record<string, unknown>;
  }
  const callSignal = (extra: McpCallExtra): AbortSignal =>
    AbortSignal.any([extra.signal, shutdown.signal]);

  for (const tool of TOOLS) {
    // The shared config: description plus the honest metadata (title, the per-verb
    // outputSchema the SDK validates structuredContent against, and the behavioral
    // annotations). Built with conditional keys so an absent field is omitted rather
    // than set to `undefined` (exactOptionalPropertyTypes).
    const config = {
      description: toolDescriptionForProfile(tool, awaitCallProfile),
      ...(tool.title !== undefined ? { title: tool.title } : {}),
      outputSchema: tool.outputSchema,
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
      async (args: Record<string, unknown>, extra: McpCallExtra) => {
        const mcpClient = resolveMcpClientInfo(
          extra._meta,
          server.server.getClientVersion(),
        );
        const call = withMcpCompletionProgress(
          extra._meta,
          extra.sendNotification,
          () =>
            runTool(
              tool,
              working,
              args,
              callSignal(extra),
              installedVersion,
              mcpClient,
              awaitCallProfile,
              cliModel,
            ),
        );
        activeCalls.add(call);
        try {
          return await call;
        } finally {
          activeCalls.delete(call);
        }
      },
    );
  }

  // Product documentation is installed with discern itself, so its resources exist
  // even when the client starts the server outside a discern project.
  registerDocsResources(server, processCwd);

  // Project resources follow the mutable working root and therefore require an
  // initial project. Their reads re-resolve after start/accept (ADR 0062).
  if (spawnRoot !== undefined) {
    registerProjectResources(server, working);
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
    detachPromise(
      "mcp-stdin-transport-close",
      () => transport.close(),
      globalThis.reportError,
    );
  });
  await server.connect(transport);
  await closed;
  shutdown.abort();
  // Transport closure does not settle the tools it dispatched. Keep the process
  // alive until their child shutdown and retained environment recovery finish.
  while (activeCalls.size > 0) await Promise.allSettled([...activeCalls]);
  return 0;
}
