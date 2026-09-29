/** Typed JSON-RPC transport and lifecycle ownership for live MCP tests. */

import { z } from "@zod/zod";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import {
  AcceptOutputSchema,
  AwaitOutputSchema,
  CheckpointsOutputSchema,
  CouplingOutputSchema,
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
  StandardsProposeOutputSchema,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  UpdateOutputSchema,
} from "../src/shared/result_schemas.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { engineEnv, engineRunArgs } from "./engine_helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS, waitUntil } from "./waiting.ts";

const ENCODER = new TextEncoder();

const MCP_STRUCTURED_CONTENT_SCHEMA = z.union([
  AcceptOutputSchema,
  AwaitOutputSchema,
  CheckpointsOutputSchema,
  CouplingOutputSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  MapOutputSchema,
  PatternsOutputSchema,
  ProgressOutputSchema,
  PrepareOutputSchema,
  RefreshOutputSchema,
  StandardsOutputSchema,
  StandardsProposeOutputSchema,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  UpdateOutputSchema,
]);

const MCP_JSON_SCHEMA_SCHEMA = z.object({
  type: z.string().optional(),
  properties: z.record(z.string(), z.json()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
}).passthrough();

const MCP_TOOL_SCHEMA = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string(),
  outputSchema: MCP_JSON_SCHEMA_SCHEMA.optional(),
  inputSchema: MCP_JSON_SCHEMA_SCHEMA.optional(),
  annotations: z.object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough();

export type ListedTool = z.output<typeof MCP_TOOL_SCHEMA>;

const MCP_RESOURCE_SCHEMA = z.object({
  uri: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
}).passthrough();

const MCP_RESOURCE_TEMPLATE_SCHEMA = z.object({
  uriTemplate: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
}).passthrough();

const MCP_RESOURCE_CONTENT_SCHEMA = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
}).passthrough().refine(
  (content) => content.text !== undefined || content.blob !== undefined,
  "resource content must carry text or blob",
);

const MCP_TEXT_CONTENT_SCHEMA = z.object({
  type: z.literal("text"),
  text: z.string(),
}).passthrough();

export const MCP_TOOL_CONTENT_SCHEMA = z.tuple([MCP_TEXT_CONTENT_SCHEMA]).rest(
  MCP_TEXT_CONTENT_SCHEMA,
);

export const MCP_RESULT_SCHEMA = z.object({
  protocolVersion: z.string().optional(),
  capabilities: z.object({
    tools: z.object({
      listChanged: z.boolean().optional(),
    }).passthrough().optional(),
    resources: z.object({
      subscribe: z.boolean().optional(),
      listChanged: z.boolean().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  serverInfo: z.object({
    name: z.string(),
    version: z.string(),
  }).passthrough().optional(),
  instructions: z.string().optional(),
  tools: z.array(MCP_TOOL_SCHEMA).optional(),
  resources: z.array(MCP_RESOURCE_SCHEMA).optional(),
  resourceTemplates: z.array(MCP_RESOURCE_TEMPLATE_SCHEMA).optional(),
  contents: z.array(MCP_RESOURCE_CONTENT_SCHEMA).optional(),
  isError: z.boolean().optional(),
  structuredContent: MCP_STRUCTURED_CONTENT_SCHEMA.optional(),
  content: z.array(MCP_TEXT_CONTENT_SCHEMA).optional(),
}).passthrough();

export const MCP_TEXT_RESOURCE_RESULT_SCHEMA = MCP_RESULT_SCHEMA.extend({
  contents: z.tuple([MCP_RESOURCE_CONTENT_SCHEMA.required({ text: true })])
    .rest(MCP_RESOURCE_CONTENT_SCHEMA),
});

const JSON_RPC_RESPONSE_SCHEMA = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: MCP_RESULT_SCHEMA.optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).passthrough().optional(),
}).passthrough().refine(
  (message) => message.result !== undefined || message.error !== undefined,
  "a JSON-RPC response must carry result or error",
);

export type JsonRpcResponse = z.output<typeof JSON_RPC_RESPONSE_SCHEMA>;
export type JsonRpcResult<T> =
  & Pick<JsonRpcResponse, "jsonrpc" | "id" | "error">
  & {
    readonly result: T;
  };

export interface McpToolResult<T> {
  readonly isError?: boolean | undefined;
  readonly structuredContent: T;
  readonly content: z.output<typeof MCP_TOOL_CONTENT_SCHEMA>;
}

/** Resolve a positive MCP infrastructure allowance at the environment boundary. */
function mcpTimeoutMs(
  name: string,
  value: string | undefined = Deno.env.get(name),
): number {
  const raw = Number(value ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : TEST_PROCESS_TIMEOUT_MS;
}

/** Infrastructure allowance for successful initialized-server responses. */
export const MCP_RECV_TIMEOUT_MS: number = mcpTimeoutMs(
  DISCERN_ENVIRONMENT_VARIABLES.testMcpTimeoutMs,
);

/**
 * Infrastructure allowance for the first response. It includes cold Deno and
 * module startup. Initialized-server calls keep an equal allowance because
 * stdio exposes no later request-readiness transition; tests of a genuine
 * timeout pass their short behavioral deadline explicitly to `recv`.
 */
export const MCP_SERVER_READINESS_TIMEOUT_MS: number = mcpTimeoutMs(
  DISCERN_ENVIRONMENT_VARIABLES.testMcpReadinessTimeoutMs,
);

/** Cleanup bounds for a client whose test path did not reach the happy close. */
const MCP_STDIN_CLOSE_GRACE_MS = 1_000;
const MCP_PROCESS_EXIT_GRACE_MS = 5_000;

/** Race an MCP operation against a bounded timer and cancel the timer after either outcome. */
async function settledWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown }
    | undefined;
  void promise.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  try {
    await waitUntil(
      () => outcome !== undefined,
      "the MCP operation to settle",
      {
        timeoutMs,
      },
    );
  } catch {
    return undefined;
  }
  if (outcome?.ok === false) throw outcome.error;
  return outcome?.value;
}

/** A live MCP server process with line-framed JSON-RPC send/recv over stdio. */
export class McpClient {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private stdinClosed = false;
  private readerCancelled = false;
  private receivedResponse = false;
  private readonly statusPromise: Promise<Deno.CommandStatus>;
  private exitStatus: Deno.CommandStatus | undefined;

  constructor(
    private child: Pick<Deno.ChildProcess, "status" | "kill" | "pid"> & {
      readonly stdin: WritableStream<Uint8Array>;
      readonly stdout: ReadableStream<Uint8Array>;
    },
    private readonly waitForExit: (
      status: Promise<Deno.CommandStatus>,
      timeoutMs: number,
    ) => Promise<Deno.CommandStatus | undefined> = settledWithin,
  ) {
    this.writer = child.stdin.getWriter();
    this.reader = child.stdout.getReader();
    this.statusPromise = child.status.then((status) => {
      this.exitStatus = status;
      return status;
    });
  }

  /** Send one JSON-RPC message as a single newline-terminated line. */
  async send(msg: Record<string, unknown>): Promise<void> {
    await this.writer.write(ENCODER.encode(`${JSON.stringify(msg)}\n`));
  }

  /** Complete the standard handshake used by high-level server exercises. */
  async initialize(): Promise<void> {
    await this.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await this.recv();
  }

  /** Call one MCP tool and return its next protocol response. */
  async callTool<T>(
    id: number,
    name: string,
    schema: z.ZodType<T>,
    args: Readonly<Record<string, unknown>> = {},
  ): Promise<JsonRpcResult<McpToolResult<T>>> {
    await this.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return await this.recvTool(schema);
  }

  /** Require the result payload expected by a successful protocol exchange. */
  async recvResult<T>(schema: z.ZodType<T>): Promise<JsonRpcResult<T>> {
    const response = await this.recv();
    return { ...response, result: schema.parse(response.result) };
  }

  /** Validate a tool's structured result against its public output contract. */
  async recvTool<T>(
    schema: z.ZodType<T>,
  ): Promise<JsonRpcResult<McpToolResult<T>>> {
    return await this.recvResult(MCP_RESULT_SCHEMA.extend({
      structuredContent: schema,
      content: MCP_TOOL_CONTENT_SCHEMA,
    }));
  }

  /** Send one raw line, for protocol-robustness tests below the JSON encoder. */
  async sendRaw(line: string): Promise<void> {
    await this.writer.write(ENCODER.encode(line));
  }

  /** Read the next non-empty JSON line from the server. */
  async recv(timeoutMs?: number): Promise<JsonRpcResponse> {
    const deadlineMs = timeoutMs ??
      (this.receivedResponse
        ? MCP_RECV_TIMEOUT_MS
        : MCP_SERVER_READINESS_TIMEOUT_MS);
    let outcome:
      | { readonly ok: true; readonly value: JsonRpcResponse }
      | { readonly ok: false; readonly error: unknown }
      | undefined;
    void this.recvLine().then(
      (value) => {
        outcome = { ok: true, value };
      },
      (error: unknown) => {
        outcome = { ok: false, error };
      },
    );
    try {
      await waitUntil(() => outcome !== undefined, "the MCP response", {
        timeoutMs: deadlineMs,
      });
      if (outcome?.ok === false) throw outcome.error;
      if (outcome === undefined) {
        throw new Error("MCP response settled without evidence");
      }
      this.receivedResponse = true;
      return outcome.value;
    } catch (error) {
      if (outcome === undefined) {
        // Reject only after the server and any in-flight gate tree are gone.
        await this.terminate();
        throw new Error(
          `timed out waiting for MCP response after ${deadlineMs}ms`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /** Read the next non-empty JSON line from the server, without a timeout wrapper. */
  private async recvLine(): Promise<JsonRpcResponse> {
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line !== "") {
          return decodeWith(JSON_RPC_RESPONSE_SCHEMA, line);
        }
        continue;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        throw new Error("server stdout closed before a full line");
      }
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  /** Close stdin — ends the server's read loop (and triggers its EOF drain). */
  async closeStdin(): Promise<void> {
    if (this.stdinClosed) {
      return;
    }
    this.stdinClosed = true;
    try {
      await this.writer.close();
    } finally {
      this.writer.releaseLock();
    }
  }

  private async cancelReader(): Promise<void> {
    if (this.readerCancelled) {
      return;
    }
    this.readerCancelled = true;
    try {
      await this.reader.cancel();
    } finally {
      this.reader.releaseLock();
    }
  }

  /** Await the process, escalating through TERM and KILL if EOF cannot stop it. */
  private async exitWithEscalation(): Promise<Deno.CommandStatus> {
    let status = this.exitStatus ??
      await this.waitForExit(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
    if (status !== undefined) {
      return status;
    }
    try {
      this.child.kill("SIGTERM");
    } catch {
      // It raced to exit.
    }
    status = this.exitStatus ??
      await this.waitForExit(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
    if (status !== undefined) {
      return status;
    }
    try {
      this.child.kill("SIGKILL");
    } catch {
      // It raced to exit.
    }
    status = this.exitStatus ??
      await this.waitForExit(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
    if (status === undefined) {
      throw new Error(
        `MCP server ${this.child.pid} did not exit after SIGKILL`,
      );
    }
    return status;
  }

  /** Idempotent cleanup for timeout and exceptional test paths. */
  private async terminate(): Promise<Deno.CommandStatus> {
    await settledWithin(
      this.closeStdin().catch(() => undefined),
      MCP_STDIN_CLOSE_GRACE_MS,
    );
    try {
      return await this.exitWithEscalation();
    } finally {
      await this.cancelReader().catch(() => undefined);
    }
  }

  /** Normal EOF waits for active tools to restore their environments before exit. */
  async finish(): Promise<number> {
    const status = this.exitStatus ??
      await this.waitForExit(this.statusPromise, MCP_RECV_TIMEOUT_MS);
    if (status === undefined) {
      await this.terminate();
      throw new Error(
        `MCP server ${this.child.pid} did not finish within ${MCP_RECV_TIMEOUT_MS}ms`,
      );
    }
    await this.cancelReader();
    return status.code;
  }

  /** Close stdin and await a clean exit (the common end-of-test path). */
  async close(): Promise<number> {
    await this.closeStdin();
    return await this.finish();
  }

  /** Every lexical MCP binding tears down even when an assertion throws. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.terminate().catch(() => undefined);
  }
}

/** Start a line-framed MCP server with the fixture engine environment and piped stdio. */
export async function spawnMcp(
  dir: string,
  extraEnv: Record<string, string> = {},
): Promise<McpClient> {
  const child = new Deno.Command("deno", {
    args: engineRunArgs(["mcp"]),
    cwd: dir,
    env: { ...await engineEnv(), ...extraEnv },
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  return new McpClient(child);
}

/** A complete, valid `initialize` params object — the handshake a conformant
 * client sends. The SDK validates `protocolVersion`/`capabilities`/`clientInfo`
 * and errors the request if any is missing, so tests that don't assert on the
 * negotiated version still send a full one rather than a bare `{}`. */
export function initParams(
  protocolVersion = "2025-11-25",
): Record<string, unknown> {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  };
}
