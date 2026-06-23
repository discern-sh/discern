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
import { finishResult } from "../gate/finish.ts";
import { changedScopesResult } from "../scopes/changed.ts";

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
    name: "discern_changed_scopes",
    description:
      "List which project scopes the current branch and working tree changed — the " +
      "classification that decides which scope gates the quality gate fires.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: (root) => changedScopesResult(root),
  },
];

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

/** Handle `tools/call`: dispatch to the named tool and render its DiscernResult. */
async function handleToolCall(
  id: string | number,
  params: Record<string, unknown>,
  root: string | undefined,
): Promise<void> {
  const name = typeof params.name === "string" ? params.name : "";
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) {
    replyError(id, -32602, `unknown tool: ${name}`);
    return;
  }
  if (root === undefined) {
    // Render the "no project" condition as a normal (error) DiscernResult, so a
    // client reads it from the same envelope as any other failure.
    const result: DiscernResult = {
      ok: false,
      verb: name.replace(/^discern_/, "").replace(/_/g, "-"),
      error: "not_initialized",
      message:
        "not inside a discern project (no discern.toml in this directory or any parent).",
    };
    renderResult(id, result);
    return;
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const result = await tool.run(root, args);
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
      const protocolVersion =
        typeof requested === "string" &&
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
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      return;
    case "tools/call":
      await handleToolCall(id, msg.params ?? {}, root);
      return;
    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
}

/**
 * Run the MCP server: read newline-delimited JSON-RPC from stdin, dispatch each
 * message, and write responses to stdout until stdin closes. The project root is
 * resolved once at startup; tools operate on it.
 */
export async function runMcpServer(): Promise<number> {
  const root = await findRoot();
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
    await dispatch(msg, root);
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
