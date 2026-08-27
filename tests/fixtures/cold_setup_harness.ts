/**
 * Built-from-source cold-setup harness. Every discern phase is a fresh child
 * process; the harness only authors fixture inputs and samples externally
 * visible Git, filesystem, Proof, resource, and command evidence between them.
 */

import { isAbsolute, join, resolve } from "@std/path";
import { z } from "@zod/zod";
import { readTextIfExists } from "../../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../../src/shared/git_admin_state.ts";
import { runGit } from "../../src/shared/subprocess.ts";
import {
  engineEnv,
  engineRunArgs,
  git,
  gitInit,
  gitOut,
  type RunResult,
  runAgent,
} from "../engine_helpers.ts";
import { decodeWith } from "../decode_cli_result.ts";

const FreshMcpResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.object({
    tools: z.array(z.object({ name: z.string() }).passthrough()).optional(),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
  }).passthrough().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).passthrough().optional(),
}).passthrough();

/** One process invocation recorded by the journey in presentation order. */
export interface ColdSetupInvocation {
  readonly argv: readonly string[];
  readonly code: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

/** Externally observable repository state at a journey boundary. */
export interface ColdSetupSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly history: string;
  readonly refs: string;
  readonly status: string;
  readonly worktrees: string;
  readonly config: string | undefined;
  readonly proof: string | undefined;
  readonly proofNote: string | undefined;
  readonly jobLog: readonly string[];
  readonly resourceResidue: readonly string[];
}

/** Result of one fresh MCP session's exact tool-inventory lookup and call. */
export interface FreshMcpCall {
  readonly tools: readonly string[];
  readonly structuredContent: Record<string, unknown>;
}

/** Quote a literal path for a fixture-authored POSIX command string. */
export function coldShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Append a successful job name to Git-admin state without dirtying a checkout. */
export function countedColdJob(label: string, command: string): string {
  return `${command} && cold_job_log="$(git rev-parse --git-common-dir)/discern/cold-journey-jobs" && mkdir -p "$(dirname "$cold_job_log")" && printf '${label}\\n' >> "$cold_job_log"`;
}

/** A reusable, deterministic driver over one temporary Git repository. */
export class ColdSetupHarness {
  readonly invocations: ColdSetupInvocation[] = [];

  constructor(
    readonly root: string,
    readonly resourceRoot: string,
  ) {}

  /** Create the pre-discern repository and its ignored/private fixture state. */
  async initialize(externalReference: string): Promise<void> {
    await Deno.writeTextFile(
      join(this.root, "README.md"),
      "# Atlas\n\nA small offline command-line project.\n",
    );
    await Deno.writeTextFile(
      join(this.root, ".gitignore"),
      ".env\nnode_modules/\nruntime.sqlite\n",
    );
    await Deno.writeTextFile(
      join(this.root, "deno.json"),
      '{\n  "tasks": {\n    "check": "deno fmt --check && deno lint && deno check main.ts && deno test main_test.ts"\n  }\n}\n',
    );
    await Deno.writeTextFile(
      join(this.root, "main.ts"),
      "export const answer={value:42}\n",
    );
    await Deno.mkdir(join(this.root, "fixtures"), { recursive: true });
    await Deno.writeFile(
      join(this.root, "fixtures", "tracked.db"),
      new Uint8Array([0x53, 0x51, 0x4c, 0x00, 0xff, 0x01]),
    );
    await Deno.writeTextFile(
      join(this.root, "external-reference.txt"),
      `${externalReference}\n`,
    );
    await gitInit(this.root);
    await git(this.root, "branch", "foreign/keep");

    await Deno.writeTextFile(
      join(this.root, ".env"),
      "COLD_TOKEN=fixture-private-value\n",
    );
    await Deno.mkdir(join(this.root, "node_modules"), { recursive: true });
    await Deno.writeTextFile(
      join(this.root, "node_modules", "cache.txt"),
      "ignored dependency cache\n",
    );
    await Deno.writeTextFile(
      join(this.root, "runtime.sqlite"),
      "ignored local database\n",
    );
  }

  /** Invoke the source CLI in a separate process and record its output budget. */
  async run(
    argv: readonly string[],
    env: Record<string, string> = {},
  ): Promise<RunResult> {
    return await this.runAt(this.root, argv, env);
  }

  /** Invoke the source CLI from one linked worktree in a separate process. */
  async runAt(
    cwd: string,
    argv: readonly string[],
    env: Record<string, string> = {},
  ): Promise<RunResult> {
    const result = await runAgent(cwd, [...argv], { env });
    this.invocations.push({
      argv: [...argv],
      code: result.code,
      stdoutBytes: new TextEncoder().encode(result.stdout).length,
      stderrBytes: new TextEncoder().encode(result.stderr).length,
    });
    return result;
  }

  /** Read the job-order log shared by the main checkout and linked worktrees. */
  async jobLog(): Promise<string[]> {
    const rawCommon = await gitOut(this.root, "rev-parse", "--git-common-dir");
    const common = isAbsolute(rawCommon)
      ? rawCommon
      : resolve(this.root, rawCommon);
    const text = await readTextIfExists(
      join(common, "discern", "cold-journey-jobs"),
    );
    return text === undefined ? [] : text.split("\n").filter(Boolean);
  }

  /** Sample every durable boundary a replay, acceptance, or teardown may affect. */
  async snapshot(): Promise<ColdSetupSnapshot> {
    const proofPath = await gitAdminStatePath(this.root, "gateProof");
    const note = await runGit(
      ["notes", "--ref=discern", "show", "HEAD"],
      { cwd: this.root },
    );
    const resourceResidue: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.resourceRoot)) {
        resourceResidue.push(entry.name);
      }
      resourceResidue.sort();
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return {
      branch: await gitOut(this.root, "branch", "--show-current"),
      head: await gitOut(this.root, "rev-parse", "HEAD"),
      history: await gitOut(
        this.root,
        "log",
        "--format=%H%x00%P%x00%s",
      ),
      refs: await gitOut(
        this.root,
        "for-each-ref",
        "--format=%(refname)%00%(objectname)",
        "refs/heads",
      ),
      status: await gitOut(this.root, "status", "--porcelain=v1", "-z"),
      worktrees: await gitOut(this.root, "worktree", "list", "--porcelain"),
      config: await readTextIfExists(join(this.root, "discern.toml")),
      proof: proofPath === undefined
        ? undefined
        : await readTextIfExists(proofPath),
      proofNote: note.success ? note.stdout.trim() : undefined,
      jobLog: await this.jobLog(),
      resourceResidue,
    };
  }

  /**
   * Start a new local MCP process with no prior-session state, inspect only its
   * advertised tool names, and invoke the exact registered action.
   */
  async callFreshMcp(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<FreshMcpCall> {
    const child = new Deno.Command("deno", {
      args: engineRunArgs(["mcp"]),
      cwd: this.root,
      env: await engineEnv(),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    const reader = child.stdout.getReader();
    const stderrPromise = new Response(child.stderr).text();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let stdinClosed = false;
    let readerReleased = false;
    let processExited = false;
    const send = async (message: Record<string, unknown>): Promise<void> => {
      await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
    };
    const receive = async (): Promise<z.output<typeof FreshMcpResponseSchema>> => {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line !== "") return decodeWith(FreshMcpResponseSchema, line);
        }
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error("fresh MCP stdout closed before the next response");
        }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    try {
      await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "cold-setup-fresh-session", version: "1.0" },
        },
      });
      const initialized = await receive();
      if (initialized.id !== 1 || initialized.error !== undefined) {
        throw new Error(`fresh MCP initialization failed: ${JSON.stringify(initialized)}`);
      }
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const list = await receive();
      await send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      });
      const call = await receive();
      await writer.close();
      writer.releaseLock();
      stdinClosed = true;
      const status = await child.status;
      processExited = true;
      reader.releaseLock();
      readerReleased = true;
      const stderr = await stderrPromise;
      if (!status.success) {
        throw new Error(`fresh MCP process failed: ${stderr}`);
      }
      const tools = (list.result?.tools ?? []).map((tool) => tool.name);
      if (call.result?.structuredContent === undefined) {
        throw new Error(
          `fresh MCP call returned no structured content: ${stderr}\n${
            JSON.stringify(call)
          }`,
        );
      }
      return { tools, structuredContent: call.result.structuredContent };
    } finally {
      if (!stdinClosed) {
        await writer.close().catch(() => undefined);
        writer.releaseLock();
      }
      if (!readerReleased) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!processExited) {
        try {
          child.kill("SIGTERM");
        } catch {
          // The process raced to exit after stdin closed.
        }
      }
    }
  }
}
