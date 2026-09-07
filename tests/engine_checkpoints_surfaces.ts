/**
 * In-process surface seams shared by the checkpoint journey modules: the MCP
 * tool runner, the authored-Markdown projection that `--markdown` and the MCP
 * text content both render from one serialized envelope, and the observation
 * shape the surface matrices assert over. A journey keeps one `runAgent`
 * boundary case per surface family and projects the rest through these seams.
 */

import { assert } from "@std/assert";
import { z } from "@zod/zod";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { resultPresenterForVerb } from "../src/shared/result_contracts.ts";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { decodeWith } from "./decode_cli_result.ts";
import type { RunResult } from "./engine_helpers.ts";

/** One in-process MCP tool call's envelope pieces. */
export interface McpOutcome {
  readonly isError: boolean;
  readonly env: Record<string, unknown>;
}

/** Run one MCP tool by name against `root` — the server's own dispatch and
 * rendering, without a stdio transport. */
export async function runMcp(
  name: string,
  root: string,
  args: Record<string, unknown>,
): Promise<McpOutcome> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  assert(tool !== undefined, `${name} must be in the MCP tool registry`);
  const outcome = await runTool(
    tool,
    new WorkingRoot(root),
    args,
    undefined,
    () => Promise.resolve(undefined),
    undefined,
    "unknown-client",
    TEST_CLI_MODEL,
  );
  return {
    isError: outcome.isError === true,
    env: outcome.structuredContent as Record<string, unknown>,
  };
}

/** The serialized envelope exactly as `--json` printed it: no schema narrowing,
 * so the presenter sees every key the CLI's own Markdown path sees. */
const RAW_ENVELOPE = z.record(z.string(), z.unknown());

/**
 * Project one `--json` stdout through the authored Markdown presenter — the
 * same `renderResultMarkdown` call `emitResult` makes for `--markdown` and
 * `renderMcpResult` makes for the tool's text content, over the same
 * serialized envelope the JSON surface carries.
 */
export function markdownProjection(stdout: string, verb: string): string {
  return renderResultMarkdown(
    decodeWith(RAW_ENVELOPE, stdout),
    resultPresenterForVerb(verb),
  ).trimEnd();
}

/** What one surface observation must prove. */
export interface SurfaceObservation {
  readonly refused: boolean;
  readonly slug: unknown;
  /** Raw public text; the exact contract facts must occur here. */
  readonly evidence: string;
}

/** The refusal facts a decoded envelope carries. */
export interface EnvelopeFacts {
  readonly ok: boolean;
  readonly error?: string | undefined;
  readonly message?: string | undefined;
  readonly hints?: readonly string[] | undefined;
}

/** The json surface: the decoded envelope plus its process exit. */
export function jsonSurface(
  run: RunResult,
  env: EnvelopeFacts,
): SurfaceObservation {
  return {
    refused: run.code === 1 && env.ok === false,
    slug: env.error,
    evidence: [env.message ?? "", ...(env.hints ?? [])].join("\n"),
  };
}

/** The markdown surface: the authored projection of the same envelope. */
export function markdownSurface(
  run: RunResult,
  env: EnvelopeFacts,
  verb: string,
): SurfaceObservation {
  return {
    refused: env.ok === false,
    slug: env.error,
    evidence: markdownProjection(run.stdout, verb),
  };
}

/** The terminal surface is prose: the machine slug rides json and mcp, so the
 * expected slug is pinned while the exit and the complete serving are read. */
export function terminalSurface(
  run: RunResult,
  slug: string,
): SurfaceObservation {
  return { refused: run.code === 1, slug, evidence: run.output };
}

/** The mcp surface: the tool result's structured envelope. */
export function mcpSurface(outcome: McpOutcome): SurfaceObservation {
  return {
    refused: outcome.isError,
    slug: outcome.env.error,
    evidence: [
      String(outcome.env.message ?? ""),
      ...((outcome.env.hints ?? []) as string[]),
    ].join("\n"),
  };
}
