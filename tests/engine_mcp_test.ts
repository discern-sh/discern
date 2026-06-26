/**
 * Engine coverage for `discern mcp` — the MCP stdio server (ADR 0028's third
 * rendering of the result spine). Drives the real JSON-RPC handshake over a
 * spawned process's stdin/stdout: initialize → tools/list → tools/call, asserting
 * each verb's tool returns its DiscernResult as the tool's structuredContent.
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import {
  DoctorOutputSchema,
  StatusOutputSchema,
} from "../src/shared/result_schemas.ts";
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
    // `discern_help` (discern's own docs) is always listed — not a project feature.
    assert(names.includes("discern_help"), JSON.stringify(names));
    // The feature-gated tools are listed too (the default scaffold has every
    // feature on).
    assert(names.includes("discern_docs"), JSON.stringify(names));
    // Location-gated: this server is rooted in the MAIN checkout, so it offers
    // discern_start and hides the worktree-only graduate/integrate (covered in
    // depth by the location-aware listing test below).
    assert(names.includes("discern_start"), JSON.stringify(names));
    assert(!names.includes("discern_graduate"), JSON.stringify(names));
    assert(!names.includes("discern_integrate"), JSON.stringify(names));

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
      params: { name: "discern_status", arguments: {} },
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
    await Deno.mkdir(join(dir, "docs"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs", "project-only.md"),
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

    // A missing target → a not_found error envelope.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_help", arguments: { target: "no-such-doc" } },
    });
    const miss = await mcp.recv();
    assertEquals(miss.result.isError, true);
    assertEquals(miss.result.structuredContent.verb, "help");
    assertEquals(miss.result.structuredContent.error, "not_found");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: pre-setup gates docs and the gate verbs, but not help", async () => {
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

    // A bootstrap-gated tool refuses with the structured not_set_up envelope.
    for (
      const [id, name] of [[2, "discern_docs"], [3, "discern_finish"]] as const
    ) {
      await mcp.send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: {} },
      });
      const refused = await mcp.recv();
      assertEquals(refused.result.isError, true, name);
      assertEquals(refused.result.structuredContent.error, "not_set_up", name);
    }

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
    // the graduation plan and touches nothing. (graduate is worktree-only, so it is
    // hidden from a main-rooted server — see the location-aware listing test.)
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
    // (integrate is worktree-only — hidden from a main-rooted server, per the
    // location-aware listing test.)
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

Deno.test("discern mcp: the tool list + instructions are location-aware (start on main; graduate/integrate in a worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From the MAIN checkout: discern_start is listed and named in the instructions,
    // while the worktree-only graduate/integrate are hidden (you can't graduate the
    // trunk) — the list is tailored to what is runnable from here.
    const main = await spawnMcp(dir);
    await main.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    const init = await main.recv();
    const mainInstructions = init.result.instructions as string;
    assert(mainInstructions.includes("discern_start"), mainInstructions);
    assert(
      !mainInstructions.includes("discern_graduate") &&
        !mainInstructions.includes("discern_integrate"),
      `main instructions must not name the worktree-only verbs: ${mainInstructions}`,
    );
    await main.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await main.recv();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(names.includes("discern_start"), JSON.stringify(names));
    assert(!names.includes("discern_graduate"), JSON.stringify(names));
    assert(!names.includes("discern_integrate"), JSON.stringify(names));

    // A real call creates the worktree and returns its path — the MCP wrinkle: the
    // server can't relocate the session, so the result carries the path + a re-root
    // hint rather than pretending it moved.
    await main.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await main.recv();
    assertEquals(started.result.isError, false);
    const sc = started.result.structuredContent;
    assertEquals(sc.verb, "start");
    assertEquals(sc.data.branch, `agent/${sc.data.id}`);
    assert(
      typeof sc.data.path === "string" && sc.data.path.length > 0,
      JSON.stringify(sc),
    );
    assert(
      await exists(join(sc.data.path, "CLAUDE.md")),
      "the created worktree is set up (agent files materialized)",
    );
    assert(
      (sc.hints as string[]).some((h) => h.includes(sc.data.path)),
      `a re-root hint must name the new path: ${JSON.stringify(sc.hints)}`,
    );
    assertEquals(await main.close(), 0);

    // From inside a WORKTREE the listing flips: discern_start is hidden (an agent
    // already in a worktree must not spawn a pointless sibling), and the worktree-only
    // graduate/integrate are now offered — absent ⇄ present, symmetric with main.
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
    assert(
      !wtInstructions.includes("discern_start"),
      `no discern_start line from a worktree: ${wtInstructions}`,
    );
    assert(
      wtInstructions.includes("discern_integrate") &&
        wtInstructions.includes("discern_graduate"),
      `worktree instructions must name the worktree verbs: ${wtInstructions}`,
    );
    await wtMcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const wtList = await wtMcp.recv();
    const wtNames = wtList.result.tools.map((t: { name: string }) => t.name);
    assert(!wtNames.includes("discern_start"), JSON.stringify(wtNames));
    assert(wtNames.includes("discern_graduate"), JSON.stringify(wtNames));
    assert(wtNames.includes("discern_integrate"), JSON.stringify(wtNames));

    // Calling it anyway → an error result (the SDK answers an unregistered name as
    // not found) — the defense-in-depth backstop behind hiding it.
    await wtMcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const refused = await wtMcp.recv();
    assertEquals(refused.result.isError, true);
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
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // tools/list omits discern_graduate (worktrees off) but keeps the always-on
    // tools and the still-enabled docs tool.
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(!names.includes("discern_graduate"), JSON.stringify(names));
    assert(!names.includes("discern_integrate"), JSON.stringify(names));
    assert(names.includes("discern_docs"), JSON.stringify(names));
    assert(names.includes("discern_finish"), JSON.stringify(names));

    // Calling the disabled tool anyway → an error result: a feature-disabled tool
    // is simply not registered, so the SDK answers as it would for any unknown name.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_graduate", arguments: { dry_run: true } },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assert(
      refused.result.content[0].text.includes("not found"),
      JSON.stringify(refused.result),
    );

    assertEquals(await mcp.close(), 0);
  });
});

/** The shape of one tool as `tools/list` advertises it (the fields this suite reads). */
interface ListedTool {
  name: string;
  title?: string;
  outputSchema?: {
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

Deno.test("discern mcp: tools advertise a title, an outputSchema, and honest annotations", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Spawn from a WORKTREE so the worktree-only graduate/integrate are visible here
    // (their honest annotations are the point); the always-on tools list from either
    // location. discern_start (main-only) is checked from a main server at the end.
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

    // Every tool advertises a non-empty title, an object outputSchema, and
    // annotations — the self-describing surface this tranche adds.
    for (
      const name of [
        "discern_finish",
        "discern_prepare",
        "discern_test",
        "discern_doctor",
        "discern_changed_scopes",
        "discern_status",
        "discern_audit",
        "discern_docs",
        "discern_help",
        "discern_graduate",
        "discern_integrate",
      ]
    ) {
      const t = byName.get(name);
      assert(t !== undefined, `missing tool ${name}`);
      assert(
        typeof t.title === "string" && t.title.length > 0,
        `${name} has no title`,
      );
      assertEquals(t.outputSchema?.type, "object", `${name} outputSchema`);
      assert(t.annotations !== undefined, `${name} has no annotations`);
    }

    // Honest annotations: the pure-observation verbs are read-only; the gate verbs
    // mutate (a fixer rewrites files / commands run); graduate is destructive.
    assertEquals(byName.get("discern_status")?.annotations?.readOnlyHint, true);
    assertEquals(byName.get("discern_doctor")?.annotations?.readOnlyHint, true);
    assertEquals(byName.get("discern_audit")?.annotations?.readOnlyHint, true);
    assertEquals(
      byName.get("discern_finish")?.annotations?.readOnlyHint,
      false,
    );
    assertEquals(
      byName.get("discern_prepare")?.annotations?.readOnlyHint,
      false,
    );
    assertEquals(byName.get("discern_test")?.annotations?.readOnlyHint, false);
    assertEquals(
      byName.get("discern_graduate")?.annotations?.destructiveHint,
      true,
    );
    // integrate mutates but is non-destructive and idempotent (a no-op once already
    // integrated) — so it advertises that, distinct from graduate's destructive hint.
    assertEquals(
      byName.get("discern_integrate")?.annotations?.readOnlyHint,
      false,
    );
    assertEquals(
      byName.get("discern_integrate")?.annotations?.destructiveHint,
      false,
    );
    assertEquals(
      byName.get("discern_integrate")?.annotations?.idempotentHint,
      true,
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

    // discern_start is main-only (hidden from the worktree server above), so verify
    // its self-describing surface from a main-rooted server: a title, an object
    // outputSchema, and a mutating (not read-only) annotation.
    const mainMcp = await spawnMcp(dir);
    await mainMcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mainMcp.recv();
    await mainMcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const mainList = await mainMcp.recv();
    const start = (mainList.result.tools as ListedTool[]).find((t) =>
      t.name === "discern_start"
    );
    assert(start !== undefined, "discern_start should be listed from main");
    assert(
      typeof start.title === "string" && start.title.length > 0,
      "discern_start has no title",
    );
    assertEquals(
      start.outputSchema?.type,
      "object",
      "discern_start outputSchema",
    );
    assertEquals(
      start.annotations?.readOnlyHint,
      false,
      "discern_start mutates (creates a worktree)",
    );
    assertEquals(await mainMcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_status documents its actionable data fields (incl. stale_materialized)", async () => {
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
    // documented, and silently went unmentioned. Pin all three so a new advisory
    // field can't drift into the payload undocumented the same way.
    for (
      const field of [
        "stale_generated",
        "stale_materialized",
        "setup_unfinished",
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
      params: { name: "discern_doctor" },
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

Deno.test("discern mcp: discern_ratchets is hidden when the ratchets feature is off", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const set = await runAgent(dir, [
      "config",
      "set",
      "features.ratchets",
      "false",
      "--bool",
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
    // ratchets off → its line drops from the instructions too (mirrors tool gating).
    assert(
      !(init.result.instructions as string).includes("discern_ratchets"),
      init.result.instructions,
    );
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(!names.includes("discern_ratchets"), JSON.stringify(names));
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
    // Worktrees are on and this server is rooted in the MAIN checkout → the location-
    // aware worktrees line is the discern_start nudge (graduate/integrate, being
    // worktree-only, are named only from a worktree-rooted server).
    assert(instructions.includes("discern_start"), instructions);
    // Always-on diagnostics, plus the feature-gated ratchets line (on by default).
    assert(instructions.includes("discern_doctor"), instructions);
    assert(instructions.includes("discern_ratchets"), instructions);
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: instructions are feature-aware (no graduate line when worktrees off)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const set = await runAgent(dir, [
      "config",
      "set",
      "features.worktrees",
      "false",
      "--bool",
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
    const instructions = init.result.instructions as string;
    assert(typeof instructions === "string" && instructions.length > 0);
    // The graduate tool isn't registered with worktrees off, so its line is dropped
    // from the instructions too (the block mirrors the tool gating).
    assert(
      !instructions.includes("discern_graduate"),
      `worktrees off → no graduate line; got:\n${instructions}`,
    );
    // The always-on guidance still stands.
    assert(instructions.includes("discern_status"), instructions);
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: resources list, template, and read fresh content", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Seed a project docs tree so discern://docs has content.
    await Deno.mkdir(join(dir, "docs", "00-orientation"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs", "00-orientation", "concepts.md"),
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
        "discern://changed-scopes",
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
      statusData.features,
      "the status resource carries the feature toggles",
    );

    // read discern://changed-scopes
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "discern://changed-scopes" },
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

Deno.test("discern mcp: the docs resource is gated on the docs feature; help and status stay", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const set = await runAgent(dir, [
      "config",
      "set",
      "features.docs",
      "false",
      "--bool",
    ]);
    assertEquals(set.code, 0, set.output);

    const mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    const list = await mcp.recv();
    const uris = (list.result.resources as { uri: string }[]).map((r) => r.uri);
    assert(!uris.includes("discern://docs"), JSON.stringify(uris));
    // help (discern's own docs) and the always-on snapshots stay.
    assert(uris.includes("discern://help"), JSON.stringify(uris));
    assert(uris.includes("discern://status"), JSON.stringify(uris));
    assertEquals(await mcp.close(), 0);
  });
});
