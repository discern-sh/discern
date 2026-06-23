/**
 * Engine coverage for `discern mcp` — the MCP stdio server (ADR 0028's third
 * rendering of the result spine). Drives the real JSON-RPC handshake over a
 * spawned process's stdin/stdout: initialize → tools/list → tools/call, asserting
 * each verb's tool returns its DiscernResult as the tool's structuredContent.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  DENO_JSON,
  engineEnv,
  gitInit,
  MAIN_TS,
  runAgent,
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
    assert(names.includes("discern_prepare"), JSON.stringify(names));
    assert(names.includes("discern_test"), JSON.stringify(names));
    assert(names.includes("discern_doctor"), JSON.stringify(names));
    assert(names.includes("discern_changed_scopes"), JSON.stringify(names));
    assert(names.includes("discern_status"), JSON.stringify(names));
    assert(names.includes("discern_audit"), JSON.stringify(names));
    // The feature-gated tools are listed too (the default scaffold has every
    // feature on).
    assert(names.includes("discern_docs"), JSON.stringify(names));
    assert(names.includes("discern_graduate"), JSON.stringify(names));

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

    // tools/call discern_status → the situation/orientation DiscernResult. The
    // server launched in the main checkout (no worktrees) → a local view.
    await mcp.send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "discern_status" },
    });
    const status = await mcp.recv();
    assertEquals(status.id, 10);
    assertEquals(status.result.isError, false);
    assertEquals(status.result.structuredContent.verb, "status");
    assertEquals(status.result.structuredContent.data.location, "main");
    assert(
      status.result.structuredContent.data.features,
      "status data carries the feature toggles",
    );

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

    // tools/call discern_doctor → the install-verification DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "discern_doctor" },
    });
    const doctor = await mcp.recv();
    assertEquals(doctor.id, 7);
    assertEquals(doctor.result.structuredContent.verb, "doctor");
    assert(
      Array.isArray(doctor.result.structuredContent.data.checks),
      "doctor data carries the per-check list",
    );
    assertEquals(
      typeof doctor.result.structuredContent.data.kit_version,
      "string",
    );

    // tools/call discern_prepare → the fast inner loop. No capability is wired in
    // the scaffold, so each stage is the `:` no-op and prepare passes.
    await mcp.send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "discern_prepare" },
    });
    const prep = await mcp.recv();
    assertEquals(prep.id, 8);
    assertEquals(prep.result.isError, false);
    assertEquals(prep.result.structuredContent.verb, "prepare");
    assertEquals(prep.result.structuredContent.ok, true);

    // tools/call discern_test → the test capability. None is wired in the scaffold,
    // so it's a trivial pass carrying a "no test configured" hint.
    await mcp.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "discern_test" },
    });
    const test = await mcp.recv();
    assertEquals(test.id, 9);
    assertEquals(test.result.isError, false);
    assertEquals(test.result.structuredContent.verb, "test");
    assertEquals(test.result.structuredContent.ok, true);
    assert(
      Array.isArray(test.result.structuredContent.hints),
      "an unconfigured test carries a hint that nothing ran",
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

Deno.test("discern mcp: discern_docs returns the index, a single doc, and a not_found error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The scaffold ships no docs/ tree until bootstrap — seed a tiny one.
    await Deno.mkdir(join(dir, "docs", "00-orientation"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs", "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas of the project.\n",
    );
    const mcp = await spawnMcp(dir);
    await mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await mcp.recv();

    // No argument → the machine-readable index.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_docs" },
    });
    const index = await mcp.recv();
    assertEquals(index.result.isError, false);
    assertEquals(index.result.structuredContent.verb, "docs");
    assert(index.result.structuredContent.data.count >= 1);
    const entry = index.result.structuredContent.data.docs[0];
    assertEquals(typeof entry.slug, "string");
    assert(entry.slug.length > 0, JSON.stringify(entry));

    // A target → that one doc's full Markdown content.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_docs", arguments: { target: entry.slug } },
    });
    const doc = await mcp.recv();
    assertEquals(doc.result.isError, false);
    assert(
      doc.result.structuredContent.data.doc.content.includes(
        "The core ideas of the project",
      ),
      "the single-doc result carries the file's content",
    );

    // A missing target → a not_found error envelope (isError true).
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_docs", arguments: { target: "no-such-doc" } },
    });
    const miss = await mcp.recv();
    assertEquals(miss.result.isError, true);
    assertEquals(miss.result.structuredContent.error, "not_found");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_graduate previews from a worktree and refuses from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From the MAIN checkout: graduate refuses with a clean error envelope (not a
    // server crash) — the precondition throw, mapped to the same slug the CLI uses.
    const main = await spawnMcp(dir);
    await main.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    await main.recv();
    await main.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: { dry_run: true } },
    });
    const refused = await main.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(refused.result.structuredContent.verb, "graduate");
    assertEquals(
      refused.result.structuredContent.error,
      "precondition_failed",
    );
    assertEquals(await main.close(), 0);

    // From inside a WORKTREE (its branch already contains main): a dry-run returns
    // the graduation plan and touches nothing.
    const wt = await addWorktree(dir, "grad");
    const wtMcp = await spawnMcp(wt);
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    await wtMcp.recv();
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: { dry_run: true } },
    });
    const preview = await wtMcp.recv();
    assertEquals(preview.result.isError, false);
    assertEquals(preview.result.structuredContent.verb, "graduate");
    assertEquals(preview.result.structuredContent.dry_run, true);
    assert(
      preview.result.structuredContent.plan,
      "a graduate preview carries the plan",
    );
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("discern mcp: a disabled feature hides its tool and refuses the call", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Turn the worktrees feature off through the real config editor.
    const set = await runAgent(dir, [
      "config",
      "set",
      "features.worktrees",
      "false",
      "--bool",
    ]);
    assertEquals(set.code, 0, set.output);

    const mcp = await spawnMcp(dir);
    await mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await mcp.recv();

    // tools/list omits discern_graduate (worktrees off) but keeps the always-on
    // tools and the still-enabled docs tool.
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(!names.includes("discern_graduate"), JSON.stringify(names));
    assert(names.includes("discern_docs"), JSON.stringify(names));
    assert(names.includes("discern_finish"), JSON.stringify(names));

    // Calling the disabled tool anyway → a feature_disabled error envelope.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: { dry_run: true } },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(refused.result.structuredContent.error, "feature_disabled");

    assertEquals(await mcp.close(), 0);
  });
});
