/**
 * MCP call-duration policy shared by provider wiring and long-running tools.
 *
 * The configured clients get one hour. `await` spends at most 55 minutes of
 * that budget, leaving five minutes for request delivery and cancellation.
 * Cursor's CLI/ACP surface currently has a fixed 60-second tool-call limit, so
 * Cursor and unknown clients use lossless 45-second continuation slices.
 */

import type { NativeAgentName } from "./agent_catalogue.ts";

export const MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS = 3_600;
export const AWAIT_LONG_CALL_SECONDS = 3_300;
export const AWAIT_STRICT_CALL_SECONDS = 45;
export const MCP_LONG_TOOL_CALLS_FLAG = "--long-tool-calls";
export const MCP_STRICT_TOOL_CALLS_FLAG = "--strict-tool-calls";

export type NativeMcpTimeoutPolicy =
  | {
    readonly capability: "configurable";
    readonly configured_seconds: number;
    readonly await_call_seconds: number;
  }
  | {
    readonly capability: "fixed";
    readonly await_call_seconds: number;
  };

/** Every native provider must declare how discern can safely hold an MCP call. */
export const NATIVE_MCP_TIMEOUT_POLICY = {
  claude_code: {
    capability: "configurable",
    configured_seconds: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    await_call_seconds: AWAIT_LONG_CALL_SECONDS,
  },
  codex: {
    capability: "configurable",
    configured_seconds: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    await_call_seconds: AWAIT_LONG_CALL_SECONDS,
  },
  gemini: {
    capability: "configurable",
    configured_seconds: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    await_call_seconds: AWAIT_LONG_CALL_SECONDS,
  },
  cursor: {
    capability: "fixed",
    await_call_seconds: AWAIT_STRICT_CALL_SECONDS,
  },
  copilot: {
    capability: "configurable",
    configured_seconds: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    await_call_seconds: AWAIT_LONG_CALL_SECONDS,
  },
} as const satisfies Record<NativeAgentName, NativeMcpTimeoutPolicy>;

export const AWAIT_CALL_PROFILES = [
  "cli",
  "long-client",
  "strict-client",
  "unknown-client",
] as const;
export type AwaitCallProfile = (typeof AWAIT_CALL_PROFILES)[number];

/** The safe duration of one call for each caller class. */
export const AWAIT_CALL_SECONDS = {
  cli: AWAIT_LONG_CALL_SECONDS,
  "long-client": AWAIT_LONG_CALL_SECONDS,
  "strict-client": AWAIT_STRICT_CALL_SECONDS,
  "unknown-client": AWAIT_STRICT_CALL_SECONDS,
} as const satisfies Record<AwaitCallProfile, number>;

/** Add the capability declaration one native provider's MCP server receives. */
export function mcpServerArgsForNativeAgent(
  agent: NativeAgentName,
  base: readonly string[],
): string[] {
  const flag = NATIVE_MCP_TIMEOUT_POLICY[agent].capability === "configurable"
    ? MCP_LONG_TOOL_CALLS_FLAG
    : MCP_STRICT_TOOL_CALLS_FLAG;
  return [...base, flag];
}
