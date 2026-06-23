/**
 * Engine coverage for `discern mcp` — the MCP stdio server (ADR 0028's third
 * rendering of the result spine). Drives the real JSON-RPC handshake over a
 * spawned process's stdin/stdout: initialize → tools/list → tools/call, asserting
 * each verb's tool returns its DiscernResult as the tool's structuredContent.
 */

import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  DENO_JSON,
  engineEnv,
  gitInit,
  MAIN_TS,
  scaffoldEngine,
} from "./engine_helpers.ts";

const ENCODER = new TextEncoder();

/** A live MCP server process with line-framed JSON-RPC send/recv over stdio. */
class McpClient {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";

  constructor(private child: Deno.ChildProcess) {
    this.writer = child.stdin.getWriter();
    this.reader = child.stdout.getReader();
  }

  /** Send one JSON-RPC message as a single newline-terminated line. */
  async send(msg: Record<string, unknown>): Promise<void> {
    await this.writer.write(ENCODER.encode(`${JSON.stringify(msg)}\n`));
  }

  /** Send raw bytes (e.g. a final message WITHOUT a trailing newline). */
  async sendRaw(text: string): Promise<void> {
    await this.writer.write(ENCODER.encode(text));
  }

  /** Read the next non-empty JSON line from the server. */
  // deno-lint-ignore no-explicit-any
  async recv(): Promise<any> {
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line !== "") {
          return JSON.parse(line);
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
    await this.writer.close();
  }

  /** Await a clean exit and release the stdout reader. */
  async finish(): Promise<number> {
    const status = await this.child.status;
    await this.reader.cancel();
    return status.code;
  }

  /** Close stdin and await a clean exit (the common end-of-test path). */
  async close(): Promise<number> {
    await this.closeStdin();
    return await this.finish();
  }
}

async function spawnMcp(dir: string): Promise<McpClient> {
  const child = new Deno.Command("deno", {
    args: ["run", "--no-check", "--config", DENO_JSON, "-A", MAIN_TS, "mcp"],
    cwd: dir,
    env: await engineEnv(),
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  return new McpClient(child);
}

Deno.test("discern mcp: initialize, tools/list, and tools/call render DiscernResults", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);

    // initialize → server identifies itself and echoes the protocol version.
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    const init = await mcp.recv();
    assertEquals(init.id, 1);
    assertEquals(init.result.serverInfo.name, "discern");
    assertEquals(init.result.protocolVersion, "2025-06-18");
    assert(init.result.capabilities.tools, "should advertise tools capability");

    // initialized notification (no id) → no response is expected.
    await mcp.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    // tools/list → the exposed tool set.
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    assertEquals(list.id, 2);
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(names.includes("discern_finish"), JSON.stringify(names));
    assert(names.includes("discern_changed_scopes"), JSON.stringify(names));
    assert(names.includes("discern_audit"), JSON.stringify(names));

    // tools/call discern_finish {dry_run:true} → the preview DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_finish", arguments: { dry_run: true } },
    });
    const call = await mcp.recv();
    assertEquals(call.id, 3);
    assertEquals(call.result.isError, false);
    const finish = call.result.structuredContent;
    assertEquals(finish.ok, true);
    assertEquals(finish.verb, "finish");
    assertEquals(finish.dry_run, true); // the uniform preview signal, over MCP too
    assertEquals(finish.plan.title, "Gate plan"); // a preview carries the plan
    // The text content mirrors the structured content (same serialized object).
    assert(call.result.content[0].text.includes('"verb": "finish"'));

    // tools/call discern_changed_scopes → its DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_changed_scopes" },
    });
    const cs = await mcp.recv();
    assertEquals(cs.result.structuredContent.verb, "changed-scopes");
    assert(Array.isArray(cs.result.structuredContent.data.scopes));

    // tools/call discern_audit → the scored best-practices DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "discern_audit", arguments: {} },
    });
    const audit = await mcp.recv();
    assertEquals(audit.id, 6);
    assertEquals(audit.result.structuredContent.verb, "audit");
    assertEquals(typeof audit.result.structuredContent.data.score, "number");
    assert(
      Array.isArray(audit.result.structuredContent.data.categories),
      "audit data carries the scored categories",
    );

    // an unknown tool is a JSON-RPC error.
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope" },
    });
    const err = await mcp.recv();
    assertEquals(err.id, 5);
    assert(err.error, "unknown tool should be a JSON-RPC error");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a final message without a trailing newline is still answered (not dropped)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    // Send initialize WITH a newline, then a second request with NO trailing newline,
    // then close stdin. The loop must drain the final un-terminated line on EOF.
    await mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assertEquals((await mcp.recv()).id, 1);
    // A final request with NO trailing newline, then close stdin: the server must
    // drain the un-terminated line on EOF and answer it (it'd be dropped pre-fix).
    await mcp.sendRaw(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    await mcp.closeStdin();
    const list = await mcp.recv();
    assertEquals(list.id, 2);
    assert(Array.isArray(list.result.tools));
    assertEquals(await mcp.finish(), 0);
  });
});

Deno.test("discern mcp: protocol version, ping, and unknown method are handled correctly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);

    // An UNSUPPORTED protocol version → the server answers with its own default,
    // not a false agreement on a revision it doesn't speak.
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    assertEquals((await mcp.recv()).result.protocolVersion, "2025-06-18");

    // ping → empty result.
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    const pong = await mcp.recv();
    assertEquals(pong.id, 2);
    assertEquals(pong.result, {});

    // An unknown method → a JSON-RPC method-not-found error (-32601).
    await mcp.send({ jsonrpc: "2.0", id: 3, method: "no/such/method" });
    const err = await mcp.recv();
    assertEquals(err.id, 3);
    assertEquals(err.error.code, -32601);

    assertEquals(await mcp.close(), 0);
  });
});
