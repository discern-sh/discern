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
import { z } from "@zod/zod";
import { findRoot } from "../../shared/env.ts";
import { type DiscernResult, serializeResult } from "../../shared/result.ts";
import {
  AuditOutputSchema,
  ChangedScopesOutputSchema,
  CouplingOutputSchema,
  DatalessEnvelopeSchema,
  type DocsData,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  IntegrateOutputSchema,
  type StartData,
  StartOutputSchema,
  StatusOutputSchema,
} from "../../shared/result_schemas.ts";
import {
  configSchema,
  type DiscernConfig,
  GRADUATE_TARGETS,
  type GraduateTarget,
  loadConfig,
} from "../../shared/config_schema.ts";
import {
  type GuidanceContext,
  renderGuidanceTemplate,
} from "../guidance_template.ts";
import { enabledFeatures, type Feature } from "../../shared/features.ts";
import {
  NOT_SET_UP_MESSAGE,
  verbNeedsBootstrap,
} from "../../shared/setup_state.ts";
import { Logger } from "../../lib/log.ts";
import { finishResult } from "../gate/finish.ts";
import { prepareResult } from "../gate/prepare.ts";
import { testResult } from "../gate/test.ts";
import { ratchetsResult } from "../gate/ratchets.ts";
import { auditResult } from "../audit/audit.ts";
import { CATEGORY_NAMES } from "../audit/rules.ts";
import { changedScopesResult } from "../scopes/changed.ts";
import { couplingResult } from "../coupling/coupling.ts";
import { statusResult } from "../status/status.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { docsResult, helpResult } from "../../commands/docs.ts";
import {
  graduateResult,
  integrateResult,
  lifecycleContext,
  startResult,
  worktreeErrorResult,
} from "../worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";

const SERVER_NAME = "discern";
const SERVER_VERSION = "1.0.0";

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
const INTEGRATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

/** A tool handler's `args`: the object the SDK validates each call against and hands
 * the handler, inferred from the tool's own Zod input shape. An argument-less tool
 * keeps the empty default shape, so its handler simply ignores the parameter. */
type ToolArgs<TShape extends z.ZodRawShape> = z.infer<z.ZodObject<TShape>>;

/** A tool: its advertised schema + metadata plus the handler that runs the verb.
 * The SDK converts {@link inputSchema}/{@link outputSchema} (Zod raw shapes, the
 * latter the per-verb schema from result_schemas.ts) to the JSON Schemas it
 * advertises in `tools/list`, and validates a call's `structuredContent` against the
 * output schema. Generic over its input shape (`TShape`) so {@link defineTool} types
 * each handler's `args` from that tool's own `inputSchema` — the SDK has already
 * validated the call against it, so the handler reads typed fields instead of
 * re-checking an untyped `Record`. The heterogeneous {@link TOOLS} table holds the
 * widened default. */
interface McpTool<TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  /** A short human label shown by clients alongside the tool. */
  title?: string;
  description: string;
  /** The verb's arguments as a Zod raw shape; absent for an argument-less verb. */
  inputSchema?: TShape;
  /** The result shape this tool advertises (a Zod raw shape — a per-verb output
   * schema's `.shape`). The SDK validates every call's `structuredContent` against
   * it, so it MUST match what the verb actually returns (ADR 0041). */
  outputSchema?: z.ZodRawShape;
  /** Honest behavioural hints (read-only / destructive / …). */
  annotations?: ToolAnnotations;
  /** When set, the tool is registered (listed and callable) only if this feature is
   * enabled — the MCP mirror of the CLI's per-feature verb gating. */
  feature?: Feature;
  /** After a SUCCESSFUL, non-preview call, compute the server's new working root —
   * the data-driven re-aim (ADR 0062), so {@link runTool} needs no per-tool name
   * switch. `discern_start` points it at the worktree it just created
   * (`result.data.path`); `discern_graduate` resets it to the spawn root (the worktree
   * it pointed at is gone). Return undefined to leave the working root unchanged — the
   * default for every other tool, which never moves it. */
  reaimOnSuccess?(
    result: DiscernResult,
    spawnRoot: string | undefined,
  ): string | undefined;
  /** Run the verb in `root` with the call's arguments → the result to render. */
  run(root: string, args: ToolArgs<TShape>): Promise<DiscernResult>;
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
 * The optional `path` override every root-operating tool carries (ADR 0062 §2): an
 * explicit project to act on instead of the server's current working root, resolved
 * through `findRoot(path)` in {@link runTool} (so any directory inside a worktree
 * resolves to its root, and a non-project path falls through to `not_initialized`).
 * `path` wins over the working root for that one call. Spread into each root-operating
 * tool's `inputSchema`; NOT on `discern_help` (discern's own bundled docs are
 * root-independent) or `discern_start` (its root is the creation source, a separate
 * concern). The describe text carries no `{{var}}`, so it is not interpolated. */
const PATH_PARAM = {
  path: z.string().optional().describe(
    "operate on the discern project containing this absolute path instead of the " +
      "server's current working root; rarely needed — discern_start re-aims " +
      "automatically",
  ),
};

/** The exposed tool set — each a thin adapter over a verb's result-returning core.
 * Exported so the verb-parity guard (`tests/engine_verb_parity_test.ts`) can
 * reconcile the tool slugs against the CLI verb SSOT via {@link verbOf} — every
 * MCP tool is a real verb, no dead slugs. */
export const TOOLS: McpTool[] = [
  defineTool({
    name: "discern_finish",
    title: "Run the quality gate",
    outputSchema: FinishOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Run the discern quality gate (formatters, checks, tests, scope gates) and " +
      "return the structured result: per-step outcomes plus normalized diagnostics " +
      "(tool, file/line when available, message, and the exact command to reproduce " +
      "each failure). Set dry_run to preview the plan without running anything.",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the gate plan and touch nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) => finishResult(root, { dryRun: args.dry_run === true }),
  }),
  defineTool({
    name: "discern_prepare",
    title: "Run the fast gate",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Run the fast inner-loop gate — the fix-stage fixers, then the read-only " +
      "check-stage jobs (no build, no tests) — and return the result envelope. The " +
      "quick check to run while iterating, before the full discern_finish. NOTE: the " +
      "fixers MUTATE the working tree (e.g. a formatter rewrites files).",
    inputSchema: { ...PATH_PARAM },
    run: (root) => prepareResult(root),
  }),
  defineTool({
    name: "discern_test",
    title: "Run the tests",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Run the project's test capability on its own (the `test` stage, outside the " +
      "full gate) and return the result envelope. When no test command is configured " +
      "it is a trivial pass carrying a hint that says so.",
    inputSchema: { ...PATH_PARAM },
    run: (root) => testResult(root),
  }),
  defineTool({
    name: "discern_ratchets",
    title: "Check the ratchets",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Check every configured quality ratchet (a never-loosen metric floor/ceiling): " +
      "run each ratchet's measurement command, compare it to its limit, and assert " +
      "the limit was not loosened versus `{{main_branch}}`. Returns the per-ratchet " +
      "steps[]. SLOW " +
      "and ON DEMAND — it runs the metric commands, so it is NOT part of " +
      "discern_finish; check it explicitly before pushing. Set dry_run to preview " +
      "which ratchets would run without measuring anything.",
    feature: "ratchets",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the ratchets that would run and measure nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      ratchetsResult(root, { dryRun: args.dry_run === true }),
  }),
  defineTool({
    name: "discern_doctor",
    title: "Check the install",
    outputSchema: DoctorOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared capability commands " +
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
    name: "discern_changed_scopes",
    title: "List changed scopes",
    outputSchema: ChangedScopesOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "List which project scopes the current branch and working tree changed — the " +
      "classification that decides which scope gates the quality gate fires.",
    inputSchema: { ...PATH_PARAM },
    run: (root) => changedScopesResult(root),
  }),
  defineTool({
    name: "discern_coupling",
    title: "Co-change partners",
    outputSchema: CouplingOutputSchema.shape,
    annotations: READ_ONLY,
    feature: "coupling",
    description:
      "Surface the files that historically change TOGETHER — a co-change advisory mined " +
      "from git history — so a touched file's habitual sibling isn't forgotten. With no " +
      "`file` it is DIFF-AWARE: it reports the files that co-change with your current " +
      "change set but are MISSING from it (the primary surface). Pass `file` to query ONE " +
      "file's top co-change partners (its blast radius). Each partner carries its evidence " +
      "(confidence, support, lift) in data.partners, and the human-readable advisory rides " +
      "in hints[]. Strictly ADVISORY: it points at where to look and NEVER blocks — you " +
      "decide whether a strong coupling is an essential invariant to lock with a " +
      "forcing-function, or incidental and ignorable. The list is not exhaustive.",
    inputSchema: {
      file: z.string().optional().describe(
        "Query ONE file's co-change partners (its blast radius). Omit for the diff-aware " +
          "view: what co-changes with your current change set but is missing from it.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      couplingResult(root, args.file !== undefined ? { path: args.file } : {}),
  }),
  defineTool({
    name: "discern_status",
    title: "Project status",
    outputSchema: StatusOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Report what is true right now and what to do next — pure observation, never " +
      "runs the gate, tests, ratchets, or touches anything. Call it at the start of a " +
      'session to orient. data.location is "worktree" or "main"; data.git carries ' +
      "branch/clean/changed-files and ahead/behind the integration branch — and, when " +
      "behind, data.git.incoming_overlap names the files YOU changed that the incoming " +
      "`{{main_branch}}` also changed (the hot zone to re-read on integrating, since a " +
      "clean merge can still break them); data.gate " +
      "lists what the gate WOULD fire (wired capabilities, checks, triggered scope " +
      "gates); data.worktree carries this worktree's id/port/db and provisioned " +
      "resources; data.features and data.ratchets list the configured set. " +
      "data.stale_generated flags generated agent files, and data.stale_materialized " +
      "the materialized skills, that have drifted from their sources (run discern " +
      "refresh for either); data.setup_unfinished is present while the project's " +
      "one-time setup is still incomplete. From the " +
      "main checkout it leads with data.fleet (a cheap row per worktree: branch, " +
      "dirty/ahead/behind, a last_activity timestamp, and is_current marking the row " +
      "this call is rooted in — every other row is a separate line of work, not a " +
      "workspace to claim, and a clean tree never means one is free); set all=true " +
      "to include the fleet from a worktree, or local=true to suppress it. hints[] are " +
      "advisory next-steps (e.g. run discern_finish, ready to graduate, or — when on " +
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
    name: "discern_audit",
    title: "Audit the setup",
    outputSchema: AuditOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Audit the project against the best-practices checklist and return the scored, " +
      "weakest-first result. Each category lists deterministic rules (status, the finding, " +
      "the exact fix, and why it matters) plus subjective review items — questions the " +
      "agent should judge against the cited material (e.g. the guidance text) and act on. " +
      "Use it to surface concrete setup improvements; pass a category to focus one area.",
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
      auditResult(root, {
        category: args.category,
        minScore: args.min_score,
      }),
  }),
  defineTool({
    name: "discern_docs",
    title: "Read project docs",
    outputSchema: DocsOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Read the project's documentation tree. With no argument, return the index — " +
      "every doc's path, section, slug, and title. Pass `target` (a slug, " +
      "`section/slug`, or path) to return that one doc's full Markdown content. The " +
      "grounded source to consult before reasoning about this project's documented " +
      "behaviour.",
    feature: "docs",
    inputSchema: {
      target: z.string().optional().describe(
        "A specific doc to fetch (slug, section/slug, or path). Omit for the index.",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      docsResult(root, {
        target: args.target,
      }),
  }),
  defineTool({
    name: "discern_help",
    title: "Read discern's docs",
    outputSchema: DocsOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Read discern's OWN documentation — the harness's docs (the discern.toml " +
      "config reference, the concepts, the gate/worktree/ratchet pages), bundled " +
      "into every install. Distinct from discern_docs, which reads the host " +
      "PROJECT's docs: call this to learn how discern itself works, before editing " +
      "discern.toml or reasoning about the gate. With no argument, return the index " +
      "(every doc's path, section, slug, and title); pass `target` (a slug, " +
      "`section/slug`, or path) for that one doc's full Markdown content. Always " +
      "available — it is discern's help, not a project feature — and serves only " +
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
    name: "discern_graduate",
    title: "Graduate the worktree",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: DESTRUCTIVE,
    description:
      "Graduate THIS worktree's branch into the main checkout: tear down the " +
      "worktree's resources, commit any leftover changes, remove the worktree, then " +
      'land the branch per `to`. `to:"branch"` checks it out in the main repo for ' +
      'review (branch preserved); `to:"trunk"` fast-forwards the trunk to the branch ' +
      "tip and deletes the now-merged branch. Omit `to` to use the project default " +
      "([worktree].graduate_to). This is the single deterministic implementation — " +
      "run it rather than reproducing the steps with git; commit the work with a real " +
      "message first so it lands as a proper review commit, then relay the result. " +
      "Requires the latest `{{main_branch}}` is already integrated and the main " +
      "checkout is clean " +
      '— refuses (error:"precondition_failed") otherwise, pointing at discern_integrate ' +
      "to integrate first. Set dry_run to preview the plan without touching anything. " +
      "Operates only on the worktree the server runs in; it cannot reach another.",
    feature: "worktrees",
    inputSchema: {
      to: z.enum(GRADUATE_TARGETS).optional().describe(
        'Where the branch lands. "branch": check it out in the main repo for review, ' +
          'branch preserved. "trunk" (a role → [project].main_branch): fast-forward ' +
          "the trunk to the branch tip and delete the merged branch. Omit to use " +
          "[worktree].graduate_to.",
      ),
      dry_run: z.boolean().optional().describe(
        "Preview the graduation plan and touch nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    // A successful graduation removes the worktree the server pointed at — reset the
    // working root to the spawn root (the trunk it was launched from), the path
    // subsequent calls should operate on.
    reaimOnSuccess: (_result, spawnRoot) => spawnRoot,
    run: (root, args) =>
      graduateToolResult(root, {
        dryRun: args.dry_run === true,
        to: args.to,
      }),
  }),
  defineTool({
    name: "discern_integrate",
    title: "Integrate {{main_branch}}",
    outputSchema: IntegrateOutputSchema.shape,
    annotations: INTEGRATE,
    description:
      "Bring the latest `{{main_branch}}` into THIS worktree's branch and " +
      "re-materialize the " +
      "generated agent files + skills, in one deterministic step — the inverse of " +
      "discern_graduate, and the action that resolves discern_finish's merge check " +
      "(which refuses a branch behind `{{main_branch}}`). Run it whenever the branch " +
      "is behind. " +
      "Just call it: you do NOT need to run git to check first — it performs every " +
      "precondition itself and returns exactly what to do next. It is idempotent and " +
      "safe to call anytime: a no-op success when the branch already contains " +
      "`{{main_branch}}` " +
      "(reported, nothing merged, no refresh); it merges into a clean tree only, so " +
      'it refuses (error:"precondition_failed") on uncommitted changes; and on a merge ' +
      "conflict it aborts cleanly (leaving the tree untouched) and refuses, naming the " +
      "conflicted files and the manual path to resolve them. " +
      "On a merge it returns `data` summarizing what landed BENEATH your work: the " +
      "commits and files brought in (each capped, with a `*_total` and `*_truncated`), " +
      "which of your own files `overlap` them (RE-READ those — a clean merge can still " +
      "conflict semantically), the `scopes_incoming` touched, and a `range` of commit " +
      "SHAs. When a list is capped, pull the full set in ONE git call from the range " +
      "rather than guessing it — e.g. `git diff --stat <range.before>..<range.after>`, " +
      "or `git diff <range.before>..<range.after> -- <path>` for one file; the hints " +
      "carry the exact command. Set dry_run to preview the " +
      "plan (and the SAME predicted `data`, computed read-only without merging) without " +
      "touching anything. Never touches the main checkout; operates only " +
      "on the worktree the server runs in.",
    feature: "worktrees",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the integration plan and touch nothing (default false).",
      ),
      ...PATH_PARAM,
    },
    run: (root, args) =>
      integrateToolResult(root, { dryRun: args.dry_run === true }),
  }),
  defineTool({
    name: "discern_start",
    title: "Start a worktree",
    outputSchema: StartOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Create a fresh ISOLATED worktree from the main checkout — your own line of " +
      "work — on its own branch, set it up, and return where it landed (data.path). " +
      "Use this when you are on the trunk (the main checkout) and about to start work: " +
      "it is the first-class way to get your own workspace, so you NEVER adopt an " +
      "existing idle worktree (each belongs to another line of work; a clean working " +
      "tree doesn't mean it's free). On success it RE-AIMS these discern tools at the " +
      "new worktree automatically — your later discern_finish / discern_integrate / " +
      "discern_graduate operate on it with nothing for you to thread. But that moves " +
      "only the discern tools: you MUST still move your OWN file operations into " +
      "data.path — via your environment's worktree-entering capability, a fresh " +
      "session rooted there, or changing directory — so your edits land in the " +
      "worktree, not the trunk; otherwise your edits and the gate diverge. Each call " +
      "mints a NEW worktree (not idempotent) — call it once per line of work. If you " +
      "are already inside a worktree, do NOT call this (you'd create a pointless " +
      'sibling): it refuses (error:"precondition_failed") if invoked anyway. Set ' +
      "dry_run to preview the plan without creating anything.",
    feature: "worktrees",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the start plan and touch nothing (default false).",
      ),
    },
    // A successful start re-aims the working root at the worktree it just created, so
    // the subsequent finish/integrate/graduate operate on it with nothing to thread.
    reaimOnSuccess: (result) => (result.data as StartData | undefined)?.path,
    run: (root, args) =>
      startToolResult(root, { dryRun: args.dry_run === true }),
  }),
];

/**
 * The `discern_graduate` tool core: build a lifecycle context with a quiet logger
 * (graduate narrates through its logger as it runs — silence it so the stdio
 * channel carries only protocol messages), perform the graduation, and map a
 * precondition / identity refusal to the same error envelope the CLI returns.
 * Unexpected errors propagate to {@link runTool}'s catch-all.
 */
async function graduateToolResult(
  root: string,
  opts: { dryRun?: boolean; to?: GraduateTarget | undefined },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    return await graduateResult(ctx, opts);
  } catch (e) {
    const mapped = worktreeErrorResult("graduate", e);
    if (mapped !== undefined) {
      return mapped;
    }
    throw e;
  }
}

/**
 * The `discern_integrate` tool core: build a lifecycle context with a quiet logger
 * (integrate narrates through its logger as it merges + re-materializes — silence
 * it so the stdio channel carries only protocol messages), perform the
 * integration, and map a precondition refusal (main checkout, dirty tree, merge
 * conflict) to the same error envelope the CLI returns. Unexpected errors
 * propagate to {@link runTool}'s catch-all.
 */
async function integrateToolResult(
  root: string,
  opts: { dryRun?: boolean },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    return await integrateResult(ctx, opts);
  } catch (e) {
    const mapped = worktreeErrorResult("integrate", e);
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
  opts: { dryRun?: boolean },
): Promise<DiscernResult> {
  const ctx = await lifecycleContext(
    root,
    new Logger({ json: true, noColor: true }),
  );
  try {
    const result = await startResult(ctx, {
      dryRun: opts.dryRun ?? false,
      worktreeRoot: resolveWorktreeRoot(ctx.root, ctx.config),
    });
    // Over MCP, start ALSO re-aims the live server's working root at the new worktree
    // (runTool applies the re-aim once this returns) — the CLI can't, having no
    // persistent server, so the shared engine hint ("nothing relocated — cd there")
    // is wrong here. Replace it with the MCP story: the discern tools follow
    // automatically, but the agent must still move its OWN file context in. Only on a
    // real apply (a dry-run created nothing and moves nothing).
    const data = result.data;
    if (result.ok && result.dry_run !== true && data !== undefined) {
      result.hints = [mcpStartHint(data.path)];
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
 * now aimed at the new worktree automatically — finish/integrate/graduate follow.
 * (2) The agent must STILL move its own file operations into `path`, because the
 * server cannot relocate the client's session — and if it doesn't, its edits land on
 * the trunk while the gate runs in the worktree, so the two diverge. Vendor-neutral
 * by design (the server is agent-agnostic): it alludes to the capability rather than
 * naming any one client's worktree-entering command.
 */
function mcpStartHint(path: string): string {
  return `discern's tools are now aimed at the new worktree at ${path} — your ` +
    `discern_finish / discern_integrate / discern_graduate calls operate on it ` +
    `automatically from here. You must STILL move your own file operations into ` +
    `${path} (your environment's worktree-entering capability, a fresh session ` +
    `rooted there, or changing directory) so your edits land in the worktree, not ` +
    `the trunk — otherwise your edits and the gate will diverge.`;
}

/** The verb slug behind a tool name (`discern_changed_scopes` → `changed-scopes`),
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

/**
 * The MCP server's **working root** — the directory its verbs operate on, held as one
 * mutable value because the OS process cwd is frozen at spawn and unusable for this
 * (ADR 0062). Initialized to the spawn root (`findRoot()`), and re-pointed on exactly
 * two lifecycle transitions: `discern_start` aims it at the worktree it just created,
 * `discern_graduate` resets it to the spawn root. `undefined` when the server spawned
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
 * Run one tool call and render its DiscernResult. The per-call root is the explicit
 * `path` argument when given (ADR 0062 §2 — resolved through `findRoot`, so any
 * directory inside a worktree resolves to its root and a non-project path falls
 * through to `not_initialized`), else the server's current working root — re-pointed
 * by `discern_start` / reset by `discern_graduate` via {@link McpTool.reaimOnSuccess},
 * applied here after a successful, non-preview call. Every refusal is rendered as a
 * normal (error) {@link DiscernResult} — a missing project, or an unexpected throw
 * from the verb (caught here so a single tool error can never take the whole stdio
 * server down). A disabled feature is handled earlier, by simply not registering its
 * tool — so it is absent from `tools/list` and the SDK rejects a call to it.
 */
async function runTool(
  tool: McpTool,
  working: WorkingRoot,
  spawnRoot: string | undefined,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // The explicit `path` override wins over the working root for this one call; any dir
  // inside a worktree resolves to its root, a non-project path → undefined → refusal.
  const pathArg = typeof args.path === "string" ? args.path : undefined;
  const root = pathArg ? await findRoot(pathArg) : working.get();
  if (root === undefined) {
    return renderResult({
      ok: false,
      verb: verbOf(tool.name),
      error: "not_initialized",
      message:
        "not inside a discern project (no discern.toml in this directory or any parent).",
    });
  }
  // Pre-setup gate — the MCP mirror of the CLI redirect: a bootstrap-gated verb
  // (the gate verbs and `discern_docs`) refuses until the project records
  // `[meta].bootstrapped`, so an agent never reads a false all-green or an empty
  // doc tree. `discern_help`/`discern_status`/`discern_doctor`/`discern_audit` are
  // not gated — they are exactly what you reach for before setup is done.
  if (
    verbNeedsBootstrap(verbOf(tool.name)) && !(await bootstrapGatePasses(root))
  ) {
    return renderResult({
      ok: false,
      verb: verbOf(tool.name),
      error: "not_set_up",
      message: NOT_SET_UP_MESSAGE,
    });
  }
  let result: DiscernResult;
  try {
    result = await tool.run(root, args);
  } catch (e) {
    result = {
      ok: false,
      verb: verbOf(tool.name),
      error: "internal_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  // Data-driven re-aim (ADR 0062): on a successful, non-preview lifecycle call, move
  // the working root per the tool's own hook (start → the new worktree; graduate →
  // the spawn root). Gated on no `path` override — an explicit `path` wins "for that
  // one call" only (§2), so it steers the call without mutating the held working root.
  // A dry-run never moves it either — it changed nothing on disk.
  if (
    pathArg === undefined && result.ok && result.dry_run !== true &&
    tool.reaimOnSuccess !== undefined
  ) {
    const next = tool.reaimOnSuccess(result, spawnRoot);
    if (next !== undefined) {
      working.set(next);
    }
  }
  return renderResult(result);
}

/**
 * Whether the pre-setup gate should let a bootstrap-gated tool run: true once the
 * project records `[meta].bootstrapped`, and also true when the config cannot be
 * read — so the verb's own core surfaces the real config error rather than a
 * misleading `not_set_up` (the MCP mirror of the CLI's `configOk` guard). Resolved
 * per call, not once at startup, so a project bootstrapped mid-session (via the
 * CLI, alongside a long-lived server) is picked up without a restart.
 */
async function bootstrapGatePasses(root: string): Promise<boolean> {
  try {
    return (await loadConfig(root)).meta.bootstrapped;
  } catch {
    return true;
  }
}

/**
 * Resolve the config the server renders + gates against: the project's real
 * `discern.toml`, or — outside a project, or when the config can't be parsed — the
 * fully-defaulted config (`configSchema.parse({})`). Resolved ONCE at startup and
 * shared by the feature gate and the text rendering below. The defaulted fallback
 * keeps the prior "every feature on when the config is unreadable" behaviour (every
 * feature defaults to true), so the tool surface never silently shrinks because of a
 * config the user is mid-edit on; it also gives {@link mcpContext} a sane fallback
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
      main_branch: config.project.main_branch,
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

/** Throw the canonical not-set-up refusal when a bootstrap-gated resource is read
 * before the project records `[meta].bootstrapped` — the resource mirror of the
 * tool's pre-setup gate. */
async function assertResourceBootstrapped(root: string): Promise<void> {
  if (!(await bootstrapGatePasses(root))) {
    throw new Error(NOT_SET_UP_MESSAGE);
  }
}

/**
 * Register the doc-tree resources for one scheme (`docs` = the project's tree,
 * `help` = discern's own): a fixed index (`discern://<scheme>` → the JSON index)
 * and a `{target}` template (`discern://<scheme>/{target}` → that one doc's
 * Markdown). `index`/`single` are the verb cores (the caller pre-guards them); a
 * not-found or refused read throws, which the SDK renders as a resource-read error.
 */
function registerDocTree(
  server: McpServer,
  scheme: "docs" | "help",
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
    new ResourceTemplate(`discern://${scheme}/{target}`, { list: undefined }),
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
 * Register the readable resources, mirroring the tools' feature- and pre-setup-
 * gating: `discern://status`, `discern://changed-scopes`, and `discern://config`
 * are always available; `discern://help` (+ a `{target}` template) is too; and
 * `discern://docs` (+ template) is registered only with the `docs` feature on and
 * refuses per read until the project is bootstrapped — exactly as the matching tools
 * do. Every read recomputes from the verb core against the server's CURRENT working
 * root (resolved per read via {@link WorkingRoot}, ADR 0062), so the resources follow
 * `discern_start` / `discern_graduate` exactly as the tools do — never a spawn root
 * frozen at registration.
 */
function registerResources(
  server: McpServer,
  working: WorkingRoot,
  enabled: ReadonlySet<Feature>,
): void {
  // Resolve the working root AT READ TIME (not captured), so a resource read reflects
  // the latest re-aim. Defensive throw only: resources are registered solely when the
  // spawn root was defined, and the working root never moves to undefined, so a read
  // always sees a real project root.
  const currentRoot = (): string => {
    const root = working.get();
    if (root === undefined) {
      throw new Error(
        "not inside a discern project (no discern.toml in this directory or any parent).",
      );
    }
    return root;
  };
  server.registerResource(
    "discern-status",
    "discern://status",
    {
      description:
        "A live discern_status snapshot: the git situation, what the gate would fire, the features and ratchets, and (from the main checkout) the worktree fleet.",
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
    "discern-changed-scopes",
    "discern://changed-scopes",
    {
      description:
        "The project scopes the current branch and working tree changed — what decides which scope gates fire.",
      mimeType: JSON_MIME,
    },
    async (uri: URL) =>
      resourceText(
        uri,
        JSON_MIME,
        asJson((await changedScopesResult(currentRoot())).data),
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

  // docs — the project's documentation, gated on the `docs` feature and (per read)
  // on bootstrap, mirroring the discern_docs tool.
  if (enabled.has("docs")) {
    registerDocTree(
      server,
      "docs",
      "the project's documentation",
      async () => {
        const root = currentRoot();
        await assertResourceBootstrapped(root);
        return docsResult(root);
      },
      async (target) => {
        const root = currentRoot();
        await assertResourceBootstrapped(root);
        return docsResult(root, { target });
      },
    );
  }
}

/**
 * The server's `instructions` — the native "when to use which tool" block capable
 * clients load when MCP connects (it rides in the `initialize` result). discern's
 * operating model in a few imperative lines, carrying the strong MCP-first stance:
 * these tools are the primary surface, not the CLI. Feature-aware, mirroring the
 * tool gating — the docs and ratchets lines appear only when their feature is on.
 * The worktree lifecycle is listed LINEARLY — start, then integrate, then graduate —
 * not branched on the server's location: every lifecycle tool is always registered
 * (ADR 0062 retired the location-based hiding), and the server re-aims its working
 * root on `discern_start`, so an agent that starts on the trunk can drive the whole
 * lifecycle through this one connection.
 */
export function buildInstructions(
  enabled: ReadonlySet<Feature>,
): string {
  const lines = [
    "discern is this project's quality harness, and these tools are the primary " +
    "surface for working in it — prefer them over shelling out to the `discern` " +
    "CLI; each returns a structured result you can read directly.",
    "",
    "- Orient at the start of a session with discern_status: the branch's " +
    "situation, what the gate would fire, and advisory next steps.",
    "- Before calling any change done, run discern_finish (the full gate). While " +
    "iterating, use discern_prepare (the fast fix-then-check loop) and discern_test " +
    "(just the tests). On a failure, read the result's diagnostics[] — the tool, " +
    "the command to reproduce it, the captured output — and fix from those rather " +
    "than re-running and scraping.",
    "- Learn how discern itself works (the gate, discern.toml, worktrees) with " +
    "discern_help.",
    "- Verify the install with discern_doctor when something looks misconfigured " +
    "(bad config, a command not on PATH, a stale schema).",
  ];
  if (enabled.has("docs")) {
    lines.push("- Read THIS project's own documentation with discern_docs.");
  }
  lines.push("- Find concrete setup improvements with discern_audit.");
  if (enabled.has("ratchets")) {
    lines.push(
      "- Before pushing, check the quality ratchets with discern_ratchets — slow " +
        "and on-demand, so NOT part of discern_finish.",
    );
  }
  if (enabled.has("worktrees")) {
    lines.push(
      "- Starting work from the trunk (the main checkout)? Run discern_start to " +
        "create your own isolated worktree: it returns the new worktree's path and " +
        "re-aims these tools at it, so your later finish/integrate/graduate operate " +
        "on the new worktree automatically. You must still move your OWN file " +
        "operations into that path (your environment's worktree-entering capability, " +
        "a fresh session rooted there, or cd) so edits land in the worktree, not the " +
        "trunk. NEVER adopt an existing idle worktree; each is another line of work, " +
        "and a clean working tree doesn't mean it's free.",
    );
    lines.push(
      "- When the branch is behind `{{main_branch}}` (the gate's merge check " +
        "points here), bring `{{main_branch}}` in with discern_integrate: it " +
        "merges `{{main_branch}}` into this worktree's branch " +
        "and re-materializes the agent files + skills in one step. Just call it — you " +
        "don't need to run git to check first. It is idempotent (a no-op when already " +
        "up to date), never touches the main checkout, and performs every precondition " +
        "itself, refusing cleanly with the exact next step (e.g. a dirty tree or a " +
        "merge conflict). Reproducing its steps by hand is slower and usually " +
        "unnecessary.",
    );
    lines.push(
      "- When a branch is finished and integrated — or the user signals a handoff " +
        '("graduate this", "I\'ll take it from here", "move this back to {{main_branch}}") — ' +
        "graduate it with discern_graduate. Commit the work with a real message " +
        "first, then just call the tool (the single deterministic implementation — " +
        "don't reproduce its git steps, and don't pre-flight preconditions with git: " +
        "it refuses cleanly with the exact next step, e.g. run discern_integrate " +
        "first) and relay its structured result. Pass " +
        'to:"trunk" to fast-forward the trunk and delete the branch, to:"branch" to ' +
        "leave it checked out for review, or omit it to use the project default.",
    );
  }
  return lines.join("\n");
}

/**
 * Run the MCP server over stdio via the official SDK. The spawn root and the enabled
 * features are resolved once at startup; the spawn root seeds the mutable
 * {@link WorkingRoot} the verbs actually operate on (re-aimed by `discern_start` /
 * `discern_graduate`, ADR 0062). Every enabled tool is registered (feature-disabled
 * tools are omitted, the MCP mirror of the CLI listing only the active verbs).
 * `connect` starts the transport; the server then runs until stdin closes (the
 * transport's `onclose`), at which point this resolves and the process exits.
 */
export async function runMcpServer(): Promise<number> {
  const spawnRoot = await findRoot();
  const cfg = await resolveServerConfig(spawnRoot);
  const enabled = new Set(enabledFeatures(cfg));
  // The server's logical cwd, made explicit: seeded from the spawn root, then
  // re-pointed on discern_start / discern_graduate. Both the tools and the readable
  // resources resolve it per call/read, so the whole surface follows the re-aim.
  const working = new WorkingRoot(spawnRoot);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: renderMcpText(buildInstructions(enabled), cfg),
    },
  );

  for (const tool of TOOLS) {
    if (tool.feature !== undefined && !enabled.has(tool.feature)) {
      continue;
    }
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
    if (tool.inputSchema !== undefined) {
      server.registerTool(
        tool.name,
        { ...config, inputSchema: tool.inputSchema },
        (args: Record<string, unknown>) =>
          runTool(tool, working, spawnRoot, args),
      );
    } else {
      // An argument-less verb registers no input schema, so the SDK skips
      // argument validation — the call is accepted whether or not the client
      // sends an (empty) `arguments` object. Its callback receives only the
      // request `extra`, so there are no arguments to forward.
      server.registerTool(
        tool.name,
        config,
        () => runTool(tool, working, spawnRoot, {}),
      );
    }
  }

  // Resources — readable context paired with the tools (ADR 0041). Registered only
  // when the server spawned inside a project; each read recomputes fresh against the
  // CURRENT working root (so the resources follow discern_start / discern_graduate
  // exactly as the tools do — ADR 0062).
  if (spawnRoot !== undefined) {
    registerResources(server, working, enabled);
  }

  const transport = new StdioServerTransport();
  // The SDK's stdio transport closes only on an explicit `close()` — it does not
  // react to stdin EOF. Bridge that here so the server shuts down cleanly when the
  // client closes the pipe (and `runMcpServer` returns rather than deadlocking the
  // top-level await): on stdin `end`, close the transport, whose `onclose` resolves.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = (): void => resolve();
  });
  process.stdin.once("end", () => void transport.close());
  await server.connect(transport);
  await closed;
  return 0;
}
