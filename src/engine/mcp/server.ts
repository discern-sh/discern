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
  DatalessEnvelopeSchema,
  type DocsData,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  type Location,
  StartOutputSchema,
  StatusOutputSchema,
} from "../../shared/result_schemas.ts";
import {
  GRADUATE_TARGETS,
  type GraduateTarget,
  loadConfig,
} from "../../shared/config_schema.ts";
import {
  enabledFeatures,
  type Feature,
  FEATURES,
} from "../../shared/features.ts";
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
import { worktreeGitKey } from "../worktree/git.ts";
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

/** A tool: its advertised schema + metadata plus the handler that runs the verb.
 * The SDK converts {@link inputSchema}/{@link outputSchema} (Zod raw shapes, the
 * latter the per-verb schema from result_schemas.ts) to the JSON Schemas it
 * advertises in `tools/list`, and validates a call's `structuredContent` against the
 * output schema. */
interface McpTool {
  name: string;
  /** A short human label shown by clients alongside the tool. */
  title?: string;
  description: string;
  /** The verb's arguments as a Zod raw shape; absent for an argument-less verb. */
  inputSchema?: z.ZodRawShape;
  /** The result shape this tool advertises (a Zod raw shape — a per-verb output
   * schema's `.shape`). The SDK validates every call's `structuredContent` against
   * it, so it MUST match what the verb actually returns (ADR 0041). */
  outputSchema?: z.ZodRawShape;
  /** Honest behavioural hints (read-only / destructive / …). */
  annotations?: ToolAnnotations;
  /** When set, the tool is registered (listed and callable) only if this feature is
   * enabled — the MCP mirror of the CLI's per-feature verb gating. */
  feature?: Feature;
  /** When set, the tool is registered ONLY when the server is rooted in this location
   * — the MCP mirror of a verb's own location precondition, so the tool list is tailored
   * to where the server actually runs (a single enum, not two booleans that could
   * contradict). `"main"` hides the tool from a worktree-rooted session (`discern_start`:
   * spawning a worktree only makes sense from the trunk, and an agent already in one must
   * not create a pointless sibling); `"worktree"` hides it from a main-rooted session
   * (`discern_graduate` / `discern_integrate`: they act on the current worktree and can't
   * run on the trunk). The verb core still refuses defensively if invoked anyway, so
   * hiding is UX, not the safety boundary. */
  requiresLocation?: Location;
  /** Run the verb in `root` with the call's arguments → the result to render. */
  run(root: string, args: Record<string, unknown>): Promise<DiscernResult>;
}

/** The exposed tool set — each a thin adapter over a verb's result-returning core.
 * Exported so the verb-parity guard (`tests/engine_verb_parity_test.ts`) can
 * reconcile the tool slugs against the CLI verb SSOT via {@link verbOf} — every
 * MCP tool is a real verb, no dead slugs. */
export const TOOLS: McpTool[] = [
  {
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
    },
    run: (root, args) => finishResult(root, { dryRun: args.dry_run === true }),
  },
  {
    name: "discern_prepare",
    title: "Run the fast gate",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Run the fast inner-loop gate — the fix-stage fixers, then the read-only " +
      "check-stage jobs (no build, no tests) — and return the result envelope. The " +
      "quick check to run while iterating, before the full discern_finish. NOTE: the " +
      "fixers MUTATE the working tree (e.g. a formatter rewrites files).",
    run: (root) => prepareResult(root),
  },
  {
    name: "discern_test",
    title: "Run the tests",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Run the project's test capability on its own (the `test` stage, outside the " +
      "full gate) and return the result envelope. When no test command is configured " +
      "it is a trivial pass carrying a hint that says so.",
    run: (root) => testResult(root),
  },
  {
    name: "discern_ratchets",
    title: "Check the ratchets",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: MUTATING,
    description:
      "Check every configured quality ratchet (a never-loosen metric floor/ceiling): " +
      "run each ratchet's measurement command, compare it to its limit, and assert " +
      "the limit was not loosened versus main. Returns the per-ratchet steps[]. SLOW " +
      "and ON DEMAND — it runs the metric commands, so it is NOT part of " +
      "discern_finish; check it explicitly before pushing. Set dry_run to preview " +
      "which ratchets would run without measuring anything.",
    feature: "ratchets",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the ratchets that would run and measure nothing (default false).",
      ),
    },
    run: (root, args) =>
      ratchetsResult(root, { dryRun: args.dry_run === true }),
  },
  {
    name: "discern_doctor",
    title: "Check the install",
    outputSchema: DoctorOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared capability commands " +
      "resolve on PATH, and advisories. data.checks lists every check with its detail " +
      "and — on failure — the exact fix.",
    run: (root) => doctorResult(root),
  },
  {
    name: "discern_changed_scopes",
    title: "List changed scopes",
    outputSchema: ChangedScopesOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "List which project scopes the current branch and working tree changed — the " +
      "classification that decides which scope gates the quality gate fires.",
    run: (root) => changedScopesResult(root),
  },
  {
    name: "discern_status",
    title: "Project status",
    outputSchema: StatusOutputSchema.shape,
    annotations: READ_ONLY,
    description:
      "Report what is true right now and what to do next — pure observation, never " +
      "runs the gate, tests, ratchets, or touches anything. Call it at the start of a " +
      'session to orient. data.location is "worktree" or "main"; data.git carries ' +
      "branch/clean/changed-files and ahead/behind the integration branch; data.gate " +
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
    },
    run: (root, args) =>
      statusResult(root, {
        all: args.all === true,
        local: args.local === true,
      }),
  },
  {
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
    },
    run: (root, args) =>
      auditResult(root, {
        category: typeof args.category === "string" ? args.category : undefined,
        minScore: typeof args.min_score === "number"
          ? args.min_score
          : undefined,
      }),
  },
  {
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
    },
    run: (root, args) =>
      docsResult(root, {
        target: typeof args.target === "string" ? args.target : undefined,
      }),
  },
  {
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
        target: typeof args.target === "string" ? args.target : undefined,
      }),
  },
  {
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
      "Requires the latest main is already integrated and the main checkout is clean " +
      '— refuses (error:"precondition_failed") otherwise, pointing at discern_integrate ' +
      "to integrate first. Set dry_run to preview the plan without touching anything. " +
      "Operates only on the worktree the server runs in; it cannot reach another.",
    feature: "worktrees",
    requiresLocation: "worktree",
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
    },
    run: (root, args) =>
      graduateToolResult(root, {
        dryRun: args.dry_run === true,
        to: args.to as GraduateTarget | undefined,
      }),
  },
  {
    name: "discern_integrate",
    title: "Integrate main",
    outputSchema: DatalessEnvelopeSchema.shape,
    annotations: INTEGRATE,
    description:
      "Bring the latest main into THIS worktree's branch and re-materialize the " +
      "generated agent files + skills, in one deterministic step — the inverse of " +
      "discern_graduate, and the action that resolves discern_finish's merge check " +
      "(which refuses a branch behind main). Run it whenever the branch is behind. " +
      "Just call it: you do NOT need to run git to check first — it performs every " +
      "precondition itself and returns exactly what to do next. It is idempotent and " +
      "safe to call anytime: a no-op success when the branch already contains main " +
      "(reported, nothing merged, no refresh); it merges into a clean tree only, so " +
      'it refuses (error:"precondition_failed") on uncommitted changes; and on a merge ' +
      "conflict it aborts cleanly (leaving the tree untouched) and refuses, naming the " +
      "conflicted files and the manual path to resolve them. Set dry_run to preview the " +
      "plan without touching anything. Never touches the main checkout; operates only " +
      "on the worktree the server runs in.",
    feature: "worktrees",
    requiresLocation: "worktree",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the integration plan and touch nothing (default false).",
      ),
    },
    run: (root, args) =>
      integrateToolResult(root, { dryRun: args.dry_run === true }),
  },
  {
    name: "discern_start",
    title: "Start a worktree",
    outputSchema: StartOutputSchema.shape,
    annotations: MUTATING,
    description:
      "Create a fresh ISOLATED worktree from the main checkout — your own line of " +
      "work — on its own branch, set it up, and return where it landed. Use this when " +
      "you are on the trunk (the main checkout) and about to start work: it is the " +
      "first-class way to get your own workspace, so you NEVER adopt an existing idle " +
      "worktree (each belongs to another agent's line of work; a clean working tree " +
      "doesn't mean it's free). CRITICAL: this server is rooted in one checkout and " +
      "CANNOT relocate your session — it returns the new worktree's absolute path in " +
      "data.path, and you MUST re-root yourself: start a session rooted there (or cd " +
      "into it) and continue from inside it, never back in the main checkout. Each " +
      "call mints a NEW worktree (not idempotent) — call it once per line of work. " +
      "If you are already inside a worktree, do NOT call this (you'd create a " +
      'pointless sibling): it is hidden there, and refuses (error:"precondition_failed") ' +
      "if invoked anyway. Set dry_run to preview the plan without creating anything.",
    feature: "worktrees",
    requiresLocation: "main",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the start plan and touch nothing (default false).",
      ),
    },
    run: (root, args) =>
      startToolResult(root, { dryRun: args.dry_run === true }),
  },
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
 * dispatcher. Unexpected errors propagate to {@link runTool}'s catch-all.
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
    return await startResult(ctx, {
      dryRun: opts.dryRun ?? false,
      worktreeRoot: resolveWorktreeRoot(ctx.root, ctx.config),
    });
  } catch (e) {
    const mapped = worktreeErrorResult("start", e);
    if (mapped !== undefined) {
      return mapped;
    }
    throw e;
  }
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
 * Run one tool call and render its DiscernResult. Every refusal is rendered as a
 * normal (error) {@link DiscernResult} — a missing project, or an unexpected throw
 * from the verb (caught here so a single tool error can never take the whole stdio
 * server down). A disabled feature is handled earlier, by simply not registering
 * its tool — so it is absent from `tools/list` and the SDK rejects a call to it.
 */
async function runTool(
  tool: McpTool,
  root: string | undefined,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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
 * Resolve which features this project has enabled — the gate for the feature-bound
 * tools (`discern_docs`, `discern_graduate`). Mirrors the CLI's resolution: outside
 * a project, or when the config can't be parsed, report every feature on (the
 * per-call config read surfaces the real error), so the tool surface never silently
 * shrinks because of a config the user is mid-edit on.
 */
async function resolveEnabledFeatures(
  root: string | undefined,
): Promise<ReadonlySet<Feature>> {
  if (root === undefined) {
    return new Set(FEATURES);
  }
  try {
    return new Set(enabledFeatures(await loadConfig(root)));
  } catch {
    return new Set(FEATURES);
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
  index: () => Promise<DiscernResult>,
  single: (target: string) => Promise<DiscernResult>,
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
      const data = result.data as DocsData | undefined;
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
 * do. Every read recomputes from the verb core.
 */
function registerResources(
  server: McpServer,
  root: string,
  enabled: ReadonlySet<Feature>,
): void {
  server.registerResource(
    "discern-status",
    "discern://status",
    {
      description:
        "A live discern_status snapshot: the git situation, what the gate would fire, the features and ratchets, and (from the main checkout) the worktree fleet.",
      mimeType: JSON_MIME,
    },
    async (uri: URL) =>
      resourceText(uri, JSON_MIME, asJson((await statusResult(root)).data)),
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
        asJson((await changedScopesResult(root)).data),
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
      resourceText(uri, JSON_MIME, asJson(await loadConfig(root))),
  );

  // help — discern's OWN documentation, always available (the pre-setup surface).
  registerDocTree(
    server,
    "help",
    "discern's own documentation",
    () => helpResult(root),
    (target) => helpResult(root, { target }),
  );

  // docs — the project's documentation, gated on the `docs` feature and (per read)
  // on bootstrap, mirroring the discern_docs tool.
  if (enabled.has("docs")) {
    registerDocTree(
      server,
      "docs",
      "the project's documentation",
      async () => {
        await assertResourceBootstrapped(root);
        return docsResult(root);
      },
      async (target) => {
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
 * Location-aware too, matching which tools are registered here: a main-rooted server
 * shows the discern_start line (and not graduate/integrate); a worktree-rooted one
 * shows the integrate/graduate lines (and not start).
 */
function buildInstructions(
  enabled: ReadonlySet<Feature>,
  location: Location,
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
    if (location === "main") {
      lines.push(
        "- On the trunk (the main checkout) and about to work? Run discern_start to " +
          "create your own isolated worktree and move into it: it returns the new " +
          "worktree's path, and you re-root there (start a session / cd in) and " +
          "continue from inside it — the server can't relocate your session for you. " +
          "NEVER adopt an existing idle worktree; each is another line of work, and a " +
          "clean working tree doesn't mean it's free.",
      );
    } else {
      lines.push(
        "- When the branch is behind main (the gate's merge check points here), bring " +
          "main in with discern_integrate: it merges main into this worktree's branch " +
          "and re-materializes the agent files + skills in one step. Just call it — you " +
          "don't need to run git to check first. It is idempotent (a no-op when already " +
          "up to date), never touches the main checkout, and performs every precondition " +
          "itself, refusing cleanly with the exact next step (e.g. a dirty tree or a " +
          "merge conflict). Reproducing its steps by hand is slower and usually " +
          "unnecessary.",
      );
      lines.push(
        "- When a branch is finished and integrated — or the user signals a handoff " +
          '("graduate this", "I\'ll take it from here", "move this back to main") — ' +
          "graduate it with discern_graduate. Commit the work with a real message " +
          "first, then just call the tool (the single deterministic implementation — " +
          "don't reproduce its git steps, and don't pre-flight preconditions with git: " +
          "it refuses cleanly with the exact next step, e.g. run discern_integrate " +
          "first) and relay its structured result. Pass " +
          'to:"trunk" to fast-forward the trunk and delete the branch, to:"branch" to ' +
          "leave it checked out for review, or omit it to use the project default.",
      );
    }
  }
  return lines.join("\n");
}

/**
 * Run the MCP server over stdio via the official SDK. The project root and its
 * enabled features are resolved once at startup; every enabled tool is registered
 * (feature-disabled tools are omitted, the MCP mirror of the CLI listing only the
 * active verbs), and each operates on that root. `connect` starts the transport;
 * the server then runs until stdin closes (the transport's `onclose`), at which
 * point this resolves and the process exits.
 */
export async function runMcpServer(): Promise<number> {
  const root = await findRoot();
  const enabled = await resolveEnabledFeatures(root);
  // Location gate (resolved once, like the feature set): the server's tool list is
  // tailored to where it is rooted. A worktree-rooted server hides the main-only tool
  // (discern_start — don't spawn a sibling from inside a worktree); a main-rooted one
  // hides the worktree-only tools (discern_graduate/discern_integrate — nothing to
  // graduate/integrate on the trunk). Each tool's `requiresLocation` mirrors its own
  // precondition, and the instructions drop the lines that don't apply here.
  const serverLocation: Location =
    root !== undefined && (await worktreeGitKey(root)) !== undefined
      ? "worktree"
      : "main";
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildInstructions(enabled, serverLocation) },
  );

  for (const tool of TOOLS) {
    if (tool.feature !== undefined && !enabled.has(tool.feature)) {
      continue;
    }
    if (
      tool.requiresLocation !== undefined &&
      tool.requiresLocation !== serverLocation
    ) {
      continue;
    }
    // The shared config: description plus the honest metadata (title, the per-verb
    // outputSchema the SDK validates structuredContent against, and the behavioural
    // annotations). Built with conditional keys so an absent field is omitted rather
    // than set to `undefined` (exactOptionalPropertyTypes).
    const config = {
      description: tool.description,
      ...(tool.title !== undefined ? { title: tool.title } : {}),
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
        (args: Record<string, unknown>) => runTool(tool, root, args),
      );
    } else {
      // An argument-less verb registers no input schema, so the SDK skips
      // argument validation — the call is accepted whether or not the client
      // sends an (empty) `arguments` object. Its callback receives only the
      // request `extra`, so there are no arguments to forward.
      server.registerTool(
        tool.name,
        config,
        () => runTool(tool, root, {}),
      );
    }
  }

  // Resources — readable context paired with the tools (ADR 0041). Registered only
  // inside a project (root resolved at startup); each read recomputes fresh.
  if (root !== undefined) {
    registerResources(server, root, enabled);
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
