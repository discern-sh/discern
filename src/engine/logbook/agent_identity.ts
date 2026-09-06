/**
 * The logbook's canonical MCP identity interpretation.
 *
 * Recorders and readers share the same catalogue-driven classifier. Readers
 * then combine immutable stored evidence with the current release's
 * interpretation of retained raw MCP metadata, so catalogue improvements apply
 * to history without rewriting it.
 */

import {
  AGENT_CATALOGUE,
  type AgentIdentity,
  type AgentIdentityDefinition,
  type AgentSignalSource,
} from "../../shared/agent_catalogue.ts";
import type { VerbEvent } from "./schema.ts";

/** The raw MCP fields identity classification needs. */
export interface McpClientIdentity {
  readonly name: string;
  readonly title?: string | undefined;
}

/** One catalogue-derived MCP identity signal. */
export interface CatalogueAgentSignal {
  readonly [key: string]: unknown;
  readonly agent: AgentIdentity;
  readonly source: "mcp-client";
  readonly markers: string[];
}

/** One effective stored-or-current identity signal exposed to readers. */
export interface EffectiveAgentSignal {
  readonly [key: string]: unknown;
  readonly agent: string;
  readonly source: AgentSignalSource;
  readonly markers: string[];
}

/** Normalize protocol display names for lookup, not for storage. */
function normalizeMcpAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** The aliases one catalogue entry owns, with derived values deduplicated. */
function mcpAliases(identity: AgentIdentityDefinition): string[] {
  const values = [
    identity.id,
    identity.label,
    identity.nativeName,
    ...(identity.mcpAliases ?? []),
  ];
  return [
    ...new Set(
      values.filter((value): value is string => value !== undefined).map(
        normalizeMcpAlias,
      ),
    ),
  ];
}

/** Compile the release catalogue once; observations never rebuild aliases. */
const MCP_ALIASES = AGENT_CATALOGUE.filter((entry) => entry.id !== "custom")
  .map((entry) => ({ agent: entry.id, aliases: mcpAliases(entry) }));

/** Merge equivalent effective evidence while preserving first-seen order. */
function addEffectiveSignal(
  signals: EffectiveAgentSignal[],
  signal: EffectiveAgentSignal,
): void {
  const existing = signals.find((candidate) =>
    candidate.agent === signal.agent && candidate.source === signal.source
  );
  if (existing === undefined) {
    signals.push({ ...signal, markers: [...new Set(signal.markers)] });
    return;
  }
  const markers = [...existing.markers];
  for (const marker of signal.markers) {
    if (!markers.includes(marker)) {
      markers.push(marker);
    }
  }
  const index = signals.indexOf(existing);
  signals[index] = { ...existing, markers };
}

/**
 * Classify bounded raw MCP metadata through the current agent catalogue.
 *
 * Name and title are independent exact matches after case/space/underscore
 * normalization. Explicit aliases live only in {@link AGENT_CATALOGUE}; there
 * is deliberately no prefix or fuzzy matching.
 */
export function classifyMcpClient(
  client: McpClientIdentity | undefined,
): CatalogueAgentSignal[] {
  if (client === undefined) {
    return [];
  }
  const normalizedName = normalizeMcpAlias(client.name);
  const normalizedTitle = client.title === undefined
    ? undefined
    : normalizeMcpAlias(client.title);
  const signals: CatalogueAgentSignal[] = [];
  for (const { agent, aliases } of MCP_ALIASES) {
    const markers = [
      aliases.includes(normalizedName) ? "clientInfo.name" : undefined,
      normalizedTitle !== undefined && aliases.includes(normalizedTitle)
        ? "clientInfo.title"
        : undefined,
    ].filter((marker): marker is string => marker !== undefined);
    if (markers.length > 0) {
      signals.push({
        agent,
        source: "mcp-client",
        markers,
      });
    }
  }
  return signals;
}

/**
 * Return one event's effective identity evidence under the current catalogue.
 *
 * Stored non-MCP evidence is always preserved. When current catalogue knowledge
 * recognizes retained raw MCP metadata, that current interpretation replaces
 * stored MCP signals because both derive from the same declaration; keeping
 * both would turn one source into false corroboration. When the current
 * catalogue has no match, stored MCP signals remain as forward-compatible
 * evidence from the writer's release. Equivalent agent/source pairs merge
 * deterministically and the input event is never mutated.
 */
export function effectiveAgentSignals(
  event: Pick<VerbEvent, "driver">,
): EffectiveAgentSignal[] {
  const stored = event.driver?.agent_signals ?? [];
  const currentMcp = classifyMcpClient(event.driver?.mcp_client);
  const effective: EffectiveAgentSignal[] = [];
  for (const signal of stored) {
    if (signal.source !== "mcp-client") {
      addEffectiveSignal(effective, signal);
    }
  }
  const mcpSignals = currentMcp.length > 0
    ? currentMcp
    : stored.filter((signal) => signal.source === "mcp-client");
  for (const signal of mcpSignals) {
    addEffectiveSignal(effective, signal);
  }
  return effective;
}
