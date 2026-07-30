/**
 * `discern patterns` — the logbook's first reader, and the diagnostic ladder's
 * third question: `doctor` asks whether the install is valid, `improvement`
 * whether the setup follows best practice, `patterns` whether the practice is
 * actually healthy. It runs the detector registry (`detectors.ts`) over the
 * recorded event stream. The result keeps findings ranked by evidence strength;
 * the human report points to the strongest attention findings, groups that same
 * order into canonical family sections, and collapses repeated detector
 * guidance into one block.
 *
 * Like every verb it computes one {@link DiscernResult}; the human report, the
 * `--json`, and the MCP tool are three renderings of the same object.
 * {@link patternsResult} is the unrendered core the MCP server calls;
 * {@link runPatterns} is the CLI. `--brag` asks the same read for bragging
 * rights (`brag.ts` computes them; `data.brag` carries them) and swaps the
 * human report for the card.
 *
 * Advisory only, structurally: the result is always `ok` once the logbook is
 * readable — findings are advice, never failures — and nothing in the gate
 * imports this module. The one destructive member of the family, the reset,
 * deletes the accumulated history ({@link patternsResetResult}); it is
 * CLI-only and plan/apply like every effectful verb (`--dry-run` previews).
 */

import { agentLabel } from "../../shared/agent_catalogue.ts";
import {
  loadConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  DETECTOR_FAMILIES,
  type DetectorFamily,
  type PatternFindingTone,
  type PatternsBrag,
  type PatternsData,
  type PatternsFinding,
  type PatternsPopulation,
  type PatternsResetData,
} from "../../shared/patterns_vocabulary.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import {
  displayWidth,
  meter,
  renderAlignedTable,
  sparkline,
  terminalWidth,
  wrapText,
} from "../../lib/text.ts";
import { colorEnabled, makeOut, type Out, type Palette } from "../output.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { readLogbookStream } from "./read.ts";
import { listLogbookFiles, logbookDir, removeLogbook } from "./store.ts";
import { driverAgent, driverKind } from "./cohorts.ts";
import { computeBrag } from "./brag.ts";
import {
  buildStreamFacts,
  inclusiveSpanDays,
  runDetectors,
  type StreamFacts,
  TRAJECTORY_BOUNDARY_ATTRIBUTION,
} from "./detectors.ts";
import { routeDetectorReports, routedFindingData } from "./routing.ts";

/**
 * Score the analysis population's drivers — reader logic over the recorded
 * evidence, computed fresh on every read so improved scoring retroactively
 * covers all accumulated history. The report states this split so the
 * segmentation the detectors rely on is never a silent filter.
 */
function scorePopulation(facts: StreamFacts): PatternsPopulation {
  const kinds = { agent: 0, human: 0, unknown: 0 };
  const identityRuns = new Map<string, number>();
  for (const e of facts.verbs) {
    kinds[driverKind(e)] += 1;
    const identity = driverAgent(e);
    if (identity !== undefined) {
      identityRuns.set(identity, (identityRuns.get(identity) ?? 0) + 1);
    }
  }
  return {
    analyzed: facts.verbs.length,
    ...kinds,
    identities: [...identityRuns.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([agent, runs]) => ({ agent, label: agentLabel(agent), runs })),
  };
}

/** The refusal when the working root is not inside a git repository — with no
 * git admin area there is nowhere a logbook could live. */
function noRepository(verb: string): DiscernResult<never> {
  return {
    ok: false,
    verb,
    error: "no_repository",
    message:
      "this directory isn't inside a git repository, so it has no logbook to read. " +
      "Run discern from the project's checkout.",
  };
}

/** Options accepted by {@link patternsResult}. */
export interface PatternsResultOptions {
  /** Also compute bragging rights (`data.brag`) from the same stream. */
  brag?: boolean;
}

/**
 * Compute the `patterns` {@link DiscernResult} without printing or exiting —
 * the core the MCP server renders. Reads the whole logbook tolerantly (torn
 * and foreign lines are skipped and counted), runs every registry detector
 * with its evidence threshold applied, and reports the ranked findings plus
 * every detector's status. When asked, `data.brag` joins with bragging
 * rights read from the same stream (`brag.ts`). An empty or absent logbook
 * is a first-class state with a helpful hint, not an error.
 */
export async function patternsResult(
  root: string,
  opts: PatternsResultOptions = {},
): Promise<DiscernResult<PatternsData>> {
  const config = await loadConfig(root);
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns");
  }
  const stream = await readLogbookStream(commonGitDir);
  const facts = buildStreamFacts(
    stream.events,
    config.repository.trunk,
    resolveConfiguredAgents(config),
  );
  const reports = runDetectors(facts);
  const findings = routeDetectorReports(reports).patterns.map(
    routedFindingData,
  );
  const first = stream.events[0];
  const last = stream.events[stream.events.length - 1];
  const branches = new Set(
    facts.verbs.map((e) => e.branch).filter((b): b is string => b !== null),
  );
  const data: PatternsData = {
    logbook: {
      events: stream.events.length,
      unparsed: stream.unparsed,
      setup_era: facts.setupEra,
      months: stream.months.length,
      ...(first !== undefined ? { first_at: first.at } : {}),
      ...(last !== undefined ? { last_at: last.at } : {}),
      branches: branches.size,
      recording: config.project.logbook,
    },
    population: scorePopulation(facts),
    findings,
    detectors: reports.map((r) => ({
      id: r.detector.id,
      title: r.detector.title,
      family: r.detector.family,
      scope: r.detector.scope,
      tier: r.detector.tier,
      status: r.status,
      considered: r.considered,
      threshold: r.detector.threshold,
      findings: r.findings.length,
    })),
    ...(opts.brag === true ? { brag: computeBrag(facts) } : {}),
  };

  const hints: FiredHint[] = [];
  if (stream.events.length === 0) {
    hints.push(fire(HINTS["patterns-logbook-empty"]));
  } else {
    const young = reports.filter((r) => r.status === "insufficient-evidence");
    if (young.length > 0) {
      hints.push(
        fire(HINTS["patterns-insufficient-evidence"], {
          young: young.length,
          total: reports.length,
        }),
      );
    }
    if (findings.length > 0) {
      hints.push(fire(HINTS["patterns-advisory-findings"]));
    }
  }
  if (!config.project.logbook) {
    hints.push(fire(HINTS["patterns-recording-off"]));
  }

  return {
    ok: true,
    verb: "patterns",
    data,
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
  };
}

// ── human rendering ─────────────────────────────────────────────────────────

interface FamilyPresentation {
  heading: string;
}

/** Human section labels keyed exhaustively by the canonical family vocabulary.
 * `DETECTOR_FAMILIES` alone owns their order. */
export const PATTERNS_FAMILY_SECTIONS = {
  trajectory: { heading: "Trajectory: how the numbers moved" },
  "gate-fit": { heading: "Gate fit: time and failure patterns" },
  behaviour: { heading: "Agent behavior: workflow habits" },
  funnel: { heading: "Task funnel: the path to green" },
} satisfies Record<DetectorFamily, FamilyPresentation>;

type ToneColor = "green" | "dim" | "yellow";

interface TonePresentation {
  glyph: string;
  color: ToneColor;
}

/** The compact report's glyphs, exhaustively bound to the canonical tones. */
export const PATTERNS_TONE_GLYPHS = {
  good: { glyph: "✓", color: "green" },
  neutral: { glyph: "·", color: "dim" },
  attention: { glyph: "!", color: "yellow" },
} satisfies Record<PatternFindingTone, TonePresentation>;

/** The one human caveat for trajectory series spanning several setups. */
export const PATTERNS_TRAJECTORY_CAVEAT =
  "Series spanning more than one configuration or release keep each segment attributed to its setup.";

/** Heading for the bounded pointer list above the full report sections. */
export const PATTERNS_ATTENTION_HEADING = "Worth your attention";
export const PATTERNS_ATTENTION_LIMIT = 3;

const PIN_COMMAND = "`discern standards --pin`";

function plural(
  value: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${formatHumanNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

/** "7 days (2026-07-20 → 2026-07-26) · 2,851 events · 73 branches" */
function summaryLine(data: PatternsData): string {
  const log = data.logbook;
  const parts: string[] = [];
  if (log.first_at !== undefined && log.last_at !== undefined) {
    const days = inclusiveSpanDays(log.first_at, log.last_at);
    if (days !== undefined) {
      parts.push(
        `${plural(days, "day")} (${log.first_at.slice(0, 10)} → ${
          log.last_at.slice(0, 10)
        })`,
      );
    }
  }
  parts.push(
    plural(log.events, "event"),
    plural(log.branches, "branch", "branches"),
  );
  if (log.unparsed > 0) {
    parts.push(`${plural(log.unparsed, "unparsable line")} skipped`);
  }
  if (log.setup_era > 0) {
    parts.push(
      `${plural(log.setup_era, "event")} from one-time setup set aside`,
    );
  }
  return parts.join(" · ");
}

/** "1,670 analyzed runs · driven by agents 1,421 (identified: Claude Code 757 · Codex 528) · humans 66 · unknown 183" */
function driversLine(population: PatternsPopulation): string {
  const identities = population.identities
    .map((identity) => `${identity.label} ${formatHumanNumber(identity.runs)}`)
    .join(" · ");
  return `${plural(population.analyzed, "analyzed run")} · driven by agents ${
    formatHumanNumber(population.agent)
  }${identities !== "" ? ` (identified: ${identities})` : ""} · humans ${
    formatHumanNumber(population.human)
  } · unknown ${formatHumanNumber(population.unknown)}`;
}

function scoreboardLine(data: PatternsData): string {
  const spoke = data.detectors.filter((d) => d.status === "fired").length;
  const clear = data.detectors.filter((d) => d.status === "quiet").length;
  const young =
    data.detectors.filter((d) => d.status === "insufficient-evidence").length;
  return `${plural(data.detectors.length, "detector")} · ${
    formatHumanNumber(spoke)
  } spoke · ${formatHumanNumber(clear)} all clear · ${
    formatHumanNumber(young)
  } too young to say`;
}

/** The trust audit's one overview row. Its detailed source and scope findings
 * still render in the canonical behavior section below. */
function preAuthorizedLandingOverview(
  data: PatternsData,
): PatternsFinding | undefined {
  return data.findings.find((finding) =>
    finding.detector === "pre-authorized-landings" &&
    finding.subject === undefined
  );
}

function writeWrapped(
  out: Out,
  prefix: string,
  text: string,
  width: number,
  style?: (line: string) => string,
): void {
  const prefixWidth = displayWidth(prefix);
  const lines = wrapText(text, Math.max(1, width - prefixWidth));
  const continuation = " ".repeat(prefixWidth);
  for (const [index, line] of lines.entries()) {
    out.raw(
      `${index === 0 ? prefix : continuation}${
        style === undefined ? line : style(line)
      }\n`,
    );
  }
}

function toneGlyph(tone: PatternFindingTone, palette: Palette): string {
  const presentation = PATTERNS_TONE_GLYPHS[tone];
  return `${palette[presentation.color]}${presentation.glyph}${palette.reset}`;
}

interface FindingRow {
  finding: PatternsFinding;
  renderedSeries: string;
}

function renderFindingRows(
  out: Out,
  findings: readonly PatternsFinding[],
  width: number,
): void {
  const rows = findings.map((finding) => ({
    finding,
    renderedSeries: finding.series === undefined
      ? ""
      : sparkline(finding.series),
  }));
  const basePrefixes = renderAlignedTable<FindingRow>([
    {
      header: "",
      value: (row) => toneGlyph(row.finding.tone, out.c),
    },
    {
      header: "",
      value: (row) => row.finding.subject ?? "",
    },
    { header: "", value: () => "" },
  ], rows).slice(1);
  const seriesPrefixes = renderAlignedTable<FindingRow>([
    {
      header: "",
      value: (row) => toneGlyph(row.finding.tone, out.c),
    },
    {
      header: "",
      value: (row) => row.finding.subject ?? "",
    },
    { header: "", value: (row) => row.renderedSeries },
    { header: "", value: () => "" },
  ], rows).slice(1);
  for (const [index, row] of rows.entries()) {
    writeWrapped(
      out,
      `    ${
        row.renderedSeries === ""
          ? basePrefixes[index] ?? ""
          : seriesPrefixes[index] ?? ""
      }`,
      row.finding.brief,
      width,
    );
  }
}

function detectorNextStep(findings: readonly PatternsFinding[]): string {
  const pinFindings = findings.filter((finding) =>
    finding.detector === "standard-trajectory" &&
    finding.next_step.includes("discern standards --pin")
  );
  const steps: string[] = [];
  if (pinFindings.length > 0) {
    const subjects = pinFindings
      .map((finding) => finding.subject)
      .filter((subject): subject is string => subject !== undefined)
      .map((subject) => `\`${subject}\``);
    const named = subjects.length > 0 ? `: ${subjects.join(" · ")}` : "";
    steps.push(
      `${plural(pinFindings.length, "standard")} ${
        pinFindings.length === 1 ? "has" : "have"
      } measured better than ${
        pinFindings.length === 1 ? "its limit" : "their limits"
      } for the last 3 readings${named}. Capture ${
        pinFindings.length === 1 ? "the gain" : "the gains"
      }: ${PIN_COMMAND}.`,
    );
  }

  for (const finding of findings) {
    if (
      pinFindings.includes(finding) ||
      steps.includes(finding.next_step)
    ) {
      continue;
    }
    steps.push(finding.next_step);
  }
  return steps.join(" ");
}

function findingsByDetector(
  findings: readonly PatternsFinding[],
): Map<string, PatternsFinding[]> {
  const groups = new Map<string, PatternsFinding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.detector);
    if (group === undefined) {
      groups.set(finding.detector, [finding]);
    } else {
      group.push(finding);
    }
  }
  return groups;
}

function renderFamily(
  out: Out,
  family: DetectorFamily,
  data: PatternsData,
  width: number,
  titleById: ReadonlyMap<string, string>,
): void {
  const familyFindings = data.findings.filter((finding) =>
    finding.family === family
  );
  if (familyFindings.length === 0) {
    return;
  }
  const groups = findingsByDetector(familyFindings);
  const c = out.c;
  out.raw(
    `${c.bold}${PATTERNS_FAMILY_SECTIONS[family].heading}${c.reset}\n`,
  );
  for (const [detector, findings] of groups) {
    writeWrapped(
      out,
      "  ",
      titleById.get(detector) ?? detector,
      width,
      (line) => `${c.bold}${line}${c.reset}`,
    );
    renderFindingRows(out, findings, width);
    writeWrapped(
      out,
      `    ${c.cyan}→${c.reset} `,
      detectorNextStep(findings),
      width,
    );
    out.raw("\n");
  }

  const crossesBoundary = family === "trajectory" &&
    familyFindings.some((finding) =>
      finding.observed.includes(TRAJECTORY_BOUNDARY_ATTRIBUTION)
    );
  if (crossesBoundary) {
    writeWrapped(
      out,
      "  ",
      `(${PATTERNS_TRAJECTORY_CAVEAT})`,
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
    out.raw("\n");
  }
}

function renderAttentionBanner(
  out: Out,
  data: PatternsData,
  width: number,
  titleById: ReadonlyMap<string, string>,
): void {
  // `data.findings` is already strength-ranked. Tone filters that order and
  // never becomes a second ranking policy.
  const findings = data.findings
    .filter((finding) => finding.tone === "attention")
    .slice(0, PATTERNS_ATTENTION_LIMIT);
  if (findings.length === 0) {
    return;
  }

  const c = out.c;
  out.raw("\n");
  out.raw(`  ${c.bold}${PATTERNS_ATTENTION_HEADING}${c.reset}\n`);
  for (const finding of findings) {
    const title = titleById.get(finding.detector) ?? finding.detector;
    const subject = finding.subject === undefined
      ? ""
      : ` · ${finding.subject}`;
    writeWrapped(
      out,
      `    ${toneGlyph(finding.tone, c)} `,
      `${title}${subject}`,
      width,
    );
  }
}

function renderClosingAccount(
  out: Out,
  data: PatternsData,
  width: number,
): void {
  const c = out.c;
  const quiet = data.detectors.filter((d) => d.status === "quiet");
  const young = data.detectors.filter((d) =>
    d.status === "insufficient-evidence"
  );
  if (quiet.length > 0) {
    writeWrapped(
      out,
      "  All clear: ",
      `${quiet.map((d) => d.title).join(" · ")}.`,
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
  }
  if (young.length > 0) {
    writeWrapped(
      out,
      "  Too young: ",
      `${young.map((d) => d.title).join(" · ")}.`,
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
  }
  writeWrapped(
    out,
    "  ",
    "Advisory only. Nothing here fails the gate. Evidence: `discern patterns --json`.",
    width,
    (line) => `${c.dim}${line}${c.reset}`,
  );
}

/** Render the recurring report for a person. The wire findings stay
 * strength-ranked; this projection groups them by canonical family and
 * collapses repeated detector guidance. */
function renderReport(out: Out, data: PatternsData, slug: string): void {
  const c = out.c;
  const width = terminalWidth();
  const titleById = new Map(
    data.detectors.map((detector) => [detector.id, detector.title]),
  );
  out.heading(`discern patterns${slug ? ` · ${slug}` : ""}`);
  writeWrapped(
    out,
    "  ",
    summaryLine(data),
    width,
    (line) => `${c.dim}${line}${c.reset}`,
  );
  if (data.population.analyzed > 0) {
    writeWrapped(
      out,
      "  ",
      driversLine(data.population),
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
  }
  writeWrapped(
    out,
    "  ",
    scoreboardLine(data),
    width,
    (line) => `${c.dim}${line}${c.reset}`,
  );
  const preAuthorized = preAuthorizedLandingOverview(data);
  if (preAuthorized !== undefined) {
    writeWrapped(
      out,
      "  Pre-authorized landings: ",
      preAuthorized.brief,
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
  }
  renderAttentionBanner(out, data, width, titleById);
  out.raw("\n");

  if (data.logbook.events === 0) {
    writeWrapped(
      out,
      "  ",
      "The logbook is empty. discern records one event per verb run under this repository's Git directory. Nothing leaves the machine. Check back after some use.",
      width,
    );
    return;
  }

  for (const family of DETECTOR_FAMILIES) {
    renderFamily(out, family, data, width, titleById);
  }
  renderClosingAccount(out, data, width);
}

// ── bragging rights ─────────────────────────────────────────────────────────

/** The empty-state line for a brag card with no analyzed runs behind it. */
export const BRAG_EMPTY_MESSAGE =
  "Nothing to brag about yet: the logbook holds no analyzed runs. Check back after some use.";

/** The card's provenance line — where every number comes from, and how far
 * it travels. */
export const BRAG_PROVENANCE =
  "Counted from this repository's local logbook. Nothing leaves the machine.";

/** Section labels for the brag card, in render order. */
export const BRAG_SECTIONS = {
  shipped: "Shipped",
  gate: "The gate",
  pace: "Pace",
  standards: "Standards",
  breadth: "Breadth",
} as const;

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Meter cells on a proportion row — wide enough to read, narrow enough to
 * leave the count and its denominator room on an 80-column card. */
export const BRAG_METER_WIDTH = 18;

/** A proportion row: a green-filled meter, then the counts it summarizes. */
function meterRow(c: Palette, fraction: number, text: string): string {
  const cells = meter(fraction, BRAG_METER_WIDTH);
  return `${c.green}${cells.filled}${c.reset}${c.dim}${cells.track}${c.reset} ${text}`;
}

/** Cadence label beside a sparkline — "landings per day", or the folded form
 * once the span outgrew the wire cap. */
function cadenceLabel(unit: string, daysPerPoint: number): string {
  return daysPerPoint <= 1
    ? `${unit} per day`
    : `${unit} per ${formatHumanNumber(daysPerPoint)} days`;
}

/** A section heading's cadence sparkline, when the series has a shape. */
interface BragSpark {
  series: readonly number[];
  label: string;
}

function bragSpark(
  series: readonly number[] | undefined,
  label: string,
): BragSpark | undefined {
  return series !== undefined && series.length > 1 &&
      series.some((value) => value > 0)
    ? { series, label }
    : undefined;
}

/** "12 days (2026-07-18 → 2026-07-29) · 1,670 analyzed runs · 61 branches" */
function bragHeaderLine(data: PatternsData, brag: PatternsBrag): string {
  const parts: string[] = [];
  const breadth = brag.breadth;
  if (
    breadth.first_day !== undefined && breadth.last_day !== undefined &&
    breadth.span_days > 0
  ) {
    parts.push(
      `${
        plural(breadth.span_days, "day")
      } (${breadth.first_day} → ${breadth.last_day})`,
    );
  }
  parts.push(
    plural(data.population.analyzed, "analyzed run"),
    plural(breadth.branches, "branch", "branches"),
  );
  return parts.join(" · ");
}

/** The shipped section: landings and their recorded scale. A single landing
 * keeps the card quiet about "biggest" and "best day" — with one member,
 * both would restate the landing itself. Records read in yellow; the daily
 * run is a streak, so it reads in green. */
function bragShippedRows(
  landings: PatternsBrag["landings"],
  c: Palette,
): string[] {
  if (landings.count === 0) {
    return ["No landings yet."];
  }
  const scale = landings.insertions + landings.deletions > 0
    ? ` · +${formatHumanNumber(landings.insertions)} −${
      formatHumanNumber(landings.deletions)
    } across ${plural(landings.files, "file")} · ${
      plural(landings.commits, "commit")
    }`
    : "";
  const rows = [
    `${c.bold}${plural(landings.count, "landing")}${c.reset} on ${
      plural(landings.branches, "branch", "branches")
    }${scale}`,
  ];
  if (landings.count > 1) {
    const biggest = landings.biggest;
    if (biggest !== undefined) {
      rows.push(
        `biggest: ${
          biggest.branch !== undefined ? `\`${biggest.branch}\` · ` : ""
        }${c.yellow}${plural(biggest.lines, "changed line")}${c.reset} · ${
          plural(biggest.files, "file")
        } (${biggest.day})`,
      );
    }
    const best = landings.best_day;
    if (best !== undefined) {
      rows.push(
        `best day: ${best.day} · ${c.yellow}${
          plural(best.landings, "landing")
        }${c.reset}${
          landings.longest_daily_streak > 1
            ? ` · longest daily run ${c.green}${
              plural(landings.longest_daily_streak, "day")
            }${c.reset}`
            : ""
        }`,
      );
    }
  }
  return rows;
}

/** The gate section: the green share and first-try share as meter rows with
 * their denominators, then streaks and check time. Streaks of one stay off
 * the card. */
function bragGateRows(gate: PatternsBrag["gate"], c: Palette): string[] {
  if (gate.runs === 0) {
    return ["No `done` runs yet."];
  }
  const rows = [
    meterRow(
      c,
      gate.greens / gate.runs,
      `${c.green}${formatHumanNumber(gate.greens)}${c.reset} of ${
        plural(gate.runs, "`done` run")
      } green (${percent(gate.greens, gate.runs)})`,
    ),
  ];
  if (gate.gated_branches > 0) {
    rows.push(
      meterRow(
        c,
        gate.first_try_green_branches / gate.gated_branches,
        `${c.green}${
          formatHumanNumber(gate.first_try_green_branches)
        }${c.reset} of ${
          plural(gate.gated_branches, "branch", "branches")
        } green first try (${
          percent(gate.first_try_green_branches, gate.gated_branches)
        })`,
      ),
    );
  }
  const tail: string[] = [];
  if (gate.longest_green_streak > 1) {
    tail.push(
      `longest green streak ${c.green}${
        formatHumanNumber(gate.longest_green_streak)
      }${c.reset}`,
    );
  }
  if (gate.current_green_streak > 1) {
    tail.push(
      `current ${c.green}${
        formatHumanNumber(gate.current_green_streak)
      }${c.reset}`,
    );
  }
  if (gate.check_hours > 0) {
    tail.push(
      `${
        formatHumanNumber(gate.check_hours)
      }h of checks run (\`done\` · \`prepare\` · \`test\`)`,
    );
  }
  if (tail.length > 0) {
    rows.push(tail.join(" · "));
  }
  return rows;
}

/** The pace section's one row, or nothing before the first completed cycle.
 * The fastest cycle is a record, so it reads in yellow. */
function bragPaceRow(
  cycles: PatternsBrag["cycles"],
  c: Palette,
): string | undefined {
  if (cycles === undefined) {
    return undefined;
  }
  if (cycles.completed === 1) {
    return `1 start-to-accept cycle · ${
      formatHumanNumber(cycles.fastest_hours)
    }h`;
  }
  return `${plural(cycles.completed, "start-to-accept cycle")} · median ${
    formatHumanNumber(cycles.median_hours)
  }h · fastest ${c.yellow}${
    formatHumanNumber(cycles.fastest_hours)
  }h${c.reset}`;
}

/** The breadth section: branches driven, active days, the busiest day. */
function bragBreadthRow(
  breadth: PatternsBrag["breadth"],
  c: Palette,
): string {
  const busiest = breadth.busiest_day;
  return `${plural(breadth.branches, "branch", "branches")} driven · active ${
    formatHumanNumber(breadth.active_days)
  } of ${plural(breadth.span_days, "day")}${
    busiest !== undefined && busiest.branches > 1
      ? ` · busiest day ${c.yellow}${
        plural(busiest.branches, "branch", "branches")
      }${c.reset} (${busiest.day})`
      : ""
  }`;
}

/** One card section: a bold label — carrying its cyan cadence sparkline when
 * the span has one — then its wrapped stat rows. */
function bragSection(
  out: Out,
  width: number,
  label: string,
  rows: readonly string[],
  spark?: BragSpark | undefined,
): void {
  const c = out.c;
  const tail = spark === undefined
    ? ""
    : `  ${c.cyan}${
      sparkline(spark.series)
    }${c.reset} ${c.dim}${spark.label}${c.reset}`;
  out.raw(`  ${c.bold}${label}${c.reset}${tail}\n`);
  for (const row of rows) {
    writeWrapped(out, "    ", row, width);
  }
}

/** Render the bragging-rights card: the practice's countable feats, each
 * with its denominator beside it, from the same analysis population the
 * detectors read. The detector report looks for what needs attention; this
 * card counts what went well. Color is meaning, never decoration: green for
 * gate greens and streaks, yellow for records, cyan for cadence sparklines. */
function renderBragReport(
  out: Out,
  data: PatternsData,
  brag: PatternsBrag,
  slug: string,
): void {
  const c = out.c;
  const width = terminalWidth();
  out.heading(`discern patterns --brag${slug ? ` · ${slug}` : ""}`);
  if (data.population.analyzed === 0) {
    writeWrapped(out, "  ", BRAG_EMPTY_MESSAGE, width);
    return;
  }
  const dim = (line: string): string => `${c.dim}${line}${c.reset}`;
  writeWrapped(out, "  ", bragHeaderLine(data, brag), width, dim);
  writeWrapped(out, "  ", BRAG_PROVENANCE, width, dim);
  out.raw("\n");
  const daysPerPoint = brag.series_days_per_point ?? 1;
  bragSection(
    out,
    width,
    BRAG_SECTIONS.shipped,
    bragShippedRows(brag.landings, c),
    bragSpark(brag.landings.per_day, cadenceLabel("landings", daysPerPoint)),
  );
  bragSection(
    out,
    width,
    BRAG_SECTIONS.gate,
    bragGateRows(brag.gate, c),
    bragSpark(
      brag.gate.greens_per_day,
      cadenceLabel("green runs", daysPerPoint),
    ),
  );
  const pace = bragPaceRow(brag.cycles, c);
  if (pace !== undefined) {
    bragSection(out, width, BRAG_SECTIONS.pace, [pace]);
  }
  if (brag.ratchet.pins > 0) {
    bragSection(out, width, BRAG_SECTIONS.standards, [
      `${plural(brag.ratchet.pins, "limit")} tightened across ${
        plural(brag.ratchet.standards, "standard")
      }. Loosening fails the gate.`,
    ]);
  }
  bragSection(
    out,
    width,
    BRAG_SECTIONS.breadth,
    [bragBreadthRow(brag.breadth, c)],
    bragSpark(
      brag.breadth.branches_per_day,
      daysPerPoint <= 1
        ? "branches active per day"
        : `peak branches per ${formatHumanNumber(daysPerPoint)} days`,
    ),
  );
  out.raw("\n");
  writeWrapped(
    out,
    "  ",
    "Data: `discern patterns --brag --json`.",
    width,
    dim,
  );
}

/** Options accepted by the patterns CLI. */
export interface RunPatternsOptions {
  json: boolean;
  /** Render the bragging-rights card (and carry `data.brag`) instead of the
   * detector report. */
  brag: boolean;
}

/** Run `discern patterns`. Returns a process exit code — 0 whenever the
 * logbook was readable: findings are advice, never failures. */
export async function runPatterns(
  root: string,
  opts: RunPatternsOptions,
): Promise<number> {
  const result = await patternsResult(root, { brag: opts.brag });
  observeResult(result);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns failed.");
    return 1;
  }
  const config = await loadConfig(root);
  const brag = result.data.brag;
  if (brag !== undefined) {
    renderBragReport(out, result.data, brag, config.project.slug);
  } else {
    renderReport(out, result.data, config.project.slug);
  }
  return 0;
}

// ── the reset action ────────────────────────────────────────────────────────

/**
 * Compute (and unless `dryRun`, apply) the `patterns reset` result: delete the
 * whole logbook directory — every month file and the epoch sidecar — and
 * report exactly what was (or would be) removed. Plan/apply like every
 * effectful verb: the plan is the file list, computed read-only; the executor
 * is one directory removal in the store.
 */
export async function patternsResetResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult<PatternsResetData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns reset");
  }
  const dryRun = opts.dryRun ?? false;
  const removed = await listLogbookFiles(commonGitDir);
  const data: PatternsResetData = {
    dir: logbookDir(commonGitDir),
    removed,
    bytes: removed.reduce((sum, f) => sum + f.bytes, 0),
  };
  if (removed.length === 0) {
    return {
      ok: true,
      verb: "patterns reset",
      ...(dryRun ? { dry_run: true } : {}),
      data,
      hints: hintTexts([fire(HINTS["patterns-reset-empty"])]),
    };
  }
  if (dryRun) {
    return {
      ok: true,
      verb: "patterns reset",
      dry_run: true,
      data,
      hints: hintTexts([fire(HINTS["patterns-reset-preview"])]),
    };
  }
  await removeLogbook(commonGitDir);
  const hints: FiredHint[] = [];
  const recording = await loadConfig(root)
    .then((c) => c.project.logbook)
    .catch(() => undefined);
  if (recording === true) {
    hints.push(fire(HINTS["patterns-reset-recording-resumes"]));
  }
  return {
    ok: true,
    verb: "patterns reset",
    data,
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
  };
}

/** Options accepted by the patterns-reset CLI. */
export interface RunPatternsResetOptions {
  json: boolean;
  dryRun: boolean;
}

/** Run `discern patterns reset`. Returns a process exit code. */
export async function runPatternsReset(
  root: string,
  opts: RunPatternsResetOptions,
): Promise<number> {
  const result = await patternsResetResult(root, { dryRun: opts.dryRun });
  observeResult(result);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns reset failed.");
    return 1;
  }
  const c = out.c;
  const data = result.data;
  if (data.removed.length === 0) {
    out.raw(`${fire(HINTS["patterns-reset-empty"]).text}\n`);
    return 0;
  }
  const verb = result.dry_run === true ? "Would remove" : "Removed";
  out.raw(`${verb} the logbook at ${c.dim}${data.dir}${c.reset}:\n`);
  for (const f of data.removed) {
    out.raw(`  ${f.file} ${c.dim}(${f.bytes} bytes)${c.reset}\n`);
  }
  out.raw(
    `${data.removed.length} file${
      data.removed.length === 1 ? "" : "s"
    }, ${data.bytes} bytes${
      result.dry_run === true ? " — nothing removed" : ""
    }.\n`,
  );
  for (const hint of interactiveHintTexts(result.hints)) {
    out.raw(`${c.dim}${hint}${c.reset}\n`);
  }
  return 0;
}
