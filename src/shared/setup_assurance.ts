/**
 * Setup **quality-coverage assurance** — the honest, per-capability account
 * `discern setup done` reports at completion (A12).
 *
 * A setup can pass green with only some of the recommended gate active: a project
 * might wire format/lint/typecheck but legitimately have no test suite wired yet, or
 * no build step at all. That is correct — but "the gate is proven" must not read to a
 * novice as "every protection is running." So at `done` we classify each known
 * capability into one of three honest states and roll them into an overall verdict,
 * which the human output and the `--json` envelope both render. This keeps
 * "setup is complete" cleanly distinct from "the full recommended gate is active."
 *
 * The classification is DERIVED from the resolved `[capabilities]` alone — unfakeable
 * and free of any self-report — and iterates {@link KNOWN_CAPABILITIES} (the SSOT), so
 * a new capability auto-enrolls here the moment it joins that set.
 */

import { KNOWN_CAPABILITIES } from "./capabilities.ts";
import { type DiscernConfig, toCommandList } from "./config_schema.ts";

/**
 * How a capability stands relative to the gate:
 *  - `enforced` — a real command is wired; `discern done` runs it.
 *  - `deferred` — the capability is PRESENT in `[capabilities]` but set to a no-op
 *    (`:` or an empty string), the deliberate "I know about this, but it isn't
 *    running yet" signal. Distinct from a silent omission, and the place a reason
 *    can travel (an inline `#` comment on the line).
 *  - `absent` — the capability is omitted entirely; the project has no such command.
 */
export const CAPABILITY_STATES = ["enforced", "deferred", "absent"] as const;
export type CapabilityState = typeof CAPABILITY_STATES[number];

/** One capability's assurance: its name, its {@link CapabilityState}, and — for a
 * `deferred` one — the reason recorded as an inline comment on its config line, when
 * present. */
export interface CapabilityAssurance {
  name: string;
  state: CapabilityState;
  /** The deferral reason (an inline `#` comment), present only for a `deferred`
   * capability that carries one. */
  reason?: string;
}

/**
 * The overall coverage verdict, over the {@link KNOWN_CAPABILITIES} set:
 *  - `full` — every capability is enforced (the full recommended gate is active);
 *  - `partial` — at least one is enforced, but not all;
 *  - `minimal` — none is enforced (setup is complete, but the gate guards nothing yet).
 */
export const ASSURANCE_VERDICTS = ["full", "partial", "minimal"] as const;
export type AssuranceVerdict = typeof ASSURANCE_VERDICTS[number];

/** The complete assurance summary `setup done` reports. */
export interface SetupAssurance {
  /** Each known capability, in {@link KNOWN_CAPABILITIES} order, with its state. */
  capabilities: CapabilityAssurance[];
  /** How many capabilities are `enforced`. */
  enforced: number;
  /** The total number of known capabilities considered. */
  total: number;
  /** The rolled-up {@link AssuranceVerdict}. */
  verdict: AssuranceVerdict;
}

/**
 * Classify ONE capability from the resolved config. `enforced` when a real command
 * survives no-op filtering (the same {@link toCommandList} the gate runs through),
 * `absent` when the key is omitted, `deferred` when it is present but a `:`/empty
 * no-op. The single decision the summary and any other consumer share.
 */
export function classifyCapability(
  config: DiscernConfig,
  name: keyof DiscernConfig["capabilities"],
): CapabilityState {
  const value = config.capabilities[name];
  if (value === undefined) {
    return "absent";
  }
  return toCommandList(value).length > 0 ? "enforced" : "deferred";
}

/**
 * Extract the inline `#` comment on a capability's line in the raw `discern.toml`, or
 * undefined when there is none. Scans only within the `[capabilities]` table so an
 * identically-named key elsewhere can't match. Surfaces a `deferred` capability's
 * recorded reason ("with reason if known"); a no-op value (`:`/`""`) never itself
 * contains a `#`, so the match is unambiguous.
 */
export function deferralReason(
  rawToml: string,
  name: string,
): string | undefined {
  let inCapabilities = false;
  for (const line of rawToml.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header !== null) {
      inCapabilities = header[1]?.trim() === "capabilities";
      continue;
    }
    if (!inCapabilities) {
      continue;
    }
    // `name = "<value>"  # reason` — the value is a quoted string or a bare token,
    // optionally followed by a comment. Capture the comment body.
    const m = line.match(
      new RegExp(
        `^\\s*${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\S+)\\s*#\\s*(.+?)\\s*$`,
      ),
    );
    if (m !== null) {
      return m[1];
    }
  }
  return undefined;
}

/**
 * Assess the full {@link SetupAssurance} for a project — the per-capability states
 * and the overall verdict — from its resolved config. Iterates
 * {@link KNOWN_CAPABILITIES} so the summary can never silently omit a capability the
 * gate knows about. When `rawToml` is supplied, a `deferred` capability's inline-
 * comment reason is attached (best-effort; omitted when there is none).
 */
export function assessSetupAssurance(
  config: DiscernConfig,
  rawToml?: string,
): SetupAssurance {
  const names = Object.keys(KNOWN_CAPABILITIES) as Array<
    keyof DiscernConfig["capabilities"]
  >;
  const capabilities: CapabilityAssurance[] = names.map((name) => {
    const state = classifyCapability(config, name);
    const reason = state === "deferred" && rawToml !== undefined
      ? deferralReason(rawToml, name)
      : undefined;
    return reason !== undefined ? { name, state, reason } : { name, state };
  });
  const enforced = capabilities.filter((c) => c.state === "enforced").length;
  const total = capabilities.length;
  const verdict: AssuranceVerdict = enforced === total
    ? "full"
    : enforced === 0
    ? "minimal"
    : "partial";
  return { capabilities, enforced, total, verdict };
}
