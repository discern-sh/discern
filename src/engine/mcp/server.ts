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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "process";
import { z } from "@zod/zod";
import { findRoot } from "../../shared/env.ts";
import { type DiscernResult, serializeResult } from "../../shared/result.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import {
  enabledFeatures,
  type Feature,
  FEATURES,
} from "../../shared/features.ts";
import { Logger } from "../../lib/log.ts";
import { finishResult } from "../gate/finish.ts";
import { prepareResult } from "../gate/prepare.ts";
import { testResult } from "../gate/test.ts";
import { auditResult } from "../audit/audit.ts";
import { changedScopesResult } from "../scopes/changed.ts";
import { statusResult } from "../status/status.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { docsResult, helpResult } from "../../commands/docs.ts";
import {
  graduateResult,
  lifecycleContext,
  worktreeErrorResult,
} from "../worktree/lifecycle.ts";

const SERVER_NAME = "discern";
const SERVER_VERSION = "1.0.0";

/** A tool: its advertised schema plus the handler that runs the verb. The SDK
 * converts {@link inputSchema} (a Zod raw shape, omitted when the verb takes no
 * arguments) to the JSON Schema it advertises in `tools/list`. */
interface McpTool {
  name: string;
  description: string;
  /** The verb's arguments as a Zod raw shape; absent for an argument-less verb. */
  inputSchema?: z.ZodRawShape;
  /** When set, the tool is registered (listed and callable) only if this feature is
   * enabled — the MCP mirror of the CLI's per-feature verb gating. */
  feature?: Feature;
  /** Run the verb in `root` with the call's arguments → the result to render. */
  run(root: string, args: Record<string, unknown>): Promise<DiscernResult>;
}

/** The exposed tool set — each a thin adapter over a verb's result-returning core. */
const TOOLS: McpTool[] = [
  {
    name: "discern_finish",
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
    description:
      "Run the fast inner-loop gate — the fix-stage fixers, then the read-only " +
      "check-stage jobs (no build, no tests) — and return the result envelope. The " +
      "quick check to run while iterating, before the full discern_finish. NOTE: the " +
      "fixers MUTATE the working tree (e.g. a formatter rewrites files).",
    run: (root) => prepareResult(root),
  },
  {
    name: "discern_test",
    description:
      "Run the project's test capability on its own (the `test` stage, outside the " +
      "full gate) and return the result envelope. When no test command is configured " +
      "it is a trivial pass carrying a hint that says so.",
    run: (root) => testResult(root),
  },
  {
    name: "discern_doctor",
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared capability commands " +
      "resolve on PATH, and advisories. data.checks lists every check with its detail " +
      "and — on failure — the exact fix.",
    run: (root) => doctorResult(root),
  },
  {
    name: "discern_changed_scopes",
    description:
      "List which project scopes the current branch and working tree changed — the " +
      "classification that decides which scope gates the quality gate fires.",
    run: (root) => changedScopesResult(root),
  },
  {
    name: "discern_status",
    description:
      "Report what is true right now and what to do next — pure observation, never " +
      "runs the gate, tests, ratchets, or touches anything. Call it at the start of a " +
      'session to orient. data.location is "worktree" or "main"; data.git carries ' +
      "branch/clean/changed-files and ahead/behind the integration branch; data.gate " +
      "lists what the gate WOULD fire (wired capabilities, checks, triggered scope " +
      "gates); data.worktree carries this worktree's id/port/db and provisioned " +
      "resources; data.features and data.ratchets list the configured set. From the " +
      "main checkout it leads with data.fleet (a cheap row per worktree: branch, " +
      "dirty/ahead/behind, and a last_activity timestamp); set all=true " +
      "to include the fleet from a worktree, or local=true to suppress it. hints[] are " +
      "advisory next-steps (e.g. run discern_finish, ready to graduate) — never an " +
      "unverified pass/fail.",
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
    description:
      "Audit the project against the best-practices checklist and return the scored, " +
      "weakest-first result. Each category lists deterministic rules (status, the finding, " +
      "the exact fix, and why it matters) plus subjective review items — questions the " +
      "agent should judge against the cited material (e.g. the guidance text) and act on. " +
      "Use it to surface concrete setup improvements; pass a category to focus one area.",
    inputSchema: {
      category: z.string().optional().describe(
        "Restrict to one area: gate, setup, guidance, docs, worktrees, ratchets, or skills.",
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
    description:
      "Graduate THIS worktree's branch into the main checkout for review: tear down " +
      "the worktree's resources, move the branch onto main, and leave the changes " +
      "staged there. Requires the latest main is already integrated and the main " +
      'checkout is clean — refuses (error:"precondition_failed") otherwise, pointing ' +
      "at discern_finish to integrate first. Set dry_run to preview the plan without " +
      "touching anything. Operates only on the worktree the server runs in; it cannot " +
      "reach another.",
    feature: "worktrees",
    inputSchema: {
      dry_run: z.boolean().optional().describe(
        "Preview the graduation plan and touch nothing (default false).",
      ),
    },
    run: (root, args) =>
      graduateToolResult(root, { dryRun: args.dry_run === true }),
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
  opts: { dryRun?: boolean },
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

/** The verb slug behind a tool name (`discern_changed_scopes` → `changed-scopes`),
 * for the envelope every failure path renders. */
function verbOf(toolName: string): string {
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
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    if (tool.feature !== undefined && !enabled.has(tool.feature)) {
      continue;
    }
    if (tool.inputSchema !== undefined) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (args: Record<string, unknown>) => runTool(tool, root, args),
      );
    } else {
      // An argument-less verb registers no input schema, so the SDK skips
      // argument validation — the call is accepted whether or not the client
      // sends an (empty) `arguments` object. Its callback receives only the
      // request `extra`, so there are no arguments to forward.
      server.registerTool(
        tool.name,
        { description: tool.description },
        () => runTool(tool, root, {}),
      );
    }
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
