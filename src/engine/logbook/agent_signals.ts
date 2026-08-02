/**
 * Advisory coding-agent signal detection for logbook driver facts.
 *
 * This module observes the shared identity catalogue and returns every matching
 * signal. It deliberately chooses no winner, computes no confidence, and changes
 * no runtime behaviour. Environment values are consulted transiently but never
 * returned; only marker names can reach the logbook. MCP client information is
 * retained separately in a bounded raw form so future readers can reinterpret
 * clients unknown to this release.
 */

import type { EnvReader } from "../../shared/env.ts";
import {
  AGENT_CATALOGUE,
  type AgentEnvironmentRule,
  type AgentIdentity,
  type AgentIdentityDefinition,
  type AgentSignalSource,
} from "../../shared/agent_catalogue.ts";
import { classifyMcpClient } from "./agent_identity.ts";

/** Request metadata key used by the MCP 2026-07-28 protocol shape. */
export const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

/** Maximum stored length of each client-supplied MCP identity field. */
export const MCP_CLIENT_INFO_FIELD_LIMIT = 256;

/** The bounded protocol declaration retained in `driver.mcp_client`. */
export interface RecordedMcpClient {
  readonly [key: string]: unknown;
  readonly name: string;
  readonly title?: string;
  readonly version: string;
}

/** One evidence bundle; several agents and sources may coexist. */
export interface AgentSignal {
  readonly [key: string]: unknown;
  readonly agent: AgentIdentity;
  readonly source: AgentSignalSource;
  readonly markers: string[];
}

/** Injectable detector inputs keep process-global env and host state out of tests. */
export interface AgentSignalOptions {
  readonly env?: EnvReader | undefined;
  readonly pathExists?: ((path: string) => Promise<boolean>) | undefined;
  readonly mcpClient?: RecordedMcpClient | undefined;
}

/** Return whether the value is a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trim and cap one untrusted protocol string; empty/non-strings are absent. */
function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === ""
    ? undefined
    : trimmed.slice(0, MCP_CLIENT_INFO_FIELD_LIMIT);
}

/**
 * Validate and bound one protocol client-info object. `name` and `version` are
 * required by both supported protocol shapes; a malformed candidate is ignored
 * in full rather than partly recorded.
 */
export function parseMcpClientInfo(
  value: unknown,
): RecordedMcpClient | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const name = boundedString(value.name);
  const version = boundedString(value.version);
  if (name === undefined || version === undefined) {
    return undefined;
  }
  const title = boundedString(value.title);
  return {
    name,
    ...(title !== undefined ? { title } : {}),
    version,
  };
}

/**
 * Resolve MCP identity across the two protocol generations: per-request `_meta`
 * first, then the initialized session's `clientInfo`. A malformed request-level
 * declaration does not mask a valid initialized fallback.
 */
export function resolveMcpClientInfo(
  requestMeta: unknown,
  initializedClient: unknown,
): RecordedMcpClient | undefined {
  const requestCandidate = isRecord(requestMeta)
    ? requestMeta[MCP_CLIENT_INFO_META_KEY]
    : undefined;
  return parseMcpClientInfo(requestCandidate) ??
    parseMcpClientInfo(initializedClient);
}

/** An env read that treats denied permission exactly like an absent marker. */
function envValue(env: EnvReader, name: string): string | undefined {
  try {
    const value = env.get(name);
    return value !== undefined && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Whether one catalogue conjunction matches, returning every marker involved. */
function matchEnvironmentRule(
  rule: AgentEnvironmentRule,
  env: EnvReader,
): string[] | undefined {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  const noneOf = rule.noneOf ?? [];
  if (allOf.some((name) => envValue(env, name) === undefined)) {
    return undefined;
  }
  if (noneOf.some((name) => envValue(env, name) !== undefined)) {
    return undefined;
  }
  const presentAny = anyOf.filter((name) => envValue(env, name) !== undefined);
  if (anyOf.length > 0 && presentAny.length === 0) {
    return undefined;
  }
  return [...allOf, ...presentAny];
}

/** Add or merge a signal while preserving catalogue and marker order. */
function addSignal(
  signals: AgentSignal[],
  agent: AgentIdentity,
  source: AgentSignalSource,
  markers: readonly string[],
): void {
  const existing = signals.find((signal) =>
    signal.agent === agent && signal.source === source
  );
  if (existing === undefined) {
    signals.push({ agent, source, markers: [...new Set(markers)] });
    return;
  }
  const merged = [...existing.markers];
  for (const marker of markers) {
    if (!merged.includes(marker)) {
      merged.push(marker);
    }
  }
  const index = signals.indexOf(existing);
  signals[index] = { agent, source, markers: merged };
}

/** Default host check; absence, unreadability, and denied permission are no match. */
async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return every coding-agent identity signal visible to this invocation.
 * Catalogue order is deterministic but carries no priority: consumers must treat
 * the array as a set of advisory evidence, not a ranked classification.
 */
export async function detectAgentSignals(
  options: AgentSignalOptions = {},
): Promise<AgentSignal[]> {
  const env = options.env ?? Deno.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  const signals: AgentSignal[] = [];
  const aiAgentValue = envValue(env, "AI_AGENT")?.trim();
  const aiAgent = aiAgentValue !== undefined && aiAgentValue !== ""
    ? aiAgentValue
    : undefined;
  let aiAgentRecognized = false;
  const mcpSignals = classifyMcpClient(options.mcpClient);

  for (const catalogueEntry of AGENT_CATALOGUE) {
    const identity: AgentIdentityDefinition = catalogueEntry;
    const agent = catalogueEntry.id;
    const environmentMarkers: string[] = [];
    for (const rule of identity.environment ?? []) {
      const matched = matchEnvironmentRule(rule, env);
      if (matched !== undefined) {
        environmentMarkers.push(...matched);
      }
    }
    const aiRule = identity.aiAgent;
    if (aiAgent !== undefined && aiRule !== undefined) {
      const exact = (aiRule.exact ?? []).includes(aiAgent);
      const prefix = (aiRule.prefixes ?? []).some((value) =>
        aiAgent.startsWith(value)
      );
      if (exact || prefix) {
        environmentMarkers.push("AI_AGENT");
        aiAgentRecognized = true;
      }
    }
    if (environmentMarkers.length > 0) {
      addSignal(signals, agent, "process-environment", environmentMarkers);
    }

    const mcpSignal = mcpSignals.find((signal) => signal.agent === agent);
    if (mcpSignal !== undefined) {
      addSignal(signals, agent, "mcp-client", mcpSignal.markers);
    }

    for (const path of identity.hostFiles ?? []) {
      try {
        if (await pathExists(path)) {
          addSignal(signals, agent, "host-filesystem", [path]);
        }
      } catch {
        // An unreadable host marker is no evidence; detection never interferes.
      }
    }
  }

  if (aiAgent !== undefined && !aiAgentRecognized) {
    addSignal(signals, "custom", "process-environment", ["AI_AGENT"]);
  }
  return signals;
}
