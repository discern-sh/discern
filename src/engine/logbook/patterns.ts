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
 * {@link runPatterns} is the CLI. `--stats` asks the same read for the
 * practice's stats (`stats.ts` computes them; `data.stats` carries them) and
 * swaps the human report for the card.
 *
 * Advisory only, structurally: the result is always `ok` once the selected
 * logbook is readable — findings are advice, never failures — and nothing in
 * the gate imports this module. Reset and archive are CLI-only lifecycle
 * actions with a noninteractive preview and a terminal-confirmed apply.
 */

import { agentLabel } from "../../shared/agent_catalogue.ts";
import { basename, join } from "@std/path";
import {
  loadConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  DETECTOR_FAMILIES,
  type DetectorFamily,
  type PatternFindingTone,
  PATTERNS_FINDINGS_PER_DETECTOR,
  type PatternsArchiveData,
  type PatternsArchiveEntry,
  type PatternsArchivesData,
  type PatternsData,
  type PatternsFinding,
  type PatternsPopulation,
  type PatternsResetData,
  type PatternsStats,
} from "../../shared/patterns_vocabulary.ts";
import {
  LOGBOOK_LIFECYCLE_ACTION_NAMES,
  type LogbookLifecycleAccess,
  logbookLifecycleAccess,
  type LogbookLifecycleActionName,
} from "../../shared/logbook_lifecycle.ts";
import { LOGBOOK_POWERED } from "../../shared/logbook_powered.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import { fire, type FiredHint, HINTS, hintTexts } from "../../shared/hints.ts";
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
import {
  freshInFlightInvocations,
  type LogbookStream,
  readLogbookFile,
  readLogbookStream,
  summarizeLogbookStream,
} from "./read.ts";
import {
  archiveLogbook,
  isLogbookArchiveFileName,
  listLogbookFiles,
  logbookArchiveDir,
  logbookDir,
  type LogbookFile,
  LogbookLifecycleBusyError,
  LogbookLifecycleError,
  MONTH_FILE_RE,
  nextLogbookArchiveFileName,
  removeLogbook,
  withLogbookLifecycleLock,
} from "./store.ts";
import { driverAgent, driverKind } from "./cohorts.ts";
import { configEpoch } from "./epoch.ts";
import { computeStats } from "./stats.ts";
import {
  buildStreamFacts,
  inclusiveSpanDays,
  round1,
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
  /** Also compute practice stats (`data.stats`) from the same stream. */
  stats?: boolean;
  /** Report every finding instead of each detector's strongest few. */
  all?: boolean;
  /** Read one sealed archive basename instead of the active Logbook. */
  logbookFile?: string;
}

type PatternsSource =
  | { kind: "active" }
  | { kind: "archive"; filename: string };

/** A selected archive that cannot be resolved inside the registered store. */
class ArchiveSelectionError extends Error {
  readonly slug: "invalid_arguments" | "not_found" | "read_error";

  /** Build a structured selector refusal. */
  constructor(
    slug: "invalid_arguments" | "not_found" | "read_error",
    message: string,
  ) {
    super(message);
    this.name = "ArchiveSelectionError";
    this.slug = slug;
  }
}

/** Resolve and read one basename-only archive without following a symlink. */
async function readSelectedArchive(
  commonGitDir: string,
  filename: string,
): Promise<LogbookStream> {
  if (
    filename === "" || filename !== basename(filename) ||
    filename.includes("/") || filename.includes("\\") ||
    !isLogbookArchiveFileName(filename)
  ) {
    throw new ArchiveSelectionError(
      "invalid_arguments",
      "--logbook-file accepts one sealed archive basename from `discern patterns archives`; paths and active Logbook names are not allowed.",
    );
  }
  const path = join(logbookArchiveDir(commonGitDir), filename);
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ArchiveSelectionError(
        "not_found",
        `No sealed Logbook archive named ${filename} exists. Run \`discern patterns archives\` to list valid filenames.`,
      );
    }
    throw new ArchiveSelectionError(
      "read_error",
      `Could not inspect sealed Logbook archive ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!info.isFile || info.isSymlink) {
    throw new ArchiveSelectionError(
      "invalid_arguments",
      `${filename} is not a regular sealed Logbook archive file.`,
    );
  }
  try {
    return await readLogbookFile(path, filename);
  } catch (error) {
    throw new ArchiveSelectionError(
      "read_error",
      `Could not read sealed Logbook archive ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Keep each detector's strongest findings, preserving the global rank order.
 * The bound holds the report to the registry's size while the detector rows
 * keep every true count. */
function capFindingsPerDetector(
  findings: readonly PatternsFinding[],
): PatternsFinding[] {
  const kept: PatternsFinding[] = [];
  const perDetector = new Map<string, number>();
  for (const finding of findings) {
    const seen = perDetector.get(finding.detector) ?? 0;
    if (seen < PATTERNS_FINDINGS_PER_DETECTOR) {
      perDetector.set(finding.detector, seen + 1);
      kept.push(finding);
    }
  }
  return kept;
}

/**
 * Compute the `patterns` {@link DiscernResult} without printing or exiting —
 * the core the MCP server renders. Reads the whole logbook tolerantly (torn
 * and foreign lines are skipped and counted), runs every registry detector
 * with its evidence threshold applied, and reports the ranked findings plus
 * every detector's status. When asked, `data.stats` joins with the practice's
 * stats read from the same stream (`stats.ts`). An empty or absent logbook
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
  let stream: LogbookStream;
  let source: PatternsSource;
  try {
    if (opts.logbookFile === undefined) {
      stream = await readLogbookStream(commonGitDir);
      source = { kind: "active" };
    } else {
      stream = await readSelectedArchive(commonGitDir, opts.logbookFile);
      source = { kind: "archive", filename: opts.logbookFile };
    }
  } catch (error) {
    if (error instanceof ArchiveSelectionError) {
      return {
        ok: false,
        verb: "patterns",
        error: error.slug,
        message: error.message,
        hints: hintTexts([fire(HINTS["patterns-archive-selection"])]),
      };
    }
    throw error;
  }
  const facts = buildStreamFacts(
    stream.events,
    config.repository.trunk,
    resolveConfiguredAgents(config),
  );
  const reports = runDetectors(facts);
  const ranked = routeDetectorReports(reports).patterns.map(
    routedFindingData,
  );
  const findings = opts.all === true ? ranked : capFindingsPerDetector(ranked);
  const first = stream.events[0];
  const last = stream.events[stream.events.length - 1];
  const branches = new Set(
    facts.verbs.map((e) => e.branch).filter((b): b is string => b !== null),
  );
  const data: PatternsData = {
    logbook: {
      source,
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
    ...(findings.length < ranked.length
      ? { findings_total: ranked.length }
      : {}),
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
    ...(opts.stats === true ? { stats: computeStats(facts) } : {}),
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
    if (findings.length < ranked.length) {
      hints.push(
        fire(HINTS["patterns-findings-capped"], {
          shown: findings.length,
          total: ranked.length,
        }),
      );
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
const ALL_COMMAND = "`discern patterns --all`";

/** Format a count with its singular or supplied plural noun. */
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

/** Summarize fired, quiet, and evidence-limited detectors in one report line. */
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

/** Wrap prose after a fixed prefix and align every continuation line beneath it. */
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

/** Render the canonical glyph and color assigned to a finding tone. */
function toneGlyph(tone: PatternFindingTone, palette: Palette): string {
  const presentation = PATTERNS_TONE_GLYPHS[tone];
  return `${palette[presentation.color]}${presentation.glyph}${palette.reset}`;
}

interface FindingRow {
  finding: PatternsFinding;
  renderedSeries: string;
}

/** Align finding subjects and sparklines before wrapping their explanatory prose. */
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

/** Deduplicate next actions and combine compatible standard-pin findings. */
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

/** Group findings by detector while preserving their ranked input order. */
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

/** Render one detector family with its findings, evidence, and next actions. */
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
  const countById = new Map(data.detectors.map((d) => [d.id, d.findings]));
  const c = out.c;
  out.group(`family:${family}`);
  out.raw(
    `${c.bold}${PATTERNS_FAMILY_SECTIONS[family].heading}${c.reset}\n`,
  );
  for (const [index, [detector, findings]] of [...groups].entries()) {
    if (index > 0) out.group(`family:${family}:detector:${detector}`);
    writeWrapped(
      out,
      "  ",
      titleById.get(detector) ?? detector,
      width,
      (line) => `${c.bold}${line}${c.reset}`,
    );
    renderFindingRows(out, findings, width);
    const elided = (countById.get(detector) ?? findings.length) -
      findings.length;
    if (elided > 0) {
      writeWrapped(
        out,
        "    ",
        `+${plural(elided, "more finding")} — ${ALL_COMMAND} lists every one.`,
        width,
        (line) => `${c.dim}${line}${c.reset}`,
      );
    }
    writeWrapped(
      out,
      `    ${c.cyan}→${c.reset} `,
      detectorNextStep(findings),
      width,
    );
  }

  const crossesBoundary = family === "trajectory" &&
    familyFindings.some((finding) =>
      finding.observed.includes(TRAJECTORY_BOUNDARY_ATTRIBUTION)
    );
  if (crossesBoundary) {
    out.group(`family:${family}:caveat`);
    writeWrapped(
      out,
      "  ",
      `(${PATTERNS_TRAJECTORY_CAVEAT})`,
      width,
      (line) => `${c.dim}${line}${c.reset}`,
    );
  }
}

/** Point to the strongest bounded set of attention findings near the report top. */
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
  out.group("attention");
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

/** Account for quiet and evidence-limited detectors after the detailed findings. */
function renderClosingAccount(
  out: Out,
  data: PatternsData,
  width: number,
): void {
  const c = out.c;
  out.group("closing-account");
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
  const archive = data.logbook.source.kind === "archive"
    ? ` · archive ${data.logbook.source.filename}`
    : "";
  out.heading(`discern patterns${slug ? ` · ${slug}` : ""}${archive}`);
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

  if (data.logbook.events === 0) {
    out.group("empty-logbook");
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

// ── practice stats ─────────────────────────────────────────────────────────

/** The empty-state line for a stats card with no analyzed runs behind it. */
export const STATS_EMPTY_MESSAGE =
  "No stats yet: the logbook holds no analyzed runs. Check back after some use.";

/** The card's provenance line — where every number comes from, and how far
 * it travels. */
export const STATS_PROVENANCE =
  "Counted from this repository's local logbook. Nothing leaves the machine.";

/** Section labels for the stats card, in render order. */
export const STATS_SECTIONS = {
  accepted: "Accepted",
  gate: "The gate",
  pace: "Pace",
  standards: "Standards",
  agents: "Agents",
  breadth: "Breadth",
} as const;

/** Render a count pair as a rounded percentage for the stats card. */
function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Meter cells on a proportion row — wide enough to read, narrow enough to
 * leave the count and its denominator room on an 80-column card. */
export const STATS_METER_WIDTH = 18;

/** A proportion row: a green-filled meter, then the counts it summarizes. */
function meterRow(c: Palette, fraction: number, text: string): string {
  const cells = meter(fraction, STATS_METER_WIDTH);
  return `${c.green}${cells.filled}${c.reset}${c.dim}${cells.track}${c.reset} ${text}`;
}

/** Cadence label beside a sparkline — "accepted per day", or the folded form
 * once the span outgrew the wire cap. */
function cadenceLabel(unit: string, daysPerPoint: number): string {
  return daysPerPoint <= 1
    ? `${unit} per day`
    : `${unit} per ${formatHumanNumber(daysPerPoint)} days`;
}

/** A section heading's cadence sparkline, when the series has a shape. */
interface StatsSpark {
  series: readonly number[];
  label: string;
}

/** Keep a cadence series only when it spans multiple nonzero points. */
function statsSpark(
  series: readonly number[] | undefined,
  label: string,
): StatsSpark | undefined {
  return series !== undefined && series.length > 1 &&
      series.some((value) => value > 0)
    ? { series, label }
    : undefined;
}

/** "12 days (2026-07-18 → 2026-07-29) · 1,670 analyzed runs · 61 branches" */
function statsHeaderLine(data: PatternsData, stats: PatternsStats): string {
  const parts: string[] = [];
  const breadth = stats.breadth;
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

/** The accepted section: changes accepted and their recorded scale. A single
 * accepted change keeps the card quiet about "biggest" and "best day" — with
 * one member, both would restate the change itself. Records read in yellow;
 * the acceptance streak reads in green; added and removed lines read
 * git-style, green and red. */
function statsAcceptedRows(
  accepted: PatternsStats["accepted"],
  c: Palette,
): string[] {
  if (accepted.count === 0) {
    return ["Nothing accepted yet."];
  }
  const rows = [
    `${c.bold}${plural(accepted.count, "change")} accepted${c.reset} from ${
      plural(accepted.branches, "branch", "branches")
    }${accepted.commits > 0 ? ` · ${plural(accepted.commits, "commit")}` : ""}`,
  ];
  if (accepted.insertions + accepted.deletions > 0) {
    const ratio = accepted.deletions > 0
      ? round1(accepted.insertions / accepted.deletions)
      : undefined;
    rows.push(
      `${c.green}+${
        formatHumanNumber(accepted.insertions)
      }${c.reset} ${c.red}−${
        formatHumanNumber(accepted.deletions)
      }${c.reset} across ${plural(accepted.files, "file")}${
        ratio !== undefined
          ? ` · ${formatHumanNumber(ratio)} ${
            ratio === 1 ? "line" : "lines"
          } added per line removed`
          : ""
      }`,
    );
  }
  if (accepted.cleanups > 0) {
    rows.push(
      `${formatHumanNumber(accepted.cleanups)} of ${
        formatHumanNumber(accepted.count)
      } removed more lines than they added`,
    );
  }
  if (accepted.count > 1) {
    const biggest = accepted.biggest;
    if (biggest !== undefined) {
      rows.push(
        `biggest: ${
          biggest.branch !== undefined ? `\`${biggest.branch}\` · ` : ""
        }${c.yellow}${plural(biggest.lines, "changed line")}${c.reset} · ${
          plural(biggest.files, "file")
        } (${biggest.day})`,
      );
    }
    const best = accepted.best_day;
    if (best !== undefined) {
      rows.push(
        `best day: ${best.day} · ${c.yellow}${
          formatHumanNumber(best.accepted)
        } accepted${c.reset}${
          accepted.longest_streak > 1
            ? ` · longest streak ${c.green}${
              plural(accepted.longest_streak, "day")
            }${c.reset}`
            : ""
        }`,
      );
    }
  }
  return rows;
}

/** The gate section: the green share and first-try share as meter rows with
 * their denominators, red runs reframed as the gate's saves, then streaks
 * and check time. Streaks of one stay off the card. */
function statsGateRows(gate: PatternsStats["gate"], c: Palette): string[] {
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
  const reds = gate.runs - gate.greens;
  if (reds > 0) {
    rows.push(
      `${c.red}${plural(reds, "red run")}${c.reset} stopped at the gate`,
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

/** An every-N interval in hours, shifting to days once hours stop reading
 * well. */
function everyLabel(hours: number): string {
  return hours < 48
    ? `${formatHumanNumber(round1(hours))}h`
    : `${plural(round1(hours / 24), "day")}`;
}

/** The pace section: how many starts were accepted (a meter row), the
 * measured start-to-accept cycles with their times, and the span-wide
 * acceptance cadence. A cycle is measured only when its `start` and `accept`
 * are both on record, so the cycle count can sit below the accepted count.
 * Empty before the first measured cycle on a one-day span. The fastest cycle
 * is a record, so it reads in yellow. */
function statsPaceRows(stats: PatternsStats, c: Palette): string[] {
  const rows: string[] = [];
  const cycles = stats.cycles;
  if (cycles !== undefined) {
    rows.push(
      meterRow(
        c,
        cycles.completed / cycles.started,
        `${c.green}${formatHumanNumber(cycles.completed)}${c.reset} of ${
          plural(cycles.started, "start")
        } were accepted (${percent(cycles.completed, cycles.started)})`,
      ),
    );
    if (cycles.completed === 1) {
      rows.push(
        `1 measured start-to-accept cycle · ${
          formatHumanNumber(cycles.fastest_hours)
        }h`,
      );
    } else {
      rows.push(
        `start-to-accept across ${
          plural(cycles.completed, "measured cycle")
        } · median ${
          formatHumanNumber(cycles.median_hours)
        }h · fastest ${c.yellow}${
          formatHumanNumber(cycles.fastest_hours)
        }h${c.reset}${
          cycles.under_day > 0
            ? ` · ${formatHumanNumber(cycles.under_day)} inside a day`
            : ""
        }`,
      );
    }
  }
  const accepted = stats.accepted;
  if (accepted.count > 1 && stats.breadth.span_days > 1) {
    rows.push(
      `one change accepted every ${
        everyLabel((stats.breadth.span_days * 24) / accepted.count)
      } across the span`,
    );
  }
  return rows;
}

/** The breadth section: branches driven, active days, the busiest day, and
 * the peak overlap — the most changes in flight at one instant. */
function statsBreadthRows(
  breadth: PatternsStats["breadth"],
  c: Palette,
): string[] {
  const busiest = breadth.busiest_day;
  const rows = [
    `${plural(breadth.branches, "branch", "branches")} driven · active ${
      formatHumanNumber(breadth.active_days)
    } of ${plural(breadth.span_days, "day")}${
      busiest !== undefined && busiest.branches > 1
        ? ` · busiest day ${c.yellow}${
          plural(busiest.branches, "branch", "branches")
        }${c.reset} (${busiest.day})`
        : ""
    }`,
  ];
  const peak = breadth.peak_in_flight;
  if (peak !== undefined && peak.branches > 1) {
    rows.push(
      `up to ${c.yellow}${
        plural(peak.branches, "change")
      } in flight at once${c.reset} (${peak.day})`,
    );
  }
  return rows;
}

/** The standards section: the pin ratchet and the most improved standard,
 * percent-normalized against its first reading so different scales read
 * like-for-like. */
function statsStandardsRows(
  ratchet: PatternsStats["ratchet"],
  c: Palette,
): string[] {
  const rows: string[] = [];
  if (ratchet.pins > 0) {
    rows.push(
      `${plural(ratchet.pins, "limit")} tightened across ${
        plural(ratchet.standards, "standard")
      }. Loosening fails the gate.`,
    );
  }
  const improved = ratchet.most_improved;
  if (improved !== undefined) {
    rows.push(
      `most improved: \`${improved.standard}\` ${
        formatHumanNumber(improved.from)
      } → ${formatHumanNumber(improved.to)} (${c.green}${
        formatHumanNumber(improved.better_percent)
      }% better${c.reset})`,
    );
  }
  return rows;
}

/** The agents section: attributed identities with their runs and green-gate
 * shares, each with its own usage sparkline. The cohort seam's honesty rules
 * hold here: below-minimum identities are counted but never listed, and the
 * unattributed share is always stated. */
function statsAgentsRows(
  agents: PatternsStats["agents"],
  c: Palette,
): string[] {
  const below = agents.below_minimum;
  const rows = [
    `${plural(agents.detected, "agent identity", "agent identities")}${
      agents.unattributed_runs > 0
        ? ` · ${formatHumanNumber(agents.unattributed_runs)} runs unattributed`
        : ""
    }`,
  ];
  for (const identity of agents.identities) {
    const spark = identity.per_day !== undefined && identity.per_day.length > 1
      ? `${c.cyan}${sparkline(identity.per_day)}${c.reset} `
      : "";
    const share = identity.done_runs > 0
      ? `${c.green}${formatHumanNumber(identity.greens)}${c.reset} of ${
        plural(identity.done_runs, "`done` run")
      } green (${percent(identity.greens, identity.done_runs)})`
      : "no `done` runs";
    rows.push(
      `${spark}${c.bold}${identity.label}${c.reset} · ${
        plural(identity.runs, "run")
      } · ${share}`,
    );
  }
  if (below !== undefined) {
    rows.push(
      `${
        plural(below.agents, "more identity", "more identities")
      } below the reporting minimums · ${plural(below.runs, "run")}`,
    );
  }
  return rows;
}

/** One card section: a bold label — carrying its cyan cadence sparkline when
 * the span has one — then its wrapped stat rows, then a blank line so the
 * groups read apart. */
function statsSection(
  out: Out,
  width: number,
  label: string,
  rows: readonly string[],
  spark?: StatsSpark | undefined,
): void {
  const c = out.c;
  out.group(`stats:${label}`);
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

/** Render the practice-stats card: the practice's countable feats, each
 * with its denominator beside it, from the same analysis population the
 * detectors read. The detector report looks for what needs attention; this
 * card counts what went well. Color is meaning, never decoration: green for
 * gate greens and streaks, yellow for records, cyan for cadence sparklines. */
function renderStatsReport(
  out: Out,
  data: PatternsData,
  stats: PatternsStats,
  slug: string,
): void {
  const c = out.c;
  const width = terminalWidth();
  const archive = data.logbook.source.kind === "archive"
    ? ` · archive ${data.logbook.source.filename}`
    : "";
  out.heading(
    `discern patterns --stats${slug ? ` · ${slug}` : ""}${archive}`,
  );
  if (data.population.analyzed === 0) {
    writeWrapped(out, "  ", STATS_EMPTY_MESSAGE, width);
    return;
  }
  const dim = (line: string): string => `${c.dim}${line}${c.reset}`;
  writeWrapped(out, "  ", statsHeaderLine(data, stats), width, dim);
  writeWrapped(out, "  ", STATS_PROVENANCE, width, dim);
  const daysPerPoint = stats.series_days_per_point ?? 1;
  statsSection(
    out,
    width,
    STATS_SECTIONS.accepted,
    statsAcceptedRows(stats.accepted, c),
    statsSpark(stats.accepted.per_day, cadenceLabel("accepted", daysPerPoint)),
  );
  statsSection(
    out,
    width,
    STATS_SECTIONS.gate,
    statsGateRows(stats.gate, c),
    statsSpark(
      stats.gate.greens_per_day,
      cadenceLabel("green runs", daysPerPoint),
    ),
  );
  const pace = statsPaceRows(stats, c);
  if (pace.length > 0) {
    statsSection(out, width, STATS_SECTIONS.pace, pace);
  }
  const standards = statsStandardsRows(stats.ratchet, c);
  if (standards.length > 0) {
    // The trend can honestly fall, so unlike the count sparks it shows
    // whenever it moves at all.
    const trend = stats.ratchet.trend;
    statsSection(
      out,
      width,
      STATS_SECTIONS.standards,
      standards,
      trend !== undefined && trend.length > 1 &&
        trend.some((value) => value !== 0)
        ? {
          series: trend,
          label: cadenceLabel("average improvement", daysPerPoint),
        }
        : undefined,
    );
  }
  if (stats.agents.identities.length > 0 || stats.agents.detected > 0) {
    statsSection(
      out,
      width,
      STATS_SECTIONS.agents,
      statsAgentsRows(stats.agents, c),
      statsSpark(
        stats.agents.per_day,
        cadenceLabel("agent runs", daysPerPoint),
      ),
    );
  }
  statsSection(
    out,
    width,
    STATS_SECTIONS.breadth,
    statsBreadthRows(stats.breadth, c),
    statsSpark(
      stats.breadth.branches_per_day,
      daysPerPoint <= 1
        ? "branches active per day"
        : `peak branches per ${formatHumanNumber(daysPerPoint)} days`,
    ),
  );
  writeWrapped(
    out,
    "  ",
    "Data: `discern patterns --stats --json`.",
    width,
    dim,
  );
}

/** Options accepted by the patterns CLI. */
export interface RunPatternsOptions {
  json: boolean;
  /** Render the practice-stats card (and carry `data.stats`) instead of the
   * detector report. */
  stats: boolean;
  /** Report every finding instead of each detector's strongest few. */
  all: boolean;
  /** Read one sealed archive basename instead of the active Logbook. */
  logbookFile?: string;
}

/** Run `discern patterns`. Returns a process exit code — 0 whenever the
 * logbook was readable: findings are advice, never failures. */
export async function runPatterns(
  root: string,
  opts: RunPatternsOptions,
): Promise<number> {
  const result = await patternsResult(root, {
    stats: opts.stats,
    all: opts.all,
    ...(opts.logbookFile !== undefined
      ? { logbookFile: opts.logbookFile }
      : {}),
  });
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
  const stats = result.data.stats;
  if (stats !== undefined) {
    renderStatsReport(out, result.data, stats, config.project.slug);
  } else {
    renderReport(out, result.data, config.project.slug);
  }
  return 0;
}

// ── active Logbook lifecycle ───────────────────────────────────────────────

interface ActiveLifecycleSnapshot {
  commonGitDir: string;
  stream: LogbookStream;
  files: LogbookFile[];
  bytes: number;
  archiveBytes: number;
  fingerprint: string;
  currentEpoch: string;
  recording: boolean;
}

const RESET_IMPACTS = LOGBOOK_POWERED.map(({ key, phrase, surface }) => ({
  key,
  phrase,
  surface,
}));

/** Render bytes as a stable hexadecimal digest. */
function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Join byte chunks without changing their content. */
function joinBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(
    new ArrayBuffer(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
    ),
  );
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** Read the exact active source used by a lifecycle plan. */
async function activeLifecycleSnapshot(
  root: string,
  commonGitDir: string,
): Promise<ActiveLifecycleSnapshot> {
  const config = await loadConfig(root);
  const files = await listLogbookFiles(commonGitDir);
  const stream = await readLogbookStream(commonGitDir);
  const encoder = new TextEncoder();
  const digestChunks: Uint8Array[] = [];
  let archiveBytes = 0;
  let wroteArchiveContent = false;
  let previousEndedWithNewline = true;
  for (const file of files) {
    const bytes = await Deno.readFile(
      join(logbookDir(commonGitDir), file.file),
    );
    digestChunks.push(
      encoder.encode(`${file.file}\0${bytes.length}\0`),
      bytes,
      new Uint8Array([0]),
    );
    if (!MONTH_FILE_RE.test(file.file) || bytes.length === 0) {
      continue;
    }
    if (wroteArchiveContent && !previousEndedWithNewline) {
      archiveBytes += 1;
    }
    archiveBytes += bytes.length;
    wroteArchiveContent = true;
    previousEndedWithNewline = bytes[bytes.length - 1] === 0x0a;
  }
  const digest = await crypto.subtle.digest("SHA-256", joinBytes(digestChunks));
  return {
    commonGitDir,
    stream,
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    archiveBytes,
    fingerprint: hex(new Uint8Array(digest)),
    currentEpoch: configEpoch(config).fingerprint,
    recording: config.project.logbook,
  };
}

/** Whether two plans name the same active bytes. */
function sameActiveSnapshot(
  reviewed: ActiveLifecycleSnapshot,
  current: ActiveLifecycleSnapshot,
): boolean {
  return reviewed.fingerprint === current.fingerprint &&
    reviewed.files.length === current.files.length;
}

/** Add tolerant event counts and date bounds to one lifecycle payload. */
function historyFields(snapshot: ActiveLifecycleSnapshot): {
  events: number;
  unparsed: number;
  first_at?: string;
  last_at?: string;
} {
  const summary = summarizeLogbookStream(snapshot.stream);
  return {
    events: summary.events,
    unparsed: summary.unparsed,
    ...(summary.firstAt !== undefined ? { first_at: summary.firstAt } : {}),
    ...(summary.lastAt !== undefined ? { last_at: summary.lastAt } : {}),
  };
}

/** Project one active snapshot into the reset's public result data. */
function resetData(
  snapshot: ActiveLifecycleSnapshot,
  recoveryPath?: string,
): PatternsResetData {
  return {
    dir: logbookDir(snapshot.commonGitDir),
    removed: snapshot.files,
    bytes: snapshot.bytes,
    ...historyFields(snapshot),
    impacts: RESET_IMPACTS,
    ...(recoveryPath !== undefined ? { recovery_path: recoveryPath } : {}),
  };
}

/** Project one active snapshot into the archive's public result data. */
function archiveData(
  snapshot: ActiveLifecycleSnapshot,
  filename: string,
  archiveBytes: number = snapshot.archiveBytes,
  recoveryPath?: string,
): PatternsArchiveData {
  const destinationDir = logbookArchiveDir(snapshot.commonGitDir);
  return {
    source_dir: logbookDir(snapshot.commonGitDir),
    destination_dir: destinationDir,
    archive_file: filename,
    archive_path: join(destinationDir, filename),
    files: snapshot.files,
    source_bytes: snapshot.bytes,
    archive_bytes: archiveBytes,
    ...historyFields(snapshot),
    ...(recoveryPath !== undefined ? { recovery_path: recoveryPath } : {}),
  };
}

/** The structured refusal shared by every unattended lifecycle apply. */
function confirmationRefusal<T>(
  verb: string,
  data: T,
): DiscernResult<T> {
  return {
    ok: false,
    verb,
    error: "confirmation_required",
    message:
      `${verb} apply requires terminal stdin and stdout, non-CI operation, non-plain output, and an explicit Yes. ` +
      "Use --dry-run for a noninteractive, machine-readable plan.",
    data,
    hints: hintTexts([fire(HINTS["patterns-lifecycle-confirmation"])]),
  };
}

/** The date span shown in lifecycle review and confirmation text. */
function lifecycleSpan(data: {
  first_at?: string | undefined;
  last_at?: string | undefined;
}): string {
  return data.first_at === undefined || data.last_at === undefined
    ? "no parsed date span"
    : `${data.first_at.slice(0, 10)} → ${data.last_at.slice(0, 10)}`;
}

/** Render every source file from a reset or archive plan. */
function renderLifecycleFiles(
  out: Out,
  files: readonly LogbookFile[],
): void {
  for (const file of files) {
    out.raw(`  ${file.file} ${out.c.dim}(${file.bytes} bytes)${out.c.reset}\n`);
  }
}

/** Render the complete reset scope before preview, refusal, or confirmation. */
function renderResetScope(out: Out, data: PatternsResetData): void {
  out.heading("Active Logbook reset");
  out.raw(
    `  ${plural(data.events, "event")} · ${lifecycleSpan(data)} · ${
      plural(data.removed.length, "file")
    } · ${formatHumanNumber(data.bytes)} bytes\n`,
  );
  renderLifecycleFiles(out, data.removed);
  out.group("impact");
  out.raw("Evidence restarts for:\n");
  for (const impact of data.impacts) {
    out.raw(`  - ${impact.phrase} (${impact.surface})\n`);
  }
}

/** Render the complete archive scope before preview, refusal, or confirmation. */
function renderArchiveScope(out: Out, data: PatternsArchiveData): void {
  out.heading("Active Logbook archive");
  out.raw(
    `  ${plural(data.events, "event")} · ${lifecycleSpan(data)} · ${
      plural(data.files.length, "file")
    } · ${formatHumanNumber(data.source_bytes)} source bytes\n`,
  );
  renderLifecycleFiles(out, data.files);
  out.raw(
    `Destination: ${data.archive_path} (${
      formatHumanNumber(data.archive_bytes)
    } event bytes)\n`,
  );
  out.raw("epoch.json starts fresh and is not copied into the archive.\n");
}

/** Ask one default-No confirmation, treating prompt cancellation as No. */
async function confirmLifecycle(
  message: string,
  confirm: LifecycleConfirmation,
): Promise<boolean> {
  try {
    return await confirm(message);
  } catch {
    return false;
  }
}

/** Find an observable invocation that makes detachment unsafe right now. */
function inFlightRefusal<T>(
  verb: string,
  snapshot: ActiveLifecycleSnapshot,
  data: T,
): DiscernResult<T> | undefined {
  const active = freshInFlightInvocations(
    snapshot.stream.events,
    snapshot.currentEpoch,
  ).at(-1);
  if (active === undefined) {
    return undefined;
  }
  const branch = active.branch === null ? "an unknown branch" : active.branch;
  return {
    ok: false,
    verb,
    error: "precondition_failed",
    message:
      `Cannot replace the active Logbook while ${active.verb} on ${branch} remains in flight (started ${active.started}). ` +
      `Wait for that invocation to finish, then re-run \`${verb}\`. If it already stopped, \`discern status --all\` shows when the unmatched start ages out.`,
    data,
  };
}

/** Emit or render one lifecycle result and return its exit code. */
function presentLifecycleResult<
  T extends PatternsResetData | PatternsArchiveData,
>(
  action: LogbookLifecycleActionName,
  result: DiscernResult<T>,
  json: boolean,
): number {
  observeResult(result);
  if (json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (result.data !== undefined) {
    if (action === "reset") {
      renderResetScope(out, result.data as PatternsResetData);
    } else {
      renderArchiveScope(out, result.data as PatternsArchiveData);
    }
  }
  if (!result.ok) {
    out.error(result.message ?? `patterns ${action} failed.`);
    return 1;
  }
  if (result.dry_run === true) {
    out.raw("Preview only — nothing changed.\n");
  }
  return 0;
}

/** Build the safe reset preview, or an apply refusal when called directly. */
export async function patternsResetResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult<PatternsResetData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns reset");
  }
  try {
    const snapshot = await activeLifecycleSnapshot(root, commonGitDir);
    const data = resetData(snapshot);
    if (opts.dryRun !== true) {
      return confirmationRefusal("patterns reset", data);
    }
    return {
      ok: true,
      verb: "patterns reset",
      dry_run: true,
      data,
      hints: hintTexts([
        fire(
          data.removed.length === 0
            ? HINTS["patterns-reset-empty"]
            : HINTS["patterns-reset-preview"],
        ),
      ]),
    };
  } catch (error) {
    return {
      ok: false,
      verb: "patterns reset",
      error: "read_error",
      message: `Could not inspect the active Logbook: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Build the safe archive preview, or an apply refusal when called directly. */
export async function patternsArchiveResult(
  root: string,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<DiscernResult<PatternsArchiveData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns archive");
  }
  try {
    const snapshot = await activeLifecycleSnapshot(root, commonGitDir);
    const filename = await nextLogbookArchiveFileName(
      commonGitDir,
      opts.now ?? new Date(),
    );
    const data = archiveData(snapshot, filename);
    if (opts.dryRun !== true) {
      return confirmationRefusal("patterns archive", data);
    }
    return {
      ok: true,
      verb: "patterns archive",
      dry_run: true,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      verb: "patterns archive",
      error: "read_error",
      message: `Could not inspect the active Logbook: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Present the cancellation outcome used by the other owner confirmations. */
function presentLifecycleCancellation(): number {
  const out = makeOut(colorEnabled());
  out.raw("Aborted — nothing was changed.\n");
  return 0;
}

/** Build a changed-while-confirming refusal over the latest reviewed data. */
function changedDuringConfirmation<T>(
  verb: string,
  data: T,
): DiscernResult<T> {
  return {
    ok: false,
    verb,
    error: "precondition_failed",
    message:
      `The active Logbook changed while confirmation was open. Nothing was detached; re-run \`${verb}\` to review the current scope.`,
    data,
  };
}

/** Interactive reset apply under the common lifecycle lock. */
async function applyReset(
  root: string,
  confirm: LifecycleConfirmation,
): Promise<number> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return presentLifecycleResult(
      "reset",
      noRepository("patterns reset"),
      false,
    );
  }
  try {
    return await withLogbookLifecycleLock(commonGitDir, async () => {
      const reviewed = await activeLifecycleSnapshot(root, commonGitDir);
      const reviewedData = resetData(reviewed);
      const running = inFlightRefusal(
        "patterns reset",
        reviewed,
        reviewedData,
      );
      if (running !== undefined) {
        return presentLifecycleResult("reset", running, false);
      }
      const out = makeOut(colorEnabled());
      renderResetScope(out, reviewedData);
      const filenames = reviewed.files.length === 0
        ? "no source files"
        : reviewed.files.map((file) => file.file).join(", ");
      const accepted = await confirmLifecycle(
        `Permanently remove ${plural(reviewedData.events, "event")} from ${
          lifecycleSpan(reviewedData)
        } across ${
          plural(reviewedData.removed.length, "file")
        } (${filenames}), ${
          formatHumanNumber(reviewedData.bytes)
        } bytes? This permanently resets the evidence listed above. Recording starts again with the next eligible command when enabled.`,
        confirm,
      );
      if (!accepted) {
        return presentLifecycleCancellation();
      }
      const current = await activeLifecycleSnapshot(root, commonGitDir);
      if (!sameActiveSnapshot(reviewed, current)) {
        return presentLifecycleResult(
          "reset",
          changedDuringConfirmation("patterns reset", resetData(current)),
          false,
        );
      }
      const newlyRunning = inFlightRefusal(
        "patterns reset",
        current,
        resetData(current),
      );
      if (newlyRunning !== undefined) {
        return presentLifecycleResult("reset", newlyRunning, false);
      }
      try {
        await removeLogbook(commonGitDir);
      } catch (error) {
        const recovery = error instanceof LogbookLifecycleError
          ? error.detachedPath
          : undefined;
        return presentLifecycleResult("reset", {
          ok: false,
          verb: "patterns reset",
          error: "apply_failed",
          message: error instanceof Error ? error.message : String(error),
          data: resetData(current, recovery),
        }, false);
      }
      const resetHints = [
        ...(current.files.length === 0
          ? [fire(HINTS["patterns-reset-empty"])]
          : []),
        ...(current.recording
          ? [fire(HINTS["patterns-reset-recording-resumes"])]
          : []),
      ];
      const result: DiscernResult<PatternsResetData> = {
        ok: true,
        verb: "patterns reset",
        data: resetData(current),
        ...(resetHints.length > 0 ? { hints: hintTexts(resetHints) } : {}),
      };
      const code = presentLifecycleResult("reset", result, false);
      makeOut(colorEnabled()).raw("Removed the active Logbook permanently.\n");
      return code;
    });
  } catch (error) {
    const message = error instanceof LogbookLifecycleBusyError
      ? error.message
      : `Could not apply the Logbook reset: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return presentLifecycleResult("reset", {
      ok: false,
      verb: "patterns reset",
      error: "precondition_failed",
      message,
    }, false);
  }
}

/** Interactive archive apply under the common lifecycle lock. */
async function applyArchive(
  root: string,
  confirm: LifecycleConfirmation,
): Promise<number> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return presentLifecycleResult(
      "archive",
      noRepository("patterns archive"),
      false,
    );
  }
  try {
    return await withLogbookLifecycleLock(commonGitDir, async () => {
      const reviewed = await activeLifecycleSnapshot(root, commonGitDir);
      const filename = await nextLogbookArchiveFileName(commonGitDir);
      const reviewedData = archiveData(reviewed, filename);
      const running = inFlightRefusal(
        "patterns archive",
        reviewed,
        reviewedData,
      );
      if (running !== undefined) {
        return presentLifecycleResult("archive", running, false);
      }
      const out = makeOut(colorEnabled());
      renderArchiveScope(out, reviewedData);
      const filenames = reviewed.files.length === 0
        ? "no source files"
        : reviewed.files.map((file) => file.file).join(", ");
      const accepted = await confirmLifecycle(
        `Seal ${plural(reviewedData.events, "event")} from ${
          lifecycleSpan(reviewedData)
        } across ${plural(reviewedData.files.length, "file")} (${filenames}), ${
          formatHumanNumber(reviewedData.source_bytes)
        } bytes, as ${filename} and begin a fresh active Logbook? Recording restarts with the next eligible command when enabled.`,
        confirm,
      );
      if (!accepted) {
        return presentLifecycleCancellation();
      }
      const current = await activeLifecycleSnapshot(root, commonGitDir);
      if (!sameActiveSnapshot(reviewed, current)) {
        return presentLifecycleResult(
          "archive",
          changedDuringConfirmation(
            "patterns archive",
            archiveData(current, filename),
          ),
          false,
        );
      }
      const newlyRunning = inFlightRefusal(
        "patterns archive",
        current,
        archiveData(current, filename),
      );
      if (newlyRunning !== undefined) {
        return presentLifecycleResult("archive", newlyRunning, false);
      }
      if (current.archiveBytes === 0) {
        const code = presentLifecycleResult("archive", {
          ok: true,
          verb: "patterns archive",
          data: archiveData(current, filename),
        }, false);
        makeOut(colorEnabled()).raw(
          "No active event lines exist to archive.\n",
        );
        return code;
      }
      try {
        const archived = await archiveLogbook(commonGitDir, filename);
        const data = archiveData(current, filename, archived.bytes);
        const result: DiscernResult<PatternsArchiveData> = {
          ok: true,
          verb: "patterns archive",
          data,
        };
        const code = presentLifecycleResult("archive", result, false);
        const successOut = makeOut(colorEnabled());
        successOut.raw(`Sealed ${archived.path}.\n`);
        successOut.raw(
          `Read it: discern patterns --logbook-file ${archived.file}\n`,
        );
        return code;
      } catch (error) {
        const lifecycle = error instanceof LogbookLifecycleError
          ? error
          : undefined;
        return presentLifecycleResult("archive", {
          ok: false,
          verb: "patterns archive",
          error: "apply_failed",
          message: error instanceof Error ? error.message : String(error),
          data: archiveData(
            current,
            filename,
            current.archiveBytes,
            lifecycle?.detachedPath,
          ),
        }, false);
      }
    });
  } catch (error) {
    const message = error instanceof LogbookLifecycleBusyError
      ? error.message
      : `Could not apply the Logbook archive: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return presentLifecycleResult("archive", {
      ok: false,
      verb: "patterns archive",
      error: "precondition_failed",
      message,
    }, false);
  }
}

/** Options accepted by either destructive Patterns lifecycle subcommand. */
export interface RunPatternsLifecycleOptions {
  json: boolean;
  dryRun: boolean;
  /** Whether the caller proved terminal stdin/stdout and non-CI/non-plain mode. */
  interactive: boolean;
  /** The guarded default-No terminal confirmation supplied by CLI dispatch. */
  confirm: LifecycleConfirmation;
}

/** One guarded terminal confirmation; false means decline. */
export type LifecycleConfirmation = (message: string) => Promise<boolean>;

type LifecycleHandler = (
  root: string,
  opts: RunPatternsLifecycleOptions,
  access: LogbookLifecycleAccess,
) => Promise<number>;

/** Preview/refuse/apply the reset through the common lifecycle policy. */
const runResetLifecycle: LifecycleHandler = async (root, opts, access) => {
  if (access === "apply") {
    return await applyReset(root, opts.confirm);
  }
  return presentLifecycleResult(
    "reset",
    await patternsResetResult(root, { dryRun: access === "preview" }),
    opts.json,
  );
};

/** Preview/refuse/apply the archive through the common lifecycle policy. */
const runArchiveLifecycle: LifecycleHandler = async (root, opts, access) => {
  if (access === "apply") {
    return await applyArchive(root, opts.confirm);
  }
  return presentLifecycleResult(
    "archive",
    await patternsArchiveResult(root, { dryRun: access === "preview" }),
    opts.json,
  );
};

const LIFECYCLE_HANDLERS: Record<
  LogbookLifecycleActionName,
  LifecycleHandler
> = {
  reset: runResetLifecycle,
  archive: runArchiveLifecycle,
};

/** Run one registered lifecycle action through the shared safety gate. */
export async function runPatternsLifecycle(
  root: string,
  action: LogbookLifecycleActionName,
  opts: RunPatternsLifecycleOptions,
): Promise<number> {
  const access = logbookLifecycleAccess({
    dryRun: opts.dryRun,
    json: opts.json,
    interactive: opts.interactive,
  });
  return await LIFECYCLE_HANDLERS[action](root, opts, access);
}

/** Backward-compatible internal entry for the reset CLI wiring. */
export async function runPatternsReset(
  root: string,
  opts: RunPatternsLifecycleOptions,
): Promise<number> {
  return await runPatternsLifecycle(root, "reset", opts);
}

/** Run the archive CLI wiring through the registered lifecycle gate. */
export async function runPatternsArchive(
  root: string,
  opts: RunPatternsLifecycleOptions,
): Promise<number> {
  return await runPatternsLifecycle(root, "archive", opts);
}

/** Read every sealed archive and return its discoverable counts. */
export async function patternsArchivesResult(
  root: string,
): Promise<DiscernResult<PatternsArchivesData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns archives");
  }
  const dir = logbookArchiveDir(commonGitDir);
  const archives: PatternsArchiveEntry[] = [];
  try {
    const names: string[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && isLogbookArchiveFileName(entry.name)) {
          names.push(entry.name);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return {
          ok: true,
          verb: "patterns archives",
          data: { dir, archives: [] },
        };
      }
      throw error;
    }
    names.sort().reverse();
    for (const filename of names) {
      const path = join(dir, filename);
      const info = await Deno.lstat(path);
      if (!info.isFile || info.isSymlink) {
        continue;
      }
      const stream = await readLogbookFile(path, filename);
      const summary = summarizeLogbookStream(stream);
      archives.push({
        filename,
        events: summary.events,
        unparsed: summary.unparsed,
        bytes: info.size,
        ...(summary.firstAt !== undefined ? { first_at: summary.firstAt } : {}),
        ...(summary.lastAt !== undefined ? { last_at: summary.lastAt } : {}),
      });
    }
    return {
      ok: true,
      verb: "patterns archives",
      data: { dir, archives },
    };
  } catch (error) {
    return {
      ok: false,
      verb: "patterns archives",
      error: "read_error",
      message: `Could not list sealed Logbook archives: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Run the read-only archive listing. */
export async function runPatternsArchives(
  root: string,
  opts: { json: boolean },
): Promise<number> {
  const result = await patternsArchivesResult(root);
  observeResult(result);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns archives failed.");
    return 1;
  }
  out.heading("Sealed Logbook archives");
  if (result.data.archives.length === 0) {
    out.raw("  No sealed archives.\n");
    return 0;
  }
  for (const archive of result.data.archives) {
    out.raw(
      `  ${archive.filename} · ${plural(archive.events, "event")} · ${
        lifecycleSpan(archive)
      } · ${formatHumanNumber(archive.bytes)} bytes${
        archive.unparsed > 0
          ? ` · ${plural(archive.unparsed, "unparsable line")} skipped`
          : ""
      }\n`,
    );
  }
  return 0;
}

/** The registry is read here so dead action metadata cannot silently survive. */
export function registeredLogbookLifecycleActions(): readonly string[] {
  return LOGBOOK_LIFECYCLE_ACTION_NAMES;
}
