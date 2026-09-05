/**
 * The **cohort seam** — one place where recorded identity evidence becomes
 * comparative population structure, and the one place its honesty rules live.
 * Detectors that segment by driver identity all pass through here, so the
 * rules cannot drift apart per detector:
 *
 *  - **Invocation-scoped evidence only.** A cohort key comes from
 *    {@link driverAgent}, which reads the catalogue's lifetime record — so a
 *    persistent host marker (or any future ambient source class) is excluded
 *    automatically and can never mint a cohort.
 *  - **`custom` is one cohort.** Every unrecognized `AI_AGENT` declaration
 *    records the same `custom` identity (the value is never retained), so all
 *    such runs form a single cohort that is never subdivided.
 *  - **The unattributed share is always reported.** A split names its
 *    unattributed remainder beside the cohorts — never a silent cap.
 *  - **No cohort speaks below the recorded minimums** ({@link COHORT_MINIMUMS}).
 *
 * Driver scoring itself ({@link driverKind}, {@link driverAgent}) lives here
 * too: it is reader logic — computed fresh on every read, never stored — so a
 * smarter release re-scores all accumulated history (ADR 0162).
 */

import {
  AGENT_SIGNAL_SOURCE_LIFETIMES,
  agentLabel,
} from "../../shared/agent_catalogue.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import {
  type EffectiveAgentSignal,
  effectiveAgentSignals,
} from "./agent_identity.ts";
import type { VerbEvent } from "./schema.ts";

// ── driver scoring ──────────────────────────────────────────────────────────

/**
 * The invocation-scoped identity signals one event carries. Ambient evidence
 * (per the catalogue's lifetime classification) is filtered before any
 * scoring: persistent host state can corroborate a reading a human makes, but
 * it never drives one here — it would attribute every run on that host.
 */
function invocationSignals(e: VerbEvent): EffectiveAgentSignal[] {
  return effectiveAgentSignals(e).filter(
    (s) => AGENT_SIGNAL_SOURCE_LIFETIMES[s.source] === "invocation",
  );
}

/**
 * Who plausibly drove one invocation, scored from the raw driver signals the
 * recorder stored as evidence: the MCP surface is an agent by construction;
 * a `spawned_by` marker is discern's subprocess boundary declaring a
 * self-invocation, and the conventional CI marker reads as automation too —
 * the fallback that classifies history recorded before the explicit marker
 * and genuine external CI alike (ADR 0282). An invocation-scoped identity
 * signal without a terminal identifies an agent-driven call. JSON and
 * Markdown are format choices, not identity evidence. An interactive
 * terminal normally reads as a human at the keyboard, but when it carries an
 * invocation-scoped signal the two disagree (environments leak into shells
 * opened inside agent sessions), so the verdict is revoked to unknown rather
 * than claimed either way. Everything unresolved stays in the analysis
 * population. Excluding it would blind the detectors to unmarked CLI agents.
 */
export function driverKind(
  e: VerbEvent,
): "agent" | "human" | "automation" | "unknown" {
  if (e.surface === "mcp") {
    return "agent";
  }
  const spawnedBy = e.driver?.spawned_by;
  if (typeof spawnedBy === "string" && spawnedBy !== "") {
    return "automation";
  }
  if (e.driver?.ci === true) {
    return "automation";
  }
  if (invocationSignals(e).length > 0) {
    return e.driver?.tty === true ? "unknown" : "agent";
  }
  if (e.driver?.tty === true) {
    return "human";
  }
  return "unknown";
}

/**
 * The one agent identity an event's invocation-scoped evidence names, or
 * undefined when the evidence is absent, ambient-only, or names two different
 * identities — corroboration across sources strengthens a reading;
 * disagreement voids it rather than electing a winner.
 */
export function driverAgent(e: VerbEvent): string | undefined {
  const ids = new Set(invocationSignals(e).map((s) => s.agent));
  const [only] = ids;
  return ids.size === 1 ? only : undefined;
}

// ── the cohort seam ─────────────────────────────────────────────────────────

/**
 * The recorded per-cohort minimums — a judgment, written down so it can be
 * tuned rather than re-argued. Chosen July 2026 against the six discern-run
 * corpora then observable on the maintainer's machine, by shape:
 *
 *  - a balanced two-cohort corpus (attributed runs split roughly 55/45) must
 *    speak — that comparison is the whole point of the seam;
 *  - a near-single-cohort corpus with a trace second (hundreds of runs against
 *    a single-digit handful) must stay silent — a "comparison" against nine
 *    runs is the dishonesty the minimums exist to prevent, and because a trace
 *    cohort can clear any absolute floor a young logbook could honestly hold,
 *    the share floor is what keeps it quiet;
 *  - a lopsided-but-real split (roughly 85/15) qualifies at the corpus level
 *    and is then held to each detector's own population, where it may or may
 *    not clear the same bars — per-detector scrutiny, not a corpus verdict.
 *
 * Those corpora recorded a launch-crunch burst, which is exactly why these are
 * recorded numbers rather than constants of nature: tune them here, in one
 * place, as calmer history accrues.
 */
export const COHORT_MINIMUMS = {
  /** A comparison needs at least this many qualifying populations. */
  cohorts: 2,
  /** Attributed runs a cohort must hold in the detector's own population. */
  runsPerCohort: 5,
  /** The share of attributed runs a cohort must hold beside its peers. */
  minShare: 0.1,
} as const;

/** One attributed population: the units it drove and the runs behind them. */
export interface Cohort<T> {
  /** Stable catalogue identity id — the cohort key. */
  agent: string;
  /** The catalogue display label. */
  label: string;
  /** The detector's population units this cohort drove. */
  units: T[];
  /** Events across those units — every rendered count's denominator. */
  runs: number;
}

/** A detector population segmented by attributed driver identity. */
export interface CohortSplit<T> {
  /** Cohorts clearing {@link COHORT_MINIMUMS}, most runs first. */
  speaking: Cohort<T>[];
  /** Attributed cohorts below the minimums — reported, never compared. */
  belowMinimum: Cohort<T>[];
  /** Units whose evidence names no single identity. */
  unattributedUnits: number;
  /** Runs behind those units. */
  unattributedRuns: number;
}

/**
 * The one identity a unit's events collectively name — {@link driverAgent}'s
 * exactly-one rule lifted to the unit level: events naming nothing don't void
 * a unit (absence is not disagreement), but events naming two different
 * identities do — a branch two agents drove belongs to neither cohort.
 * Automation events attribute nothing: a gate child inherits the outer
 * session's markers, so letting it vote would both credit plumbing and void
 * units where a different agent's session happened to run the gate.
 */
export function attributedIdentity(
  events: readonly VerbEvent[],
): string | undefined {
  const ids = new Set<string>();
  for (const e of events) {
    if (driverKind(e) === "automation") {
      continue;
    }
    const id = driverAgent(e);
    if (id !== undefined) {
      ids.add(id);
    }
  }
  const [only] = ids;
  return ids.size === 1 ? only : undefined;
}

/**
 * Segment a detector's population units (an event, a branch, a session) by
 * attributed driver identity, applying the recorded minimums. `eventsOf`
 * names each unit's own events — the seam derives nothing else from a unit,
 * so any population shape can pass through the same honesty rules.
 */
export function splitByCohort<T>(
  units: readonly T[],
  eventsOf: (unit: T) => readonly VerbEvent[],
): CohortSplit<T> {
  const byId = new Map<string, Cohort<T>>();
  let unattributedUnits = 0;
  let unattributedRuns = 0;
  for (const unit of units) {
    // Cohorts compare decisions, so automation events — gate children and CI
    // runs — join neither a cohort's runs nor the unattributed remainder; the
    // population account reports that volume (ADR 0282). A unit with no
    // decision events carries nothing to compare and drops out entirely.
    const decisions = eventsOf(unit).filter(
      (e) => driverKind(e) !== "automation",
    );
    if (decisions.length === 0) {
      continue;
    }
    const id = attributedIdentity(decisions);
    if (id === undefined) {
      unattributedUnits += 1;
      unattributedRuns += decisions.length;
      continue;
    }
    const cohort = byId.get(id) ??
      { agent: id, label: agentLabel(id), units: [], runs: 0 };
    cohort.units.push(unit);
    cohort.runs += decisions.length;
    byId.set(id, cohort);
  }
  const cohorts = [...byId.values()].sort((a, b) =>
    b.runs - a.runs || a.agent.localeCompare(b.agent)
  );
  const attributedRuns = cohorts.reduce((sum, c) => sum + c.runs, 0);
  const speaking: Cohort<T>[] = [];
  const belowMinimum: Cohort<T>[] = [];
  for (const cohort of cohorts) {
    const clears = cohort.runs >= COHORT_MINIMUMS.runsPerCohort &&
      cohort.runs >= attributedRuns * COHORT_MINIMUMS.minShare;
    (clears ? speaking : belowMinimum).push(cohort);
  }
  return { speaking, belowMinimum, unattributedUnits, unattributedRuns };
}

/** Whether a split holds enough qualifying cohorts to compare at all. */
export function comparative(split: CohortSplit<unknown>): boolean {
  return split.speaking.length >= COHORT_MINIMUMS.cohorts;
}

/**
 * The denominator counts every cohort finding must carry: each speaking
 * cohort's attributed runs, plus the never-hidden remainders. Detectors merge
 * their own per-cohort counts beside these.
 */
export function cohortDenominators(
  split: CohortSplit<unknown>,
): Record<string, number> {
  const evidence: Record<string, number> = {};
  for (const cohort of split.speaking) {
    evidence[`${cohort.agent}_runs`] = cohort.runs;
  }
  const below = split.belowMinimum.reduce((sum, c) => sum + c.runs, 0);
  if (below > 0) {
    evidence.below_minimum_runs = below;
  }
  evidence.unattributed_runs = split.unattributedRuns;
  return evidence;
}

/**
 * The denominator clause every cohort finding's sentence embeds, e.g.
 * "Claude Code 676 · Codex 516 · 316 unattributed" — the unattributed share
 * is stated even at zero, so a fully-attributed corpus says so explicitly.
 */
export function denominatorClause(split: CohortSplit<unknown>): string {
  const parts = split.speaking.map((c) =>
    `${c.label} ${formatHumanNumber(c.runs)}`
  );
  const below = split.belowMinimum.reduce((sum, c) => sum + c.runs, 0);
  if (below > 0) {
    parts.push(`${formatHumanNumber(below)} below the reporting minimums`);
  }
  parts.push(`${formatHumanNumber(split.unattributedRuns)} unattributed`);
  return parts.join(" · ");
}

// ── driver-release boundaries ───────────────────────────────────────────────

/**
 * The dominant MCP client's version eras across a stream — the driver's half
 * of the attribution vocabulary that config epochs and discern releases
 * already fill (ADR 0160/0162). Deliberately modest: only the client behind
 * the plurality of `mcp_client`-bearing runs contributes boundaries, and only
 * a change between two RECORDED versions is one — first sight of a client is
 * not a boundary, and a corpus with no client declarations at all (a cohort
 * attributed purely through process evidence) simply has none: a silent
 * absence, never an error.
 */
export interface ClientVersionEras {
  /** Display name for the dominant client (the current effective catalogue
   * label when one identity matches, the raw declared name otherwise);
   * undefined when the stream carries no client declarations. */
  label: string | undefined;
  /** Each recorded version change: when, from, to. */
  boundaries: { at: string; from: string; to: string }[];
  /** The era an event falls in: the count of boundaries at or before it. */
  eraOf(e: VerbEvent): number;
  /** The dominant client's version in effect during one era. */
  versionOf(era: number): string | undefined;
  /** The dominant client's version in effect for one event: the event's own
   * recorded declaration when it came from the dominant client (evidence
   * beats imputation — parallel sessions can interleave versions), the era's
   * version otherwise. */
  versionInEffectOf(e: VerbEvent): string | undefined;
}

/** Compute {@link ClientVersionEras} over a stream's analyzable verb events. */
export function dominantClientEras(
  verbs: readonly VerbEvent[],
): ClientVersionEras {
  const counts = new Map<string, number>();
  for (const e of verbs) {
    const name = e.driver?.mcp_client?.name;
    if (name !== undefined) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  let dominant: string | undefined;
  for (const [name, count] of counts) {
    if (
      dominant === undefined || count > (counts.get(dominant) ?? 0) ||
      (count === (counts.get(dominant) ?? 0) && name < dominant)
    ) {
      dominant = name;
    }
  }
  if (dominant === undefined) {
    return {
      label: undefined,
      boundaries: [],
      eraOf: () => 0,
      versionOf: () => undefined,
      versionInEffectOf: () => undefined,
    };
  }
  let label = dominant;
  let firstVersion: string | undefined;
  let lastVersion: string | undefined;
  const boundaries: { at: string; from: string; to: string }[] = [];
  for (const e of verbs) {
    const client = e.driver?.mcp_client;
    if (client === undefined || client.name !== dominant) {
      continue;
    }
    // Current catalogue interpretation names the identity when exactly one
    // match exists. Conflicting matches keep the raw client label rather than
    // electing a winner.
    const recognized = new Set(
      effectiveAgentSignals(e)
        .filter((signal) => signal.source === "mcp-client")
        .map((signal) => signal.agent),
    );
    const [recognizedAgent] = recognized;
    if (recognized.size === 1 && recognizedAgent !== undefined) {
      label = agentLabel(recognizedAgent);
    }
    if (firstVersion === undefined) {
      firstVersion = client.version;
    } else if (lastVersion !== undefined && client.version !== lastVersion) {
      boundaries.push({ at: e.at, from: lastVersion, to: client.version });
    }
    lastVersion = client.version;
  }
  const eraOf = (e: VerbEvent): number => {
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const boundary = boundaries[middle];
      if (boundary !== undefined && boundary.at <= e.at) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  };
  const versionOf = (era: number): string | undefined =>
    era === 0 ? firstVersion : boundaries[era - 1]?.to;
  return {
    label,
    boundaries,
    eraOf,
    versionOf,
    versionInEffectOf: (e: VerbEvent): string | undefined => {
      const client = e.driver?.mcp_client;
      return client !== undefined && client.name === dominant
        ? client.version
        : versionOf(eraOf(e));
    },
  };
}
