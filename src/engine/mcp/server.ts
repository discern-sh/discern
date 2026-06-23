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
 * Transport: the MCP stdio convention — newline-delimited JSON-RPC 2.0 on
 * stdin/stdout. stdout carries ONLY protocol messages; every verb routes its human
 * narration to stderr (json semantics), so the channel stays clean. Hand-rolled
 * (no SDK dependency) to keep discern one self-contained binary.
 */

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
import { auditResult } from "../audit/audit.ts";
import { changedScopesResult } from "../scopes/changed.ts";
import { doctorResult } from "../../commands/doctor.ts";
import { docsResult } from "../../commands/docs.ts";
import {
  graduateResult,
  lifecycleContext,
  worktreeErrorResult,
} from "../worktree/lifecycle.ts";

/** The MCP protocol revisions this server speaks; the first is the default when a
 * client doesn't pin one, and any other requested revision is echoed only if known. */
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const SERVER_NAME = "discern";
const SERVER_VERSION = "1.0.0";

/** A JSON-RPC tool: its advertised schema plus the handler that runs the verb. */
interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** When set, the tool is listed and callable only if this feature is enabled —
   * the MCP mirror of the CLI's per-feature verb gating. */
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
      type: "object",
      properties: {
        dry_run: {
          type: "boolean",
          description:
            "Preview the gate plan and touch nothing (default false).",
        },
      },
      required: [],
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
    inputSchema: { type: "object", properties: {}, required: [] },
    run: (root) => prepareResult(root),
  },
  {
    name: "discern_doctor",
    description:
      "Verify the discern install and return each check as an actionable result: " +
      "config validity, schema currency, whether the declared capability commands " +
      "resolve on PATH, and advisories. data.checks lists every check with its detail " +
      "and — on failure — the exact fix.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: (root) => doctorResult(root),
  },
  {
    name: "discern_changed_scopes",
    description:
      "List which project scopes the current branch and working tree changed — the " +
      "classification that decides which scope gates the quality gate fires.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: (root) => changedScopesResult(root),
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
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Restrict to one area: gate, setup, guidance, docs, worktrees, ratchets, or skills.",
        },
        min_score: {
          type: "number",
          description:
            "Mark the result failed (isError) when the overall score is below this floor.",
        },
      },
      required: [],
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
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "A specific doc to fetch (slug, section/slug, or path). Omit for the index.",
        },
      },
      required: [],
    },
    run: (root, args) =>
      docsResult(root, {
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
      type: "object",
      properties: {
        dry_run: {
          type: "boolean",
          description:
            "Preview the graduation plan and touch nothing (default false).",
        },
      },
      required: [],
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
 * Unexpected errors propagate to {@link handleToolCall}'s catch-all.
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

/** A minimal JSON-RPC 2.0 request/notification as it arrives off the wire. */
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ENCODER = new TextEncoder();

/** Write one JSON-RPC message as a single newline-terminated line to stdout. */
function writeMessage(msg: Record<string, unknown>): void {
  const bytes = ENCODER.encode(`${JSON.stringify(msg)}\n`);
  let n = 0;
  while (n < bytes.length) {
    n += Deno.stdout.writeSync(bytes.subarray(n));
  }
}

/** A JSON-RPC success response for `id`. */
function reply(id: string | number, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

/** A JSON-RPC error response for `id`. */
function replyError(id: string | number, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

/** The verb slug behind a tool name (`discern_changed_scopes` → `changed-scopes`),
 * for the envelope every failure path renders. */
function verbOf(toolName: string): string {
  return toolName.replace(/^discern_/, "").replace(/_/g, "-");
}

/**
 * Handle `tools/call`: dispatch to the named tool and render its DiscernResult.
 * Every refusal is rendered as a normal (error) {@link DiscernResult}, so a client
 * reads it from the same envelope as any other failure — a disabled feature, a
 * missing project, or an unexpected throw from the verb (caught here so a single
 * tool error can never take the whole stdio server down).
 */
async function handleToolCall(
  id: string | number,
  params: Record<string, unknown>,
  root: string | undefined,
  enabled: ReadonlySet<Feature>,
): Promise<void> {
  const name = typeof params.name === "string" ? params.name : "";
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) {
    replyError(id, -32602, `unknown tool: ${name}`);
    return;
  }
  if (tool.feature !== undefined && !enabled.has(tool.feature)) {
    renderResult(id, {
      ok: false,
      verb: verbOf(name),
      error: "feature_disabled",
      message:
        `the "${tool.feature}" feature is disabled in this project (set [features].${tool.feature} = true in discern.toml to enable it).`,
    });
    return;
  }
  if (root === undefined) {
    renderResult(id, {
      ok: false,
      verb: verbOf(name),
      error: "not_initialized",
      message:
        "not inside a discern project (no discern.toml in this directory or any parent).",
    });
    return;
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  let result: DiscernResult;
  try {
    result = await tool.run(root, args);
  } catch (e) {
    result = {
      ok: false,
      verb: verbOf(name),
      error: "internal_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  renderResult(id, result);
}

/** Render a DiscernResult as an MCP tool result (text + structured, isError on !ok). */
function renderResult(id: string | number, result: DiscernResult): void {
  const serialized = serializeResult(result);
  reply(id, {
    content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
    structuredContent: serialized,
    isError: !result.ok,
  });
}

/** Dispatch one parsed message. Notifications (no id) get no response. */
async function dispatch(
  msg: JsonRpcMessage,
  root: string | undefined,
  enabled: ReadonlySet<Feature>,
): Promise<void> {
  const { method, id } = msg;
  // A notification carries no id and never gets a reply.
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized — nothing to do
  }
  switch (method) {
    case "initialize": {
      // Echo the client's protocol version only if we actually speak it; otherwise
      // answer with our default rather than agreeing to a revision we don't support.
      const requested = msg.params?.protocolVersion;
      const protocolVersion = typeof requested === "string" &&
          SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, {
        // List only the tools whose feature is enabled (or that gate on none) — the
        // MCP mirror of the CLI listing exactly the active verbs in `--help`.
        tools: TOOLS
          .filter((t) => t.feature === undefined || enabled.has(t.feature))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
      });
      return;
    case "tools/call":
      await handleToolCall(id, msg.params ?? {}, root, enabled);
      return;
    default:
      replyError(id, -32601, `method not found: ${method}`);
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

/**
 * Run the MCP server: read newline-delimited JSON-RPC from stdin, dispatch each
 * message, and write responses to stdout until stdin closes. The project root and
 * its enabled features are resolved once at startup; tools operate on the root and
 * the feature-bound ones are gated by the enabled set.
 */
export async function runMcpServer(): Promise<number> {
  const root = await findRoot();
  const enabled = await resolveEnabledFeatures(root);
  const decoder = new TextDecoder();
  let buffer = "";
  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed === "") {
      return;
    }
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return; // a malformed line has no id to address — drop it
    }
    await dispatch(msg, root, enabled);
  };
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      await handleLine(line);
    }
  }
  // Flush the decoder and dispatch any final message that arrived without a
  // trailing newline (a conformant client newline-terminates, but don't hang on one
  // that frames its last message otherwise).
  buffer += decoder.decode();
  await handleLine(buffer);
  return 0;
}
