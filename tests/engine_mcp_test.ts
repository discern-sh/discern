/**
 * Engine coverage for `discern mcp` — the MCP stdio server (ADR 0028's third
 * rendering of the result spine). Drives the real JSON-RPC handshake over a
 * spawned process's stdin/stdout: initialize → tools/list → tools/call, asserting
 * each verb's tool returns its DiscernResult as the tool's structuredContent.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import {
  CouplingOutputSchema,
  DatalessEnvelopeSchema,
  DoctorOutputSchema,
  IntegrateOutputSchema,
  RefreshOutputSchema,
  StatusOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  buildInstructions,
  mcpStartHint,
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  DENO_JSON,
  engineEnv,
  git,
  gitInit,
  MAIN_TS,
  runAgent,
  scaffoldEngine,
  writeConfig,
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

  /** Send one raw line, for protocol-robustness tests below the JSON encoder. */
  async sendRaw(line: string): Promise<void> {
    await this.writer.write(ENCODER.encode(line));
  }

  /** Read the next non-empty JSON line from the server. */
  // deno-lint-ignore no-explicit-any
  async recv(timeoutMs = 5000): Promise<any> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.recvLine(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `timed out waiting for MCP response after ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  /** Read the next non-empty JSON line from the server, without a timeout wrapper. */
  // deno-lint-ignore no-explicit-any
  private async recvLine(): Promise<any> {
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

async function commitWorktreeForGraduation(
  dir: string,
  message = "prepare graduation",
): Promise<void> {
  await git(dir, "add", "-A");
  await git(
    dir,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
    "--no-gpg-sign",
  );
}

/** A complete, valid `initialize` params object — the handshake a conformant
 * client sends. The SDK validates `protocolVersion`/`capabilities`/`clientInfo`
 * and errors the request if any is missing, so tests that don't assert on the
 * negotiated version still send a full one rather than a bare `{}`. */
function initParams(
  protocolVersion = "2025-11-25",
): Record<string, unknown> {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  };
}

Deno.test("mcp: EVERY tool's live call echoes its own verb", async () => {
  // The verb echo was pinned tool-by-tool (14 of 15). The SDK advertises each tool's
  // outputSchema as z.literal(verb), but a copy-paste tool whose CORE returns another
  // verb's result still renders that wrong verb. Call every tool through runTool (the
  // SDK's own per-call entry point) and assert the rendered structuredContent carries
  // THIS tool's verb. Even a refusal/preview echoes the verb, so no per-tool happy
  // fixture is needed; `dry_run` keeps every call fast and side-effect-free. Iterated
  // over TOOLS, so a new tool auto-enrols.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    for (const tool of TOOLS) {
      // A fresh WorkingRoot per tool so a lifecycle re-aim never drifts the next call.
      const result = await runTool(tool, new WorkingRoot(dir), {
        dry_run: true,
      });
      assertEquals(
        result.structuredContent.verb,
        verbOf(tool.name),
        `${tool.name}: its live result must echo verb "${
          verbOf(tool.name)
        }", not "${result.structuredContent.verb}"`,
      );
    }
  });
});

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
    assertEquals(init.result.serverInfo.version, KIT_VERSION);
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
    assert(names.includes("discern_refresh"), JSON.stringify(names));
    assert(names.includes("discern_prepare"), JSON.stringify(names));
    assert(names.includes("discern_test"), JSON.stringify(names));
    assert(names.includes("discern_doctor"), JSON.stringify(names));
    assert(names.includes("discern_scopes"), JSON.stringify(names));
    assert(names.includes("discern_status"), JSON.stringify(names));
    assert(names.includes("discern_improve"), JSON.stringify(names));
    // `discern_help` (discern's own docs) is always listed — not a project feature.
    assert(names.includes("discern_help"), JSON.stringify(names));
    // The feature-gated tools are listed too (the default scaffold has every
    // feature on).
    assert(names.includes("discern_docs"), JSON.stringify(names));
    // The worktree lifecycle tools are always listed now (ADR 0062 retired the
    // location-based hiding): start, graduate, and integrate all appear from a
    // main-rooted server (covered in depth by the listing test below).
    assert(names.includes("discern_start"), JSON.stringify(names));
    assert(names.includes("discern_graduate"), JSON.stringify(names));
    assert(names.includes("discern_integrate"), JSON.stringify(names));

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

    // tools/call discern_scopes → its DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_scopes", arguments: {} },
    });
    const cs = await mcp.recv();
    assertEquals(cs.result.structuredContent.verb, "scopes");
    assert(Array.isArray(cs.result.structuredContent.data.scopes));

    // tools/call discern_status → the situation/orientation DiscernResult. The
    // server launched in the main checkout (no worktrees) → a local view.
    await mcp.send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const status = await mcp.recv();
    assertEquals(status.id, 10);
    assertEquals(status.result.isError, false);
    assertEquals(status.result.structuredContent.verb, "status");
    assertEquals(status.result.structuredContent.data.location, "main");
    assert(
      Array.isArray(status.result.structuredContent.data.ratchets),
      "status data carries the configured ratchets",
    );

    // tools/call discern_improve → the continuous-improvement DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "discern_improve", arguments: {} },
    });
    const improve = await mcp.recv();
    assertEquals(improve.id, 6);
    assertEquals(improve.result.structuredContent.verb, "improve");
    assertEquals(typeof improve.result.structuredContent.data.score, "number");
    assert(
      Array.isArray(improve.result.structuredContent.data.categories),
      "improve data carries the scored categories",
    );
    assertEquals(
      typeof improve.result.structuredContent.data.next_action.action,
      "string",
    );

    // tools/call discern_doctor → the install-verification DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "discern_doctor", arguments: {} },
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
      params: { name: "discern_prepare", arguments: {} },
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
      params: { name: "discern_test", arguments: {} },
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

    // an unknown tool is reported as an error result (the SDK answers tools/call
    // for an unregistered name with an isError result, not a JSON-RPC error).
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nope" },
    });
    const err = await mcp.recv();
    assertEquals(err.id, 5);
    assertEquals(err.result.isError, true);
    assert(
      err.result.content[0].text.includes("not found"),
      JSON.stringify(err.result),
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: protocol version, ping, and unknown method are handled correctly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);

    // An UNSUPPORTED protocol version → the SDK answers with the latest revision
    // it speaks, rather than a false agreement on one it doesn't.
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams("1999-01-01"),
    });
    assertEquals((await mcp.recv()).result.protocolVersion, "2025-11-25");

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

Deno.test("discern mcp: an unexpected core throw becomes internal_error and the server answers the next call", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Corrupt the config after startup: the server keeps its registered tool surface,
    // but coupling's real core will throw while loading the project config.
    await Deno.writeTextFile(join(dir, "discern.toml"), "[project]\nslug =\n");
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_coupling", arguments: { file: "a.ts" } },
    });
    const failed = await mcp.recv();
    assertEquals(failed.result.isError, true, JSON.stringify(failed.result));
    assertEquals(failed.result.structuredContent.ok, false);
    assertEquals(failed.result.structuredContent.verb, "coupling");
    assertEquals(failed.result.structuredContent.error, "internal_error");

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_help", arguments: {} },
    });
    const next = await mcp.recv();
    assertEquals(next.result.isError, false, JSON.stringify(next.result));
    assertEquals(next.result.structuredContent.verb, "help");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a malformed JSON line does not prevent the next valid call", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.sendRaw("{ definitely not json\n");
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const first = await mcp.recv();
    const status = first.error?.code === -32700 ? await mcp.recv() : first;
    assertEquals(status.result.isError, false, JSON.stringify(status.result));
    assertEquals(status.result.structuredContent.verb, "status");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: wrong-typed arguments return a field-naming Zod validation error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_finish", arguments: { dry_run: "yes" } },
    });
    const rejected = await mcp.recv();
    const text = JSON.stringify(rejected);
    assertStringIncludes(text, "dry_run");
    assert(
      rejected.error !== undefined || rejected.result?.isError === true,
      text,
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const status = await mcp.recv();
    assertEquals(status.result.isError, false, JSON.stringify(status.result));

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_docs returns the index, a single doc, and a not_found error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The scaffold ships no docs/ tree until bootstrap — seed a tiny one.
    await Deno.mkdir(join(dir, "discern/docs", "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "discern/docs", "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas of the project.\n",
    );
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // No target → the machine-readable index.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_docs", arguments: {} },
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

Deno.test("discern mcp: discern_help returns discern's OWN docs, not the project's", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The host project has its own docs/ — discern_help must ignore it and serve
    // discern's bundled documentation (resolved module-relative to this repo).
    await Deno.mkdir(join(dir, "discern/docs"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/docs", "project-only.md"),
      "# Project Only\n\nNothing to do with discern.\n",
    );
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // No target → discern's own index (never the project's project-only.md).
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_help", arguments: {} },
    });
    const index = await mcp.recv();
    assertEquals(index.result.isError, false);
    assertEquals(index.result.structuredContent.verb, "help");
    assertEquals(index.result.structuredContent.data.docs_dir, undefined);
    const docs = index.result.structuredContent.data.docs;
    assert(
      docs.some((d: { slug: string }) => d.slug === "config-reference"),
      "discern_help serves discern's own docs (the config reference)",
    );
    assert(
      !docs.some((d: { slug: string }) => d.slug === "project-only"),
      "discern_help must not serve the host project's docs",
    );
    // The internal ADR/maintainer trees are never exposed over MCP.
    assert(
      docs.every((d: { path: string }) =>
        !d.path.includes("_adr") && !d.path.includes("_internal") &&
        !d.path.includes("_private")
      ),
      "discern_help excludes every internal subtree",
    );

    // A target → that one doc's full Markdown content.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "discern_help",
        arguments: { target: "config-reference" },
      },
    });
    const doc = await mcp.recv();
    assertEquals(doc.result.isError, false);
    assert(
      doc.result.structuredContent.data.doc.content.includes(
        "config reference",
      ),
      "the single-doc result carries the file's content",
    );

    // A near-miss target → a not_found error envelope with retryable suggestions.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_help", arguments: { target: "config" } },
    });
    const miss = await mcp.recv();
    assertEquals(miss.result.isError, true);
    assertEquals(miss.result.structuredContent.verb, "help");
    assertEquals(miss.result.structuredContent.error, "not_found");
    assertStringIncludes(miss.result.structuredContent.message, "Closest");
    assertEquals(
      miss.result.structuredContent.data.suggestions[0].slug,
      "config-reference",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: pre-setup gates docs but not the gate proof verbs or help", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // `discern_docs` still refuses with the structured not_set_up envelope — its
    // tree is empty until setup fills it.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_docs", arguments: {} },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(refused.result.structuredContent.error, "not_set_up");

    // `discern_finish` is a gate PROOF verb — un-gated during setup (ADR 0065) so
    // the agent can iterate while wiring capabilities — but it carries the
    // setup-in-progress hint so a green run can't be mistaken for "done".
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_finish", arguments: {} },
    });
    const finish = await mcp.recv();
    assertEquals(finish.result.structuredContent.verb, "finish");
    assert(finish.result.structuredContent.error !== "not_set_up");
    assert(
      (finish.result.structuredContent.hints ?? []).some((h: string) =>
        h.includes("Setup is not finished")
      ),
      "finish must carry the setup-in-progress hint pre-setup",
    );

    // `discern_help` stays open pre-setup — discern's own docs are what you need now.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_help", arguments: {} },
    });
    const help = await mcp.recv();
    assertEquals(help.result.isError, false);
    assertEquals(help.result.structuredContent.verb, "help");
    assert(help.result.structuredContent.data.count > 0);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_graduate previews a graduation from inside a worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From inside a WORKTREE (its branch already contains main): a dry-run returns
    // the graduation plan and touches nothing. (graduate is always listed now; it
    // still requires a worktree to act on — the listing test covers visibility.)
    const wt = await addWorktree(dir, "grad");
    const wtMcp = await spawnMcp(wt);
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
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

Deno.test("discern mcp: discern_integrate is an idempotent no-op from an up-to-date worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From inside a WORKTREE whose branch already contains main: a real (non-dry-run)
    // call is an idempotent no-op success — nothing merged, so nothing refreshed.
    // (integrate is always listed now; it still requires a worktree to act on, per
    // the listing test.)
    const wt = await addWorktree(dir, "intg");
    const wtMcp = await spawnMcp(wt);
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await wtMcp.recv();
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_integrate", arguments: {} },
    });
    const noop = await wtMcp.recv();
    assertEquals(noop.result.isError, false);
    assertEquals(noop.result.structuredContent.verb, "integrate");
    assert(
      (noop.result.structuredContent.steps as Array<{ outcome: string }>)
        .every((s) => s.outcome === "skipped"),
      `an up-to-date integrate reports only skipped steps: ${
        JSON.stringify(noop.result.structuredContent)
      }`,
    );
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_integrate returns schema-valid data for a real merge", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "intg-data");

    await Deno.writeTextFile(join(dir, "upstream.txt"), "landed\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const mcp = await spawnMcp(wt);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_integrate", arguments: {} },
    });
    const merged = await mcp.recv();
    assertEquals(merged.result.isError, false, JSON.stringify(merged.result));
    const payload = merged.result.structuredContent;
    const parsed = IntegrateOutputSchema.safeParse(payload);
    assert(
      parsed.success,
      `integrate MCP payload drifted from schema:\n${
        JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
      }\n${JSON.stringify(payload, null, 2)}`,
    );
    assertEquals(payload.verb, "integrate");
    assertEquals(payload.data.behind, 1);
    assertEquals(payload.data.files.map((f: { path: string }) => f.path), [
      "upstream.txt",
    ]);
    assert(typeof payload.data.range.after === "string");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_coupling covers diff, query, evidence, and invalid paired args", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const commit = async (
      files: Record<string, string>,
      msg: string,
    ): Promise<void> => {
      for (const [path, contents] of Object.entries(files)) {
        await Deno.writeTextFile(join(dir, path), contents);
      }
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", msg, "--no-gpg-sign");
    };

    for (let i = 0; i < 4; i++) {
      await commit({ "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    for (let i = 0; i < 5; i++) {
      await commit({ [`n${i}.ts`]: "1", [`m${i}.ts`]: "1" }, `noise${i}`);
    }
    await Deno.writeTextFile(join(dir, "a.ts"), "staged\n");

    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_coupling", arguments: {} },
    });
    const diff = await mcp.recv();
    assertEquals(diff.result.isError, false, JSON.stringify(diff.result));
    assert(
      CouplingOutputSchema.safeParse(diff.result.structuredContent).success,
    );
    assertEquals(diff.result.structuredContent.data.mode, "diff");
    assertEquals(diff.result.structuredContent.data.changed, ["a.ts"]);
    assert(
      diff.result.structuredContent.data.partners.some((
        p: { path: string },
      ) => p.path === "b.ts"),
      JSON.stringify(diff.result.structuredContent.data),
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_coupling", arguments: { file: "a.ts" } },
    });
    const query = await mcp.recv();
    assertEquals(query.result.isError, false, JSON.stringify(query.result));
    assert(
      CouplingOutputSchema.safeParse(query.result.structuredContent).success,
    );
    assertEquals(query.result.structuredContent.data.mode, "query");
    assertEquals(query.result.structuredContent.data.target, "a.ts");
    assert(
      query.result.structuredContent.data.partners.some((
        p: { path: string },
      ) => p.path === "b.ts"),
      JSON.stringify(query.result.structuredContent.data),
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "discern_coupling",
        arguments: { file: "a.ts", with: "b.ts" },
      },
    });
    const evidence = await mcp.recv();
    assertEquals(
      evidence.result.isError,
      false,
      JSON.stringify(evidence.result),
    );
    assert(
      CouplingOutputSchema.safeParse(evidence.result.structuredContent).success,
    );
    assertEquals(evidence.result.structuredContent.data.mode, "evidence");
    assertEquals(evidence.result.structuredContent.data.a, "a.ts");
    assertEquals(evidence.result.structuredContent.data.b, "b.ts");
    assertEquals(evidence.result.structuredContent.data.together, 4);
    assert(
      evidence.result.structuredContent.data.commits.some((
        c: { subject: string },
      ) => c.subject === "ab3"),
      JSON.stringify(evidence.result.structuredContent.data),
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "discern_coupling", arguments: { with: "b.ts" } },
    });
    const invalid = await mcp.recv();
    assertEquals(invalid.result.isError, true, JSON.stringify(invalid.result));
    assertEquals(
      invalid.result.structuredContent.error,
      "invalid_arguments",
    );
    assertStringIncludes(invalid.result.structuredContent.message, "with");
    assertStringIncludes(invalid.result.structuredContent.message, "file");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the lifecycle tools list + instructions from both roots (visibility is location-independent; refusals kept)", async () => {
  const LIFECYCLE = ["discern_start", "discern_integrate", "discern_graduate"];
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From the MAIN checkout: ALL three lifecycle tools are listed and named in the
    // instructions. ADR 0062 retired the location-based hiding — every lifecycle tool
    // is always registered, and discern_start re-aims the server's working root, so a
    // main-rooted session can drive the whole lifecycle through one connection.
    const main = await spawnMcp(dir);
    await main.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const init = await main.recv();
    const mainInstructions = init.result.instructions as string;
    for (const verb of LIFECYCLE) {
      assert(
        mainInstructions.includes(verb),
        `main instructions must name ${verb}: ${mainInstructions}`,
      );
    }
    await main.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await main.recv();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    for (const verb of LIFECYCLE) {
      assert(names.includes(verb), JSON.stringify(names));
    }

    // The defensive refusals are KEPT (ADR 0062): graduate is now callable from the
    // trunk, but its core still refuses — there is no worktree to graduate. Visible,
    // not silent — a clean precondition_failed, the safety boundary the cores own.
    await main.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: { dry_run: true } },
    });
    const gradFromMain = await main.recv();
    assertEquals(gradFromMain.result.isError, true);
    assertEquals(
      gradFromMain.result.structuredContent.error,
      "precondition_failed",
    );
    assertEquals(await main.close(), 0);

    // From inside a WORKTREE: the SAME three lifecycle tools are listed and named —
    // symmetric with main, not the absent ⇄ present flip of the old location gating.
    const wt = await addWorktree(dir, "alpha");
    const wtMcp = await spawnMcp(wt);
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const wtInit = await wtMcp.recv();
    const wtInstructions = wtInit.result.instructions as string;
    for (const verb of LIFECYCLE) {
      assert(
        wtInstructions.includes(verb),
        `worktree instructions must name ${verb}: ${wtInstructions}`,
      );
    }
    await wtMcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const wtList = await wtMcp.recv();
    const wtNames = wtList.result.tools.map((t: { name: string }) => t.name);
    for (const verb of LIFECYCLE) {
      assert(wtNames.includes(verb), JSON.stringify(wtNames));
    }

    // The refusal mirror: discern_start is now callable from a worktree, but its core
    // still refuses — an agent already in a worktree must not spawn a pointless sibling.
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_start", arguments: { dry_run: true } },
    });
    const startFromWt = await wtMcp.recv();
    assertEquals(startFromWt.result.isError, true);
    assertEquals(
      startFromWt.result.structuredContent.error,
      "precondition_failed",
    );
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("WorkingRoot: seeds from the spawn root and re-points on set", () => {
  // The one mutable value the server holds (ADR 0062): seeded from the spawn root,
  // moved by discern_start (→ the new worktree) and discern_graduate (→ back to spawn).
  const w = new WorkingRoot("/repo");
  assertEquals(w.get(), "/repo");
  w.set("/repo.worktrees/alpha"); // start re-aims at the new worktree
  assertEquals(w.get(), "/repo.worktrees/alpha");
  w.set("/repo"); // graduate resets to the spawn root
  assertEquals(w.get(), "/repo");
});

Deno.test("WorkingRoot: an undefined spawn root (outside a project) stays undefined until set", () => {
  // Spawned outside a discern project → undefined, which runTool's not_initialized
  // guard turns into the uniform refusal envelope.
  const w = new WorkingRoot(undefined);
  assertEquals(w.get(), undefined);
  w.set("/now/a/project");
  assertEquals(w.get(), "/now/a/project");
});

Deno.test("discern mcp: project commands execute in the path-resolved worktree, not the server cwd", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[checks.cwd]",
        'stage = "check"',
        'run = "pwd > command.cwd"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const worktree = await addWorktree(dir, "command-cwd");

    // The server process stays rooted in `dir` (the stable main checkout), while
    // this one call explicitly targets `worktree`. The command must follow the
    // resolved logical root; inheriting the server cwd produces a false-green gate.
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "discern_finish",
        arguments: { path: worktree },
      },
    });
    const finished = await mcp.recv();
    assertEquals(
      finished.result.isError,
      false,
      JSON.stringify(finished.result),
    );
    assertEquals(finished.result.structuredContent.ok, true);

    const marker = join(worktree, "command.cwd");
    assert(
      await exists(marker),
      "the gate passed but its project command ran outside the targeted worktree",
    );
    assertEquals(
      (await Deno.readTextFile(marker)).trim(),
      await Deno.realPath(worktree),
    );
    assertEquals(
      await exists(join(dir, "command.cwd")),
      false,
      "the worktree-targeted command leaked into the MCP server's main cwd",
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: start then graduate over ONE main-rooted session — the working root re-aims (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // The motivating flow this whole record exists to fix: an agent on the trunk opens
    // ONE MCP connection, starts a worktree, and graduates it — without ever re-rooting
    // the connection. Before ADR 0062 this was impossible (graduate was hidden from a
    // main-rooted server, and even revealed it gated the trunk); now discern_start
    // re-aims the server's working root at the new worktree, so graduate lands it.
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // discern_start from the trunk → creates the worktree and re-aims the working root.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await mcp.recv();
    assertEquals(started.result.isError, false, JSON.stringify(started.result));
    const wtPath = started.result.structuredContent.data.path as string;
    assert(
      typeof wtPath === "string" && wtPath.length > 0,
      JSON.stringify(started.result.structuredContent),
    );
    assert(
      await exists(join(wtPath, "CLAUDE.md")),
      "the created worktree is set up",
    );
    await commitWorktreeForGraduation(wtPath);

    // discern_graduate over the SAME connection now operates on the re-aimed working
    // root (the new worktree), not the trunk — and SUCCEEDS. This is the headline
    // guard: it fails against today's main, where graduate is hidden (→ "not found").
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: {} },
    });
    const graduated = await mcp.recv();
    assertEquals(
      graduated.result.isError,
      false,
      JSON.stringify(graduated.result),
    );
    assertEquals(graduated.result.structuredContent.verb, "graduate");
    assertEquals(graduated.result.structuredContent.ok, true);
    // graduate removed the worktree it landed — proof it acted on the worktree, not the
    // (still-present) trunk.
    assertEquals(
      await exists(wtPath),
      false,
      "graduate removed the worktree directory",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a worktree-spawned server re-aims to main on graduate even with an explicit `path`, since graduate removed its held root (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Codex's app-managed-worktree flow (Phase B) spawns the MCP server INSIDE the
    // worktree, so its spawn root IS the worktree — unlike Claude Code, launched from
    // the trunk. A main-rooted server creates + sets up the worktree (start refuses from
    // inside one), then we hand it to a server rooted THERE, the way Codex does.
    const maker = await spawnMcp(dir);
    await maker.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await maker.recv();
    await maker.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await maker.recv();
    const wtPath = started.result.structuredContent.data.path as string;
    assert(await exists(join(wtPath, "CLAUDE.md")), "worktree is set up");
    await commitWorktreeForGraduation(wtPath);
    assertEquals(await maker.close(), 0);

    // The graduating server is rooted IN the worktree (spawn root = the worktree).
    const inWt = await spawnMcp(wtPath);
    await inWt.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await inWt.recv();

    // graduate with an EXPLICIT `path` (the worktree) — Codex's exact call — removes
    // the spawn-root worktree. A `path` override normally leaves the held root alone
    // (§2), but graduate just deleted the directory that root points at, so it must
    // re-root anyway. The result reports the main checkout it landed in.
    await inWt.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "discern_graduate",
        arguments: { path: wtPath, to: "trunk" },
      },
    });
    const graduated = await inWt.recv();
    assertEquals(
      graduated.result.isError,
      false,
      JSON.stringify(graduated.result),
    );
    const landedRoot = graduated.result.structuredContent.data.root as string;
    assert(
      typeof landedRoot === "string" && landedRoot.length > 0,
      JSON.stringify(graduated.result.structuredContent),
    );
    assertEquals(await exists(wtPath), false, "graduate removed the worktree");

    // The headline: a subsequent call with NO `path` must follow the re-aimed working
    // root to the MAIN CHECKOUT — not the removed worktree. Without the held-root-missing
    // re-aim, the explicit `path` on graduate would skip re-aiming, leaving this `status`
    // to resolve the deleted worktree's discern.toml and error.
    await inWt.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const status = await inWt.recv();
    assertEquals(status.result.isError, false, JSON.stringify(status.result));
    assertEquals(status.result.structuredContent.data.location, "main");
    // The status root is exactly the root graduate re-aimed to (the main checkout).
    assertEquals(status.result.structuredContent.data.root, landedRoot);

    assertEquals(await inWt.close(), 0);
  });
});

Deno.test("discern mcp: graduating a DIFFERENT worktree by `path` leaves the held root alone (ADR 0062 §2 preserved)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // The other side of the held-root-removed rule: re-aiming on a `path` override must
    // fire ONLY when graduate removed the root you're HOLDING — never when you graduate
    // some OTHER worktree by path while still working in your own. Make two worktrees,
    // hold one, graduate the other. (Each `start` runs from a fresh main-rooted server,
    // because a server re-aims into the worktree it just started and `start` then refuses
    // from inside one.)
    const startFromMain = async (): Promise<string> => {
      const m = await spawnMcp(dir);
      await m.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: initParams(),
      });
      await m.recv();
      await m.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "discern_start", arguments: {} },
      });
      const path = (await m.recv()).result.structuredContent.data
        .path as string;
      assertEquals(await m.close(), 0);
      return path;
    };
    const held = await startFromMain(); // the worktree we keep working in
    const other = await startFromMain(); // the worktree we graduate by path
    await commitWorktreeForGraduation(other);

    // A server rooted in `held`, graduating `other` by explicit path.
    const inHeld = await spawnMcp(held);
    await inHeld.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await inHeld.recv();
    await inHeld.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "discern_graduate",
        arguments: { path: other, to: "trunk" },
      },
    });
    const graduated = await inHeld.recv();
    assertEquals(
      graduated.result.isError,
      false,
      JSON.stringify(graduated.result),
    );
    assertEquals(await exists(other), false, "the OTHER worktree was removed");
    assert(await exists(held), "the held worktree is untouched");

    // The held root survived — a no-path call still operates on it, NOT the main checkout
    // (it wasn't the one removed, so §2's one-call-override rule holds).
    await inHeld.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const status = await inHeld.recv();
    assertEquals(status.result.isError, false, JSON.stringify(status.result));
    assertEquals(status.result.structuredContent.data.location, "worktree");

    assertEquals(await inHeld.close(), 0);
  });
});

Deno.test("discern mcp: discern_graduate with no prior discern_start refuses cleanly (working root = trunk)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // No discern_start has moved the working root, so it is still the spawn root (the
    // trunk). graduate is visible now (ADR 0062 retired the hiding) but its core
    // refuses — there is no worktree to graduate. A clean precondition_failed, not a
    // silent false green gating the trunk (the very failure §2 of the ADR guards).
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: {} },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(
      refused.result.structuredContent.verb,
      "graduate",
    );
    assertEquals(
      refused.result.structuredContent.error,
      "precondition_failed",
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: an explicit `path` wins over the working root (ADR 0062 §2)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Re-aim the working root at a fresh worktree via discern_start, so the working
    // root and the spawn root genuinely differ — the precedence has something to win.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await mcp.recv();
    assertEquals(started.result.isError, false, JSON.stringify(started.result));
    const wtPath = started.result.structuredContent.data.path as string;

    // No `path` → status follows the (re-aimed) working root: the worktree.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const fromWorking = await mcp.recv();
    assertEquals(
      fromWorking.result.structuredContent.data.location,
      "worktree",
    );

    // An explicit `path` pointing at the trunk WINS over the working root for that one
    // call: status reports the main checkout, not the worktree the working root holds.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_status", arguments: { path: dir } },
    });
    const fromPath = await mcp.recv();
    assertEquals(fromPath.result.structuredContent.data.location, "main");

    // …and the override is scoped to that one call — the held working root is unchanged
    // (a subsequent no-`path` call still sees the worktree).
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const afterOverride = await mcp.recv();
    assertEquals(
      afterOverride.result.structuredContent.data.location,
      "worktree",
    );
    // A `path` inside the worktree resolves to the worktree's root (findRoot walks up).
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "discern_status", arguments: { path: wtPath } },
    });
    const fromWtPath = await mcp.recv();
    assertEquals(fromWtPath.result.structuredContent.data.location, "worktree");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a `path` outside any discern project falls through to not_initialized", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A path with no discern.toml in it or any ancestor (the system temp, outside the
    // project tree) → findRoot returns undefined → the uniform not_initialized refusal.
    const outside = await Deno.makeTempDir({
      prefix: "discern-not-a-project-",
    });
    try {
      const mcp = await spawnMcp(dir);
      await mcp.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: initParams(),
      });
      await mcp.recv();
      await mcp.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "discern_status", arguments: { path: outside } },
      });
      const refused = await mcp.recv();
      assertEquals(refused.result.isError, true);
      assertEquals(
        refused.result.structuredContent.error,
        "not_initialized",
      );
      assertEquals(await mcp.close(), 0);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("discern mcp: after discern_start, discern_status follows the re-aimed working root, and the start hint spells out the agent's own move (ADR 0062 §4)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Before start: status is rooted in the main checkout (the spawn root).
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const before = await mcp.recv();
    assertEquals(before.result.structuredContent.data.location, "main");

    // discern_start re-aims the working root at the new worktree…
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await mcp.recv();
    assertEquals(started.result.isError, false, JSON.stringify(started.result));
    const wtPath = started.result.structuredContent.data.path as string;

    // …and its result hint spells out BOTH load-bearing halves (§4): the discern tools
    // now follow the new worktree automatically, AND the agent must still move its own
    // file context there (alluded to, not a vendor tool name) or its edits and the gate
    // diverge. The hint names the new path so the agent knows where to go.
    const hint = (started.result.structuredContent.hints as string[]).join(
      "\n",
    );
    assert(
      hint.includes(wtPath),
      `the start hint must name the new path: ${hint}`,
    );
    assert(
      /aimed|operate on it/i.test(hint),
      `the hint must say the discern tools now follow the worktree: ${hint}`,
    );
    assert(
      /move your own|your own file/i.test(hint) && /diverge/i.test(hint),
      `the hint must say to move the agent's own file context, or edits/gate diverge: ${hint}`,
    );
    // Vendor-neutral: the agent-agnostic server alludes to the capability, never names
    // one client's command.
    assert(
      !/EnterWorktree|\/worktree/.test(hint),
      `the hint must stay vendor-neutral: ${hint}`,
    );

    // …so a plain discern_status (no path) now reports the worktree and its exact root.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const after = await mcp.recv();
    assertEquals(after.result.structuredContent.data.location, "worktree");
    assertEquals(after.result.structuredContent.data.root, wtPath);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("the can't-re-root fallback is one shared pattern across every shipped surface", () => {
  // An agent that cannot change its working root must read the SAME fallback —
  // prefix every shell command with `cd <path> &&`, and pass `path` to every
  // discern tool — whether it looks at the compiled worktree guidance, the
  // discern_start MCP result hint, or the MCP server instructions. Hold all three
  // to both halves at once, driven off the same predicate, so none can teach
  // half the pattern.
  const surfaces: Record<string, string> = {
    "compiled guidance (worktrees.md)": Deno.readTextFileSync(
      new URL("../templates/guidance/worktrees.md", import.meta.url),
    ),
    "discern_start MCP hint": mcpStartHint("/wt/x"),
    "MCP server instructions": buildInstructions(),
  };
  for (const [name, text] of Object.entries(surfaces)) {
    assert(/cd .*&&/.test(text), `${name} must teach the cd-prefix: ${text}`);
    assert(
      /pass\s+`?path/i.test(text),
      `${name} must say to pass \`path\` to every discern tool: ${text}`,
    );
  }
});

/** The shape of one tool as `tools/list` advertises it (the fields this suite reads). */
interface ListedTool {
  name: string;
  title?: string;
  description: string;
  outputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
  };
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("discern mcp: tools advertise a title, an outputSchema, and honest annotations", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Every tool lists from either location now (ADR 0062 retired the location-based
    // hiding), so one worktree-rooted server advertises them all — verify each
    // lifecycle tool's self-describing surface and honest annotations here.
    const wt = await addWorktree(dir, "adv");
    const mcp = await spawnMcp(wt);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const byName = new Map(
      (list.result.tools as ListedTool[]).map((t) => [t.name, t] as const),
    );

    assertEquals(
      sorted(byName.keys()),
      sorted(TOOLS.map((t) => t.name)),
      "tools/list must advertise exactly the TOOLS table when every feature is on",
    );

    // Every source entry and advertised tool carries the self-describing surface.
    for (const tool of TOOLS) {
      const name = tool.name;
      assert(
        typeof tool.title === "string" && tool.title.length > 0,
        `${name} has no source title`,
      );
      assert(tool.outputSchema !== undefined, `${name} has no outputSchema`);
      assert(tool.annotations !== undefined, `${name} has no annotations`);

      const t = byName.get(name);
      assert(t !== undefined, `missing tool ${name}`);
      assert(
        typeof t.title === "string" && t.title.length > 0,
        `${name} has no title`,
      );
      assertEquals(t.outputSchema?.type, "object", `${name} outputSchema`);
      assert(t.annotations !== undefined, `${name} has no annotations`);
    }

    const READ_ONLY_TOOLS = new Set([
      "discern_doctor",
      "discern_scopes",
      "discern_coupling",
      "discern_status",
      "discern_improve",
      "discern_docs",
      "discern_help",
    ]);
    const MUTATING_TOOLS = new Set([
      "discern_refresh",
      "discern_finish",
      "discern_prepare",
      "discern_test",
      "discern_ratchets",
      "discern_start",
      "discern_integrate",
    ]);
    const DESTRUCTIVE_TOOLS = new Set(["discern_graduate"]);
    const IDEMPOTENT_MUTATING_TOOLS = new Set([
      "discern_refresh",
      "discern_integrate",
    ]);
    assertEquals(
      sorted([
        ...READ_ONLY_TOOLS,
        ...MUTATING_TOOLS,
        ...DESTRUCTIVE_TOOLS,
      ]),
      sorted(TOOLS.map((t) => t.name)),
      "every MCP tool must be classified as read-only, mutating, or destructive",
    );

    // Honest annotations: the pure-observation verbs are read-only; the gate/lifecycle
    // verbs mutate; graduate is destructive; integrate is the only mutating idempotent
    // operation (a no-op once already integrated).
    for (const tool of TOOLS) {
      const annotations = byName.get(tool.name)?.annotations;
      assert(annotations !== undefined, `${tool.name} has no annotations`);
      assertEquals(
        annotations.readOnlyHint,
        READ_ONLY_TOOLS.has(tool.name),
        `${tool.name} readOnlyHint`,
      );
      assertEquals(
        annotations.destructiveHint ?? false,
        DESTRUCTIVE_TOOLS.has(tool.name),
        `${tool.name} destructiveHint`,
      );
      assertEquals(
        annotations.idempotentHint ?? false,
        READ_ONLY_TOOLS.has(tool.name) ||
          IDEMPOTENT_MUTATING_TOOLS.has(tool.name),
        `${tool.name} idempotentHint`,
      );
      const closedWorldTools = new Set([...READ_ONLY_TOOLS, "discern_refresh"]);
      assertEquals(
        annotations.openWorldHint,
        closedWorldTools.has(tool.name) ? false : undefined,
        `${tool.name} openWorldHint`,
      );
    }
    assertEquals(
      sorted(IDEMPOTENT_MUTATING_TOOLS),
      ["discern_integrate", "discern_refresh"],
      "record any additional mutating idempotent tool explicitly",
    );

    // openWorldHint honesty: the pure observers claim a closed world; the
    // command-running tools leave it unset (it defaults open), since their
    // configured commands are arbitrary and may reach the network.
    assertEquals(
      byName.get("discern_status")?.annotations?.openWorldHint,
      false,
    );
    assertEquals(
      byName.get("discern_finish")?.annotations?.openWorldHint,
      undefined,
    );
    assertEquals(
      byName.get("discern_refresh")?.annotations?.openWorldHint,
      false,
    );
    assertEquals(
      byName.get("discern_ratchets")?.annotations?.openWorldHint,
      undefined,
    );
    assertEquals(
      byName.get("discern_graduate")?.annotations?.openWorldHint,
      undefined,
    );

    // The advertised outputSchema names the envelope fields it validates, and
    // finish's narrows `data` to the gate payload.
    const finishProps = byName.get("discern_finish")?.outputSchema?.properties;
    assert(finishProps?.ok !== undefined, "finish outputSchema has ok");
    assert(finishProps?.verb !== undefined, "finish outputSchema has verb");
    assert(finishProps?.data !== undefined, "finish outputSchema narrows data");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: tools/list advertises tools in workflow priority order", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const tools = list.result.tools as ListedTool[];
    assertEquals(
      tools.map((t) => t.name),
      [
        "discern_status",
        "discern_start",
        "discern_finish",
        "discern_prepare",
        "discern_test",
        "discern_integrate",
        "discern_ratchets",
        "discern_graduate",
        "discern_scopes",
        "discern_coupling",
        "discern_refresh",
        "discern_docs",
        "discern_help",
        "discern_doctor",
        "discern_improve",
      ],
      "MCP tools should be listed in deliberate workflow priority order for clients that truncate tools/list",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_refresh repairs stale generated artifacts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);

    const claude = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claude,
      `${await Deno.readTextFile(claude)}\n<!-- stale edit -->\n`,
    );

    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_refresh", arguments: {} },
    });
    const refreshed = await mcp.recv();
    assertEquals(refreshed.result.isError, false);
    assert(
      RefreshOutputSchema.safeParse(refreshed.result.structuredContent).success,
      JSON.stringify(refreshed.result.structuredContent),
    );
    assertEquals(refreshed.result.structuredContent.verb, "refresh");
    assert(
      !(await Deno.readTextFile(claude)).includes("stale edit"),
      "discern_refresh should rewrite generated guidance just like the CLI refresh",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_status metadata is search-shaped for orientation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const status = (list.result.tools as ListedTool[])
      .find((t) => t.name === "discern_status");
    assert(status !== undefined, "discern_status should be listed");
    assertEquals(status.title, "Orient with discern_status");
    assert(
      status.description.startsWith(
        "Start here: call discern_status",
      ),
      `discern_status description should lead with its exact orientation role; got:\n${status.description}`,
    );
    assert(
      status.description.includes("discern_refresh"),
      `discern_status description should name the MCP repair tool; got:\n${status.description}`,
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: initialization instructions prioritize discern_status", () => {
  const instructions = buildInstructions();
  const statusAt = instructions.indexOf("discern_status");
  assert(statusAt >= 0, instructions);
  assert(
    statusAt < 512,
    `discern_status must appear in the first 512 chars; found at ${statusAt}`,
  );

  const firstTool = [...instructions.matchAll(/\bdiscern_[a-z_]+\b/g)][0];
  assert(firstTool !== undefined, instructions);
  assertEquals(
    firstTool[0],
    "discern_status",
    "the first tool named in MCP instructions should be the orientation tool",
  );
});

Deno.test("discern mcp: discern_status documents its actionable data fields (incl. stale integrations)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const status =
      (list.result.tools as { name: string; description: string }[])
        .find((t) => t.name === "discern_status");
    assert(status !== undefined, "discern_status should be listed");

    // What the agent SEES (the tool description) must name every actionable advisory
    // field status DOES emit — each tells the agent to run a command (`discern
    // refresh`, or finish setup). `stale_materialized` is why this guard exists: it
    // arrived with the materialized-skills currency check AFTER its two siblings were
    // documented, and silently went unmentioned. Pin the set so a new advisory
    // field can't drift into the payload undocumented the same way.
    for (
      const field of [
        "stale_generated",
        "stale_materialized",
        "stale_integrations",
        "setup_unfinished",
        "incoming_overlap",
      ]
    ) {
      assert(
        status.description.includes(field),
        `discern_status description must document data.${field}; got:\n${status.description}`,
      );
    }

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a tool call's structuredContent validates against its advertised schema", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // The SDK already validates structuredContent against the outputSchema before
    // sending (a mismatch would surface as an error), but assert it independently
    // against the SAME Zod source the schema is built from — the end-to-end SSOT
    // check, on top of Phase 2's core-level faithfulness tests.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_status", arguments: {} },
    });
    const status = await mcp.recv();
    assertEquals(status.result.isError, false);
    const sParsed = StatusOutputSchema.safeParse(
      status.result.structuredContent,
    );
    assert(
      sParsed.success,
      `status structuredContent drifted: ${
        JSON.stringify(sParsed.success ? [] : sParsed.error.issues)
      }`,
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_doctor", arguments: {} },
    });
    const doctor = await mcp.recv();
    const dParsed = DoctorOutputSchema.safeParse(
      doctor.result.structuredContent,
    );
    assert(
      dParsed.success,
      `doctor structuredContent drifted: ${
        JSON.stringify(dParsed.success ? [] : dParsed.error.issues)
      }`,
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_ratchets is listed (slow/on-demand), not read-only, and previews a dry-run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Listed with the ratchets feature on (the default scaffold).
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const tools = list.result.tools as ListedTool[];
    const rt = tools.find((t) => t.name === "discern_ratchets");
    assert(rt !== undefined, "discern_ratchets should be listed");
    // It runs the metric commands, so it is NOT read-only.
    assertEquals(rt.annotations?.readOnlyHint, false);
    assertStringIncludes(rt.description, "clean worktree");
    assertStringIncludes(rt.description, "force");
    assert(
      !rt.description.includes("before pushing"),
      `ratchets description should not mention pushing:\n${rt.description}`,
    );
    assert(
      Object.hasOwn(rt.inputSchema?.properties ?? {}, "force"),
      "discern_ratchets input schema should expose force",
    );

    // A dry-run preview returns the plan and measures nothing.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_ratchets", arguments: { dry_run: true } },
    });
    const preview = await mcp.recv();
    assertEquals(preview.result.isError, false);
    assertEquals(preview.result.structuredContent.verb, "ratchets");
    assertEquals(preview.result.structuredContent.dry_run, true);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a failing discern_ratchets apply returns an ok:false envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[ratchets.coverage]",
        'run = "echo DISCERN_METRIC coverage 10"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_ratchets", arguments: {} },
    });
    const failed = await mcp.recv();
    assertEquals(failed.result.isError, true, JSON.stringify(failed.result));
    const payload = failed.result.structuredContent;
    assert(DatalessEnvelopeSchema.safeParse(payload).success);
    assertEquals(payload.ok, false);
    assertEquals(payload.verb, "ratchets");
    assert(
      payload.steps.some((s: { outcome: string }) => s.outcome === "failed"),
      JSON.stringify(payload),
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the server advertises a non-empty, MCP-first instructions block", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const init = await mcp.recv();
    const instructions = init.result.instructions;
    assert(
      typeof instructions === "string" && instructions.length > 0,
      "the server should advertise instructions in its initialize result",
    );
    // It names the operating model's core tools (orient, gate) — the "when to use
    // which tool" block.
    assert(instructions.includes("discern_status"), instructions);
    assert(instructions.includes("discern_finish"), instructions);
    // Worktrees are on → the whole lifecycle is named linearly, from any root (ADR
    // 0062 retired the location-branched instructions): start, integrate, graduate.
    assert(instructions.includes("discern_start"), instructions);
    assert(instructions.includes("discern_integrate"), instructions);
    assert(instructions.includes("discern_graduate"), instructions);
    assert(
      instructions.includes("user explicitly asks"),
      instructions,
    );
    assert(
      instructions.includes("Do not treat a green finish or status hint"),
      instructions,
    );
    // Diagnostics and ratchets are always present (every subsystem is core).
    assert(instructions.includes("discern_doctor"), instructions);
    assert(instructions.includes("discern_ratchets"), instructions);
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the rendered surface names the project's configured integration branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Customise the integration branch — the value the graduate_to / guidance.sources
    // fixes proved the agent files must reflect. The MCP surface must reflect it too:
    // a description that names the branch shows the REAL one, never a baked-in "main".
    const set = await runAgent(dir, [
      "config",
      "set",
      "project.main_branch",
      "trunkline",
    ]);
    assertEquals(set.code, 0, set.output);

    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const init = await mcp.recv();
    // No template token ever escapes to the wire — every {{var}} is rendered.
    const instructions = init.result.instructions as string;
    assert(
      !instructions.includes("{{"),
      `an unrendered template token reached the wire:\n${instructions}`,
    );

    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    // discern_ratchets names the branch ("loosened versus `<main_branch>`") and is
    // visible from the main checkout, so it is the end-to-end witness here.
    const ratchets =
      (list.result.tools as { name: string; description: string }[])
        .find((t) => t.name === "discern_ratchets");
    assert(ratchets !== undefined, "discern_ratchets should be listed");
    assert(
      ratchets.description.includes("trunkline"),
      `the description must name the configured branch; got:\n${ratchets.description}`,
    );
    assert(
      !ratchets.description.includes("versus main"),
      `the hardcoded default must be gone; got:\n${ratchets.description}`,
    );
    assert(
      !ratchets.description.includes("before pushing"),
      `ratchets should not assume a remote-push workflow; got:\n${ratchets.description}`,
    );
    assert(!ratchets.description.includes("{{"), ratchets.description);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: resources list, template, and read fresh content", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Seed a project docs tree so discern://docs has content.
    await Deno.mkdir(join(dir, "discern/docs", "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "discern/docs", "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas of the project.\n",
    );
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const init = await mcp.recv();
    assert(
      init.result.capabilities.resources,
      "server should advertise the resources capability",
    );

    // resources/list → the fixed resources (gated like their tools, all on here).
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    const list = await mcp.recv();
    const uris = (list.result.resources as { uri: string }[]).map((r) => r.uri);
    for (
      const u of [
        "discern://status",
        "discern://scopes",
        "discern://config",
        "discern://help",
        "discern://docs",
      ]
    ) {
      assert(uris.includes(u), `${u} missing from ${JSON.stringify(uris)}`);
    }

    // resources/templates/list → the {target} doc templates.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/templates/list",
    });
    const templates = await mcp.recv();
    const tpl = (templates.result.resourceTemplates as {
      uriTemplate: string;
    }[]).map((t) => t.uriTemplate);
    assert(tpl.includes("discern://docs/{target}"), JSON.stringify(tpl));
    assert(tpl.includes("discern://help/{target}"), JSON.stringify(tpl));

    // read discern://status → a fresh JSON snapshot (the data payload, not the
    // envelope).
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "discern://status" },
    });
    const status = await mcp.recv();
    const statusPart = status.result.contents[0];
    assertEquals(statusPart.mimeType, "application/json");
    assertEquals(statusPart.uri, "discern://status");
    const statusData = JSON.parse(statusPart.text);
    assertEquals(statusData.location, "main");
    assert(
      Array.isArray(statusData.ratchets),
      "the status resource carries the configured ratchets",
    );

    // read discern://scopes
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "discern://scopes" },
    });
    const cs = await mcp.recv();
    assert(Array.isArray(JSON.parse(cs.result.contents[0].text).scopes));

    // read discern://config → the resolved DiscernConfig.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "discern://config" },
    });
    const cfg = await mcp.recv();
    assert(
      JSON.parse(cfg.result.contents[0].text).project,
      "the config resource carries [project]",
    );

    // read discern://help (index) + a single help doc (Markdown).
    await mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/read",
      params: { uri: "discern://help" },
    });
    const help = await mcp.recv();
    assert(
      JSON.parse(help.result.contents[0].text).docs.some((
        d: { slug: string },
      ) => d.slug === "config-reference"),
      "discern://help indexes discern's own docs",
    );
    await mcp.send({
      jsonrpc: "2.0",
      id: 8,
      method: "resources/read",
      params: { uri: "discern://help/config-reference" },
    });
    const helpDoc = await mcp.recv();
    assertEquals(helpDoc.result.contents[0].mimeType, "text/markdown");
    assert(helpDoc.result.contents[0].text.includes("config reference"));

    // read discern://docs (index) + the seeded project doc (Markdown).
    await mcp.send({
      jsonrpc: "2.0",
      id: 9,
      method: "resources/read",
      params: { uri: "discern://docs" },
    });
    const docs = await mcp.recv();
    const slug = JSON.parse(docs.result.contents[0].text).docs[0].slug;
    await mcp.send({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/read",
      params: { uri: `discern://docs/${slug}` },
    });
    const doc = await mcp.recv();
    assertEquals(doc.result.contents[0].mimeType, "text/markdown");
    assert(
      doc.result.contents[0].text.includes("The core ideas of the project"),
      "the docs template serves the doc's Markdown content",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the resources follow the re-aimed working root after discern_start (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Baseline: the discern://status resource reads the main checkout (the spawn root).
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "discern://status" },
    });
    const before = await mcp.recv();
    assertEquals(
      JSON.parse(before.result.contents[0].text).location,
      "main",
    );

    // discern_start re-aims the server's working root at the new worktree…
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await mcp.recv();
    assertEquals(started.result.isError, false, JSON.stringify(started.result));
    const wtPath = started.result.structuredContent.data.path as string;

    // …and the resources follow it: a fresh read of discern://status (resolved per
    // read, not bound to the spawn root) now reports the worktree and its exact root —
    // the readable surface aligned with the tools, not lagging on the trunk.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "discern://status" },
    });
    const after = await mcp.recv();
    const afterData = JSON.parse(after.result.contents[0].text);
    assertEquals(afterData.location, "worktree");
    assertEquals(afterData.root, wtPath);

    assertEquals(await mcp.close(), 0);
  });
});

// ---------------------------------------------------------------------------
// Cancellation propagation — an interrupted call must not orphan gate jobs.
//
// The class this guards: gate jobs run in their own detached process groups, so
// the ONLY thing that can stop them is the runner's abort controller. Before
// this wiring, a client cancelling a discern_finish call (or killing the server)
// left the gate running invisibly to completion — orphaned processes racing the
// user's next run over shared build state.
// ---------------------------------------------------------------------------

/** A gate config whose check job records its PID (the job group's leader) and
 * blocks — so a test can cancel a genuinely in-flight gate, then prove the
 * group died. */
function sleeperConfig(): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[capabilities]",
    'lint = "echo $$ > gate.pid && sleep 30"',
  ].join("\n");
}

/** Poll until `check` is true, failing the test after the deadline. */
async function pollUntil(
  check: () => Promise<boolean> | boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Whether a PID is still alive (signal-0 semantics via a harmless SIGCONT). */
function pidAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/** Initialize handshake + the in-flight sleeper gate: start a discern_finish
 * call (request id 2), wait until its check job is running, return the job's
 * PID. Shared by the cancel and shutdown tests so both interrupt the same
 * genuinely-running gate. */
async function startInFlightFinish(
  mcp: McpClient,
  dir: string,
): Promise<number> {
  await mcp.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: initParams(),
  });
  await mcp.recv();
  await mcp.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await mcp.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "discern_finish", arguments: {} },
  });
  const pidFile = join(dir, "gate.pid");
  await pollUntil(
    async () => await exists(pidFile),
    "the gate's check job to start",
  );
  const jobPid = Number((await Deno.readTextFile(pidFile)).trim());
  assert(Number.isFinite(jobPid) && jobPid > 0, `bad gate.pid: ${jobPid}`);
  return jobPid;
}

Deno.test("mcp: cancelling an in-flight discern_finish tree-kills its gate jobs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, sleeperConfig());
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    const jobPid = await startInFlightFinish(mcp, dir);

    // The client cancels the call — the SDK aborts the request's signal, which
    // must reach the job runner's tree-kill.
    await mcp.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 2, reason: "user cancelled" },
    });
    await pollUntil(
      () => !pidAlive(jobPid),
      `cancelled gate job ${jobPid} to die`,
      10_000,
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("mcp: server shutdown (stdin EOF) tree-kills an in-flight gate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, sleeperConfig());
    await gitInit(dir);
    const mcp = await spawnMcp(dir);
    const jobPid = await startInFlightFinish(mcp, dir);

    // The client closes the pipe mid-call — the server must cancel the run
    // (killing its jobs) before it exits, not leave them orphaned.
    await mcp.closeStdin();
    assertEquals(await mcp.finish(), 0);
    await pollUntil(
      () => !pidAlive(jobPid),
      `gate job ${jobPid} to die with the server`,
      10_000,
    );
  });
});
