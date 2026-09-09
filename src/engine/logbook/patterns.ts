/**
 * `discern patterns` — the logbook's first reader, and the diagnostic ladder's
 * third question: `doctor` asks whether the install is valid, `improvement`
 * whether the setup follows best practice, `patterns` whether the practice is
 * actually healthy. It runs the detector registry (`detectors.ts`) over the
 * recorded event stream. The result keeps findings ranked by evidence strength;
 * the human report points to the strongest attention findings, groups that same
 * order into canonical family sections, and collapses repeated detector
 * instructions into one block.
 *
 * Like every verb it computes one {@link DiscernResult}; the human report, the
 * quiet CLI projections, and the MCP tool are renderings of the same object.
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
  renderCommandCli,
  renderDiffstatCli,
  renderEmptyStateCli,
  renderFileChangeCli,
  renderMeterCli,
  renderProcedureCli,
  renderResultSummaryCli,
  renderResultSummaryGroupCli,
  renderStatCli,
  renderVerificationReportCli,
  type ResultSummaryCliProps,
  type ResultSummaryGroupCliItem,
} from "discern-design-system/cli";
import {
  loadConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import { firableCheckpointIds } from "../checkpoints/policy.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  DETECTOR_FAMILIES,
  type DetectorFamily,
  type PatternFindingTone,
  type PatternInvestigation,
  PATTERNS_FINDINGS_PER_DETECTOR,
  type PatternsArchiveEntry,
  type PatternsArchivesData,
  type PatternsData,
  type PatternsFinding,
  type PatternsPopulation,
  type PatternsResetData,
  type PatternsSealData,
  type PatternsStats,
} from "../../shared/patterns_vocabulary.ts";
import {
  type LogbookLifecycleAccess,
  logbookLifecycleAccess,
  type LogbookLifecycleActionName,
} from "../../shared/logbook_lifecycle.ts";
import { LOGBOOK_POWERED } from "../../shared/logbook_powered.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import { fire, type FiredHint, HINTS, hintTexts } from "../../shared/hints.ts";
import { sparkline } from "../../lib/text.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import type { ConfirmationLabels } from "../../shared/confirmation.ts";
import { makeOut, type Out } from "../output.ts";
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
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { driverAgent, driverKind } from "./cohorts.ts";
import { configEpoch } from "./epoch.ts";
import { computeStats } from "./stats.ts";
import { completionEconomics } from "./completion_economics.ts";
import {
  buildStreamFacts,
  inclusiveSpanDays,
  round1,
  runDetectors,
  type StreamFacts,
  TRAJECTORY_BOUNDARY_ATTRIBUTION,
} from "./detectors.ts";
import { routeDetectorReports, routedFindingData } from "./routing.ts";
import { synthesizeInvestigations } from "./investigations.ts";

/**
 * Score the analysis population's drivers — reader logic over the recorded
 * evidence, computed fresh on every read so improved scoring retroactively
 * covers all accumulated history. The report states this split so the
 * segmentation the detectors rely on is never a silent filter.
 */
function scorePopulation(facts: StreamFacts): PatternsPopulation {
  const kinds = { agent: 0, human: 0, automation: 0, unknown: 0 };
  const identityRuns = new Map<string, number>();
  for (const e of facts.verbs) {
    const kind = driverKind(e);
    kinds[kind] += 1;
    if (kind === "automation") {
      // Inherited markers on a gate child identify the outer session, not a
      // decision — the automation count carries this volume instead.
      continue;
    }
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
    options?: ErrorOptions,
  ) {
    super(message, options);
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
      "--logbook-file accepts one sealed archive basename from `discern patterns archives`; paths and active logbook names are not allowed.",
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
        `No sealed logbook archive named ${filename} exists. Run \`discern patterns archives\` to list valid filenames.`,
      );
    }
    throw new ArchiveSelectionError(
      "read_error",
      `Could not inspect sealed logbook archive ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (!info.isFile || info.isSymlink) {
    throw new ArchiveSelectionError(
      "invalid_arguments",
      `${filename} is not a regular sealed logbook archive file.`,
    );
  }
  try {
    return await readLogbookFile(path, filename);
  } catch (error) {
    throw new ArchiveSelectionError(
      "read_error",
      `Could not read sealed logbook archive ${filename}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
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
    // Only checkpoints that COULD fire are dead-checkpoint candidates: an
    // entry that cannot govern, or one dormant by configuration (an unset
    // scalar reference expanding to the match-nothing pattern), is waiting,
    // not mis-scoped.
    firableCheckpointIds(config),
  );
  const reports = runDetectors(facts);
  const ranked = routeDetectorReports(reports).patterns.map(
    routedFindingData,
  );
  const findings = opts.all === true ? ranked : capFindingsPerDetector(ranked);
  const investigations = synthesizeInvestigations(findings);
  const first = stream.events[0];
  const last = stream.events[stream.events.length - 1];
  const branches = new Set(
    facts.verbs.map((e) => e.branch).filter((b): b is string => b !== null),
  );
  const completion = facts.events.flatMap((event) =>
    event.kind === "completion" && event.driver?.ci !== true
      ? [event.observation]
      : []
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
    investigations,
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
    ...(completion.length === 0
      ? {}
      : { completion: completionEconomics(completion) }),
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

/** Build one human output surface from an already-resolved terminal snapshot. */
function presentationOut(terminal: TerminalContext): Out {
  return makeOut(terminal.color, { terminal });
}

/** Human section labels keyed exhaustively by the canonical family vocabulary.
 * `DETECTOR_FAMILIES` alone owns their order. */
export const PATTERNS_FAMILY_SECTIONS = {
  trajectory: { heading: "Trajectory: how the numbers moved" },
  "gate-fit": { heading: "Gate fit: time and failure patterns" },
  behavior: { heading: "Workflow behavior: recorded actions" },
  funnel: { heading: "Task funnel: the path to green" },
} satisfies Record<DetectorFamily, FamilyPresentation>;

/** Exhaustive adaptation from advisory tone into package result semantics. */
export const PATTERNS_TONE_RESULT_STATE = {
  good: "passed",
  neutral: "unchanged",
  attention: "changed",
} as const satisfies Readonly<
  Record<PatternFindingTone, ResultSummaryCliProps["state"]>
>;

/** Give package renderers one explicit measure from the shared presenter. */
function presentationFacts(out: Out): {
  readonly presenter: Out["terminal"]["presenter"];
  readonly width: number;
} {
  const width = Math.max(20, Math.min(104, out.terminal.size.columns));
  return {
    presenter: out.terminal.presenter,
    width,
  };
}

/** Preserve the stable human-output group id while the package owns its rule. */
function renderGroup(out: Out, id: string, label: string): void {
  const { presenter, width } = presentationFacts(out);
  out.group(id);
  out.raw(`${
    presenter.motifSectionRule(terminalLine(label), {
      register: "brand",
      width,
    })
  }\n`);
}

/** The one human caveat for trajectory series spanning several setups. */
export const PATTERNS_TRAJECTORY_CAVEAT =
  "Series spanning more than one configuration or release keep each segment attributed to its setup.";

/** Heading for the bounded pointer list above the full report sections. */
export const PATTERNS_ATTENTION_HEADING = "Worth your attention";
export const PATTERNS_ATTENTION_LIMIT = 3;

const PIN_COMMAND = "`discern standards --pin`";

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

/** "1,670 analyzed runs · driven by agents 1,421 (identified: Claude Code 757 · Codex 528) · humans 66 · automation 96 · unknown 87" */
function driversLine(population: PatternsPopulation): string {
  const identities = population.identities
    .map((identity) => `${identity.label} ${formatHumanNumber(identity.runs)}`)
    .join(" · ");
  return `${plural(population.analyzed, "analyzed run")} · driven by agents ${
    formatHumanNumber(population.agent)
  }${identities !== "" ? ` (identified: ${identities})` : ""} · humans ${
    formatHumanNumber(population.human)
  } · automation ${formatHumanNumber(population.automation)} · unknown ${
    formatHumanNumber(population.unknown)
  }`;
}

/** Summarize fired, quiet, and evidence-limited detectors in one report line. */
function scoreboardLine(data: PatternsData): string {
  const fired = data.detectors.filter((d) => d.status === "fired").length;
  const quiet = data.detectors.filter((d) => d.status === "quiet").length;
  const insufficient =
    data.detectors.filter((d) => d.status === "insufficient-evidence").length;
  return `${plural(data.detectors.length, "detector")} · ${
    formatHumanNumber(fired)
  } fired · ${formatHumanNumber(quiet)} quiet · ${
    formatHumanNumber(insufficient)
  } insufficient evidence`;
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

/** Adapt findings into one package-owned alignment group. */
function findingResultItems(
  findings: readonly PatternsFinding[],
): ResultSummaryGroupCliItem[] {
  return findings.map((finding) => {
    const facts: string[] = [
      finding.summary,
      ...(finding.subject === undefined ? [] : [`Subject: ${finding.subject}`]),
      ...(finding.series === undefined
        ? []
        : [`Series: ${sparkline(finding.series)}`]),
      `Evidence: ${finding.observed}`,
    ];
    return {
      state: PATTERNS_TONE_RESULT_STATE[finding.tone],
      fact: terminalMultiline(facts.join(" · ")),
    };
  });
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
  const { presenter } = presentationFacts(out);
  const groups = findingsByDetector(familyFindings);
  const countById = new Map(data.detectors.map((d) => [d.id, d.findings]));
  renderGroup(
    out,
    `family:${family}`,
    PATTERNS_FAMILY_SECTIONS[family].heading,
  );
  for (const [index, [detector, findings]] of [...groups].entries()) {
    if (index > 0) out.group(`family:${family}:detector:${detector}`);
    const summaries: ResultSummaryGroupCliItem[] = [
      {
        state: "unchanged",
        fact: terminalLine(
          `Detector: ${
            titleById.get(detector) ?? detector
          } · ${findings.length} shown.`,
        ),
      },
      ...findingResultItems(findings),
      {
        state: "unchanged",
        fact: terminalMultiline(
          `Next action: ${detectorNextStep(findings)}`,
        ),
      },
    ];
    out.raw(`${
      presenter.present(renderResultSummaryGroupCli, {
        // Re-adapt at the package boundary so the structural safety guard can
        // prove every member of this mixed-state alignment group.
        items: summaries.map((summary) => ({
          state: summary.state,
          fact: terminalMultiline(summary.fact),
          ...(summary.nextAction === undefined
            ? {}
            : { nextAction: terminalMultiline(summary.nextAction) }),
        })),
        maxWidth: width,
      })
    }\n`);
    const elided = (countById.get(detector) ?? findings.length) -
      findings.length;
    if (elided > 0) {
      out.raw(`${
        presenter.present(renderCommandCli, {
          command: terminalLine("discern patterns --all"),
          explanation: terminalLine(
            `${plural(elided, "more finding")} remain for this detector.`,
          ),
          maxWidth: width,
        })
      }\n`);
    }
  }

  const crossesBoundary = family === "trajectory" &&
    familyFindings.some((finding) =>
      finding.observed.includes(TRAJECTORY_BOUNDARY_ATTRIBUTION)
    );
  if (crossesBoundary) {
    out.group(`family:${family}:caveat`);
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine(PATTERNS_TRAJECTORY_CAVEAT),
        maxWidth: width,
      })
    }\n`);
  }
}

/** Point to the strongest bounded set of attention findings near the report top. */
function renderAttentionBanner(
  out: Out,
  data: PatternsData,
  width: number,
): void {
  // `data.findings` is already strength-ranked. Tone filters that order and
  // never becomes a second ranking policy.
  const findings = data.findings
    .filter((finding) => finding.tone === "attention")
    .slice(0, PATTERNS_ATTENTION_LIMIT);
  if (findings.length === 0) {
    return;
  }

  const { presenter } = presentationFacts(out);
  renderGroup(out, "attention", PATTERNS_ATTENTION_HEADING);
  for (const finding of findings) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "changed",
        fact: terminalLine(
          finding.subject === undefined
            ? finding.summary
            : `${finding.subject}: ${finding.summary}`,
        ),
        maxWidth: width,
      })
    }\n`);
  }
}

/** Render additive investigation paths without replacing or shortening the
 * source findings that remain in their canonical family blocks below. */
function renderInvestigations(
  out: Out,
  investigations: readonly PatternInvestigation[],
  width: number,
): void {
  if (investigations.length === 0) return;
  const { presenter } = presentationFacts(out);
  renderGroup(out, "investigations", "Investigation paths");
  for (const [index, investigation] of investigations.entries()) {
    if (index > 0) out.group(`investigation:${investigation.id}`);
    const subject = investigation.subject === undefined
      ? ""
      : ` · ${investigation.subject}`;
    out.raw(`${
      presenter.present(renderProcedureCli, {
        title: terminalLine(`${investigation.title}${subject}`),
        description: terminalMultiline(
          `${investigation.summary}\nEvidence: ${investigation.observed}\nDiagnostic: ${investigation.diagnostic_action}`,
        ),
        steps: [{
          title: terminalLine("Run the diagnostic investigation."),
          status: "active",
        }],
        completionLabel: terminalLine("Falsifier"),
        completion: terminalMultiline(investigation.falsifier),
        register: "brand",
        maxWidth: width,
      })
    }\n`);
  }
}

/** Account for quiet and evidence-limited detectors after the detailed findings. */
function renderClosingAccount(
  out: Out,
  data: PatternsData,
  width: number,
): void {
  const { presenter } = presentationFacts(out);
  out.group("closing-account");
  const quiet = data.detectors.filter((d) => d.status === "quiet");
  const young = data.detectors.filter((d) =>
    d.status === "insufficient-evidence"
  );
  out.raw(`${
    presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: terminalMultiline([
        "The report is advisory and does not change the gate.",
        ...(quiet.length === 0 ? [] : [
          `No finding (${quiet.length}): ${
            quiet.map((detector) => detector.title).join(" · ")
          }`,
        ]),
        ...(young.length === 0 ? [] : [
          `Insufficient evidence (${young.length}): ${
            young.map((detector) => detector.title).join(" · ")
          }`,
        ]),
        "Structured data: discern patterns --json",
      ].join(" · ")),
      maxWidth: width,
    })
  }\n`);
}

/** Render the recurring report for a person. The wire findings stay
 * strength-ranked; this projection groups them by canonical family and
 * collapses repeated detector instructions. */
function renderReport(out: Out, data: PatternsData, slug: string): void {
  const { presenter, width } = presentationFacts(out);
  const titleById = new Map(
    data.detectors.map((detector) => [detector.id, detector.title]),
  );
  const archive = data.logbook.source.kind === "archive"
    ? ` · archive ${data.logbook.source.filename}`
    : "";
  const preAuthorized = preAuthorizedLandingOverview(data);
  out.raw(`${
    out.terminal.role(
      terminalLine(
        `discern patterns${slug ? ` · ${slug}` : ""}${archive}`,
      ),
      "strong",
    )
  }\n`);
  out.raw(`${
    presenter.present(renderResultSummaryGroupCli, {
      items: [
        {
          state: "unchanged",
          fact: terminalMultiline([
            summaryLine(data),
            ...(data.population.analyzed === 0
              ? []
              : [`Drivers: ${driversLine(data.population)}`]),
            `Detectors: ${scoreboardLine(data)}`,
          ].join(" · ")),
        },
        ...(preAuthorized === undefined ? [] : [{
          state: PATTERNS_TONE_RESULT_STATE[preAuthorized.tone],
          fact: terminalMultiline(
            `${preAuthorized.summary} · Evidence: ${preAuthorized.observed}`,
          ),
        }]),
      ],
      maxWidth: width,
    })
  }\n`);
  renderAttentionBanner(out, data, width);
  if (data.completion !== undefined) {
    const economics = data.completion;
    out.raw(`${
      presenter.present(renderResultSummaryGroupCli, {
        items: [{
          state: "unchanged",
          fact: terminalMultiline(
            `Completion observations: ${economics.efforts} efforts, ${economics.candidates} candidates, ${economics.landings} landings. ` +
              `${economics.reused_receipts} reused component receipts. ` +
              `Physical producer executions: ${
                economics.producer_executions ?? "unknown"
              }. ` +
              `Prediction denominator: ${
                economics.prediction_denominator ?? "unknown"
              }. ` +
              "Overlapping phase durations are reported separately; these observations grant no Proof or recovery authority.",
          ),
        }],
        maxWidth: width,
      })
    }\n`);
  }
  renderInvestigations(out, data.investigations, width);

  if (data.logbook.events === 0) {
    out.group("empty-logbook");
    out.raw(`${
      presenter.present(renderEmptyStateCli, {
        title: terminalLine("The logbook is empty"),
        description: terminalLine(
          "Privacy: local metadata only; nothing leaves the machine.",
        ),
        action: terminalLine(
          "Check back after discern records local metadata for some verb runs.",
        ),
        width,
      })
    }\n`);
    return;
  }

  for (const family of DETECTOR_FAMILIES) {
    renderFamily(out, family, data, width, titleById);
  }
  renderClosingAccount(out, data, width);
}

// ── practice stats ─────────────────────────────────────────────────────────

/** Empty-state title for a stats card with no analyzed runs behind it. */
export const STATS_EMPTY_TITLE = "No stats yet";

/** Empty-state explanation for a stats card with no analyzed runs behind it. */
export const STATS_EMPTY_DESCRIPTION =
  "The logbook holds no analyzed runs. Check back after some use.";

/** The card's provenance line — where every number comes from, and how far
 * it travels. */
export const STATS_PROVENANCE =
  "Counted from this repository's local logbook. Nothing leaves the machine.";

/** Section labels for the stats card, in render order. */
export const STATS_SECTIONS = {
  accepted: "Accepted",
  gate: "The gate",
  workflows: "Validation workflows",
  pace: "Pace",
  standards: "Standards",
  checkpoints: "Checkpoints",
  agents: "Agents",
  breadth: "Breadth",
} as const;

/** Render a count pair as a rounded percentage for the stats card. */
function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Package Meter cap keeps the reading legible without filling wide terminals. */
export const STATS_METER_WIDTH = 48;

/** A proportion row keeps the explicit denominator beside its percentage. */
function meterRow(fraction: number, text: string): string {
  return `${Math.round(fraction * 100)}% · ${text}`;
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

interface StatsDiffstatReading {
  readonly kind: "diffstat";
  readonly added: number;
  readonly removed: number;
}

type StatsReading = string | StatsDiffstatReading;

/** The accepted section: changes accepted and their recorded scale. A single
 * accepted change keeps the card quiet about "biggest" and "best day" — with
 * one member, both would restate the change itself. Records read in yellow;
 * the acceptance streak reads in green; added and removed lines read
 * git-style, green and red. */
function statsAcceptedRows(
  accepted: PatternsStats["accepted"],
): StatsReading[] {
  if (accepted.count === 0) {
    return ["Nothing accepted yet."];
  }
  const rows: StatsReading[] = [
    `${plural(accepted.count, "change")} accepted from ${
      plural(accepted.branches, "branch", "branches")
    }${accepted.commits > 0 ? ` · ${plural(accepted.commits, "commit")}` : ""}`,
  ];
  if (accepted.insertions + accepted.deletions > 0) {
    const ratio = accepted.deletions > 0
      ? round1(accepted.insertions / accepted.deletions)
      : undefined;
    const ratioText = ratio === undefined
      ? ""
      : ` · ${formatHumanNumber(ratio)} ${
        ratio === 1 ? "line" : "lines"
      } added per line removed`;
    rows.push(
      {
        kind: "diffstat",
        added: accepted.insertions,
        removed: accepted.deletions,
      },
      `${plural(accepted.files, "file")}${ratioText}`,
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
        }${plural(biggest.lines, "changed line")} · ${
          plural(biggest.files, "file")
        } (${biggest.day})`,
      );
    }
    const best = accepted.best_day;
    if (best !== undefined) {
      rows.push(
        `best day: ${best.day} · ${formatHumanNumber(best.accepted)} accepted${
          accepted.longest_streak > 1
            ? ` · longest streak ${plural(accepted.longest_streak, "day")}`
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
function statsGateRows(gate: PatternsStats["gate"]): string[] {
  if (gate.runs === 0) {
    return ["No `done` runs yet."];
  }
  const rows = [
    meterRow(
      gate.greens / gate.runs,
      `${formatHumanNumber(gate.greens)} of ${
        plural(gate.runs, "`done` run")
      } green (${percent(gate.greens, gate.runs)})`,
    ),
  ];
  if (gate.gated_branches > 0) {
    rows.push(
      meterRow(
        gate.first_try_green_branches / gate.gated_branches,
        `${formatHumanNumber(gate.first_try_green_branches)} of ${
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
      `${plural(reds, "red run")} stopped at the gate`,
    );
  }
  const tail: string[] = [];
  if (gate.longest_green_streak > 1) {
    tail.push(
      `longest green streak ${formatHumanNumber(gate.longest_green_streak)}`,
    );
  }
  if (gate.current_green_streak > 1) {
    tail.push(
      `current ${formatHumanNumber(gate.current_green_streak)}`,
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

/** One evidence count with its share of an explicit denominator. */
function evidenceShare(part: number, whole: number): string {
  return `${formatHumanNumber(part)} (${percent(part, whole)})`;
}

/** The validation-workflow section: verb entry state, conservative change
 * cycles and their routes, evidence coverage, privacy-safe dirty-state shape,
 * then eligible identity cohorts with every denominator and remainder. */
function statsValidationWorkflowRows(
  workflows: PatternsStats["validation_workflows"],
): string[] {
  if (workflows.runs.total === 0) {
    return ["No `prepare`, `test`, or `done` runs yet."];
  }
  const rows: string[] = [];
  for (const verb of workflows.runs.by_verb) {
    rows.push(
      `\`${verb.verb}\`: ${plural(verb.runs, "run")} across ${
        plural(verb.branches, "branch", "branches")
      } · ${formatHumanNumber(verb.clean)} clean · ${
        formatHumanNumber(verb.dirty)
      } dirty · ${formatHumanNumber(verb.unknown)} unknown · ${
        formatHumanNumber(verb.successes)
      } ok · ${formatHumanNumber(verb.failures)} failed · ${
        plural(verb.retries, "retry", "retries")
      }`,
    );
  }
  rows.push(
    `${plural(workflows.cycles.total, "change cycle")} across ${
      plural(workflows.cycles.branches, "branch", "branches")
    }`,
  );
  for (const route of workflows.cycles.routes) {
    rows.push(
      `${route.route}: ${plural(route.cycles, "cycle")} / ${
        plural(route.runs, "run")
      } across ${plural(route.branches, "branch", "branches")} · ${
        formatHumanNumber(route.successful_runs)
      } ok / ${formatHumanNumber(route.failed_runs)} failed runs · ${
        formatHumanNumber(route.successful_cycles)
      } reached a clean gate / ${
        formatHumanNumber(route.failed_cycles)
      } had a failure · ${plural(route.retried_cycles, "retried cycle")} / ${
        plural(route.retry_runs, "retry run")
      }`,
    );
  }
  const precommit = workflows.cycles.precommit_to_clean_gate;
  const testFirst = workflows.cycles.routes.find((route) =>
    route.route === "test-first"
  );
  rows.push(
    `pre-commit validation → clean gate: ${
      formatHumanNumber(precommit.cycles)
    } of ${plural(testFirst?.cycles ?? 0, "test-first cycle")} across ${
      plural(precommit.branches, "branch", "branches")
    } · ${plural(precommit.runs, "run")} · ${
      plural(precommit.retry_runs, "retry run")
    }`,
  );
  const evidence = workflows.runs.evidence;
  rows.push(
    `evidence across ${plural(evidence.denominator, "run")}: complete ${
      evidenceShare(evidence.complete, evidence.denominator)
    } · incomplete ${
      evidenceShare(evidence.incomplete, evidence.denominator)
    } · unattributed ${
      evidenceShare(evidence.unattributed, evidence.denominator)
    }`,
  );
  const dirty = workflows.runs.dirty_state;
  if (dirty.denominator > 0) {
    rows.push(
      `complete dirty states across ${
        plural(dirty.denominator, "run")
      }: tracked-only ${
        formatHumanNumber(dirty.tracked_only)
      } · untracked-only ${formatHumanNumber(dirty.untracked_only)} · mixed ${
        formatHumanNumber(dirty.mixed)
      } · unclassified ${formatHumanNumber(dirty.unclassified)}`,
    );
  }
  const cohorts = workflows.cohorts;
  if (cohorts !== undefined) {
    rows.push(
      `identity cohorts: ${plural(cohorts.denominator_cycles, "cycle")} / ${
        plural(cohorts.denominator_runs, "run")
      }`,
    );
    for (const identity of cohorts.identities) {
      rows.push(
        `${identity.label}: ${plural(identity.cycles, "cycle")} / ${
          plural(identity.runs, "run")
        } · test-first ${
          formatHumanNumber(identity.test_first_cycles)
        } · commit-first ${
          formatHumanNumber(identity.commit_first_cycles)
        } · clean gate ${
          formatHumanNumber(identity.successful_cycles)
        } · failed ${formatHumanNumber(identity.failed_cycles)} · retried ${
          formatHumanNumber(identity.retried_cycles)
        }`,
      );
    }
    rows.push(
      `below reporting minimums: ${
        plural(cohorts.below_minimum.cohorts, "cohort")
      } · ${plural(cohorts.below_minimum.cycles, "cycle")} / ${
        plural(cohorts.below_minimum.runs, "run")
      }`,
      `unattributed: ${plural(cohorts.unattributed.cycles, "cycle")} / ${
        plural(cohorts.unattributed.runs, "run")
      }`,
    );
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
function statsPaceRows(stats: PatternsStats): string[] {
  const rows: string[] = [];
  const cycles = stats.cycles;
  if (cycles !== undefined) {
    rows.push(
      meterRow(
        cycles.completed / cycles.started,
        `${formatHumanNumber(cycles.completed)} of ${
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
        } · median ${formatHumanNumber(cycles.median_hours)}h · fastest ${
          formatHumanNumber(cycles.fastest_hours)
        }h${
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
): string[] {
  const busiest = breadth.busiest_day;
  const rows = [
    `${plural(breadth.branches, "branch", "branches")} driven · active ${
      formatHumanNumber(breadth.active_days)
    } of ${plural(breadth.span_days, "day")}${
      busiest !== undefined && busiest.branches > 1
        ? ` · busiest day ${
          plural(busiest.branches, "branch", "branches")
        } (${busiest.day})`
        : ""
    }`,
  ];
  const peak = breadth.peak_in_flight;
  if (peak !== undefined && peak.branches > 1) {
    rows.push(
      `up to ${
        plural(peak.branches, "change")
      } in flight at once (${peak.day})`,
    );
  }
  return rows;
}

/** The standards section: the pin ratchet and the most improved standard,
 * percent-normalized against its first reading so different scales read
 * like-for-like. */
function statsStandardsRows(
  standards: PatternsStats["standards"],
): string[] {
  const rows: string[] = [];
  if (standards.pins > 0) {
    rows.push(
      `${plural(standards.pins, "limit")} tightened across ${
        plural(standards.standards, "standard")
      }. Loosening fails the gate.`,
    );
  }
  const improved = standards.most_improved;
  if (improved !== undefined) {
    rows.push(
      `most improved: \`${improved.standard}\` ${
        formatHumanNumber(improved.from)
      } → ${formatHumanNumber(improved.to)} (${
        formatHumanNumber(improved.better_percent)
      }% better)`,
    );
  }
  return rows;
}

/** The checkpoints section: one observed-economics line per checkpoint —
 * plain counts beside their denominators, most-served first. Observation
 * vocabulary only: what fired, what was declared and on what kind of subject,
 * what landed under an authorized variance — never a verdict about an agent. */
function statsCheckpointRows(
  economics: NonNullable<PatternsStats["checkpoints"]>,
): string[] {
  const rows = economics.rows.map((row) => {
    const parts = [
      `\`${row.id}\` fired on ${row.efforts_fired} of ${
        plural(economics.efforts, "effort")
      } (${plural(row.fires, "serving")})`,
    ];
    if (row.declared > 0) {
      const split: string[] = [];
      if (row.declared_unchanged > 0) {
        split.push(`${row.declared_unchanged} on an unchanged subject`);
      }
      if (row.declared_unmet > 0) {
        split.push(`${row.declared_unmet} unmet`);
      }
      parts.push(
        `declared ${row.declared}${
          split.length === 0 ? "" : ` (${split.join(", ")})`
        }`,
      );
    }
    if (row.variances > 0) {
      parts.push(
        `${
          plural(row.variances, "authorized variance")
        } across ${row.efforts_landed} landed`,
      );
    }
    if (row.abandoned > 0) {
      parts.push(`${row.abandoned} abandoned`);
    }
    if (row.median_declare_s !== undefined) {
      parts.push(
        `median time to declare ${formatHumanNumber(row.median_declare_s)}s`,
      );
    }
    return parts.join("; ");
  });
  if (economics.omitted > 0) {
    rows.push(
      `${
        plural(economics.omitted, "more checkpoint")
      } with observed history — counted, not listed`,
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
      ? `${sparkline(identity.per_day)} `
      : "";
    const share = identity.done_runs > 0
      ? `${formatHumanNumber(identity.greens)} of ${
        plural(identity.done_runs, "`done` run")
      } green (${percent(identity.greens, identity.done_runs)})`
      : "no `done` runs";
    rows.push(
      `${spark}${identity.label} · ${plural(identity.runs, "run")} · ${share}`,
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
  rows: readonly StatsReading[],
  spark?: StatsSpark | undefined,
): void {
  const { presenter } = presentationFacts(out);
  renderGroup(out, `stats:${label}`, label);
  out.raw(`${
    presenter.present(renderStatCli, {
      label: terminalLine(label),
      value: terminalLine(plural(rows.length, "reading")),
      ...(spark === undefined ? {} : {
        context: terminalLine(`${sparkline(spark.series)} ${spark.label}`),
      }),
      maxWidth: width,
    })
  }\n`);
  for (const row of rows) {
    const rendered = typeof row === "string"
      ? presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalMultiline(row),
        maxWidth: width,
      })
      : presenter.present(renderDiffstatCli, {
        added: row.added,
        removed: row.removed,
        maxWidth: width,
      });
    out.raw(`${rendered}\n`);
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
  const { presenter, width } = presentationFacts(out);
  const archive = data.logbook.source.kind === "archive"
    ? ` · archive ${data.logbook.source.filename}`
    : "";
  out.heading(terminalLine(
    `discern patterns --stats${slug ? ` · ${slug}` : ""}${archive}`,
  ));
  if (data.population.analyzed === 0) {
    out.raw(`${
      presenter.present(renderEmptyStateCli, {
        title: terminalLine(STATS_EMPTY_TITLE),
        description: terminalLine(STATS_EMPTY_DESCRIPTION),
        width,
      })
    }\n`);
    return;
  }
  out.raw(`${
    presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: terminalMultiline(
        `${statsHeaderLine(data, stats)} · Source: ${STATS_PROVENANCE}`,
      ),
      maxWidth: width,
    })
  }\n`);
  if (stats.gate.runs > 0) {
    out.raw(`${
      presenter.present(renderMeterCli, {
        kind: "determinate-progress",
        label: terminalLine("Green gate runs"),
        lifecycle: { status: "active" },
        completed: stats.gate.greens,
        total: stats.gate.runs,
        reading: terminalLine(
          `${formatHumanNumber(stats.gate.greens)} of ${
            formatHumanNumber(stats.gate.runs)
          }`,
        ),
        tone: "neutral",
        width: Math.min(STATS_METER_WIDTH, width),
      })
    }\n`);
  }
  const daysPerPoint = stats.series_days_per_point ?? 1;
  statsSection(
    out,
    width,
    STATS_SECTIONS.accepted,
    statsAcceptedRows(stats.accepted),
    statsSpark(stats.accepted.per_day, cadenceLabel("accepted", daysPerPoint)),
  );
  statsSection(
    out,
    width,
    STATS_SECTIONS.gate,
    statsGateRows(stats.gate),
    statsSpark(
      stats.gate.greens_per_day,
      cadenceLabel("green runs", daysPerPoint),
    ),
  );
  statsSection(
    out,
    width,
    STATS_SECTIONS.workflows,
    statsValidationWorkflowRows(stats.validation_workflows),
  );
  const pace = statsPaceRows(stats);
  if (pace.length > 0) {
    statsSection(out, width, STATS_SECTIONS.pace, pace);
  }
  const standards = statsStandardsRows(stats.standards);
  if (standards.length > 0) {
    // The trend can honestly fall, so unlike the count sparks it shows
    // whenever it moves at all.
    const trend = stats.standards.trend;
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
  if (stats.checkpoints !== undefined && stats.checkpoints.rows.length > 0) {
    statsSection(
      out,
      width,
      STATS_SECTIONS.checkpoints,
      statsCheckpointRows(stats.checkpoints),
    );
  }
  if (stats.agents.identities.length > 0 || stats.agents.detected > 0) {
    statsSection(
      out,
      width,
      STATS_SECTIONS.agents,
      statsAgentsRows(stats.agents),
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
    statsBreadthRows(stats.breadth),
    statsSpark(
      stats.breadth.branches_per_day,
      daysPerPoint <= 1
        ? "branches active per day"
        : `peak branches per ${formatHumanNumber(daysPerPoint)} days`,
    ),
  );
  out.raw(`${
    presenter.present(renderCommandCli, {
      command: terminalLine("discern patterns --stats --json"),
      explanation: terminalLine(
        "Read the same counted facts as structured data.",
      ),
      maxWidth: width,
    })
  }\n`);
}

/** Options accepted by the patterns CLI. */
export interface RunPatternsOptions {
  json: boolean;
  /** Explicit human presentation facts; CLI callers use the installed context. */
  terminal?: TerminalContext;
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
  const terminal = opts.terminal ?? terminalContext();
  const out = presentationOut(terminal);
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
): PatternsSealData {
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
      "Use --dry-run to inspect the complete plan without changing anything.",
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
  const { presenter, width } = presentationFacts(out);
  for (const file of files) {
    out.raw(`${
      presenter.present(renderFileChangeCli, {
        path: terminalLine(file.file),
        disposition: "unchanged",
        maxWidth: width,
      })
    }\n`);
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine(
          `Source file: ${file.file}. Bytes: ${formatHumanNumber(file.bytes)}.`,
        ),
        maxWidth: width,
      })
    }\n`);
  }
}

/** Render the complete reset scope before preview, refusal, or confirmation. */
function renderResetScope(out: Out, data: PatternsResetData): void {
  const { presenter, width } = presentationFacts(out);
  out.heading(terminalLine("Active Logbook reset"));
  out.raw(`${
    presenter.present(renderVerificationReportCli, {
      title: terminalLine("Reset scope"),
      meta: [
        {
          label: terminalLine("Events"),
          value: terminalLine(String(data.events)),
        },
        {
          label: terminalLine("Span"),
          value: terminalLine(lifecycleSpan(data)),
        },
        {
          label: terminalLine("Files"),
          value: terminalLine(String(data.removed.length)),
        },
        {
          label: terminalLine("Bytes"),
          value: terminalLine(formatHumanNumber(data.bytes)),
        },
      ],
      summary: terminalLine(
        "The active local metadata history will be removed.",
      ),
      maxWidth: width,
    })
  }\n`);
  for (const impact of data.impacts) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "changed",
        fact: terminalMultiline(
          `${impact.surface}: evidence restarts. ${impact.phrase}`,
        ),
        maxWidth: width,
      })
    }\n`);
  }
  renderLifecycleFiles(out, data.removed);
}

/** Render the complete archive scope before preview, refusal, or confirmation. */
function renderArchiveScope(out: Out, data: PatternsSealData): void {
  const { presenter, width } = presentationFacts(out);
  out.heading(terminalLine("Active Logbook archive"));
  out.raw(`${
    presenter.present(renderVerificationReportCli, {
      title: terminalLine("Archive scope"),
      meta: [
        {
          label: terminalLine("Events"),
          value: terminalLine(String(data.events)),
        },
        {
          label: terminalLine("Span"),
          value: terminalLine(lifecycleSpan(data)),
        },
        {
          label: terminalLine("Files"),
          value: terminalLine(String(data.files.length)),
        },
        {
          label: terminalLine("Source bytes"),
          value: terminalLine(formatHumanNumber(data.source_bytes)),
        },
        {
          label: terminalLine("Archive bytes"),
          value: terminalLine(formatHumanNumber(data.archive_bytes)),
        },
      ],
      summary: terminalLine(
        "epoch.json starts fresh and is not copied into the archive.",
      ),
      footer: terminalLine(`Destination: ${data.archive_path}`),
      maxWidth: width,
    })
  }\n`);
  out.raw(`${
    presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: terminalLine(`Destination: ${data.archive_path}`),
      maxWidth: width,
    })
  }\n`);
  renderLifecycleFiles(out, data.files);
}

/** Preserve a confirmation fault across the core's lifecycle error renderer. */
class LifecycleConfirmationFault extends Error {
  readonly fault: unknown;

  constructor(fault: unknown) {
    super("The lifecycle confirmation failed.");
    this.fault = fault;
  }
}

/** Ask one injected boolean confirmation without knowing its interaction source. */
async function confirmLifecycle(
  message: string,
  labels: ConfirmationLabels,
  confirm: LifecycleConfirmation,
): Promise<boolean> {
  try {
    return await confirm(message, labels);
  } catch (error) {
    throw new LifecycleConfirmationFault(error);
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
      `Cannot replace the active logbook while ${active.verb} on ${branch} remains in flight (started ${active.started}). ` +
      `Wait for that invocation to finish, then re-run \`${verb}\`. If it already stopped, \`discern status --all\` shows when the unmatched start ages out.`,
    data,
  };
}

/** Emit or render one lifecycle result and return its exit code. */
function presentLifecycleResult<
  T extends PatternsResetData | PatternsSealData,
>(
  action: LogbookLifecycleActionName,
  result: DiscernResult<T>,
  json: boolean,
  out: Out | undefined,
): number {
  observeResult(result);
  if (json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  if (out === undefined) {
    throw new TypeError("human lifecycle presentation requires terminal facts");
  }
  if (result.data !== undefined) {
    if (action === "reset") {
      renderResetScope(out, result.data as PatternsResetData);
    } else {
      renderArchiveScope(out, result.data as PatternsSealData);
    }
  }
  if (!result.ok) {
    out.error(result.message ?? `patterns ${action} failed.`);
    return 1;
  }
  if (result.dry_run === true) {
    out.raw("Preview only. Nothing changed.\n");
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
      message: `Could not inspect the active logbook: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Build the safe seal preview, or an apply refusal when called directly. */
export async function patternsSealResult(
  root: string,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<DiscernResult<PatternsSealData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns seal");
  }
  try {
    const snapshot = await activeLifecycleSnapshot(root, commonGitDir);
    const filename = await nextLogbookArchiveFileName(
      commonGitDir,
      opts.now ?? new Date(SYSTEM_CLOCK.wallNow()),
    );
    const data = archiveData(snapshot, filename);
    if (opts.dryRun !== true) {
      return confirmationRefusal("patterns seal", data);
    }
    return {
      ok: true,
      verb: "patterns seal",
      dry_run: true,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      verb: "patterns seal",
      error: "read_error",
      message: `Could not inspect the active logbook: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Present the cancellation outcome used by the other owner confirmations. */
function presentLifecycleCancellation(out: Out): number {
  out.raw("Aborted. Nothing changed.\n");
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
      `The active logbook changed while confirmation was open. Nothing was detached; re-run \`${verb}\` to review the current scope.`,
    data,
  };
}

/** Review reset scope, then apply under the common lifecycle lock. */
async function applyReset(
  root: string,
  confirm: LifecycleConfirmation,
  out: Out,
): Promise<number> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return presentLifecycleResult(
      "reset",
      noRepository("patterns reset"),
      false,
      out,
    );
  }
  try {
    const reviewed = await activeLifecycleSnapshot(root, commonGitDir);
    const reviewedData = resetData(reviewed);
    const running = inFlightRefusal(
      "patterns reset",
      reviewed,
      reviewedData,
    );
    if (running !== undefined) {
      return presentLifecycleResult("reset", running, false, out);
    }
    renderResetScope(out, reviewedData);
    const filenames = reviewed.files.length === 0
      ? "no source files"
      : reviewed.files.map((file) => file.file).join(", ");
    const accepted = await confirmLifecycle(
      `Permanently remove ${plural(reviewedData.events, "event")} from ${
        lifecycleSpan(reviewedData)
      } across ${plural(reviewedData.removed.length, "file")} (${filenames}), ${
        formatHumanNumber(reviewedData.bytes)
      } bytes? This permanently resets the evidence listed above. Recording starts again with the next eligible command when enabled.`,
      { noLabel: "Keep", yesLabel: "Delete" },
      confirm,
    );
    if (!accepted) {
      return presentLifecycleCancellation(out);
    }
    return await withLogbookLifecycleLock(commonGitDir, async () => {
      const current = await activeLifecycleSnapshot(root, commonGitDir);
      if (!sameActiveSnapshot(reviewed, current)) {
        return presentLifecycleResult(
          "reset",
          changedDuringConfirmation("patterns reset", resetData(current)),
          false,
          out,
        );
      }
      const newlyRunning = inFlightRefusal(
        "patterns reset",
        current,
        resetData(current),
      );
      if (newlyRunning !== undefined) {
        return presentLifecycleResult("reset", newlyRunning, false, out);
      }
      try {
        await removeLogbook(commonGitDir);
      } catch (error) {
        const recovery = error instanceof LogbookLifecycleError
          ? error.detachedPath
          : undefined;
        return presentLifecycleResult(
          "reset",
          {
            ok: false,
            verb: "patterns reset",
            error: "apply_failed",
            message: error instanceof Error ? error.message : String(error),
            data: resetData(current, recovery),
          },
          false,
          out,
        );
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
      const code = presentLifecycleResult("reset", result, false, out);
      out.raw("Removed the active logbook permanently.\n");
      return code;
    });
  } catch (error) {
    if (error instanceof LifecycleConfirmationFault) throw error.fault;
    const message = error instanceof LogbookLifecycleBusyError
      ? error.message
      : `Could not apply the logbook reset: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return presentLifecycleResult(
      "reset",
      {
        ok: false,
        verb: "patterns reset",
        error: "precondition_failed",
        message,
      },
      false,
      out,
    );
  }
}

/** Review archive scope, then apply under the common lifecycle lock. */
async function applySeal(
  root: string,
  confirm: LifecycleConfirmation,
  out: Out,
): Promise<number> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return presentLifecycleResult(
      "seal",
      noRepository("patterns seal"),
      false,
      out,
    );
  }
  try {
    const reviewed = await activeLifecycleSnapshot(root, commonGitDir);
    const filename = await nextLogbookArchiveFileName(
      commonGitDir,
      new Date(SYSTEM_CLOCK.wallNow()),
    );
    const reviewedData = archiveData(reviewed, filename);
    const running = inFlightRefusal(
      "patterns seal",
      reviewed,
      reviewedData,
    );
    if (running !== undefined) {
      return presentLifecycleResult("seal", running, false, out);
    }
    renderArchiveScope(out, reviewedData);
    const filenames = reviewed.files.length === 0
      ? "no source files"
      : reviewed.files.map((file) => file.file).join(", ");
    const accepted = await confirmLifecycle(
      `Seal ${plural(reviewedData.events, "event")} from ${
        lifecycleSpan(reviewedData)
      } across ${plural(reviewedData.files.length, "file")} (${filenames}), ${
        formatHumanNumber(reviewedData.source_bytes)
      } bytes, as ${filename} and begin a fresh active logbook? Recording restarts with the next eligible command when enabled.`,
      { noLabel: "Keep", yesLabel: "Seal" },
      confirm,
    );
    if (!accepted) {
      return presentLifecycleCancellation(out);
    }
    return await withLogbookLifecycleLock(commonGitDir, async () => {
      const current = await activeLifecycleSnapshot(root, commonGitDir);
      if (!sameActiveSnapshot(reviewed, current)) {
        return presentLifecycleResult(
          "seal",
          changedDuringConfirmation(
            "patterns seal",
            archiveData(current, filename),
          ),
          false,
          out,
        );
      }
      const newlyRunning = inFlightRefusal(
        "patterns seal",
        current,
        archiveData(current, filename),
      );
      if (newlyRunning !== undefined) {
        return presentLifecycleResult("seal", newlyRunning, false, out);
      }
      if (current.archiveBytes === 0) {
        const code = presentLifecycleResult(
          "seal",
          {
            ok: true,
            verb: "patterns seal",
            data: archiveData(current, filename),
          },
          false,
          out,
        );
        out.raw(
          "No active event lines exist to archive.\n",
        );
        return code;
      }
      try {
        const archived = await archiveLogbook(commonGitDir, filename);
        const data = archiveData(current, filename, archived.bytes);
        const result: DiscernResult<PatternsSealData> = {
          ok: true,
          verb: "patterns seal",
          data,
        };
        const code = presentLifecycleResult("seal", result, false, out);
        out.raw(`Sealed ${archived.path}.\n`);
        out.raw(
          `Read it: discern patterns --logbook-file ${archived.file}\n`,
        );
        return code;
      } catch (error) {
        const lifecycle = error instanceof LogbookLifecycleError
          ? error
          : undefined;
        return presentLifecycleResult(
          "seal",
          {
            ok: false,
            verb: "patterns seal",
            error: "apply_failed",
            message: error instanceof Error ? error.message : String(error),
            data: archiveData(
              current,
              filename,
              current.archiveBytes,
              lifecycle?.detachedPath,
            ),
          },
          false,
          out,
        );
      }
    });
  } catch (error) {
    if (error instanceof LifecycleConfirmationFault) throw error.fault;
    const message = error instanceof LogbookLifecycleBusyError
      ? error.message
      : `Could not apply the logbook archive: ${
        error instanceof Error ? error.message : String(error)
      }`;
    return presentLifecycleResult(
      "seal",
      {
        ok: false,
        verb: "patterns seal",
        error: "precondition_failed",
        message,
      },
      false,
      out,
    );
  }
}

/** Options accepted by either destructive Patterns lifecycle subcommand. */
export interface RunPatternsLifecycleOptions {
  json: boolean;
  dryRun: boolean;
  /** Explicit human presentation facts; JSON paths never resolve them. */
  terminal?: TerminalContext;
  /** Whether the caller proved terminal stdin/stdout and non-CI/non-plain mode. */
  interactive: boolean;
  /** The guarded default-No terminal confirmation supplied by CLI dispatch. */
  confirm: LifecycleConfirmation;
}

/** One guarded terminal confirmation; false means decline. */
export type LifecycleConfirmation = (
  message: string,
  labels: ConfirmationLabels,
) => Promise<boolean>;

type LifecycleHandler = (
  root: string,
  opts: RunPatternsLifecycleOptions,
  access: LogbookLifecycleAccess,
  out: Out | undefined,
) => Promise<number>;

/** Preview/refuse/apply the reset through the common lifecycle policy. */
const runResetLifecycle: LifecycleHandler = async (root, opts, access, out) => {
  if (access === "apply") {
    if (out === undefined) {
      throw new TypeError("reset apply requires human presentation facts");
    }
    return await applyReset(root, opts.confirm, out);
  }
  return presentLifecycleResult(
    "reset",
    await patternsResetResult(root, { dryRun: access === "preview" }),
    opts.json,
    out,
  );
};

/** Preview/refuse/apply sealing through the common lifecycle policy. */
const runSealLifecycle: LifecycleHandler = async (
  root,
  opts,
  access,
  out,
) => {
  if (access === "apply") {
    if (out === undefined) {
      throw new TypeError("seal apply requires human presentation facts");
    }
    return await applySeal(root, opts.confirm, out);
  }
  return presentLifecycleResult(
    "seal",
    await patternsSealResult(root, { dryRun: access === "preview" }),
    opts.json,
    out,
  );
};

const LIFECYCLE_HANDLERS: Record<
  LogbookLifecycleActionName,
  LifecycleHandler
> = {
  reset: runResetLifecycle,
  seal: runSealLifecycle,
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
  const out = opts.json
    ? undefined
    : presentationOut(opts.terminal ?? terminalContext());
  return await LIFECYCLE_HANDLERS[action](root, opts, access, out);
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
      message: `Could not list sealed logbook archives: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Run the read-only archive listing. */
export async function runPatternsArchives(
  root: string,
  opts: { json: boolean; terminal?: TerminalContext },
): Promise<number> {
  const result = await patternsArchivesResult(root);
  observeResult(result);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = presentationOut(opts.terminal ?? terminalContext());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns archives failed.");
    return 1;
  }
  const { presenter, width } = presentationFacts(out);
  out.heading(terminalLine("Sealed logbook archives"));
  if (result.data.archives.length === 0) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine("No sealed archives."),
        maxWidth: width,
      })
    }\n`);
    return 0;
  }
  for (const archive of result.data.archives) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: archive.unparsed === 0 ? "unchanged" : "changed",
        fact: terminalLine(`Sealed archive: ${archive.filename}`),
        maxWidth: width,
      })
    }\n`);
    out.raw(`${
      presenter.present(renderVerificationReportCli, {
        title: terminalLine("Archive evidence"),
        meta: [
          {
            label: terminalLine("Events"),
            value: terminalLine(String(archive.events)),
          },
          {
            label: terminalLine("Span"),
            value: terminalLine(lifecycleSpan(archive)),
          },
          {
            label: terminalLine("Bytes"),
            value: terminalLine(formatHumanNumber(archive.bytes)),
          },
        ],
        ...(archive.unparsed === 0 ? {} : {
          checks: [{
            label: terminalLine("Unparsable lines"),
            state: "fail" as const,
            value: terminalLine(String(archive.unparsed)),
          }],
        }),
        maxWidth: width,
      })
    }\n`);
  }
  return 0;
}
