/** Review identified test failures against current canary membership and measured cost. */

import { readLogbookStream } from "../src/engine/logbook/read.ts";
import { runGit } from "../src/shared/subprocess.ts";
import {
  CANARY_EXCLUDED_TEST_FILES,
  CANARY_EXTRA_TEST_FILES,
  canaryTestFiles,
} from "./canary_registry.ts";
import { listTestModules } from "./test_modules.ts";
import {
  CANARY_REVIEW_FAILURE_RUNS,
  recordedJobOutcome,
  testFailureFiles,
} from "../src/engine/logbook/test_failure_findings.ts";
import type { LogbookEvent, VerbEvent } from "../src/engine/logbook/schema.ts";

/** The same review threshold used by normal advisory findings. */
export const CANDIDATE_RED_RUNS = CANARY_REVIEW_FAILURE_RUNS;

/** Rows shown in the ranking table. */
const RANKING_ROWS = 20;

/** The canonical recorded invocation supplies identity and completed job verdicts. */
export type TestFailureEvidence = VerbEvent;

/** One file's recorded test-failure history, aggregated across events. */
export interface TestFailureRecord {
  readonly file: string;
  /** Distinct recorded runs in which the file had at least one failing case. */
  readonly redRuns: number;
  /** Recorded diagnostic rows, without treating sampling counts as defect counts. */
  readonly diagnosticRows: number;
  /** ISO timestamp of the newest record. */
  readonly lastAt: string;
}

/** Deduplicate before filtering verdicts, so contradictory copies cannot create a failure. */
export function rankTestFailures(
  events: readonly LogbookEvent[],
): TestFailureRecord[] {
  return testFailureFiles(events.filter((event) => event.kind === "verb"))
    .flatMap((entry) => {
      const failed = entry.events.filter((event) =>
        recordedJobOutcome(event, "test") === "failed"
      );
      if (failed.length === 0) return [];
      return [{
        file: entry.file,
        redRuns: failed.length,
        diagnosticRows: failed.reduce(
          (sum, event) =>
            sum +
            (event.diagnostics ?? []).filter((row) =>
              row.tool === "test" && row.file === entry.file
            ).length,
          0,
        ),
        lastAt: failed.map((event) => event.at).sort().at(-1) ?? "",
      }];
    }).sort((a, b) => b.redRuns - a.redRuns || a.file.localeCompare(b.file));
}

/** Review candidates and the explicit limits of retained history. */
export interface CanaryAuditFindings {
  /** Hot files neither covered nor recorded as refused: add or refuse them. */
  readonly candidates: TestFailureRecord[];
  /** Missing failure history does not establish that an existing guard is unnecessary. */
  readonly unobservedExtras: string[];
  /** Historical paths absent from current discovery cannot enroll by their old name. */
  readonly unavailableFiles: string[];
}

/**
 * Compare a failure ranking with the derived canary membership. `members` is
 * the canary's current file set; recorded exclusions are settled decisions,
 * so they are never re-nominated.
 */
export function auditCanary(
  ranking: readonly TestFailureRecord[],
  members: ReadonlySet<string>,
  modules: ReadonlySet<string>,
): CanaryAuditFindings {
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  const recorded = new Set(ranking.map((r) => r.file));
  return {
    candidates: ranking.filter((r) =>
      r.redRuns >= CANDIDATE_RED_RUNS && !members.has(r.file) &&
      !excluded.has(r.file) && modules.has(r.file)
    ),
    unavailableFiles: ranking.filter((row) => !modules.has(row.file)).map((
      row,
    ) => row.file),
    unobservedExtras: CANARY_EXTRA_TEST_FILES
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
    String(record.diagnosticRows).padStart(6),
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
  const modules = new Set(await listTestModules());
  const members = new Set(canaryTestFiles([...modules]));
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  const findings = auditCanary(ranking, members, modules);

  console.log(
    `Canary audit — ${ranking.length} files with recorded test failures ` +
      `across ${stream.months.length} Logbook month file(s).\n`,
  );
  console.log(
    [
      "red runs".padStart(8),
      "rows".padStart(6),
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
    for (const candidate of findings.candidates.slice(0, RANKING_ROWS)) {
      console.log(`  ${candidate.file} — ${candidate.redRuns} red runs`);
    }
    console.log(
      "  Time each candidate first. A file that holds the seconds bar joins\n" +
        "  CANARY_EXTRA_TEST_FILES; one that cannot is recorded with its\n" +
        "  measurement in CANARY_EXCLUDED_TEST_FILES (scripts/canary_registry.ts).",
    );
  } else {
    console.log(
      ranking.length === 0
        ? "\nNo identified completed test-failure history is available; canary suitability remains unknown."
        : "\nNo current uncovered file reaches the review threshold in this window.",
    );
  }

  if (findings.unobservedExtras.length > 0) {
    console.log(
      "\nExtras without retained failure observations — insufficient evidence to retire:",
    );
    for (const file of findings.unobservedExtras.slice(0, RANKING_ROWS)) {
      console.log(`  ${file}`);
    }
  }

  console.log(
    `\n${findings.unavailableFiles.length} historical file paths are absent from current discovery. ` +
      "Counts can span configurations and describe invocations, not independent defects.\n" +
      "Advisory only: current membership and measured cost decide enrollment; missing history cannot establish canary coverage or Proof.",
  );
}

/** Resolve the repository's common Git directory from the working directory. */
export async function resolveCommonGitDir(
  cwd: string = Deno.cwd(),
): Promise<string> {
  const output = await runGit(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd, bin: "git", environmentPermissionFallback: "isolated-read-only" },
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
