/**
 * Engine coverage for `discern mcp` — the MCP stdio server (ADR 0028's third
 * rendering of the result spine). Drives the real JSON-RPC handshake over a
 * spawned process's stdin/stdout: initialize → tools/list → tools/call, asserting
 * each verb's tool returns its DiscernResult as the tool's structuredContent.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { basename, dirname, join } from "@std/path";
import {
  AcceptOutputSchema,
  AwaitOutputSchema,
  CheckpointsOutputSchema,
  CouplingOutputSchema,
  DocsDataSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  MapOutputSchema,
  PatternsOutputSchema,
  PrepareOutputSchema,
  RefreshOutputSchema,
  ScopesDataSchema,
  StandardsOutputSchema,
  StartOutputSchema,
  StatusOutputSchema,
  StatusWireDataSchema,
  TestOutputSchema,
  UpdateOutputSchema,
} from "../src/shared/result_schemas.ts";
import { waitUntil } from "./waiting.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { z } from "@zod/zod";
import { assertResultDataKey, decodeWith } from "./decode_cli_result.ts";
import { seedForBranch } from "../src/engine/worktree/identity.ts";
import {
  buildInstructions,
  MCP_CORE_LIFECYCLE,
  MCP_INSTRUCTIONS_BYTE_LIMIT,
  mcpStartHint,
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import { providerFor } from "../src/lib/providers.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import { resultPresenterForVerb } from "../src/shared/result_contracts.ts";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";
import {
  AWAIT_WATCH_POLICY,
  OPERATING_POLICIES,
} from "../src/shared/operating_policies.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import {
  type LogbookEvent,
  parseLogbookLine,
} from "../src/engine/logbook/schema.ts";
import { MCP_CLIENT_INFO_META_KEY } from "../src/engine/logbook/agent_signals.ts";
import {
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_STRICT_CALL_SECONDS,
} from "../src/engine/await/defaults.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { stageBundledDocs } from "../scripts/build.ts";
import { logbookArchiveDir } from "../src/engine/logbook/store.ts";
import {
  addWorktree,
  defaultMapPath,
  engineEnv,
  engineRunArgs,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertHasMcpHint } from "./mcp_hint_asserts.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";

const ENCODER = new TextEncoder();

/** Set the repository convergence commands for an MCP lifecycle fixture. */
async function setRepositoryEnsure(
  dir: string,
  commands: string[],
): Promise<void> {
  const configPath = join(dir, "discern.toml");
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  editor.setStringArray("repository.ensure", commands);
  await writeDiscernToml(configPath, editor.toString());
}

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
  PrepareOutputSchema,
  RefreshOutputSchema,
  StandardsOutputSchema,
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

type ListedTool = z.output<typeof MCP_TOOL_SCHEMA>;

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

const MCP_RESULT_SCHEMA = z.object({
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
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }).passthrough(),
  ).optional(),
}).passthrough();

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

/** Infrastructure allowance for successful initialized-server responses. */
const MCP_RECV_TIMEOUT_MS: number = (() => {
  const raw = Number(
    Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.testMcpTimeoutMs) ?? "",
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

/**
 * Infrastructure allowance for the first response. It includes cold Deno and
 * module startup. Initialized-server calls keep an equal allowance because
 * stdio exposes no later request-readiness transition; tests of a genuine
 * timeout pass their short behavioral deadline explicitly to `recv`.
 */
const MCP_SERVER_READINESS_TIMEOUT_MS: number = (() => {
  const raw = Number(
    Deno.env.get(
      DISCERN_ENVIRONMENT_VARIABLES.testMcpReadinessTimeoutMs,
    ) ?? "",
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

Deno.test("MCP success responses retain the load-safe readiness allowance", () => {
  assert(
    MCP_RECV_TIMEOUT_MS >= MCP_SERVER_READINESS_TIMEOUT_MS,
    "an initialized server response has no separate observable readiness marker, so a shorter wall-clock budget turns scheduler load into a false failure",
  );
});

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
class McpClient {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private stdinClosed = false;
  private readerCancelled = false;
  private receivedResponse = false;
  private readonly statusPromise: Promise<Deno.CommandStatus>;
  private exitStatus: Deno.CommandStatus | undefined;

  constructor(private child: Deno.ChildProcess) {
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

  /** Send one raw line, for protocol-robustness tests below the JSON encoder. */
  async sendRaw(line: string): Promise<void> {
    await this.writer.write(ENCODER.encode(line));
  }

  /** Read the next non-empty JSON line from the server. */
  // deno-lint-ignore no-explicit-any
  async recv(timeoutMs?: number): Promise<any> {
    const deadlineMs = timeoutMs ??
      (this.receivedResponse
        ? MCP_RECV_TIMEOUT_MS
        : MCP_SERVER_READINESS_TIMEOUT_MS);
    let outcome:
      | { readonly ok: true; readonly value: unknown }
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
  // deno-lint-ignore no-explicit-any
  private async recvLine(): Promise<any> {
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
      await settledWithin(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
    if (status !== undefined) {
      return status;
    }
    try {
      this.child.kill("SIGTERM");
    } catch {
      // It raced to exit.
    }
    status = this.exitStatus ??
      await settledWithin(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
    if (status !== undefined) {
      return status;
    }
    try {
      this.child.kill("SIGKILL");
    } catch {
      // It raced to exit.
    }
    status = this.exitStatus ??
      await settledWithin(this.statusPromise, MCP_PROCESS_EXIT_GRACE_MS);
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

  /** Await a clean exit and release the stdout reader. */
  async finish(): Promise<number> {
    const status = await this.exitWithEscalation();
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
async function spawnMcp(
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

const MCP_SPAWN_CALL = ["await ", "spawnMcp("].join("");

/** Source lines that start a live MCP server without lexical async disposal. */
function unmanagedMcpSpawnLines(source: string): string[] {
  return source.split("\n").flatMap((line, index) =>
    line.includes(MCP_SPAWN_CALL) && !line.includes("await using ")
      ? [`${index + 1}: ${line.trim()}`]
      : []
  );
}

Deno.test("mcp harness: every live server binding is async-disposed — future cases auto-enrol", async () => {
  assertEquals(
    unmanagedMcpSpawnLines(
      await Deno.readTextFile(new URL(import.meta.url)),
    ),
    [],
    "bind every spawn with `await using` so timeout and assertion failures reap the server",
  );
  const futureSibling = ["const future = ", MCP_SPAWN_CALL, "root);"].join("");
  assertEquals(
    unmanagedMcpSpawnLines(futureSibling),
    [`1: ${futureSibling}`],
    "an unmanaged future live-server case must enter the detector",
  );
});

/** Read the valid verb events written by a spawned MCP server. */
async function readMcpVerbEvents(
  dir: string,
): Promise<Extract<LogbookEvent, { kind: "verb" }>[]> {
  const events: Extract<LogbookEvent, { kind: "verb" }>[] = [];
  const logDir = join(dir, ".git", "discern", "logbook");
  for await (const entry of Deno.readDir(logDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const text = await Deno.readTextFile(join(logDir, entry.name));
    for (
      const line of text.split("\n").filter((candidate) => candidate !== "")
    ) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event", `unparseable MCP logbook line: ${line}`);
      if (parsed.event.kind === "verb") {
        events.push(parsed.event);
      }
    }
  }
  return events;
}

/** Create a clean accepted HEAD while allowing an empty fixture commit. */
async function commitWorktreeForAcceptance(
  dir: string,
  message = "prepare acceptance",
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

Deno.test("mcp: discern_patterns reads sealed historical Stats without modifying the archive", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const archives = logbookArchiveDir(join(dir, ".git"));
    const filename = "logbook-20260811T120000Z.jsonl";
    const path = join(archives, filename);
    await Deno.mkdir(archives, { recursive: true });
    await Deno.writeTextFile(
      path,
      `${
        JSON.stringify({
          schema: 1,
          at: "2026-08-11T12:00:00.000Z",
          writer: "9.9.9",
          kind: "verb",
          verb: "done",
          surface: "cli",
          branch: "main",
          head: "abc1234",
          clean: true,
          outcome: "ok",
          duration_ms: 1,
          epoch: null,
        })
      }\n`,
    );
    const before = await Deno.readFile(path);
    const tool = TOOLS.find((candidate) =>
      candidate.name === "discern_patterns"
    );
    assert(tool !== undefined);
    const result = await runTool(tool, new WorkingRoot(dir), {
      logbook_file: filename,
      stats: true,
      all: true,
    });
    assertEquals(result.isError, false, JSON.stringify(result));
    const parsed = PatternsOutputSchema.parse(result.structuredContent);
    assertResultDataKey(parsed, "logbook");
    const data = parsed.data;
    assertEquals(data.logbook.source, {
      kind: "archive",
      filename,
    });
    assertEquals(data.logbook.events, 1);
    assert(data.stats !== undefined);
    assertEquals(await Deno.readFile(path), before);
  });
});

Deno.test("mcp: discern_patterns carries synthesized investigations beside raw findings", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    const values = [85, 88, 86, 89, 87];
    const events = values.map((value, index) => ({
      schema: 1,
      at: new Date(Date.UTC(2026, 6, 1, index)).toISOString(),
      kind: "verb",
      verb: "done",
      surface: "cli",
      writer: "9.9.9",
      driver: {
        session: "cli:mcp-investigation",
        json: true,
        tty: false,
        ci: false,
      },
      branch: "agent/mcp-investigation",
      head: `head-${index}`,
      clean: true,
      outcome: "ok",
      duration_ms: 1_000,
      epoch: "investigation-epoch",
      standards: [{
        name: "coverage",
        direction: "up",
        limit: 80,
        margin: 2,
        measurement: "measured",
        value,
        verdict: "improved",
        pin_eligible: true,
        pin_target: value - 2,
      }],
    }));
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    const tool = TOOLS.find((candidate) =>
      candidate.name === "discern_patterns"
    );
    assert(tool !== undefined);
    const result = await runTool(tool, new WorkingRoot(dir), {});
    assertEquals(result.isError, false, JSON.stringify(result));
    const parsed = PatternsOutputSchema.parse(result.structuredContent);
    assertResultDataKey(parsed, "investigations");
    const data = parsed.data;
    assertEquals(
      data.investigations.map(({ id }) => id),
      ["standard-variance/coverage"],
    );
    assert(
      data.findings.some((finding) =>
        finding.detector === "standard-trajectory"
      ),
      "the MCP synthesis must retain its raw source finding",
    );
  });
});

// ---------------------------------------------------------------------------
// B38 class guard: a tool declared root-INDEPENDENT must stay reachable when the
// server spawned OUTSIDE any discern project (working root undefined), because it
// serves the same answer from anywhere — the CLI serves `discern docs` from
// anywhere too. The pre-fix runTool applied ONE uniform not_initialized guard to
// every tool, refusing docs outside a project.
//
// Driven off the TOOLS table's `rootIndependent` flag (the single source of
// truth), so a future root-free tool auto-enrols; the complementary half asserts
// every root-DEPENDENT tool IS still refused there, proving the flag gates real
// behaviour and can't be silently dropped to a no-op.
// ---------------------------------------------------------------------------
Deno.test("mcp: a root-independent tool serves from a server spawned outside any project; a root-dependent one refuses (B38)", async () => {
  // WorkingRoot(undefined) is exactly the state runMcpServer seeds when findRoot()
  // returns undefined — the server spawned outside any discern project.
  const outsideAnyProject = (): WorkingRoot => new WorkingRoot(undefined);

  const independent = TOOLS.filter((t) => t.rootIndependent === true);
  assert(
    independent.length > 0,
    "at least one tool must be root-independent (discern_docs) — the flag is gone if this is empty",
  );
  for (const tool of independent) {
    // No `path` — the pure spawned-outside-a-project case (docs declares no path arg).
    const res = await runTool(tool, outsideAnyProject(), {});
    assertEquals(
      res.isError,
      false,
      `${tool.name} is root-independent but was refused outside a project: ${
        JSON.stringify(res.structuredContent)
      }`,
    );
    assertEquals(
      res.structuredContent.ok,
      true,
      JSON.stringify(res.structuredContent),
    );
    assertEquals(
      res.structuredContent.error,
      undefined,
      `${tool.name} must not refuse outside a project`,
    );
  }

  // Every OTHER tool genuinely operates on the project — outside one it must refuse
  // with not_initialized (never silently run against the wrong place). `dry_run`
  // keeps any that DID slip through fast and side-effect-free.
  for (const tool of TOOLS.filter((t) => t.rootIndependent !== true)) {
    const res = await runTool(tool, outsideAnyProject(), { dry_run: true });
    assertEquals(
      res.isError,
      true,
      `${tool.name} is root-dependent and must refuse outside a project`,
    );
    assertEquals(
      res.structuredContent.error,
      "not_initialized",
      `${tool.name} outside a project must refuse with not_initialized, got ${
        JSON.stringify(res.structuredContent.error)
      }`,
    );
    const message = String(res.structuredContent.message);
    assertStringIncludes(message, "no discern.toml");
    assertStringIncludes(message, "discern setup");
    assertStringIncludes(message, "move into an existing discern project");
  }
});

Deno.test("mcp (live): discern_docs serves discern's own docs from a server spawned outside any project (B38)", async () => {
  // A bare temp dir with no discern.toml in it or any ancestor — findRoot() at server
  // startup returns undefined, so the server runs with WorkingRoot(undefined), the
  // real spawned-outside-a-project state. End-to-end over stdio, proving the whole
  // tool path (not just runTool) serves docs there.
  await withTempDir(async (dir) => {
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_docs", arguments: {} },
    });
    const docs = await mcp.recv();
    assertEquals(
      docs.result.isError,
      false,
      `discern_docs must serve outside a project: ${
        JSON.stringify(docs.result.structuredContent)
      }`,
    );
    const data = docs.result.structuredContent.data as {
      docs?: { slug: string }[];
    };
    assert(
      (data.docs ?? []).some((d) => d.slug === "config-reference"),
      "docs outside a project indexes discern's own bundled docs",
    );

    assertEquals(await mcp.close(), 0);
  });
});

// ---------------------------------------------------------------------------
// B40 class guard: a `path` argument must be ABSOLUTE — its own schema says "this
// absolute path". The server's OS cwd is frozen at spawn and is not the caller's
// directory, so the pre-fix runTool, passing a relative `path` straight to
// findRoot, silently resolved it against that stale cwd and could operate on the
// WRONG project while reporting success. The choke point now refuses a relative
// path with a clear error, so EVERY tool that takes `path` inherits the check.
//
// Driven off the TOOLS table: every tool whose input schema declares `path` is
// exercised, so a future path-taking tool auto-enrols.
// ---------------------------------------------------------------------------
Deno.test("mcp: every tool refuses a relative `path` argument instead of resolving it against the spawn cwd (B40)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);

    const pathTools = TOOLS.filter((t) =>
      Object.keys(t.inputSchema).includes("path")
    );
    assert(
      pathTools.length > 0,
      "expected tools that declare a `path` argument — the class is empty otherwise",
    );
    for (const tool of pathTools) {
      // A relative path plus a VALID working root: if the check were missing, the
      // relative string would resolve against the server cwd (or fall through) —
      // never the actionable refusal. `dry_run` guards against any side effect were
      // the refusal absent.
      const res = await runTool(tool, new WorkingRoot(dir), {
        path: "some/relative/dir",
        dry_run: true,
      });
      assertEquals(
        res.isError,
        true,
        `${tool.name} accepted a relative path: ${
          JSON.stringify(res.structuredContent)
        }`,
      );
      assertEquals(
        res.structuredContent.error,
        "invalid_arguments",
        `${tool.name} must refuse a relative path with invalid_arguments, got ${
          JSON.stringify(res.structuredContent.error)
        }`,
      );
      assertStringIncludes(
        String(res.structuredContent.message ?? ""),
        "absolute",
        `${tool.name}'s refusal must tell the caller the path has to be absolute`,
      );
    }
  });
});

Deno.test("discern mcp: initialize, tools/list, and tools/call render DiscernResults", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(join(dir, "discern.toml"))}\n` +
        '[scopes.preview_probe]\npaths = ["preview/**"]\n' +
        'preview = "deno task preview:probe"\n',
    );
    await gitInit(dir);
    await Deno.mkdir(join(dir, "preview"), { recursive: true });
    await Deno.writeTextFile(join(dir, "preview/change.txt"), "changed\n");
    await using mcp = await spawnMcp(dir);

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
    assert(names.includes("discern_done"), JSON.stringify(names));
    assert(names.includes("discern_refresh"), JSON.stringify(names));
    const refreshTool = list.result.tools.find((tool: { name: string }) =>
      tool.name === "discern_refresh"
    );
    assert(
      refreshTool?.inputSchema?.properties?.dry_run !== undefined,
      "refresh must expose its preview over MCP",
    );
    assert(names.includes("discern_prepare"), JSON.stringify(names));
    assert(names.includes("discern_test"), JSON.stringify(names));
    assert(names.includes("discern_doctor"), JSON.stringify(names));
    const doctorTool = list.result.tools.find((tool: { name: string }) =>
      tool.name === "discern_doctor"
    );
    assert(
      doctorTool?.inputSchema?.properties?.verbose !== undefined,
      "doctor's complete execution model must be an explicit verbose input",
    );
    assert(names.includes("discern_impact"), JSON.stringify(names));
    assert(names.includes("discern_status"), JSON.stringify(names));
    assert(names.includes("discern_improvement"), JSON.stringify(names));
    // `discern_docs` (discern's own docs) is always listed — not a project feature.
    assert(names.includes("discern_docs"), JSON.stringify(names));
    // The feature-gated tools are listed too (the default scaffold has every
    // feature on).
    assert(names.includes("discern_map"), JSON.stringify(names));
    // The worktree lifecycle tools are always listed now (ADR 0062 retired the
    // location-based hiding): start, accept, and update all appear from a
    // main-rooted server (covered in depth by the listing test below).
    assert(names.includes("discern_start"), JSON.stringify(names));
    assert(names.includes("discern_accept"), JSON.stringify(names));
    assert(names.includes("discern_update"), JSON.stringify(names));

    // tools/call discern_done {dry_run:true} → the preview DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_done", arguments: { dry_run: true } },
    });
    const call = await mcp.recv();
    assertEquals(call.id, 3);
    assertEquals(call.result.isError, false);
    const finish = call.result.structuredContent;
    assertEquals(finish.ok, true);
    assertEquals(finish.verb, "done");
    assertEquals(finish.dry_run, true); // the uniform preview signal, over MCP too
    assertEquals(finish.steps, undefined); // a preview serializes no effects
    assertEquals(finish.plan.title, "Gate plan"); // a preview carries the plan
    // Text is the authored Markdown projection of the same prepared result.
    assertStringIncludes(call.result.content[0].text, "# `discern done`");
    assertStringIncludes(call.result.content[0].text, "## Current state");
    assertStringIncludes(
      call.result.content[0].text,
      "## Current state\n\n**Dry run: nothing changed.**",
    );
    assertStringIncludes(call.result.content[0].text, "Gate plan");
    assertStringIncludes(call.result.content[0].text, "Would check");
    assert(
      !call.result.content[0].text.includes('"verb": "done"'),
      call.result.content[0].text,
    );

    const skillsTarget = join(dir, ".claude/skills");
    assertEquals(await targetExists(skillsTarget), false);
    await mcp.send({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "discern_refresh", arguments: { dry_run: true } },
    });
    const refreshPreview = await mcp.recv();
    assertEquals(refreshPreview.id, 31);
    assertEquals(refreshPreview.result.isError, false);
    assertEquals(refreshPreview.result.structuredContent.ok, true);
    assertEquals(refreshPreview.result.structuredContent.verb, "refresh");
    assertEquals(refreshPreview.result.structuredContent.dry_run, true);
    assertEquals(
      refreshPreview.result.structuredContent.plan.title,
      "Refresh plan",
    );
    assertStringIncludes(
      refreshPreview.result.content[0].text,
      "**Dry run: nothing changed.**",
    );
    assertStringIncludes(
      refreshPreview.result.content[0].text,
      ".claude/skills/discern-write-adr",
    );
    assertEquals(
      await targetExists(skillsTarget),
      false,
      "an MCP refresh preview must not materialize skills",
    );

    // tools/call discern_impact → its DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_impact", arguments: {} },
    });
    const cs = await mcp.recv();
    assertEquals(cs.result.structuredContent.verb, "impact");
    assert(Array.isArray(cs.result.structuredContent.data.scopes));
    assertEquals(cs.result.structuredContent.data.preview_actions, [{
      scope: "preview_probe",
      command: "deno task preview:probe",
    }]);

    // tools/call discern_status → the situation/orientation DiscernResult. The
    // server launched in the main checkout (no worktrees) → a local view.
    await mcp.send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "discern_status",
        arguments: {},
        _meta: {
          [MCP_CLIENT_INFO_META_KEY]: {
            name: "cursor-vscode",
            version: "2.0.0",
          },
        },
      },
    });
    const status = await mcp.recv();
    assertEquals(status.id, 10);
    assertEquals(status.result.isError, false);
    assertEquals(status.result.structuredContent.verb, "status");
    assertEquals(status.result.structuredContent.data.location, "main");
    assert(
      Array.isArray(status.result.structuredContent.data.standards),
      "status data carries the configured standards",
    );

    // tools/call discern_improvement → the continuous-improvement DiscernResult.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "discern_improvement", arguments: {} },
    });
    const improve = await mcp.recv();
    assertEquals(improve.id, 6);
    assertEquals(improve.result.structuredContent.verb, "improvement");
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
    assertEquals(
      doctor.result.structuredContent.data.execution_model,
      undefined,
    );
    assert(
      Array.isArray(doctor.result.structuredContent.data.provider_trust),
      "doctor MCP data carries typed provider trust guidance",
    );
    assert(
      doctor.result.structuredContent.data.provider_trust.every(
        (trust: { actions: unknown[] }) =>
          trust.actions.every((action: unknown) =>
            typeof action === "object" && action !== null &&
            Array.isArray((action as { facts?: unknown }).facts)
          ),
      ),
      "every MCP trust action carries typed literal facts",
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 70,
      method: "tools/call",
      params: { name: "discern_doctor", arguments: { verbose: true } },
    });
    const verboseDoctor = await mcp.recv();
    assertEquals(verboseDoctor.id, 70);
    assert(
      Array.isArray(
        verboseDoctor.result.structuredContent.data.execution_model,
      ),
      "verbose doctor carries the complete execution model",
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
    assertHasMcpHint(
      test.result.structuredContent,
      HINTS["test-job-not-configured"],
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
    const recordedEvents = await readMcpVerbEvents(dir);
    const statusEvent = recordedEvents.find((event) => event.verb === "status");
    assert(
      statusEvent !== undefined,
      "the live MCP status call must be recorded",
    );
    assertEquals(statusEvent.driver?.mcp_client, {
      name: "cursor-vscode",
      version: "2.0.0",
    });
    assert(
      statusEvent.driver?.agent_signals?.some((signal) =>
        signal.agent === "cursor" && signal.source === "mcp-client" &&
        signal.markers.includes("clientInfo.name")
      ) === true,
      "the name-only Cursor client must override initialized clientInfo and classify through the catalogue",
    );
    const impactEvent = recordedEvents.find((event) => event.verb === "impact");
    assert(
      impactEvent !== undefined,
      "the live MCP impact call must be recorded",
    );
    assertEquals(
      impactEvent.driver?.mcp_client,
      { name: "test", version: "0" },
      "without request metadata, initialized clientInfo is the fallback",
    );
  });
});

Deno.test("discern mcp: protocol version, ping, and unknown method are handled correctly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);

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

Deno.test("discern mcp: a config parse failure stays structured and the server answers the next call", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Corrupt the config after startup: the server keeps its registered tool
    // surface, while coupling's config boundary returns the user-originated
    // parse refusal instead of misclassifying it as an engine crash.
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
    assertEquals(failed.result.structuredContent.error, "invalid_toml");
    const message = String(failed.result.structuredContent.message);
    assertStringIncludes(message, "syntax error near line");
    assertStringIncludes(message, "discern.toml");
    assertHasMcpHint(
      failed.result.structuredContent,
      HINTS["failure-recovery"],
      { verb: "coupling" },
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_docs", arguments: {} },
    });
    const next = await mcp.recv();
    assertEquals(next.result.isError, false, JSON.stringify(next.result));
    assertEquals(next.result.structuredContent.verb, "docs");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: concurrent calls keep a crash signature on the call that crashed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);

    const status = TOOLS.find((tool) => tool.name === "discern_status");
    const docs = TOOLS.find((tool) => tool.name === "discern_docs");
    assertExists(status);
    assertExists(docs);

    let signalCapture: (() => void) | undefined;
    const captureStarted = new Promise<void>((resolve) => {
      signalCapture = resolve;
    });
    const failure = new TypeError("parallel crash");
    Object.defineProperty(failure, "stack", {
      configurable: true,
      get: () => {
        signalCapture?.();
        return [
          "TypeError: parallel crash",
          "    at explode (file:///tmp/project/src/parallel.ts:12:3)",
        ].join("\n");
      },
    });

    const crashingTool = {
      ...status,
      run: (): Promise<never> => Promise.reject(failure),
    };
    const successfulTool = {
      ...docs,
      run: async (): Promise<DiscernResult> => {
        // Resume only after the other call has entered crash capture. The
        // crashing call then yields while saving its report, so this call
        // crosses the MCP completion boundary first.
        await captureStarted;
        return { ok: true, verb: "docs" };
      },
    };

    const [crashResult, successResult] = await Promise.all([
      runTool(
        crashingTool,
        new WorkingRoot(dir),
        {},
        undefined,
        () => Promise.resolve(KIT_VERSION),
      ),
      runTool(
        successfulTool,
        // This root-independent call has no recorder. It still crosses the
        // same completion boundary, so the old process-global mailbox let it
        // steal another request's signature without introducing a second
        // concurrent logbook append into the regression itself.
        new WorkingRoot(undefined),
        {},
        undefined,
        () => Promise.resolve(KIT_VERSION),
      ),
    ]);
    assertEquals(crashResult.structuredContent.error, "internal_error");
    assertEquals(successResult.structuredContent.ok, true);

    const events = await readMcpVerbEvents(dir);
    const crashed = events.find((event) => event.verb === "status");
    assertExists(crashed);
    assertEquals(crashed.outcome, "failed");
    assertEquals(crashed.crash, {
      name: "TypeError",
      frame: "src/parallel.ts:12:3",
    });
    assertEquals(
      events.some((event) => event.verb === "docs"),
      false,
      "a root-independent call outside a project has no logbook recorder",
    );
  });
});

Deno.test("discern mcp: a malformed JSON line does not prevent the next valid call", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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

Deno.test("discern mcp: status projects the same setup applicability counts and labels", async () => {
  await withTempDir(async (dir) => {
    const applicableNames = Object.keys(KNOWN_JOBS).filter((name) =>
      name !== "build"
    );
    const applicableTotal = applicableNames.length;
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = false",
        "",
        "[assurance]",
        'not_applicable = ["build"]',
        "",
        "[jobs]",
        ...applicableNames.map((name) => `${name} = "${name}"`),
      ].join("\n"),
    );
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_status", arguments: {} },
    });
    const status = await mcp.recv();
    const unfinished = status.result.structuredContent.data.setup_unfinished;
    assertEquals(unfinished.assurance.enforced, applicableTotal);
    assertEquals(unfinished.assurance.total, applicableTotal);
    assertEquals(
      unfinished.assurance.known_total,
      Object.keys(KNOWN_JOBS).length,
    );
    assertEquals(unfinished.assurance.not_applicable, 1);
    assertEquals(
      unfinished.known_jobs.find((job: { name: string }) =>
        job.name === "build"
      )?.not_applicable,
      true,
    );
    assertStringIncludes(
      status.result.content[0].text,
      `Applicable protections: ${applicableTotal} of ${applicableTotal} enforced; 1 does not apply; verdict \`full\`.`,
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: wrong-typed arguments return a field-naming Zod validation error", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_done", arguments: { dry_run: "yes" } },
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

Deno.test("discern mcp: EVERY tool refuses an undeclared argument loudly — never silently stripped", async () => {
  // Class guard: an open input schema silently STRIPS unknown keys, so an argument a
  // tool doesn't declare (e.g. `path` on a tool without it) would vanish and the verb
  // would run with different semantics, reporting success — for a mutating verb, the
  // worst failure shape an agent-facing surface can have. Every tool registers a
  // CLOSED schema (strictInput), so the same call must instead fail with a validation
  // error naming the stray key. Driven live over one server and iterated over TOOLS,
  // so a new tool auto-enrols; validation fires before the verb core runs, so even
  // the mutating tools stay side-effect-free here.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    let id = 2;
    for (const tool of TOOLS) {
      await mcp.send({
        jsonrpc: "2.0",
        id: id++,
        method: "tools/call",
        params: { name: tool.name, arguments: { not_an_argument: true } },
      });
      const rejected = await mcp.recv();
      const text = JSON.stringify(rejected);
      assert(
        rejected.error !== undefined || rejected.result?.isError === true,
        `${tool.name} accepted an argument it does not declare: ${text}`,
      );
      assertStringIncludes(
        text,
        "not_an_argument",
        `${tool.name}'s refusal must name the stray key so the caller can fix the call`,
      );
    }
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_map indexes, searches, scopes, reads, and reports misses", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The scaffold ships no map tree until setup — seed a tiny one.
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas of the project.\n",
    );
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "task-left.md"),
      "# Copper orchard\n",
    );
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "task-right.md"),
      "# Velvet beacon\n",
    );
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_map", arguments: {} },
    });
    const index = await mcp.recv();
    assertEquals(index.result.isError, false);
    assertEquals(index.result.structuredContent.verb, "map");
    assert(index.result.structuredContent.data.count >= 1);
    const regions = index.result.structuredContent.data.regions;
    assert(regions.length >= 1);
    for (const region of regions) {
      assert(!("staleness" in region), JSON.stringify(region));
      assert(!("status" in region), JSON.stringify(region));
      assert(!("code_paths" in region), JSON.stringify(region));
      assertEquals("pages_changed_at" in region, false);
      assertEquals("code_changes_since" in region, false);
    }
    const entry = index.result.structuredContent.data.docs[0];
    assertEquals(typeof entry.slug, "string");
    assert(entry.slug.length > 0, JSON.stringify(entry));

    // A target → that one doc's full Markdown content.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_map", arguments: { target: entry.slug } },
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
      params: { name: "discern_map", arguments: { target: "no-such-doc" } },
    });
    const miss = await mcp.recv();
    assertEquals(miss.result.isError, true);
    assertEquals(miss.result.structuredContent.error, "not_found");

    // Search returns a bounded result with a canonical follow-up target.
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "discern_map",
        arguments: { search: "core ideas" },
      },
    });
    const search = await mcp.recv();
    assertEquals(search.result.isError, false);
    const searchData = search.result.structuredContent.data;
    assertEquals(searchData.results[0].target, "00-orientation/concepts");
    assertEquals(searchData.results[0].match, "complete");
    assertEquals("score" in searchData.results[0], false);

    // A top-level region is both a compact index target and a search scope.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "discern_map",
        arguments: { target: "00-orientation" },
      },
    });
    const region = await mcp.recv();
    assertEquals(region.result.isError, false);
    assertEquals(region.result.structuredContent.data.scope, "00-orientation");

    await mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "discern_map",
        arguments: { target: "00-orientation", search: "core ideas" },
      },
    });
    const scoped = await mcp.recv();
    assertEquals(scoped.result.isError, false);
    assertEquals(
      scoped.result.structuredContent.data.scope,
      "00-orientation",
    );

    // Task terms can span documents; MCP returns and labels both partials.
    await mcp.send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "discern_map",
        arguments: {
          search: "copper orchard velvet beacons telescope",
        },
      },
    });
    const partials = await mcp.recv();
    assertEquals(partials.result.isError, false);
    assertEquals(
      new Set(
        partials.result.structuredContent.data.results.map(
          (result: { target: string }) => result.target,
        ),
      ),
      new Set([
        "00-orientation/task-left",
        "00-orientation/task-right",
      ]),
    );
    assert(
      partials.result.structuredContent.data.results.every(
        (result: { match: string }) => result.match === "partial",
      ),
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_docs returns discern's OWN docs, not the project's", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The host project has its own map — discern_docs must ignore it and serve
    // discern's bundled documentation (resolved module-relative to this repo).
    await Deno.mkdir(defaultMapPath(dir), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "project-only.md"),
      "# Project Only\n\nNothing to do with discern.\n",
    );
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_docs", arguments: {} },
    });
    const index = await mcp.recv();
    assertEquals(index.result.isError, false);
    assertEquals(index.result.structuredContent.verb, "docs");
    assertEquals(index.result.structuredContent.data.map_dir, undefined);
    const docs = index.result.structuredContent.data.docs;
    assert(
      docs.some((d: { slug: string }) => d.slug === "config-reference"),
      "discern_docs serves discern's own docs (the config reference)",
    );
    assert(
      !docs.some((d: { slug: string }) => d.slug === "project-only"),
      "discern_docs must not serve the host project's docs",
    );
    // The internal ADR/maintainer trees are never exposed over MCP.
    assert(
      docs.every((d: { path: string }) =>
        !d.path.includes("_adr") && !d.path.includes("_internal") &&
        !d.path.includes("_private")
      ),
      "discern_docs excludes every internal subtree",
    );

    // A target → that one doc's full Markdown content.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "discern_docs",
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

    // A frontmatter alias resolves like a slug ("config" is a declared alias
    // of the config reference).
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_docs", arguments: { target: "config" } },
    });
    const viaAlias = await mcp.recv();
    assertEquals(viaAlias.result.isError, false);
    assertEquals(
      viaAlias.result.structuredContent.data.doc.slug,
      "config-reference",
      "a frontmatter alias resolves to its page",
    );

    // A near-miss target → a not_found error envelope with retryable suggestions.
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "discern_docs",
        arguments: { target: "config-referenc" },
      },
    });
    const miss = await mcp.recv();
    assertEquals(miss.result.isError, true);
    assertEquals(miss.result.structuredContent.verb, "docs");
    assertEquals(miss.result.structuredContent.error, "not_found");
    assertStringIncludes(miss.result.structuredContent.message, "Closest");
    assert(
      miss.result.structuredContent.data.suggestions.some(
        (suggestion: { slug: string }) =>
          suggestion.slug === "config-reference",
      ),
      "config-reference remains among the retryable suggestions",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: docs tool and resources serve exactly the staged public set", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const source = join(dir, "source-map");
    const files: Record<string, string> = {
      "README.md": "# Public front door\n",
      "00-orientation/README.md": "# Orientation\n",
      "00-orientation/guide.md": "# Public guide\n\nVisible.\n",
      "00-orientation/withheld.md": "---\npublish: false\n---\n# Withheld\n",
      "_adr/0001-internal.md": "# Internal decision\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      const path = join(source, rel);
      await Deno.mkdir(join(path, ".."), { recursive: true });
      await Deno.writeTextFile(path, content);
    }
    const staged = join(dir, "staged-docs");
    const copied = await stageBundledDocs(source, staged);
    const expectedPaths = copied.map((rel) => `staged-docs/${rel}`);

    await using mcp = await spawnMcp(dir, { DISCERN_DOCS_DIR: staged });
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
      params: { name: "discern_docs", arguments: {} },
    });
    const tool = await mcp.recv();
    const toolPaths = tool.result.structuredContent.data.docs.map(
      (doc: { path: string }) => doc.path,
    );
    assertEquals(toolPaths, expectedPaths);

    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: "discern://docs" },
    });
    const resource = await mcp.recv();
    const resourcePaths = decodeWith(
      DocsDataSchema,
      resource.result.contents[0].text,
    ).docs?.map((doc) => doc.path) ?? [];
    assertEquals(resourcePaths, expectedPaths);
    assert(
      resourcePaths.every((path: string) =>
        !path.includes("withheld") && !path.includes("_adr")
      ),
      "MCP docs must expose neither withheld pages nor internal records",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: pre-setup gates map but not the gate proof verbs or docs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // `discern_map` still refuses with the structured not_set_up envelope — its
    // tree is empty until setup fills it.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_map", arguments: {} },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(refused.result.structuredContent.error, "not_set_up");

    // `discern_done` is a gate PROOF verb — un-gated during setup (ADR 0065) so
    // the agent can iterate while wiring capabilities — but it carries the
    // setup-in-progress hint so a green run can't be mistaken for "done".
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_done", arguments: {} },
    });
    const finish = await mcp.recv();
    assertEquals(finish.result.structuredContent.verb, "done");
    assert(finish.result.structuredContent.error !== "not_set_up");
    assertHasMcpHint(
      finish.result.structuredContent,
      HINTS["setup-unfinished-gate"],
    );

    // `discern_docs` stays open pre-setup — discern's own docs are what you need now.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_docs", arguments: {} },
    });
    const docs = await mcp.recv();
    assertEquals(docs.result.isError, false);
    assertEquals(docs.result.structuredContent.verb, "docs");
    assert(docs.result.structuredContent.data.count > 0);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: noisy Gate output stays inside the result under both stream settings", async () => {
  for (const stream of [false, true]) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { agents: [] });
      await writeConfig(
        dir,
        [
          "[project]",
          'slug = "mcp-gate-silence"',
          "agents = []",
          "",
          "[instructions]",
          "sources = []",
          "",
          "[jobs]",
          `format = "printf 'MCP-GATE-NOISE\\n'; exit 7"`,
          "",
          "[gate]",
          `stream = ${stream}`,
          "",
        ].join("\n"),
      );
      await gitInit(dir);
      await using mcp = await spawnMcp(dir);
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
        params: { name: "discern_done", arguments: {} },
      });
      const response = await mcp.recv();
      assertEquals(response.result.structuredContent.ok, false);
      assertEquals(response.result.structuredContent.verb, "done");
      assertStringIncludes(
        JSON.stringify(response.result.structuredContent.diagnostics),
        "MCP-GATE-NOISE",
      );
      assertEquals(await mcp.close(), 0);
    });
  }
});

Deno.test("discern mcp: discern_accept previews an acceptance from inside a worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From inside a WORKTREE (its branch already contains main): a dry-run returns
    // the acceptance plan and touches nothing. (accept is always listed now; it
    // still requires a worktree to act on — the listing test covers visibility.)
    const wt = await addWorktree(dir, "grad");
    await using wtMcp = await spawnMcp(wt);
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
      params: { name: "discern_accept", arguments: { dry_run: true } },
    });
    const preview = await wtMcp.recv();
    assertEquals(preview.result.isError, false);
    assertEquals(preview.result.structuredContent.verb, "accept");
    assertEquals(preview.result.structuredContent.dry_run, true);
    assert(
      preview.result.structuredContent.plan,
      "an accept preview carries the plan",
    );
    assertStringIncludes(
      preview.result.content[0].text,
      "## Current state\n\n**Dry run: nothing changed.**",
    );
    assertStringIncludes(preview.result.content[0].text, "Would run");
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_update is an idempotent no-op from an up-to-date worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const logAttempt = "printf 'MCP_UNFRAMED_LOG_ATTEMPT\\n'";
    await setRepositoryEnsure(dir, [logAttempt]);
    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await gitInit(dir);

    // From inside a WORKTREE whose branch already contains main: a real (non-dry-run)
    // call is an idempotent success — nothing merged (the merge step is skipped),
    // while the refresh + ensure convergence still runs (what makes a plain re-run
    // the recovery after a manually resolved conflict). (update is always listed
    // now; it still requires a worktree to act on, per the listing test.)
    const wt = await addWorktree(dir, "intg");
    await using wtMcp = await spawnMcp(wt);
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    };
    await wtMcp.send(initialize);
    await wtMcp.recv();
    const updateCall = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_update", arguments: {} },
    };
    await wtMcp.send(updateCall);
    const noop = await wtMcp.recv();
    assertEquals(
      noop.result.isError,
      false,
      JSON.stringify(noop.result, null, 2),
    );
    assertEquals(noop.result.structuredContent.verb, "update");
    const steps = noop.result.structuredContent.steps as Array<
      { label: string; outcome: string }
    >;
    assertEquals(
      steps.find((step) => step.label === logAttempt)?.outcome,
      "ok",
      "the log-attempting command ran; recv decoded the next stdout line as JSON-RPC, proving no unframed output preceded it",
    );
    assertEquals(
      steps.find((s) => s.label === "merge")?.outcome,
      "skipped",
      `an up-to-date update merges nothing: ${
        JSON.stringify(noop.result.structuredContent)
      }`,
    );
    assertEquals(
      steps.find((s) => s.label === BUILT_IN_STEP_LABELS.completeRefresh)
        ?.outcome,
      "ok",
      `the no-op still re-converges (refresh runs): ${
        JSON.stringify(noop.result.structuredContent)
      }`,
    );
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("discern mcp: a failed no-op convergence returns command recovery", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await setRepositoryEnsure(dir, ["exit 7"]);
    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await gitInit(dir);

    const wt = await addWorktree(dir, "intg-failed-convergence");
    await using wtMcp = await spawnMcp(wt);
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
      params: { name: "discern_update", arguments: {} },
    });
    const failed = await wtMcp.recv();
    assertEquals(failed.result.isError, true, JSON.stringify(failed.result));
    const payload = failed.result.structuredContent as {
      ok: boolean;
      diagnostics?: Array<{ tool: string; reproduce_cmd: string }>;
      hints?: string[];
    };
    assertEquals(payload.ok, false);
    assertEquals(
      payload.diagnostics?.find((entry) => entry.tool === "repository-ensure")
        ?.reproduce_cmd,
      "exit 7",
    );
    assertHasMcpHint(
      payload,
      HINTS["lifecycle-convergence-failed"],
    );
    assertEquals(await wtMcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_update returns schema-valid data for a real merge", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "intg-data");

    await Deno.writeTextFile(join(dir, "upstream.txt"), "landed\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    await using mcp = await spawnMcp(wt);
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
      params: { name: "discern_update", arguments: {} },
    });
    const merged = await mcp.recv();
    assertEquals(merged.result.isError, false, JSON.stringify(merged.result));
    const payload = merged.result.structuredContent;
    const parsed = UpdateOutputSchema.safeParse(payload);
    assert(
      parsed.success,
      `update MCP payload drifted from schema:\n${
        JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
      }\n${JSON.stringify(payload, null, 2)}`,
    );
    assertEquals(payload.verb, "update");
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
    const generatedPath = "mcp-projection.snapshot";
    const generatedGroup = "mcp-projection";
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        `[generated.${generatedGroup}]`,
        `paths = [${JSON.stringify(generatedPath)}]`,
        'run = "true"',
        "",
      ].join("\n"),
    );
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
      await commit(
        {
          "a.ts": `${i}`,
          "b.ts": `${i}`,
          [generatedPath]: `${i}`,
        },
        `ab${i}`,
      );
    }
    for (let i = 0; i < 5; i++) {
      await commit({ [`n${i}.ts`]: "1", [`m${i}.ts`]: "1" }, `noise${i}`);
    }
    await Deno.writeTextFile(join(dir, "a.ts"), "staged\n");
    await Deno.writeTextFile(join(dir, generatedPath), "staged\n");

    await using mcp = await spawnMcp(dir);
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
    assertEquals(diff.result.structuredContent.data.excluded_generated, [{
      path: generatedPath,
      group: generatedGroup,
    }]);
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
    assert(
      !query.result.structuredContent.data.partners.some((
        p: { path: string },
      ) => p.path === generatedPath),
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
      params: {
        name: "discern_coupling",
        arguments: { file: generatedPath },
      },
    });
    const generated = await mcp.recv();
    assertEquals(
      generated.result.isError,
      false,
      JSON.stringify(generated.result),
    );
    assert(
      CouplingOutputSchema.safeParse(generated.result.structuredContent)
        .success,
    );
    assertEquals(generated.result.structuredContent.data, {
      mode: "query",
      target: generatedPath,
      partners: [],
      excluded_generated: [{
        path: generatedPath,
        group: generatedGroup,
      }],
    });
    assertHasMcpHint(
      generated.result.structuredContent,
      HINTS["coupling-generated-exclusion"],
      { path: generatedPath, group: generatedGroup },
    );

    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
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
  const LIFECYCLE = ["discern_start", "discern_update", "discern_accept"];
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // From the MAIN checkout: ALL three lifecycle tools are listed and named in the
    // instructions. ADR 0062 retired the location-based hiding — every lifecycle tool
    // is always registered, and discern_start re-aims the server's working root, so a
    // main-rooted session can drive the whole lifecycle through one connection.
    await using main = await spawnMcp(dir);
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

    // The defensive refusals are KEPT (ADR 0062): accept is now callable from the
    // trunk, but its core still refuses — there is no worktree to accept. Visible,
    // not silent — a clean precondition_failed, the safety boundary the cores own.
    await main.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_accept", arguments: { dry_run: true } },
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
    await using wtMcp = await spawnMcp(wt);
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
  // moved by discern_start (→ the new worktree) and discern_accept (→ back to spawn).
  const w = new WorkingRoot("/repo");
  assertEquals(w.get(), "/repo");
  w.set("/repo.worktrees/alpha"); // start re-aims at the new worktree
  assertEquals(w.get(), "/repo.worktrees/alpha");
  w.set("/repo"); // accept resets to the spawn root
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

Deno.test("mcp lifecycle re-aim: a failed start cannot move the held root even when its payload carries a path", () => {
  const start = TOOLS.find((tool) => tool.name === "discern_start");
  assert(start?.reaimAfterResult !== undefined);
  const refusal: DiscernResult = {
    ok: false,
    verb: "start",
    error: "precondition_failed",
    message: "Start refused.",
    data: {
      path: "/repo.worktrees/must-not-become-root",
    },
  };

  assertEquals(
    start.reaimAfterResult(refusal, { heldRootMissing: false }),
    undefined,
  );
});

Deno.test("discern mcp: project commands execute in the path-resolved worktree, not the server cwd", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs.cwd]",
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
    await using mcp = await spawnMcp(dir);
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
        name: "discern_done",
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
      await targetExists(marker),
      "the gate passed but its project command ran outside the targeted worktree",
    );
    assertEquals(
      (await Deno.readTextFile(marker)).trim(),
      await Deno.realPath(worktree),
    );
    assertEquals(
      await targetExists(join(dir, "command.cwd")),
      false,
      "the worktree-targeted command leaked into the MCP server's main cwd",
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: start then accept over ONE main-rooted session — the working root re-aims (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // The motivating flow this whole record exists to fix: an agent on the trunk opens
    // ONE MCP connection, starts a worktree, and accepts it — without ever re-rooting
    // the connection. Before ADR 0062 this was impossible (accept was hidden from a
    // main-rooted server, and even revealed it gated the trunk); now discern_start
    // re-aims the server's working root at the new worktree, so accept lands it.
    await using mcp = await spawnMcp(dir);
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
      await targetExists(join(wtPath, "CLAUDE.md")),
      "the created worktree is set up",
    );
    await commitWorktreeForAcceptance(wtPath);

    // discern_accept over the SAME connection now operates on the re-aimed working
    // root (the new worktree), not the trunk — and SUCCEEDS. This is the headline
    // guard: it fails against today's main, where accept is hidden (→ "not found").
    // `confirmed` attests the owner accepted this landing (ADR 0134).
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_accept", arguments: { confirmed: true } },
    });
    const landed = await mcp.recv();
    assertEquals(
      landed.result.isError,
      false,
      JSON.stringify(landed.result),
    );
    assertEquals(landed.result.structuredContent.verb, "accept");
    assertEquals(landed.result.structuredContent.ok, true);
    // accept removed the worktree it landed — proof it acted on the worktree, not the
    // (still-present) trunk.
    assertEquals(
      await targetExists(wtPath),
      false,
      "accept removed the worktree directory",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a worktree-spawned server re-aims to main on accept even with an explicit `path`, since accept removed its held root (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Codex's app-managed-worktree flow (Phase B) spawns the MCP server INSIDE the
    // worktree, so its spawn root IS the worktree — unlike Claude Code, launched from
    // the trunk. A main-rooted server creates + sets up the worktree (start refuses from
    // inside one), then we hand it to a server rooted THERE, the way Codex does.
    await using maker = await spawnMcp(dir);
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
    assert(await targetExists(join(wtPath, "CLAUDE.md")), "worktree is set up");
    await commitWorktreeForAcceptance(wtPath);
    assertEquals(await maker.close(), 0);

    // The accepting server is rooted IN the worktree (spawn root = the worktree).
    await using inWt = await spawnMcp(wtPath);
    await inWt.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await inWt.recv();

    // accept with an EXPLICIT `path` (the worktree) — Codex's exact call — removes
    // the spawn-root worktree. A `path` override normally leaves the held root alone
    // (§2), but accept just deleted the directory that root points at, so it must
    // re-root anyway. The result reports the main checkout it landed in.
    await inWt.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "discern_accept",
        arguments: { path: wtPath, confirmed: true },
      },
    });
    const landed = await inWt.recv();
    assertEquals(
      landed.result.isError,
      false,
      JSON.stringify(landed.result),
    );
    const landedRoot = landed.result.structuredContent.data.root as string;
    assert(
      typeof landedRoot === "string" && landedRoot.length > 0,
      JSON.stringify(landed.result.structuredContent),
    );
    assertEquals(
      await targetExists(wtPath),
      false,
      "accept removed the worktree",
    );

    // The headline: a subsequent call with NO `path` must follow the re-aimed working
    // root to the MAIN CHECKOUT — not the removed worktree. Without the held-root-missing
    // re-aim, the explicit `path` on accept would skip re-aiming, leaving this `status`
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
    // The status root is exactly the root accept re-aimed to (the main checkout).
    assertEquals(status.result.structuredContent.data.root, landedRoot);

    assertEquals(await inWt.close(), 0);
  });
});

Deno.test("discern mcp: a partial accept that removed its held worktree still re-aims and records the landed effects", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "partial-branch-delete");
    await commitWorktreeForAcceptance(worktree);
    const branch = await gitOut(worktree, "branch", "--show-current");

    // Let landing and worktree removal complete, then fail only the final branch
    // deletion. A loose-ref lock is Git's deterministic refusal at that seam.
    const branchLock = join(
      dir,
      ".git",
      "refs",
      "heads",
      `${branch}.lock`,
    );
    await Deno.mkdir(dirname(branchLock), { recursive: true });
    await Deno.writeTextFile(branchLock, "held by test\n");

    const acceptTool = TOOLS.find((tool) => tool.name === "discern_accept");
    const statusTool = TOOLS.find((tool) => tool.name === "discern_status");
    assert(acceptTool !== undefined);
    assert(statusTool !== undefined);
    const working = new WorkingRoot(worktree);

    const partial = await runTool(
      acceptTool,
      working,
      { confirmed: true },
      undefined,
      () => Promise.resolve(undefined),
      undefined,
      "unknown-client",
      TEST_CLI_MODEL,
    );
    assertEquals(partial.isError, true);
    assertEquals(partial.structuredContent.error, "partial_acceptance");
    const partialData = partial.structuredContent.data as {
      root?: unknown;
      consent?: unknown;
      landing?: unknown;
    } | undefined;
    const canonicalRoot = await Deno.realPath(dir);
    assertEquals(partialData?.root, canonicalRoot);
    assertEquals(partialData?.consent, {
      source: "conversation",
    });
    assertEquals(partialData?.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: false,
    });
    assertEquals(await targetExists(worktree), false);
    assertEquals(
      working.get(),
      canonicalRoot,
      "the deleted held root must re-aim even though the envelope is partial",
    );

    const follow = await runTool(
      statusTool,
      working,
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(follow.isError, false, JSON.stringify(follow));
    const followData = follow.structuredContent.data as {
      location?: unknown;
      root?: unknown;
    } | undefined;
    assertEquals(followData?.location, "main");
    assertEquals(followData?.root, canonicalRoot);

    const event = (await readMcpVerbEvents(dir)).findLast((candidate) =>
      candidate.verb === "accept"
    );
    assert(event !== undefined);
    assertEquals(event.outcome, "partial");
    assertEquals(
      (event as unknown as { landing?: unknown }).landing,
      partialData?.landing,
    );

    await Deno.remove(branchLock);
  });
});

Deno.test("discern mcp: accepting a DIFFERENT worktree by `path` leaves the held root alone (ADR 0062 §2 preserved)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // The other side of the held-root-removed rule: re-aiming on a `path` override must
    // fire ONLY when accept removed the root you're HOLDING — never when you accept
    // some OTHER worktree by path while still working in your own. Make two worktrees,
    // hold one, accept the other. (Each `start` runs from a fresh main-rooted server,
    // because a server re-aims into the worktree it just started and `start` then refuses
    // from inside one.)
    const startFromMain = async (): Promise<string> => {
      await using m = await spawnMcp(dir);
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
    const other = await startFromMain(); // the worktree we accept by path
    await commitWorktreeForAcceptance(other);

    // A server rooted in `held`, accepting `other` by explicit path.
    await using inHeld = await spawnMcp(held);
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
        name: "discern_accept",
        arguments: { path: other, confirmed: true },
      },
    });
    const landed = await inHeld.recv();
    assertEquals(
      landed.result.isError,
      false,
      JSON.stringify(landed.result),
    );
    assertEquals(
      await targetExists(other),
      false,
      "the OTHER worktree was removed",
    );
    assert(await targetExists(held), "the held worktree is untouched");

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

Deno.test("discern mcp: discern_accept with no prior discern_start refuses cleanly (working root = trunk)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // No discern_start has moved the working root, so it is still the spawn root (the
    // trunk). accept is visible now (ADR 0062 retired the hiding) but its core
    // refuses — there is no worktree to accept. `confirmed` is passed so the consent
    // gate (ADR 0134) is satisfied and the precondition refusal is what fires: a clean
    // precondition_failed, not a silent false green gating the trunk (the very failure
    // §2 of the ADR guards).
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_accept", arguments: { confirmed: true } },
    });
    const refused = await mcp.recv();
    assertEquals(refused.result.isError, true);
    assertEquals(
      refused.result.structuredContent.verb,
      "accept",
    );
    assertEquals(
      refused.result.structuredContent.error,
      "precondition_failed",
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_accept without confirmed refuses read-only with awaiting_consent (ADR 0134)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Start a worktree (re-aims the working root to it) and commit landable work.
    await mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "discern_start", arguments: {} },
    });
    const started = await mcp.recv();
    const wtPath = started.result.structuredContent.data.path as string;
    await commitWorktreeForAcceptance(wtPath);

    // accept WITHOUT confirmed refuses — the same awaiting_consent slug setup begin
    // uses, carrying ≥1 hint, and touching nothing (the worktree survives). This is
    // the MCP mirror of the CLI refusal: the consent gate fires before any git.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_accept", arguments: {} },
    });
    const refused = await mcp.recv();
    assertEquals(
      refused.result.isError,
      true,
      JSON.stringify(refused.result),
    );
    assertEquals(refused.result.structuredContent.verb, "accept");
    assertEquals(
      refused.result.structuredContent.error,
      "awaiting_consent",
    );
    assert(
      (refused.result.structuredContent.hints ?? []).length >= 1,
      JSON.stringify(refused.result.structuredContent),
    );
    assert(
      await targetExists(wtPath),
      "the refusal must not remove the worktree",
    );

    // confirmed: true over the same connection lands it — the byte-identical
    // success path, gated only by the attestation.
    await mcp.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "discern_accept", arguments: { confirmed: true } },
    });
    const landed = await mcp.recv();
    assertEquals(
      landed.result.isError,
      false,
      JSON.stringify(landed.result),
    );
    assertEquals(landed.result.structuredContent.ok, true);
    assertEquals(landed.result.structuredContent.data.consent, {
      source: "conversation",
    });
    assertStringIncludes(
      landed.result.structuredContent.data.proof_line,
      "landed with conversation consent",
    );
    assertEquals(
      await targetExists(wtPath),
      false,
      "a confirmed accept lands and removes the worktree",
    );
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: an explicit `path` wins over the working root (ADR 0062 §2)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    await using mcp = await spawnMcp(dir);
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

Deno.test("discern mcp: discern_start with `path` creates the worktree for ANOTHER project — the cross-project entry point (ADR 0111)", async () => {
  // Two discern projects side by side; the server spawns in A. `path` into B on
  // discern_start must mint B's worktree (the creation target follows `path`, the
  // same resolution every other root-operating tool honours) and the re-aim must
  // follow it: the next no-`path` call operates on B's new worktree, while A —
  // the spawn project — is untouched. Before this was declared, the SDK silently
  // STRIPPED the argument and start minted the worktree in A, the wrong project,
  // while reporting success.
  await withTempDir(async (dirA) => {
    await withTempDir(async (dirB) => {
      await scaffoldEngine(dirA);
      await gitInit(dirA);
      await scaffoldEngine(dirB);
      await gitInit(dirB);

      await using mcp = await spawnMcp(dirA);
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
          name: "discern_start",
          arguments: { path: dirB, name: "cross project" },
        },
      });
      const started = await mcp.recv();
      assertEquals(
        started.result.isError,
        false,
        JSON.stringify(started.result),
      );
      const data = started.result.structuredContent.data;
      // The worktree landed in B's sibling worktrees dir, not A's. Compared by the
      // unique temp basename (never the full prefix), so a /private-style realpath
      // difference can't produce a false miss.
      const wtPath = data.path as string;
      assert(
        wtPath.includes(`${basename(dirB)}.worktrees`),
        `worktree must land under B's worktrees dir: ${wtPath}`,
      );
      assert(
        !wtPath.includes(`${basename(dirA)}.worktrees`),
        `worktree must NOT land under A's worktrees dir: ${wtPath}`,
      );

      // The re-aim followed the cross-project start: a no-`path` call now operates
      // on B's new worktree (the same worktree id start just returned)…
      await mcp.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "discern_status", arguments: {} },
      });
      const followed = await mcp.recv();
      assertEquals(followed.result.structuredContent.data.location, "worktree");
      assertEquals(
        followed.result.structuredContent.data.worktree.id,
        data.id,
        "the held working root must follow the cross-project worktree",
      );

      // …while A, the spawn project, still answers by explicit `path` and holds no
      // worktree from this start.
      await mcp.send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "discern_status", arguments: { path: dirA } },
      });
      const spawnProject = await mcp.recv();
      assertEquals(spawnProject.result.structuredContent.data.location, "main");

      assertEquals(await mcp.close(), 0);
    });
  });
});

Deno.test("discern mcp: a `path` outside any discern project falls through to not_initialized", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A path with no discern.toml in it or any ancestor (the system temp, outside the
    // project tree) → findRoot returns undefined → the uniform not_initialized refusal.
    await withTempDir(async (outside) => {
      await using mcp = await spawnMcp(dir);
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
    }, { prefix: "discern-not-a-project-" });
  });
});

Deno.test("discern mcp: after discern_start, discern_status follows the re-aimed working root, and the start hint spells out the agent's own move (ADR 0062 §4)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
    assertHasMcpHint(
      started.result.structuredContent,
      HINTS["start-mcp-re-root"],
      { path: wtPath },
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

Deno.test("generic worktree instructions stays within agent-observable state", () => {
  // An agent that cannot change its working root must read the SAME fallback —
  // prefix every shell command with `cd <path> &&`, and pass `path` to every
  // discern tool. A vendor UI may pause a tool call before execution without
  // reporting that pause to the agent, so human-only approval state and editor
  // actions cannot appear on these generic agent surfaces.
  const mcpHint = mcpStartHint("/wt/x");
  assertHasMcpHint(
    { hints: [mcpHint] },
    HINTS["start-mcp-re-root"],
    { path: "/wt/x" },
  );
  const worktreePolicy = OPERATING_POLICIES.find((policy) =>
    policy.id === "worktree-first"
  );
  assert(worktreePolicy !== undefined, "missing worktree-first policy");
  assertStringIncludes(buildInstructions(), worktreePolicy.statement);
  const surfaces: Record<string, string> = {
    "worktree instructions template": Deno.readTextFileSync(
      new URL("../templates/instructions/worktrees.md", import.meta.url),
    ),
    "discern_start MCP hint": mcpHint,
    "worktree-first operating policy": worktreePolicy.statement,
    "MCP server instructions": buildInstructions(),
  };
  const humanOnlyTopics = AGENT_NAMES.flatMap((name) =>
    providerFor(name)?.humanSetupAdvice?.humanOnlyTopics ?? []
  );
  assert(
    humanOnlyTopics.length > 0,
    "expected at least one provider-declared human-only setup topic",
  );
  for (const [name, text] of Object.entries(surfaces)) {
    assert(/cd .*&&/.test(text), `${name} must teach the cd-prefix: ${text}`);
    assert(
      /pass\s+`?path/i.test(text),
      `${name} must say to pass \`path\` to every discern tool: ${text}`,
    );
    for (
      const forbidden of [
        /\bif (?:your|a|the) client\b/i,
        /open[^.\n]{0,80}(?:worktree|returned path)[^.\n]{0,80}workspace/i,
        /external file protection/i,
        /(approval|approve)[^.\n]{0,80}(edit|file)/i,
      ]
    ) {
      assert(
        !forbidden.test(text),
        `${name} conditions agent instructions on human-only editor state: ${text}`,
      );
    }
    for (const topic of humanOnlyTopics) {
      assert(
        !text.toLowerCase().includes(topic.toLowerCase()),
        `${name} includes provider-declared human-only setup topic "${topic}"`,
      );
    }
  }
  for (
    const [name, text] of Object.entries({
      "worktree-first operating policy": worktreePolicy.statement,
      "MCP server instructions": buildInstructions(),
    })
  ) {
    assert(
      /own file operations/i.test(text),
      `${name} must distinguish the agent's file operations from discern's re-aimed tools: ${text}`,
    );
    assert(
      /otherwise edits[^.]*trunk[^.]*gate[^.]*worktree/i.test(text),
      `${name} must spell out the trunk/worktree divergence: ${text}`,
    );
  }
});

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("discern mcp: tools advertise a title, an outputSchema, and honest annotations", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Every tool lists from either location now (ADR 0062 retired the location-based
    // hiding), so one worktree-rooted server advertises them all — verify each
    // lifecycle tool's self-describing surface and honest annotations here.
    const wt = await addWorktree(dir, "adv");
    await using mcp = await spawnMcp(wt);
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
      "discern_impact",
      "discern_coupling",
      "discern_await",
      "discern_patterns",
      "discern_status",
      "discern_improvement",
      "discern_checkpoints",
      "discern_map",
      "discern_docs",
    ]);
    const MUTATING_TOOLS = new Set([
      "discern_refresh",
      "discern_done",
      "discern_prepare",
      "discern_test",
      "discern_standards",
      "discern_standards_propose",
      "discern_start",
      "discern_update",
    ]);
    const DESTRUCTIVE_TOOLS = new Set(["discern_accept"]);
    const IDEMPOTENT_MUTATING_TOOLS = new Set([
      "discern_refresh",
      "discern_standards_propose",
      "discern_update",
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
    // verbs mutate; accept is destructive; update is the lifecycle's mutating
    // idempotent operation (a no-op once already current).
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
      const closedWorldTools = new Set([
        ...READ_ONLY_TOOLS,
        "discern_refresh",
        "discern_standards_propose",
      ]);
      assertEquals(
        annotations.openWorldHint,
        closedWorldTools.has(tool.name) ? false : undefined,
        `${tool.name} openWorldHint`,
      );
    }
    assertEquals(
      sorted(IDEMPOTENT_MUTATING_TOOLS),
      [
        "discern_refresh",
        "discern_standards_propose",
        "discern_update",
      ],
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
      byName.get("discern_done")?.annotations?.openWorldHint,
      undefined,
    );
    assertEquals(
      byName.get("discern_refresh")?.annotations?.openWorldHint,
      false,
    );
    assertEquals(
      byName.get("discern_standards")?.annotations?.openWorldHint,
      undefined,
    );
    assertEquals(
      byName.get("discern_accept")?.annotations?.openWorldHint,
      undefined,
    );

    // The advertised outputSchema names the envelope fields it validates, and
    // finish's narrows `data` to the gate payload.
    const finishProps = byName.get("discern_done")?.outputSchema?.properties;
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
    await using mcp = await spawnMcp(dir);
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
        "discern_prepare",
        "discern_done",
        "discern_update",
        "discern_await",
        "discern_accept",
        "discern_test",
        "discern_standards",
        "discern_standards_propose",
        "discern_impact",
        "discern_coupling",
        "discern_patterns",
        "discern_checkpoints",
        "discern_refresh",
        "discern_map",
        "discern_docs",
        "discern_doctor",
        "discern_improvement",
      ],
      "MCP tools should be listed in deliberate workflow priority order for clients that truncate tools/list",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: await bounds follow the server's configured transport profile", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "await-auto");
    const tool = TOOLS.find((candidate) => candidate.name === "discern_await");
    assert(tool !== undefined);
    assertStringIncludes(
      tool.description,
      "Do not surface progress updates until it returns",
    );
    assertStringIncludes(
      tool.description,
      "continue with `data.resume` without surfacing an update",
    );
    assertStringIncludes(tool.description, AWAIT_WATCH_POLICY);

    const cases = [
      {
        client: { name: "codex-mcp-client", version: "1" },
        profile: "unknown-client",
        seconds: AWAIT_STRICT_CALL_SECONDS,
        basis: "unknown-client",
      },
      {
        client: undefined,
        profile: "strict-client",
        seconds: AWAIT_STRICT_CALL_SECONDS,
        basis: "strict-client",
      },
      {
        client: undefined,
        profile: "long-client",
        seconds: AWAIT_LONG_CALL_SECONDS,
        basis: "long-client",
      },
    ] as const;
    for (const fixture of cases) {
      const abort = new AbortController();
      abort.abort();
      const result = await runTool(
        tool,
        new WorkingRoot(dir),
        { green: "agent/await-auto" },
        abort.signal,
        () => Promise.resolve(undefined),
        fixture.client,
        fixture.profile,
      );
      assertEquals(result.isError, false, JSON.stringify(result));
      const data = result.structuredContent.data as {
        timeout_seconds?: unknown;
        timeout_basis?: unknown;
      } | undefined;
      assertEquals(data?.timeout_seconds, fixture.seconds);
      assertEquals(data?.timeout_basis, fixture.basis);
    }
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

    await using mcp = await spawnMcp(dir);
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
      "discern_refresh should rewrite generated instructions just like the CLI refresh",
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: discern_status metadata is search-shaped for orientation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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

/** Report startup-instruction violations for schema-deferred MCP clients. */
function instructionContractFailures(instructions: string): string[] {
  const failures: string[] = [];
  const bytes = ENCODER.encode(instructions).length;
  if (bytes >= MCP_INSTRUCTIONS_BYTE_LIMIT) {
    failures.push(`${bytes} bytes is not below ${MCP_INSTRUCTIONS_BYTE_LIMIT}`);
  }
  const seen = new Set<string>();
  const distinctTools = [...instructions.matchAll(/\bdiscern_[a-z_]+\b/g)]
    .map((match) => match[0])
    .filter((tool) => {
      if (seen.has(tool)) {
        return false;
      }
      seen.add(tool);
      return true;
    });
  for (const [index, tool] of MCP_CORE_LIFECYCLE.entries()) {
    const actual = distinctTools[index];
    if (actual !== tool) {
      failures.push(
        `${tool} should be lifecycle tool ${index + 1}; found ${
          actual ?? "nothing"
        }`,
      );
    }
  }
  return failures;
}

Deno.test("discern mcp: initialization instructions fit 2KB with the core lifecycle first", () => {
  assertEquals(MCP_CORE_LIFECYCLE, [
    "discern_status",
    "discern_start",
    "discern_prepare",
    "discern_done",
    "discern_update",
    "discern_await",
    "discern_accept",
  ]);
  assertEquals(instructionContractFailures(buildInstructions()), []);
});

Deno.test("the MCP instruction detector rejects future over-budget and misordered siblings", () => {
  const ordered = MCP_CORE_LIFECYCLE.join(" ");
  assertEquals(instructionContractFailures(ordered), []);
  assert(
    instructionContractFailures(`${ordered}${"x".repeat(2048)}`).some((f) =>
      f.includes("not below")
    ),
  );
  assert(
    instructionContractFailures(
      ordered.replace(
        "discern_prepare discern_done",
        "discern_done discern_prepare",
      ),
    ).some((f) => f.includes("discern_prepare")),
  );
});

Deno.test("discern mcp: accept requires the verbatim landing proof line", () => {
  const accept = TOOLS.find((tool) => tool.name === "discern_accept");
  assert(accept !== undefined, "discern_accept should be registered");
  assertStringIncludes(accept.description, "data.proof_line verbatim");
  assertStringIncludes(
    accept.description,
    "full review page remains available through `discern status --verbose`",
  );
});

Deno.test("discern mcp: discern_status documents its actionable data fields", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
    assert(
      new TextEncoder().encode(status.description).length < 1_500,
      `discern_status description exceeded its 1.5KB context budget:\n${status.description}`,
    );

    // What the agent SEES (the tool description) must name every actionable advisory
    // field status DOES emit — each tells the agent to run a command (`discern
    // refresh`, or finish setup). `stale_materialized` is why this guard exists: it
    // arrived with the materialized-skills currency check AFTER its two siblings were
    // documented, and silently went unmentioned. Pin the set so a new advisory
    // field can't drift into the payload undocumented the same way.
    for (
      const field of [
        "project",
        "gate_proof",
        "stale_generated",
        "stale_materialized",
        "stale_integrations",
        "setup_unfinished",
        "incoming_overlap",
        "reappeared_worktree_paths",
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

Deno.test("discern mcp: status carries project identity and compact fleet proof checks", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");
    const status = TOOLS.find((tool) => tool.name === "discern_status");
    assertExists(status);

    const result = await runTool(status, new WorkingRoot(dir), {});
    assertEquals(result.isError, false, JSON.stringify(result));
    const parsed = StatusOutputSchema.parse(result.structuredContent);
    assertResultDataKey(parsed, "location");
    assertEquals(parsed.data.project, "engine-test");
    assertExists(parsed.data.worktree);
    assertEquals(parsed.data.worktree.id, "main");
    assertEquals(parsed.data.worktree.seed, seedForBranch("main"));
    assertEquals(parsed.data.projection.mode, "orientation");
    assertEquals(parsed.data.fleet_total, 1);
    const alpha = parsed.data.fleet?.find((row) =>
      row.branch === "agent/alpha"
    );
    assertExists(alpha);
    assertEquals(alpha.gate_proof?.status, "missing");
    assert(
      !("proof_honored" in alpha),
      "compact rows must not retain the honored-only compatibility copy",
    );
    assertStringIncludes(
      (parsed.hints ?? []).join("\n"),
      "`discern_status` (verbose: true)",
    );

    const full = await runTool(status, new WorkingRoot(dir), {
      verbose: true,
    });
    const fullParsed = StatusOutputSchema.parse(full.structuredContent);
    assertResultDataKey(fullParsed, "location");
    assertEquals(fullParsed.data.projection.mode, "full");
    assertEquals(fullParsed.data.fleet?.length, 2);
    assert(
      !(fullParsed.hints ?? []).some((hint) =>
        hint.includes("bounded orientation projection")
      ),
      JSON.stringify(fullParsed.hints),
    );
  });
});

Deno.test("discern mcp: text content is the CLI Markdown projection of structuredContent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const status = TOOLS.find((tool) => tool.name === "discern_status");
    assertExists(status);

    const result = await runTool(status, new WorkingRoot(dir), {});
    const expected = renderResultMarkdown(
      result.structuredContent,
      resultPresenterForVerb("status"),
    );
    assertEquals(result.content, [{ type: "text", text: expected }]);
    assertStringIncludes(expected, "## Current state");
    assertStringIncludes(expected, "## Next action");
    assert(!expected.trimStart().startsWith("{"), expected);
  });
});

Deno.test("discern mcp: a tool call's structuredContent validates against its advertised schema", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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

Deno.test("discern mcp: discern_standards is listed (slow/on-demand), not read-only, and previews a dry-run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    // Listed with the standards feature on (the default scaffold).
    await mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await mcp.recv();
    const tools = list.result.tools as ListedTool[];
    const rt = tools.find((t) => t.name === "discern_standards");
    assert(rt !== undefined, "discern_standards should be listed");
    // It runs the metric commands, so it is NOT read-only.
    assertEquals(rt.annotations?.readOnlyHint, false);
    assertStringIncludes(rt.description, "clean worktree");
    assertStringIncludes(rt.description, "force");
    assert(
      !rt.description.includes("before pushing"),
      `standards description should not mention pushing:\n${rt.description}`,
    );
    assert(
      Object.hasOwn(rt.inputSchema?.properties ?? {}, "force"),
      "discern_standards input schema should expose force",
    );

    // A dry-run preview returns the plan and measures nothing.
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "discern_standards", arguments: { dry_run: true } },
    });
    const preview = await mcp.recv();
    assertEquals(preview.result.isError, false);
    assertEquals(preview.result.structuredContent.verb, "standards");
    assertEquals(preview.result.structuredContent.dry_run, true);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: a failing discern_standards apply returns an ok:false envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[standards.coverage]",
        'run = "echo DISCERN_METRIC coverage 10"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
      params: { name: "discern_standards", arguments: {} },
    });
    const failed = await mcp.recv();
    assertEquals(failed.result.isError, true, JSON.stringify(failed.result));
    const payload = failed.result.structuredContent;
    const parsed = StandardsOutputSchema.safeParse(payload);
    assert(parsed.success, JSON.stringify(payload));
    assertEquals(payload.ok, false);
    assertEquals(payload.verb, "standards");
    // The envelope carries the per-standard readings even on a red run — the
    // measured value and its regressed verdict, not just a failed step.
    const reading = payload.data?.standards?.find(
      (s: { name: string }) => s.name === "coverage",
    );
    assert(reading !== undefined, JSON.stringify(payload.data));
    assertEquals(reading.value, 10);
    assertEquals(reading.verdict, "regressed");
    assert(
      payload.steps.some((s: { outcome: string }) => s.outcome === "failed"),
      JSON.stringify(payload),
    );
    // …and the envelope says WHY, not just that it failed. The reason travels in
    // diagnostics[]: an MCP caller cannot hear the live logger, so a bare failed
    // step would force a fall-back to the CLI to learn what the CLI narrates. The
    // reproduce is the standard's own measurement command, and the applied step's
    // note carries the measured value.
    const diag = (payload.diagnostics ?? [])[0];
    assertEquals(diag?.tool, "coverage", JSON.stringify(payload));
    assertStringIncludes(diag?.message ?? "", "below the floor 80");
    assertStringIncludes(diag?.reproduce_cmd ?? "", "DISCERN_METRIC coverage");
    const failedStep = payload.steps.find(
      (s: { outcome: string }) => s.outcome === "failed",
    );
    assertStringIncludes(failedStep?.note ?? "", "measured 10");

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the server advertises a non-empty, MCP-first instructions block", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
    assert(instructions.includes("discern_done"), instructions);
    // Worktrees are on → the whole lifecycle is named linearly, from any root (ADR
    // 0062 retired the location-branched instructions): start, update, accept.
    assert(instructions.includes("discern_start"), instructions);
    assert(instructions.includes("discern_update"), instructions);
    assert(instructions.includes("discern_accept"), instructions);
    // Clients may load schemas only on demand, so the instructions must also
    // advertise fleet waiting; the discern_await schema carries its mechanics.
    assert(instructions.includes("discern_await"), instructions);
    assert(/explicit[^.]{0,80}consent/i.test(instructions), instructions);
    assert(
      /green gate[^.]{0,40}not permission/i.test(instructions),
      instructions,
    );
    // Diagnostics and standards are always present (every subsystem is core).
    assert(instructions.includes("discern_doctor"), instructions);
    assert(instructions.includes("discern_standards"), instructions);
    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the rendered surface names the project's configured trunk", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Customise the trunk — the value the graduate_to / instructions.sources
    // fixes proved the agent files must reflect. The MCP surface must reflect it too:
    // a description that names the branch shows the REAL one, never a baked-in "main".
    const set = await runAgent(dir, [
      "config",
      "set",
      "repository.trunk",
      "trunkline",
    ]);
    assertEquals(set.code, 0, set.output);

    await using mcp = await spawnMcp(dir);
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
    // discern_standards names the branch ("loosened versus `<main_branch>`") and is
    // visible from the main checkout, so it is the end-to-end witness here.
    const standards =
      (list.result.tools as { name: string; description: string }[])
        .find((t) => t.name === "discern_standards");
    assert(standards !== undefined, "discern_standards should be listed");
    assert(
      standards.description.includes("trunkline"),
      `the description must name the configured branch; got:\n${standards.description}`,
    );
    assert(
      !standards.description.includes("versus main"),
      `the hardcoded default must be gone; got:\n${standards.description}`,
    );
    assert(
      !standards.description.includes("before pushing"),
      `standards should not assume a remote-push workflow; got:\n${standards.description}`,
    );
    assert(!standards.description.includes("{{"), standards.description);

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: resources list, template, and read fresh content", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Seed a project map so discern://map has content.
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas of the project.\n",
    );
    await using mcp = await spawnMcp(dir);
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
        "discern://impact",
        "discern://config",
        "discern://docs",
        "discern://map",
      ]
    ) {
      assert(uris.includes(u), `${u} missing from ${JSON.stringify(uris)}`);
    }

    // resources/templates/list → the {+target} doc templates. The `+` is RFC 6570
    // reserved-expansion so a slash-bearing target (section/slug, a path) resolves;
    // a bare {target} stops at `/` and only ever matched a slug (B37).
    await mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/templates/list",
    });
    const templates = await mcp.recv();
    const tpl = (templates.result.resourceTemplates as {
      uriTemplate: string;
    }[]).map((t) => t.uriTemplate);
    assert(tpl.includes("discern://map/{+target}"), JSON.stringify(tpl));
    assert(tpl.includes("discern://docs/{+target}"), JSON.stringify(tpl));

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
    const statusData = decodeWith(StatusWireDataSchema, statusPart.text);
    assertEquals(statusData.location, "main");
    assertExists(statusData.worktree);
    assertEquals(statusData.worktree.id, "main");
    assertEquals(statusData.worktree.seed, seedForBranch("main"));
    assert(
      Array.isArray(statusData.standards),
      "the status resource carries the configured standards",
    );

    // read discern://impact
    await mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "discern://impact" },
    });
    const cs = await mcp.recv();
    assert(
      Array.isArray(
        decodeWith(ScopesDataSchema, cs.result.contents[0].text).scopes,
      ),
    );

    // read discern://config → the resolved DiscernConfig.
    await mcp.send({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: { uri: "discern://config" },
    });
    const cfg = await mcp.recv();
    assert(
      decodeWith(configSchema, cfg.result.contents[0].text).project,
      "the config resource carries [project]",
    );

    // read discern://docs (index) + a single manual page (Markdown).
    await mcp.send({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/read",
      params: { uri: "discern://docs" },
    });
    const docsIndex = await mcp.recv();
    assert(
      decodeWith(DocsDataSchema, docsIndex.result.contents[0].text).docs?.some(
        (d) => d.slug === "config-reference",
      ),
      "discern://docs indexes discern's own docs",
    );
    await mcp.send({
      jsonrpc: "2.0",
      id: 8,
      method: "resources/read",
      params: { uri: "discern://docs/config-reference" },
    });
    const docsPage = await mcp.recv();
    assertEquals(docsPage.result.contents[0].mimeType, "text/markdown");
    assert(docsPage.result.contents[0].text.includes("config reference"));

    // read discern://map (index) + the seeded project doc (Markdown).
    await mcp.send({
      jsonrpc: "2.0",
      id: 9,
      method: "resources/read",
      params: { uri: "discern://map" },
    });
    const mapIndex = await mcp.recv();
    const mapData = decodeWith(
      DocsDataSchema,
      mapIndex.result.contents[0].text,
    );
    const firstMapDoc = mapData.docs?.[0];
    assert(firstMapDoc !== undefined, "discern://map indexes a project doc");
    const slug = firstMapDoc.slug;
    await mcp.send({
      jsonrpc: "2.0",
      id: 10,
      method: "resources/read",
      params: { uri: `discern://map/${slug}` },
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

// ---------------------------------------------------------------------------
// B37 class guard: a doc resource template must resolve EVERY target form its
// description (and the mirroring discern_map/discern_docs tools) advertise —
// by slug, by `section/slug`, AND by path. The SDK compiles a bare `{target}`
// to a capture that stops at `/`, so before the `{+target}` fix only the
// slug form resolved and the two slash-bearing forms fell through to a
// not-found — a resource template narrower than the tool contract it mirrors.
//
// Driven off the SCHEME set (`map` + `docs`, every registered doc-tree
// scheme via registerDocTree), so a third doc-tree scheme auto-enrols; and
// off the live index, so the exact slug/section/path come from the server
// itself rather than a hand-copied fixture.
// ---------------------------------------------------------------------------
Deno.test("discern mcp: a doc resource resolves by slug, section/slug, AND path for every scheme (B37)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    // Seed a project doc UNDER A SECTION, so its `section/slug` and path forms are
    // genuinely slash-bearing (the forms the bare template could never match).
    const marker = "Sectioned doc body for the B37 addressing guard.";
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      `# Concepts\n\n${marker}\n`,
    );
    await using mcp = await spawnMcp(dir);
    await mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initParams(),
    });
    await mcp.recv();

    let id = 100;
    const readResource = async (uri: string): Promise<{
      result?: { contents?: { mimeType: string; text: string }[] };
      error?: { code: number; message: string };
    }> => {
      await mcp.send({
        jsonrpc: "2.0",
        id: id++,
        method: "resources/read",
        params: { uri },
      });
      return await mcp.recv();
    };

    // Every registered doc-tree scheme. Both are registered through the ONE
    // registerDocTree call, so this list IS the class; a new scheme added there
    // must be added here (or its slash-bearing forms would silently regress).
    for (const scheme of ["map", "docs"] as const) {
      // Read the index to discover a real doc with a non-empty section, so the
      // three target forms are computed from live data, not guessed.
      const index = await readResource(`discern://${scheme}`);
      const docs = decodeWith(
        DocsDataSchema,
        index.result?.contents?.[0]?.text ?? "{}",
      ).docs ?? [];
      assert(
        Array.isArray(docs) && docs.length > 0,
        `${scheme}: index carried no docs`,
      );
      // A doc under a section (so `section/slug` + path are genuinely slash-bearing)
      // whose slug is UNIQUE in the tree (so the bare-slug form is unambiguous —
      // discern's own manual carries many `README` files, an ambiguity orthogonal
      // to the template-matching this guard exercises).
      const slugCounts = new Map<string, number>();
      for (const d of docs) {
        slugCounts.set(d.slug, (slugCounts.get(d.slug) ?? 0) + 1);
      }
      const entry = docs.find((d) =>
        d.section !== "" && slugCounts.get(d.slug) === 1
      );
      assert(
        entry !== undefined,
        `${scheme}: no uniquely-slugged doc under a section to exercise the section/slug + path forms`,
      );

      // The three documented target forms — the slug, the section/slug, and the
      // (project-relative) path. The latter two contain `/`, so a bare `{target}`
      // template never matched them (B37).
      const forms: Record<string, string> = {
        slug: entry.slug,
        "section/slug": `${entry.section}/${entry.slug}`,
        path: entry.path,
      };
      for (const [label, target] of Object.entries(forms)) {
        const res = await readResource(`discern://${scheme}/${target}`);
        assertEquals(
          res.error,
          undefined,
          `${scheme} by ${label} ("${target}"): resource read errored — ${
            JSON.stringify(res.error)
          }`,
        );
        const part = res.result?.contents?.[0];
        assert(
          part !== undefined,
          `${scheme} by ${label} ("${target}"): no content returned`,
        );
        assertEquals(
          part.mimeType,
          "text/markdown",
          `${scheme} by ${label} ("${target}"): expected Markdown`,
        );
        assert(
          part.text.length > 0,
          `${scheme} by ${label} ("${target}"): empty document body`,
        );
      }

      // For the project docs scheme we also seeded a known body — assert every
      // form resolves to the SAME doc, not merely to some doc.
      if (scheme === "map") {
        for (const [label, target] of Object.entries(forms)) {
          const res = await readResource(`discern://${scheme}/${target}`);
          assertStringIncludes(
            res.result?.contents?.[0]?.text ?? "",
            marker,
            `map by ${label} ("${target}"): served a different doc's body`,
          );
        }
      }
    }

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("discern mcp: the resources follow the re-aimed working root after discern_start (ADR 0062)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
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
      decodeWith(StatusWireDataSchema, before.result.contents[0].text).location,
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
    const afterData = decodeWith(
      StatusWireDataSchema,
      after.result.contents[0].text,
    );
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
// this wiring, a client cancelling a discern_done call (or killing the server)
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
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "echo $$ > gate.pid && sleep 30"',
  ].join("\n");
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

/** Initialize handshake + the in-flight sleeper gate: start a discern_done
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
    params: { name: "discern_done", arguments: {} },
  });
  const pidFile = join(dir, "gate.pid");
  await waitUntil(
    async () => await targetExists(pidFile),
    "the gate's check job to start",
    { timeoutMs: 30_000, intervalMs: 50 },
  );
  const jobPid = Number((await Deno.readTextFile(pidFile)).trim());
  assert(Number.isFinite(jobPid) && jobPid > 0, `bad gate.pid: ${jobPid}`);
  return jobPid;
}

Deno.test("mcp: a response timeout tree-kills the server's in-flight gate before it rejects", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, sleeperConfig());
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    const jobPid = await startInFlightFinish(mcp, dir);
    let caught: unknown;
    try {
      try {
        await mcp.recv(25);
      } catch (error) {
        caught = error;
      }
      assert(caught instanceof Error, "the planted call must time out");
      assertStringIncludes(
        caught.message,
        "timed out waiting for MCP response",
      );
      await waitUntil(
        () => !pidAlive(jobPid),
        `timed-out gate job ${jobPid} to die`,
        { timeoutMs: 1_000, intervalMs: 50 },
      );
    } finally {
      await mcp.close().catch(() => undefined);
    }
  });
});

Deno.test("mcp: cancelling an in-flight discern_done tree-kills its gate jobs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, sleeperConfig());
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    const jobPid = await startInFlightFinish(mcp, dir);

    // The client cancels the call — the SDK aborts the request's signal, which
    // must reach the job runner's tree-kill.
    await mcp.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 2, reason: "user cancelled" },
    });
    await waitUntil(
      () => !pidAlive(jobPid),
      `cancelled gate job ${jobPid} to die`,
      { timeoutMs: 10_000, intervalMs: 50 },
    );

    assertEquals(await mcp.close(), 0);
  });
});

Deno.test("mcp: server shutdown (stdin EOF) tree-kills an in-flight gate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, sleeperConfig());
    await gitInit(dir);
    await using mcp = await spawnMcp(dir);
    const jobPid = await startInFlightFinish(mcp, dir);

    // The client closes the pipe mid-call — the server must cancel the run
    // (killing its jobs) before it exits, not leave them orphaned.
    await mcp.closeStdin();
    assertEquals(await mcp.finish(), 0);
    await waitUntil(
      () => !pidAlive(jobPid),
      `gate job ${jobPid} to die with the server`,
      { timeoutMs: 10_000, intervalMs: 50 },
    );
  });
});
