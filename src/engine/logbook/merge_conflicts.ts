/** File-level conflict recurrence from complete, distinct merge observations. */
import type { MergeAttempt } from "../../shared/merge_observation.ts";
import type { VerbEvent } from "./schema.ts";
import type {
  Detector,
  DetectorFinding,
  DetectorOutcome,
} from "./detectors.ts";

interface Episode {
  attempt: MergeAttempt;
  signature: string;
  routes: Set<MergeAttempt["route"]>;
}

/** The same recommendation feeds the full report and conflict recovery. */
const NEXT_STEP =
  "Inspect whether independent changes repeatedly edit the same section. " +
  "If this file collects independent entries, record each entry separately and generate the final artifact. " +
  "Declare its output paths and regeneration command as paths and run in a [generated.<name>] group in discern.toml, keeping the source entries outside those paths. " +
  "Updates and acceptance then rebuild the declared outputs and resolve conflicts confined to generated files. " +
  "Conflicts in authored sources still need review.";

/** Equal revision pairs with different merge observations cannot support a verdict. */
function signature(attempt: MergeAttempt): string {
  return JSON.stringify([
    attempt.outcome,
    [...attempt.conflicts].sort((a, b) => a.path.localeCompare(b.path)),
  ]);
}

/** Analyze recorded attempts plus the current executor observation before it is logged. */
export function mergeConflictOutcome(
  events: readonly VerbEvent[],
  current?: MergeAttempt,
): DetectorOutcome {
  const attempts = events.flatMap((event) => event.merges?.attempts ?? []);
  if (current !== undefined) attempts.push(current);
  const unobserved =
    events.filter((event) =>
      (event.verb === "update" || event.verb === "accept") &&
      event.merges === undefined
    ).length;
  const omitted = events.reduce(
    (sum, event) => sum + (event.merges?.omitted ?? 0),
    0,
  );
  const episodes = new Map<string, Episode>();
  const contradictory = new Set<string>();
  let incomplete = 0;
  let duplicates = 0;
  for (const attempt of attempts) {
    if (
      attempt.head === null || attempt.incoming === null ||
      attempt.paths_omitted > 0 ||
      (attempt.outcome === "conflict" && attempt.conflicts.length === 0)
    ) {
      incomplete += 1;
      continue;
    }
    const key = JSON.stringify([
      attempt.effort,
      attempt.head,
      attempt.incoming,
    ]);
    const prior = episodes.get(key);
    const observed = signature(attempt);
    if (prior === undefined) {
      episodes.set(key, {
        attempt,
        signature: observed,
        routes: new Set([attempt.route]),
      });
    } else {
      duplicates += 1;
      prior.routes.add(attempt.route);
      if (prior.signature !== observed) contradictory.add(key);
    }
  }
  const complete = [...episodes].filter(([key]) => !contradictory.has(key))
    .map(([, episode]) => episode);
  const paths = new Map<string, Episode[]>();
  for (const episode of complete) {
    if (episode.attempt.outcome !== "conflict") continue;
    for (
      const path of new Set(
        episode.attempt.conflicts
          .filter((entry) => !entry.generated).map((entry) => entry.path),
      )
    ) {
      const entries = paths.get(path) ?? [];
      entries.push(episode);
      paths.set(path, entries);
    }
  }
  const findings: DetectorFinding[] = [];
  for (const [path, conflicts] of paths) {
    const efforts = new Set(conflicts.map((entry) => entry.attempt.effort));
    if (conflicts.length < 3 || efforts.size < 2) continue;
    const updates = conflicts.filter((entry) =>
      entry.routes.has("update")
    ).length;
    const accepts =
      conflicts.filter((entry) => entry.routes.has("accept")).length;
    const excluded = unobserved + omitted + incomplete + contradictory.size;
    const limitation = excluded === 0
      ? ""
      : ` Excluded: ${unobserved} runs without merge evidence, ${omitted} omitted attempts, ${incomplete} incomplete observations, and ${contradictory.size} contradictory revision pairs.`;
    findings.push({
      subject: path,
      summary: "Several efforts encountered merge conflicts in this file.",
      observed:
        `${
          JSON.stringify(path)
        } conflicted in ${conflicts.length} of ${complete.length} distinct merge attempts. Conflicts affected ${efforts.size} efforts. ` +
        `Update: ${updates}; acceptance: ${accepts}. Route counts can overlap; unchanged retries count once.${limitation} ` +
        "File recurrence does not establish that the same section conflicted.",
      evidence: {
        conflicts: conflicts.length,
        merge_attempts: complete.length,
        efforts: efforts.size,
        update_conflicts: updates,
        acceptance_conflicts: accepts,
        duplicate_attempts: duplicates,
        unobserved_runs: unobserved,
        omitted_attempts: omitted,
        incomplete_observations: incomplete,
        contradictory_pairs: contradictory.size,
      },
      strength: conflicts.length,
    });
  }
  findings.sort((a, b) =>
    b.strength - a.strength ||
    (a.subject ?? "").localeCompare(b.subject ?? "")
  );
  return { considered: complete.length, findings };
}

/** Three revision pairs across multiple efforts distinguish recurrence from one retry loop. */
export const recurringMergeConflicts: Detector = {
  id: "recurring-merge-conflicts",
  title: "Recurring merge conflicts by file",
  family: "funnel",
  scope: "project",
  tier: "inline",
  tone: "attention",
  threshold: 3,
  next_step: NEXT_STEP,
  detect: (facts): DetectorOutcome => mergeConflictOutcome(facts.verbs),
};
