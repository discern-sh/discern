/**
 * Canary audit — rank the Logbook's recorded per-file test failures against
 * the canary registry, and name membership that looks wrong in either
 * direction: hot files the canary does not cover, and registered extras with
 * no failure record left to justify them.
 *
 * Advisory only, and deliberately never part of the gate: failure history
 * differs per machine (a fresh clone has none), and gate behaviour must not.
 * The registry stays the deterministic authority; this report is the
 * evidence to revise it with. Run it via `discern scripts canary-audit`.
 */

import { readLogbookStream } from "../src/engine/logbook/read.ts";
import { runGit } from "../src/shared/subprocess.ts";
import {
  CANARY_EXCLUDED_TEST_FILES,
  CANARY_EXTRA_TEST_FILES,
  canaryTestFiles,
} from "./canary_registry.ts";
import { listTestModules } from "./canary_tests.ts";

/**
 * Red runs on record before an uncovered file is named a canary candidate:
 * five across the rolling Logbook reads as a trend rather than bad luck.
 */
export const CANDIDATE_RED_RUNS = 5;

/** Rows shown in the ranking table. */
const RANKING_ROWS = 20;

/** The event fields the ranking reads — a Logbook verb event supplies them. */
export interface TestFailureEvidence {
  readonly kind: string;
  readonly at: string;
  readonly diagnostics?:
    | ReadonlyArray<{
      readonly tool: string;
      readonly file?: string | undefined;
      readonly count?: number | undefined;
    }>
    | undefined;
}

/** One file's recorded test-failure history, aggregated across events. */
export interface TestFailureRecord {
  readonly file: string;
  /** Distinct recorded runs in which the file had at least one failing case. */
  readonly redRuns: number;
  /** Failing case classes summed with their recorded collapse counts. */
  readonly cases: number;
  /** ISO timestamp of the newest record. */
  readonly lastAt: string;
}

/**
 * Aggregate per-file test-failure records from Logbook events: a `test`-tool
 * diagnostic carrying a file marks that file red for its event. Files the
 * report cannot attribute (diagnostics without a file) are skipped. Returns
 * records ranked hottest first: red runs, then cases, then name.
 */
export function rankTestFailures(
  events: readonly TestFailureEvidence[],
): TestFailureRecord[] {
  const byFile = new Map<
    string,
    { redRuns: number; cases: number; lastAt: string }
  >();
  for (const event of events) {
    if (event.kind !== "verb" || event.diagnostics === undefined) continue;
    const filesInEvent = new Set<string>();
    for (const diagnostic of event.diagnostics) {
      if (diagnostic.tool !== "test" || diagnostic.file === undefined) continue;
      const record = byFile.get(diagnostic.file) ??
        { redRuns: 0, cases: 0, lastAt: event.at };
      record.cases += diagnostic.count ?? 1;
      if (!filesInEvent.has(diagnostic.file)) {
        record.redRuns += 1;
        filesInEvent.add(diagnostic.file);
      }
      if (event.at > record.lastAt) record.lastAt = event.at;
      byFile.set(diagnostic.file, record);
    }
  }
  return [...byFile.entries()]
    .map(([file, r]) => ({ file, ...r }))
    .sort((a, b) =>
      b.redRuns - a.redRuns || b.cases - a.cases ||
      a.file.localeCompare(b.file)
    );
}

/** The registry drift a ranking exposes, in both directions. */
export interface CanaryAuditFindings {
  /** Hot files neither covered nor recorded as refused: add or refuse them. */
  readonly candidates: TestFailureRecord[];
  /** Registered extras with no failure record left: consider retiring them. */
  readonly quietExtras: string[];
}

/**
 * Compare a failure ranking with the derived canary membership. `members` is
 * the canary's current file set; recorded exclusions are settled decisions,
 * so they are never re-nominated.
 */
export function auditCanary(
  ranking: readonly TestFailureRecord[],
  members: ReadonlySet<string>,
): CanaryAuditFindings {
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  const recorded = new Set(ranking.map((r) => r.file));
  return {
    candidates: ranking.filter((r) =>
      r.redRuns >= CANDIDATE_RED_RUNS && !members.has(r.file) &&
      !excluded.has(r.file)
    ),
    quietExtras: CANARY_EXTRA_TEST_FILES
      .map((e) => e.file)
      .filter((file) => !recorded.has(file)),
  };
}

/** Render one ranking row with its membership marker. */
function rankingRow(
  record: TestFailureRecord,
  members: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): string {
  const marker = members.has(record.file)
    ? "member"
    : excluded.has(record.file)
    ? "excluded"
    : "";
  return [
    String(record.redRuns).padStart(8),
    String(record.cases).padStart(6),
    record.lastAt.slice(0, 10).padEnd(11),
    marker.padEnd(9),
    record.file,
  ].join(" ");
}

/** Read the Logbook and print the audit report. */
async function main(): Promise<void> {
  const commonGitDir = await resolveCommonGitDir();
  const stream = await readLogbookStream(commonGitDir);
  const ranking = rankTestFailures(stream.events);
  const members = new Set(canaryTestFiles(await listTestModules()));
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  const findings = auditCanary(ranking, members);

  console.log(
    `Canary audit — ${ranking.length} files with recorded test failures ` +
      `across ${stream.months.length} Logbook month file(s).\n`,
  );
  console.log(
    [
      "red runs".padStart(8),
      "cases".padStart(6),
      "last seen ",
      "status   ",
      "file",
    ]
      .join(" "),
  );
  for (const record of ranking.slice(0, RANKING_ROWS)) {
    console.log(rankingRow(record, members, excluded));
  }
  if (ranking.length > RANKING_ROWS) {
    console.log(`… ${ranking.length - RANKING_ROWS} more file(s) not shown.`);
  }

  if (findings.candidates.length > 0) {
    console.log(
      `\nCandidates (>= ${CANDIDATE_RED_RUNS} recorded red runs, not covered):`,
    );
    for (const candidate of findings.candidates) {
      console.log(`  ${candidate.file} — ${candidate.redRuns} red runs`);
    }
    console.log(
      "  Time each candidate first. A file that holds the seconds bar joins\n" +
        "  CANARY_EXTRA_TEST_FILES; one that cannot is recorded with its\n" +
        "  measurement in CANARY_EXCLUDED_TEST_FILES (scripts/canary_registry.ts).",
    );
  } else {
    console.log("\nNo uncovered hot files on record.");
  }

  if (findings.quietExtras.length > 0) {
    console.log("\nExtras with no failure record left — consider retiring:");
    for (const file of findings.quietExtras) console.log(`  ${file}`);
  }

  console.log(
    "\nAdvisory only: the registry stays the deterministic authority; revise\n" +
      "it with this evidence rather than wiring history into the gate.",
  );
}

/** Resolve the repository's common Git directory from the working directory. */
async function resolveCommonGitDir(): Promise<string> {
  const output = await runGit(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: Deno.cwd() },
  );
  if (!output.success) {
    throw new Error(
      `git rev-parse --git-common-dir failed: ${output.stderr.trim()}`,
    );
  }
  return output.stdout.trim();
}

if (import.meta.main) {
  await main();
}
