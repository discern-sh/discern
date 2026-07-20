/**
 * The desk's pure model: bucket the worktree fleet into decision order and map
 * each row's state to the actions that are legal for it (ADR 0119).
 *
 * The desk owns NO state of its own — every field here comes from the `status`
 * fleet survey plus the gate-receipt check, and every mutation it offers is one
 * of the existing lifecycle verbs. This module is the desk's only decision
 * logic, kept pure (time is a parameter) so `tests/engine_desk_model_test.ts`
 * can pin the whole classification table.
 */

import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import { basename } from "@std/path";
import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import type { DetectedAgentBinary } from "../../lib/detect_agents.ts";
import type { AgentName } from "../../lib/config.ts";
import { providerFor } from "../../lib/providers.ts";
import type { ProjectScript } from "../project_scripts.ts";
import {
  idleDaysOf,
  relativeAge,
  STALE_WORKTREE_DAYS,
} from "../status/status.ts";
import { isReadyToLand } from "../worktree/readiness.ts";

/** The decision-order buckets, most actionable first. */
export const DESK_BUCKETS = ["ready", "in_flight", "attention"] as const;
export type DeskBucket = (typeof DESK_BUCKETS)[number];

/** Every action the desk can offer on a row, in menu order. */
export const DESK_ACTIONS = [
  "accept",
  "update",
  "script",
  "agent",
  "jump",
  "inspect",
  "drop",
] as const;
export type DeskAction = (typeof DESK_ACTIONS)[number];

/** One provider-owned command the desk can launch in a selected worktree. */
export interface DeskAgentLaunch {
  readonly id: string;
  readonly agent: AgentName;
  readonly providerLabel: string;
  readonly binary: string;
  readonly kind: "open" | "continue";
  readonly label: string;
  readonly args: readonly string[];
}

/** The human task name shown by the desk, plus the minted id's short tail when
 * two visible tasks need disambiguating. Git identity remains available on the
 * action screen instead of leading every fleet row. */
export interface DeskTaskLabel {
  readonly name: string;
  readonly disambiguator?: string;
}

/** One selectable effort on the desk: a non-main fleet entry, classified. */
export interface DeskRow {
  readonly entry: StatusFleetEntry;
  readonly task: DeskTaskLabel;
  /** Whether the row's clean HEAD holds a recorded gate receipt. */
  readonly receiptHonored: boolean;
  /** Executable Project Scripts discovered through this worktree's config. */
  readonly scripts: readonly ProjectScript[];
  /** Configured agents whose declared CLI binary is currently on PATH. */
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly bucket: DeskBucket;
  /** The actions legal for this row's state, in menu order. */
  readonly actions: readonly DeskAction[];
  /** The plain-text state summary shown beside the branch name. */
  readonly summary: string;
}

/** Turn a discern worktree id (`<name>-<hex>`) back into the task name a person
 * supplied. The uniqueness tail is retained separately for duplicate names. */
export function taskLabel(entry: StatusFleetEntry): DeskTaskLabel {
  const id = entry.id?.trim() || basename(entry.path);
  const match = /^(.*)-([0-9a-f]{6})$/i.exec(id);
  const stem = match?.[1] ?? id;
  const words = stem.replaceAll("-", " ").trim();
  const name = words === ""
    ? "Unnamed task"
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  const disambiguator = match?.[2];
  return disambiguator === undefined ? { name } : { name, disambiguator };
}

/** The bucket headings as the desk renders them. */
export function bucketTitle(bucket: DeskBucket): string {
  switch (bucket) {
    case "ready":
      return "Ready to land";
    case "in_flight":
      return "In flight";
    case "attention":
      return "Needs attention";
  }
}

/** An unreadable or half-created checkout — state unknown, drop is the only move. */
function isUnhealthy(entry: StatusFleetEntry): boolean {
  return entry.broken === true || entry.git_unavailable === true;
}

/** Idle past the staleness threshold while still carrying work — the same
 * predicate `status` uses for its stale-worktree hint. */
function isStale(entry: StatusFleetEntry, nowMs: number): boolean {
  const idleDays = idleDaysOf(entry.last_activity, nowMs);
  return idleDays !== undefined && idleDays >= STALE_WORKTREE_DAYS &&
    (entry.clean === false || (entry.ahead ?? 0) > 0);
}

/** Classify one fleet entry into its decision-order bucket. */
export function classifyBucket(
  entry: StatusFleetEntry,
  receiptHonored: boolean,
  nowMs: number,
): DeskBucket {
  if (isUnhealthy(entry)) {
    return "attention";
  }
  if ((entry.behind ?? 0) > 0) {
    return "in_flight";
  }
  if (isReadyToLand(entry, receiptHonored)) {
    return "ready";
  }
  if (isStale(entry, nowMs)) {
    return "attention";
  }
  return "in_flight";
}

/**
 * The actions legal for a row's state, in menu order. Advisory, not
 * authoritative: the desk offers only what can plausibly succeed, but every
 * action still runs the real verb core, whose own preconditions keep the final
 * word (a refusal renders; it is never bypassed). Accept is offered without
 * requiring a receipt — acceptance validates the tree at the landing boundary
 * itself, so a receiptless clean branch simply pays for a full gate run there.
 */
export function legalActions(
  entry: StatusFleetEntry,
  scripts: readonly ProjectScript[],
  agentLaunches: readonly DeskAgentLaunch[],
): readonly DeskAction[] {
  if (isUnhealthy(entry)) {
    // The checkout can't be trusted (or entered): discarding is the only move
    // the desk can honestly offer. `worktree drop` still refuses unverifiable
    // work without an explicit typed confirmation.
    return ["drop"];
  }
  const actions: DeskAction[] = [];
  if (entry.clean === true && (entry.ahead ?? 0) > 0) {
    actions.push("accept");
  }
  if ((entry.behind ?? 0) > 0) {
    actions.push("update");
  }
  if (scripts.length > 0) {
    actions.push("script");
  }
  if (agentLaunches.length > 0) {
    actions.push("agent");
  }
  actions.push("jump", "inspect", "drop");
  return actions;
}

/**
 * Derive the agent commands available in one checkout. Committed configuration
 * decides which providers belong to the project; the live PATH scan decides
 * which of those can be launched now. Provider order follows the config and
 * action order follows the registry, with no runtime fallback to detected-only
 * agents.
 */
export function buildAgentLaunches(
  config: DiscernConfig,
  detected: readonly DetectedAgentBinary[],
): DeskAgentLaunch[] {
  const detectedByName = new Map(detected.map((item) => [item.name, item]));
  const launches: DeskAgentLaunch[] = [];
  for (const configuredAgent of resolveConfiguredAgents(config)) {
    const provider = providerFor(configuredAgent);
    if (provider === undefined) {
      continue;
    }
    const found = detectedByName.get(provider.name);
    if (found === undefined) {
      continue;
    }
    for (const action of provider.cli.actions) {
      launches.push({
        id: `${provider.name}:${action.kind}`,
        agent: provider.name,
        providerLabel: provider.label,
        binary: found.binary,
        kind: action.kind,
        label: action.label,
        args: action.args,
      });
    }
  }
  return launches;
}

/** The plain-text state summary rendered beside a row's branch name. */
export function rowSummary(
  entry: StatusFleetEntry,
  receiptHonored: boolean,
  nowMs: number,
): string {
  if (entry.broken === true) {
    return "Setup incomplete";
  }
  if (entry.git_unavailable === true) {
    return "Git state unreadable";
  }
  const parts: string[] = [];
  const ahead = entry.ahead ?? 0;
  const behind = entry.behind ?? 0;
  if (isStale(entry, nowMs)) {
    parts.push("Stale");
  }
  if (behind > 0) {
    parts.push("Update needed");
  } else if (receiptHonored) {
    parts.push("Gate passed");
  } else if (entry.clean === true && ahead > 0) {
    parts.push("Awaiting gate");
  }
  if (entry.clean === false) {
    const changed = entry.changed_files;
    parts.push(
      changed === undefined
        ? "Changed files unknown"
        : `${changed} file${changed === 1 ? "" : "s"} changed`,
    );
  } else if (ahead === 0 && behind === 0) {
    parts.push("No changes");
  }
  if (ahead > 0) {
    parts.push(`${ahead} ahead`);
  }
  if (behind > 0) {
    parts.push(`${behind} behind`);
  }
  const age = relativeAge(entry.last_activity, nowMs);
  parts.push(age === "just now" ? "now" : age);
  return parts.join(" · ");
}

/** Most-recent-first by last activity; unknown activity sinks. */
function byActivityDesc(a: StatusFleetEntry, b: StatusFleetEntry): number {
  const at = a.last_activity === undefined ? 0 : Date.parse(a.last_activity);
  const bt = b.last_activity === undefined ? 0 : Date.parse(b.last_activity);
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

/**
 * Build the desk's rows from a fleet survey: the main checkout's own row is
 * excluded (the desk runs there — it is the vantage point, not an effort), and
 * the rest are classified and sorted into decision order — ready first, then in
 * flight, needs-attention last; within a bucket, most recently active first.
 */
export function buildDeskRows(
  fleet: readonly StatusFleetEntry[],
  receiptHonoredByPath: ReadonlyMap<string, boolean>,
  scriptsByPath: ReadonlyMap<string, readonly ProjectScript[]>,
  agentLaunchesByPath: ReadonlyMap<string, readonly DeskAgentLaunch[]>,
  nowMs: number,
): DeskRow[] {
  const rows = fleet
    .filter((entry) => !entry.is_main)
    .map((entry): DeskRow => {
      const receiptHonored = receiptHonoredByPath.get(entry.path) ?? false;
      const scripts = scriptsByPath.get(entry.path) ?? [];
      const agentLaunches = agentLaunchesByPath.get(entry.path) ?? [];
      return {
        entry,
        task: taskLabel(entry),
        receiptHonored,
        scripts,
        agentLaunches,
        bucket: classifyBucket(entry, receiptHonored, nowMs),
        actions: legalActions(entry, scripts, agentLaunches),
        summary: rowSummary(entry, receiptHonored, nowMs),
      };
    });
  return rows.sort((a, b) =>
    a.bucket === b.bucket
      ? byActivityDesc(a.entry, b.entry)
      : DESK_BUCKETS.indexOf(a.bucket) - DESK_BUCKETS.indexOf(b.bucket)
  );
}
