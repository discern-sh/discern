/** A real stdio peer records notifications and sends explicit transport cancellation. */
import { z } from "@zod/zod";
import { engineEnv, engineRunArgs } from "./engine_helpers.ts";
import {
  type ProcessAllowance,
  settlePending,
  TEST_PROCESS_TIMEOUT_MS,
  waitForPendingCondition,
} from "./waiting.ts";
import { decodeWith } from "./decode_cli_result.ts";

const MessageSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
type Message = z.infer<typeof MessageSchema>;

/** The process resources owned by a real peer or its deterministic lifecycle test. */
interface McpPeerProcess {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly stderr: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
}

/** Probe only PIDs written by a disposable fixture's owned process tree. */
export function completionProcessAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/** Own the server, its input, and its output drain for the fixture's lifetime. */
export class CompletionMcpPeer implements AsyncDisposable {
  readonly messages: Message[] = [];
  stderr = "";
  readonly finished: Promise<Deno.CommandStatus>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly drained: Promise<void>;

  constructor(
    private readonly child: McpPeerProcess,
    private readonly waitForExit: typeof settlePending = settlePending,
    private readonly allowance?: ProcessAllowance,
  ) {
    this.writer = child.stdin.getWriter();
    this.finished = child.status;
    this.drained = Promise.all([this.drain(), this.drainErrors()]).then(
      () => {},
    );
  }

  private async drainErrors(): Promise<void> {
    for await (
      const text of this.child.stderr.pipeThrough(new TextDecoderStream())
    ) {
      this.stderr = (this.stderr + text).slice(-65_536);
    }
  }

  private async drain(): Promise<void> {
    let buffer = "";
    for await (
      const text of this.child.stdout.pipeThrough(new TextDecoderStream())
    ) {
      buffer += text;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) {
          this.messages.push(decodeWith(MessageSchema, line));
        }
      }
    }
  }

  async send(message: Record<string, unknown>): Promise<void> {
    await this.writer.write(
      new TextEncoder().encode(
        `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`,
      ),
    );
  }

  async response(id: number): Promise<Message> {
    await waitForPendingCondition(
      this.finished,
      () => this.messages.some((message) => message.id === id),
      `MCP response ${id}`,
      this.allowance !== undefined ? { allowance: this.allowance } : {},
    );
    const message = this.messages.find((message) => message.id === id);
    if (message === undefined) {
      throw new Error("The observed MCP response is unavailable.");
    }
    return message;
  }

  /** A living server does not prove that a particular tool call is still active. */
  ensurePending(id: number): void {
    const response = this.messages.find((message) => message.id === id);
    if (response !== undefined) {
      throw new Error(
        "MCP call settled before fixture readiness: " +
          JSON.stringify(response),
      );
    }
  }

  async call(
    id: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    await this.send({
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: { progressToken: `call-${id}` },
      },
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.writer.close();
    try {
      await this.waitForExit(
        this.finished,
        "MCP server shutdown and child settlement",
        this.allowance !== undefined
          ? { allowance: this.allowance }
          : { timeoutMs: TEST_PROCESS_TIMEOUT_MS },
      );
    } catch (error) {
      this.child.kill("SIGTERM");
      await this.finished;
      throw error;
    } finally {
      await this.drained;
    }
  }
}

/** Start the source engine and complete the public protocol handshake. */
export async function completionMcpPeer(
  root: string,
  extraEnv: Record<string, string> = {},
  allowance?: ProcessAllowance,
): Promise<CompletionMcpPeer> {
  const peer = new CompletionMcpPeer(
    new Deno.Command(Deno.execPath(), {
      args: engineRunArgs(["mcp"]),
      cwd: root,
      env: await engineEnv(extraEnv),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn(),
    settlePending,
    allowance,
  );
  try {
    await peer.send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "completion-journey", version: "1" },
      },
    });
    await peer.response(1);
    await peer.send({ method: "notifications/initialized" });
    return peer;
  } catch (error) {
    await peer[Symbol.asyncDispose]();
    throw new Error(`MCP initialization failed: ${peer.stderr}`, {
      cause: error,
    });
  }
}
