/**
 * The one block builder for a task's details.
 *
 * The inspector beside the list, the strip on narrow screens, the zoomed
 * details, and the View changes reader all render these blocks; none of them
 * words a fact a second way. Tier-one facts come from the status survey and
 * paint at once; tier-two artifacts (commits, files, uncommitted files, the
 * last failure) come from the selected-item slot and show a skeleton while
 * they are read. Pure: time and every fact are inputs.
 */

import type {
  ApplicationDetailBlock,
  ApplicationDetailStrip,
  ApplicationGlyph,
  ApplicationRun,
} from "discern-design-system/cli/interactive";
import { proofLineWithoutPointer } from "../gate/proof_render.ts";
import { inlineRuns } from "./header_view.ts";
import type {
  StatusData,
  SubmissionRowData,
} from "../../shared/result_schemas.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";
import { DESK_COMMAND_LABELS } from "../../shared/desk_vocabulary.ts";
import { compactDuration } from "../output.ts";
import {
  FLEET_ROW_STATES,
  type FleetRowFactName,
  type FleetRowTone,
} from "../status/row_states.ts";
import { compactAge, queueHuman, relativeAge } from "../status/row_facts.ts";
import type { DeskAction } from "../../shared/desk_vocabulary.ts";
import { type DeskRow, deskRowId } from "./model.ts";
import { shortCommit } from "./review_facts.ts";
import { CONSEQUENCE_GLYPHS, DESK_GLYPHS, type DeskGlyph } from "./glyphs.ts";
import type {
  DeskEvidence,
  DeskEvidenceSection,
  DeskFileStat,
} from "./evidence.ts";

/** What the detail builder reads besides the row itself. */
export interface DeskInspection {
  /** The main checkout, which a checkout's path is shown from. */
  readonly root: string;
  readonly rows: readonly DeskRow[];
  readonly data?: StatusData;
  readonly trunk: string;
  readonly now: number;
  /** When the adopted survey was read; running times count on from it. */
  readonly observedAt?: number;
  /** Surveys are failing: running rows stop counting. */
  readonly frozen: boolean;
  /** Tier-two evidence for this row, once read. */
  readonly evidence?: DeskEvidence;
}

/** A status tone as the package names it. */
export function tone(value: FleetRowTone): ApplicationRun["tone"] & string {
  return value;
}

/** A one-cell glyph from a Unicode and ASCII pair. */
export function glyph(
  pair: DeskGlyph,
  glyphTone?: FleetRowTone,
): ApplicationGlyph {
  return {
    unicode: pair.unicode,
    ascii: pair.ascii,
    ...(glyphTone === undefined ? {} : { tone: glyphTone }),
  };
}

/** Whether a row's state is a running one whose glyph spins. */
export function isRunning(row: DeskRow): boolean {
  return row.entry.running !== undefined ||
    FLEET_ROW_STATES[row.decision.state].glyph === "◐";
}

/** The row's state glyph: toned, spinning while it runs and is not frozen. */
export function stateGlyph(row: DeskRow, frozen: boolean): ApplicationGlyph {
  const { decision } = row;
  return {
    unicode: decision.glyph,
    ascii: decision.ascii,
    tone: tone(decision.tones.glyph),
    ...(isRunning(row) && !frozen ? { animation: "spinner" as const } : {}),
  };
}

/** A four-cell age for the list's age column, or blank without a time. */
export function ageText(iso: string | undefined, now: number): string {
  return compactAge(iso, now) ?? "";
}

/** How long a running verb has run, by the clock: `1:12`, then `12m`. */
export function runningElapsed(
  row: DeskRow,
  inspection: Pick<DeskInspection, "now" | "observedAt" | "frozen">,
): number | undefined {
  const running = row.entry.running;
  if (running === undefined) return undefined;
  const since = inspection.frozen || inspection.observedAt === undefined
    ? 0
    : Math.max(0, inspection.now - inspection.observedAt);
  return running.elapsed_ms + since;
}

/** Elapsed time in the age column's four cells. */
export function elapsedLabel(ms: number, frozen: boolean): string {
  const seconds = Math.floor(ms / 1000);
  if (frozen) return `${Math.floor(seconds / 60)}m+`;
  if (seconds < 600) {
    return `${Math.floor(seconds / 60)}:${
      String(seconds % 60).padStart(2, "0")
    }`;
  }
  return compactDuration(ms);
}

/** The task this branch belongs to, by title, for "also in" facts. */
function taskTitleFor(branch: string, rows: readonly DeskRow[]): string {
  return rows.find((row) => row.entry.branch === branch)?.task.name ?? branch;
}

const SEPARATOR: ApplicationRun = { text: " · ", ascii: " - ", tone: "faint" };

/**
 * A checkout's path as the inspector shows it, short enough to read at a
 * glance. A checkout beside the main one reads from the folder that holds
 * them both (`…/project.worktrees/tidy-scripts`, and `…/project` for the
 * main checkout); a path elsewhere keeps its first folder and its last two
 * names around an ellipsis. View changes and the recovery steps show it
 * whole.
 */
export function checkoutPathRuns(path: string, root: string): ApplicationRun[] {
  const parent = root.slice(0, root.lastIndexOf("/"));
  if (parent !== "" && path.startsWith(`${parent}/`)) {
    const tail = path.slice(parent.length + 1);
    return [{ text: `…/${tail}`, ascii: `.../${tail}` }];
  }
  const names = path.split("/").filter((name) => name !== "");
  const [first, ...rest] = names;
  if (first === undefined || rest.length <= 2 || !path.startsWith("/")) {
    return [{ text: path }];
  }
  const last = rest.slice(-2).join("/");
  return [{ text: `/${first}/…/${last}`, ascii: `/${first}/.../${last}` }];
}

/**
 * The faint line under a task's title: its branch, without the prefix every
 * task branch shares. A branch named `<prefix><id>` reads as its id, which
 * fits the inspector where the whole ref would be cut; View changes shows
 * the whole branch.
 */
export function branchLine(branch: string, id: string): string {
  if (branch === "") return id;
  return id !== "" && branch.length > id.length && branch.endsWith(id)
    ? id
    : branch;
}

/** The Checks fact: the run in progress, the failed run, or the Proof. */
function checksFact(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationRun[][] {
  const { entry, decision } = row;
  if (entry.running?.verb === "done") return [[{ text: "Running now" }]];
  const action = entry.last_action;
  if (decision.state === "checks-failed" && action !== undefined) {
    return [[{
      text: `Failed ${relativeAge(action.at, inspection.now)}${
        action.failed_stage === undefined ? "" : ` at ${action.failed_stage}`
      }`,
    }]];
  }
  const lines: ApplicationRun[][] = [[{ text: decision.proof.summary }]];
  const proof = entry.gate_proof?.proof_data;
  if (decision.proof.honored && proof !== undefined) {
    lines.push([
      { text: `${plural(proof.files_total, "file")}  ` },
      ...diffRuns(proof.insertions, proof.deletions),
    ]);
  }
  return lines;
}

/** The Main fact: how far the trunk moved since the branch left it. */
function mainFact(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationRun[][] | undefined {
  const behind = row.entry.behind;
  if (behind === undefined) return undefined;
  if (behind === UNKNOWN_GIT_COUNT) {
    return [[{ text: `Couldn't count against ${inspection.trunk}` }]];
  }
  if (!isPositiveGitCount(behind)) return [[{ text: "Up to date" }]];
  return [[
    {
      text: String(behind),
      ...(row.decision.proof.honored ? { tone: "warning" as const } : {}),
    },
    { text: ` new commit${behind === 1 ? "" : "s"} since` },
  ]];
}

/** The task's queue entry, when it has one. */
function queueRow(
  row: DeskRow,
  data: StatusData | undefined,
): SubmissionRowData | undefined {
  return data?.queue?.find((item) => item.branch === row.entry.branch);
}

/** The Overlap and ADR facts. */
function collisionFacts(
  row: DeskRow,
  rows: readonly DeskRow[],
): { label: string; value: ApplicationRun[][] }[] {
  const facts: { label: string; value: ApplicationRun[][] }[] = [];
  for (const collision of row.decision.collisions) {
    if (collision.kind === "changed_files") {
      const shown = collision.paths.slice(0, 3);
      const more = collision.total - shown.length;
      facts.push({
        label: "Overlap",
        value: [
          ...shown.map((path) => [{ text: path }]),
          ...(more > 0
            ? [[{ text: `and ${more} more`, tone: "muted" as const }]]
            : []),
          [{
            text: `also in ${taskTitleFor(collision.otherBranch, rows)}`,
            tone: "muted",
          }],
        ],
      });
    } else {
      facts.push({
        label: "ADR",
        value: [[{
          text: `${collision.number} also added in ${
            collision.otherBranches.map((branch) => taskTitleFor(branch, rows))
              .join(", ")
          }`,
        }]],
      });
    }
  }
  return facts;
}

/**
 * The Setup and Error facts for a checkout whose setup stopped. Setup says
 * where it stopped, or that its record is unreadable; with no step record
 * it has nothing to add to the explanation, so it is left out.
 */
function setupFacts(
  row: DeskRow,
): { label: string; value: ApplicationRun[][] }[] {
  const setup = row.entry.setup;
  if (setup === undefined || setup.state === "ready") return [];
  const steps = setup.journal?.steps ?? [];
  const stopped = steps.findIndex((step) => step.state !== "completed");
  const where = row.decision.state === "setup-unknown"
    ? "Couldn't read the setup record"
    : steps.length > 0 && stopped >= 0
    ? `Stopped at step ${stopped + 1} of ${steps.length}`
    : undefined;
  const facts: { label: string; value: ApplicationRun[][] }[] =
    where === undefined ? [] : [{ label: "Setup", value: [[{ text: where }]] }];
  // A recorded failure is an error; a repair that needs the owner says why.
  // A safe retry needs no words here: the explanation already says so.
  const failure = setup.journal?.reason;
  if (failure !== undefined) {
    facts.push({ label: "Error", value: [[{ text: failure }]] });
  } else if (setup.repair?.kind === "manual") {
    facts.push({ label: "Why", value: [[{ text: setup.repair.reason }]] });
  }
  return facts;
}

/** Every fact a task row shows, in the inspector's fixed order. */
export function taskFacts(
  row: DeskRow,
  inspection: DeskInspection,
): { name?: FleetRowFactName; label: string; value: ApplicationRun[][] }[] {
  const { entry, decision } = row;
  const facts: {
    name?: FleetRowFactName;
    label: string;
    value: ApplicationRun[][];
  }[] = [
    { name: "checks", label: "Checks", value: checksFact(row, inspection) },
  ];
  const main = mainFact(row, inspection);
  if (main !== undefined) {
    facts.push({ name: "main", label: "Main", value: main });
  }
  const queued = queueRow(row, inspection.data);
  if (decision.proof.honored || decision.authority.status === "granted") {
    if (decision.authority.summary !== undefined) {
      facts.push({
        name: "landing",
        label: "Landing",
        value: [[{ text: decision.authority.summary }]],
      });
    }
  }
  if (decision.proof.honored || queued !== undefined) {
    facts.push({
      name: "queue",
      label: "Queue",
      value: [[{ text: queueHuman(queued) }]],
    });
  }
  if (entry.broken !== true && entry.git_unavailable !== true) {
    facts.push({
      name: "changes",
      label: "Changes",
      value: [[{
        text: entry.clean === false
          ? `${plural(entry.changed_files ?? 0, "uncommitted file")}`
          : entry.clean === true
          ? "Clean"
          : "Unknown",
      }]],
    });
  }
  facts.push(...collisionFacts(row, inspection.rows));
  for (const fact of setupFacts(row)) {
    facts.push({ name: fact.label === "Setup" ? "setup" : "error", ...fact });
  }
  const exception = inspection.data === undefined
    ? undefined
    : exceptionFact(row);
  if (exception !== undefined) facts.push(exception);
  return facts;
}

/** The Exception fact: the owner decisions the Desk hands to a terminal. */
function exceptionFact(
  row: DeskRow,
):
  | { name: FleetRowFactName; label: string; value: ApplicationRun[][] }
  | undefined {
  if (row.decision.state !== "exception") return undefined;
  const land = row.decision.actions.find((offer) => offer.action === "accept");
  const proof = row.entry.gate_proof?.proof_data;
  const unmet = proof?.checkpoints?.declared_unmet.length ?? 0;
  const proposals = proof?.standard_proposals?.length ?? 0;
  const lines: ApplicationRun[][] = [];
  if (unmet > 0) {
    lines.push([{
      text: `${plural(unmet, "checkpoint")} need${
        unmet === 1 ? "s" : ""
      } your exception`,
    }]);
  }
  if (proposals > 0) {
    lines.push([{
      text: `${plural(proposals, "standard change")} need${
        proposals === 1 ? "s" : ""
      } your approval`,
    }]);
  }
  if (land?.availability === "disabled") {
    lines.push([{ text: land.reason, tone: "muted" }]);
  }
  return lines.length === 0
    ? undefined
    : { name: "exception", label: "Exception", value: lines };
}

/**
 * A section's failure or content once read, and until then its skeleton,
 * for a section that shows one while it is read.
 */
function evidenceSection<T>(
  title: string,
  section: DeskEvidenceSection<T> | undefined,
  skeleton: boolean,
  content: (value: T) => ApplicationDetailBlock[] | undefined,
): ApplicationDetailBlock[] {
  if (section === undefined) {
    return skeleton
      ? [{
        kind: "section",
        title,
        blocks: [{ kind: "pending", label: "Reading…" }],
      }]
      : [];
  }
  if (section.state === "failed") {
    return [{
      kind: "section",
      title,
      blocks: [{
        kind: "text",
        runs: [
          { text: `Couldn't read ${title.toLowerCase()}`, tone: "warning" },
          SEPARATOR,
          {
            text: "r",
            role: "key",
          },
          { text: " Retry", tone: "muted" },
        ],
      }, { kind: "text", runs: [{ text: section.error, tone: "faint" }] }],
    }];
  }
  return content(section.value) ?? [];
}

/** A change letter for a file row. */
function changeLetter(file: DeskFileStat): ApplicationRun {
  return file.status === "added"
    ? { text: "A", tone: "success" }
    : file.status === "removed"
    ? { text: "D", tone: "danger" }
    : { text: "M", tone: "muted" };
}

/** Commits, files, uncommitted files, and the last failure. */
function artifacts(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const evidence = inspection.evidence;
  const overlapping = new Set(
    row.decision.collisions.flatMap((collision) =>
      collision.kind === "changed_files" ? collision.paths : []
    ),
  );
  const blocks: ApplicationDetailBlock[] = [];
  if (
    row.decision.statusKind === "failed" ||
    row.entry.last_action?.outcome === "failed"
  ) {
    blocks.push(
      ...evidenceSection(
        "Failure",
        evidence?.failure,
        false,
        (failures) =>
          failures.length === 0 ? undefined : [{
            kind: "section",
            title: "Failure",
            caption: "from the last run",
            blocks: [{
              kind: "marks",
              items: failures.slice(0, 3).map((failure) => ({
                mark: glyph(CONSEQUENCE_GLYPHS.failure, "danger"),
                runs: [{ text: failure.name }],
                lines: [
                  ...(failure.file === undefined ? [] : [[{
                    text: `${failure.file}${
                      failure.line === undefined ? "" : `:${failure.line}`
                    }`,
                    tone: "muted" as const,
                  }]]),
                  [{ text: failure.message, tone: "muted" as const }],
                ],
              })),
            }],
          }],
      ),
    );
  }
  if (row.entry.clean === false) {
    blocks.push(
      ...evidenceSection(
        "Uncommitted",
        evidence?.uncommitted,
        true,
        (files) => [{
          kind: "section",
          title: "Uncommitted",
          count: files.length,
          blocks: [{
            kind: "rows",
            lead: { id: "change", width: 1 },
            columns: [{ id: "flag", width: 1, priority: 1 }],
            items: files.map((file) => ({
              lead: [changeLetter(file)],
              text: [{ text: file.path }],
              ...(overlapping.has(file.path)
                ? {
                  cells: {
                    flag: [{
                      text: DESK_GLYPHS.overlap.unicode,
                      ascii: DESK_GLYPHS.overlap.ascii,
                      tone: "faint" as const,
                    }],
                  },
                }
                : {}),
            })),
          }],
        }],
      ),
    );
  }
  blocks.push(
    ...evidenceSection(
      "Commits",
      evidence?.commits,
      true,
      (commits) =>
        commits.length === 0 ? undefined : [{
          kind: "section",
          title: "Commits",
          count: commits.length,
          blocks: [{
            kind: "rows",
            lead: { id: "sha", width: 7 },
            columns: [{ id: "age", width: 4, align: "end", priority: 1 }],
            items: commits.map((commit) => ({
              lead: [{ text: shortCommit(commit.sha), tone: "faint" as const }],
              text: [{ text: commit.subject }],
              cells: {
                age: [{
                  text: ageText(commit.at, inspection.now),
                  tone: "faint" as const,
                }],
              },
            })),
          }],
        }],
    ),
  );
  blocks.push(
    ...evidenceSection(
      "Files",
      evidence?.files,
      false,
      (files) =>
        files.length === 0 ? undefined : [{
          kind: "section",
          title: "Files",
          count: files.length,
          blocks: [fileRows(files)],
        }],
    ),
  );
  return blocks;
}

/** Changed files, one row each: the change letter, the path, the lines. */
export function fileRows(
  files: readonly DeskFileStat[],
): ApplicationDetailBlock {
  return {
    kind: "rows",
    lead: { id: "change", width: 1 },
    columns: [{ id: "lines", width: 12, align: "end", priority: 1 }],
    items: files.map((file) => ({
      lead: [changeLetter(file)],
      text: [{ text: file.path }],
      cells: {
        lines: file.added === undefined && file.removed === undefined
          ? [{ text: "binary", tone: "faint" as const }]
          : diffRuns(file.added ?? 0, file.removed ?? 0),
      },
    })),
  };
}

/** Added and removed line counts as green and red runs. */
export function diffRuns(added: number, removed: number): ApplicationRun[] {
  return [
    { text: `+${added}`, tone: "success" },
    { text: ` −${removed}`, ascii: ` -${removed}`, tone: "danger" },
  ];
}

/** Setup steps from the journal: what finished, what failed, what never ran. */
function setupSteps(row: DeskRow): ApplicationDetailBlock[] {
  const steps = row.entry.setup?.journal?.steps ?? [];
  if (steps.length === 0 || row.entry.setup?.state === "ready") return [];
  return [{
    kind: "section",
    title: "Setup steps",
    blocks: [{
      kind: "marks",
      items: steps.map((step) => ({
        // A step still "running" in a stopped setup is the one that failed.
        mark: step.state === "completed"
          ? glyph(DESK_GLYPHS.done, "success")
          : step.state === "running"
          ? glyph(DESK_GLYPHS.failed, "danger")
          : glyph(DESK_GLYPHS.separator, "faint"),
        runs: [{ text: step.command, role: "code" as const }],
      })),
    }],
  }];
}

/** The Next block: the next step, the keyed alternatives, and the menu. */
function nextBlock(row: DeskRow): ApplicationDetailBlock[] {
  const { decision } = row;
  const summary = (action: DeskAction): string =>
    decision.actions.find((offer) => offer.action === action)?.summary ?? "";
  const items: {
    key: string;
    label: string;
    description?: string;
    primary?: boolean;
  }[] = [];
  if (decision.next?.availability === "enabled") {
    items.push({
      key: "enter",
      label: decision.next.label,
      description: summary(decision.next.action),
      primary: true,
    });
  }
  for (const offer of decision.also) {
    if (offer.key === undefined) continue;
    items.push({
      key: offer.key,
      label: offer.label,
      description: offer.summary,
    });
  }
  items.push({
    key: ".",
    label: "Actions",
    description: "Every action for this task",
  });
  // Below the wide tier the package hides hints, and the section with them.
  return [nextSection(items)];
}

/**
 * What can be done next, described: wide screens and zoom show it under a
 * "Next" heading; narrower ones hide the hints, and the heading with them.
 */
function nextSection(
  items: Extract<ApplicationDetailBlock, { readonly kind: "hints" }>["items"],
): ApplicationDetailBlock {
  return { kind: "section", title: "Next", blocks: [{ kind: "hints", items }] };
}

/** The running meter against the usual duration, when there is a prior. */
function meter(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const typical = row.entry.running?.typical_duration_ms;
  const elapsed = runningElapsed(row, inspection);
  if (typical === undefined || elapsed === undefined || typical <= 0) return [];
  return [{
    kind: "meter",
    value: Math.min(elapsed, typical),
    max: typical,
    caption: `${elapsedLabel(elapsed, inspection.frozen)} of about ${
      compactDuration(typical)
    }`,
  }];
}

/** A task's details, in the order every container shows them. */
export function taskBlocks(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const { decision, entry } = row;
  const labelTone =
    decision.tones.label === "muted" || decision.tones.label === "faint" ||
      decision.tones.label === "accent"
      ? "ink"
      : decision.tones.label;
  return [
    {
      kind: "heading",
      title: row.task.name,
      aside: [{
        text: branchLine(entry.branch, deskRowId(row)),
        tone: "faint",
      }],
    },
    {
      kind: "state",
      glyph: stateGlyph(row, inspection.frozen),
      label: decision.label,
      tone: labelTone,
      ...(decision.qualifier === undefined
        ? {}
        : { qualifier: decision.qualifier }),
    },
    ...meter(row, inspection),
    { kind: "text", runs: [{ text: decision.explanation }] },
    {
      kind: "facts",
      rows: taskFacts(row, inspection).map(({ label, value }) => ({
        label,
        value,
      })),
    },
    ...(decision.state === "checking"
      ? [{
        kind: "text" as const,
        runs: [{
          text:
            "Agent and shell stay open to you. Editing now may make these checks outdated.",
          tone: "faint" as const,
        }],
      }]
      : []),
    ...taskTail(row, inspection),
  ];
}

/** What follows a task's head: next steps, setup, artifacts and identity. */
function taskTail(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const { entry } = row;
  return [
    ...nextBlock(row),
    ...setupSteps(row),
    ...artifacts(row, inspection),
    ...(entry.task?.brief === undefined ? [] : [{
      kind: "section" as const,
      title: "Brief",
      blocks: [{ kind: "text" as const, runs: [{ text: entry.task.brief }] }],
    }]),
    {
      kind: "section",
      title: "Identity",
      blocks: [{
        kind: "facts",
        rows: [
          {
            label: "Path",
            value: [checkoutPathRuns(entry.path, inspection.root)],
          },
          // The id is the checkout's own folder name, which Path already
          // ends with; it shows only when it differs.
          ...(entry.path.split("/").at(-1) === deskRowId(row)
            ? []
            : [{ label: "Id", value: [[{ text: deskRowId(row) }]] }]),
          ...(entry.task?.created_from === undefined ? [] : [{
            label: "From",
            value: [[{
              text: `${entry.task.created_from.ref} at ${
                shortCommit(entry.task.created_from.commit)
              }`,
            }]],
          }]),
        ],
      }],
    },
  ];
}

/** The compact strip: glyph, title and label, then the headline facts. */
export function taskStrip(
  row: DeskRow,
  inspection: DeskInspection,
): ApplicationDetailStrip {
  const facts = taskFacts(row, inspection);
  const headline = FLEET_ROW_STATES[row.decision.state].headline;
  return {
    title: [
      {
        text: row.decision.glyph,
        ascii: row.decision.ascii,
        tone: tone(row.decision.tones.glyph),
      },
      { text: " " },
      { text: row.task.name, role: "title" },
      { text: "  " },
      { text: row.decision.label, tone: tone(row.decision.tones.label) },
    ],
    facts: headline.flatMap((name) => {
      const fact = facts.find((candidate) => candidate.name === name);
      const first = fact?.value[0];
      return first === undefined ? [] : [first];
    }),
  };
}

/** A parked branch's details. */
export function parkedBlocks(
  branch: string,
  title: string,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const parked = inspection.data?.parked_tasks?.find((task) =>
    task.branch === branch
  );
  const look = FLEET_ROW_STATES.parked;
  return [
    { kind: "heading", title, aside: [{ text: branch, tone: "faint" }] },
    {
      kind: "state",
      glyph: {
        unicode: look.glyph,
        ascii: look.ascii,
        tone: tone(look.glyphTone),
      },
      label: look.label,
      tone: "ink",
      qualifier: "no checkout",
    },
    {
      kind: "text",
      runs: [{
        text:
          "Its branch, title and brief are kept, but it has no checkout. Resuming gives it a fresh checkout on this branch.",
      }],
    },
    {
      kind: "facts",
      rows: [
        { label: "Branch", value: [[{ text: branch }]] },
        ...(parked === undefined ? [] : [{
          label: "Parked",
          value: [[{ text: relativeAge(parked.parked_at, inspection.now) }]],
        }]),
        ...(parked?.task.brief === undefined ? [] : [{
          label: "Brief",
          value: [[{ text: parked.task.brief }]],
        }]),
      ],
    },
    ...parkedTail(inspection),
  ];
}

/** What follows a parked branch's head: its next steps and its commits. */
function parkedTail(inspection: DeskInspection): ApplicationDetailBlock[] {
  const evidence = inspection.evidence;
  return [
    nextSection([
      {
        key: "enter",
        label: DESK_COMMAND_LABELS.resume,
        description: "Review, then give it a checkout",
        primary: true,
      },
      {
        key: "v",
        label: DESK_COMMAND_LABELS.branch_commits,
        description: `The commits that are not on ${inspection.trunk}`,
      },
      {
        key: ".",
        label: "Actions",
        description: "Every action for this branch",
      },
    ]),
    ...evidenceSection(
      "Commits",
      evidence?.commits,
      true,
      (commits) =>
        commits.length === 0 ? undefined : [{
          kind: "section",
          title: "Commits",
          count: commits.length,
          caption: `not on ${inspection.trunk}`,
          blocks: [{
            kind: "rows",
            lead: { id: "sha", width: 7 },
            columns: [{ id: "age", width: 4, align: "end", priority: 1 }],
            items: commits.map((commit) => ({
              lead: [{ text: shortCommit(commit.sha), tone: "faint" as const }],
              text: [{ text: commit.subject }],
              cells: {
                age: [{
                  text: ageText(commit.at, inspection.now),
                  tone: "faint" as const,
                }],
              },
            })),
          }],
        }],
    ),
  ];
}

/** A parked branch's strip. */
export function parkedStrip(
  branch: string,
  title: string,
): ApplicationDetailStrip {
  const look = FLEET_ROW_STATES.parked;
  return {
    title: [
      { text: look.glyph, ascii: look.ascii, tone: tone(look.glyphTone) },
      { text: " " },
      { text: title, role: "title" },
      { text: "  " },
      { text: look.label, tone: "faint" },
    ],
    facts: [[{ text: branch }]],
  };
}

/**
 * A stored Proof line as the owner reads it: its label and code spans
 * styled, never their Markdown markers, and without its pointer to the CLI,
 * since the full Proof is one key away.
 */
export function proofLineBlock(line: string): ApplicationDetailBlock {
  return { kind: "text", runs: inlineRuns(proofLineWithoutPointer(line)) };
}

/** A recent landing's details. */
export function landedBlocks(
  task: NonNullable<StatusData["recent_completed_tasks"]>[number],
  title: string,
  inspection: DeskInspection,
): ApplicationDetailBlock[] {
  const look = FLEET_ROW_STATES.landed;
  return [
    { kind: "heading", title, aside: [{ text: task.branch, tone: "faint" }] },
    {
      kind: "state",
      glyph: {
        unicode: look.glyph,
        ascii: look.ascii,
        tone: tone(look.glyphTone),
      },
      label: look.label,
      tone: "ink",
      qualifier: relativeAge(task.completed_at, inspection.now),
    },
    {
      kind: "text",
      runs: [{
        text: `It landed on ${inspection.trunk} ${
          relativeAge(task.completed_at, inspection.now)
        }.`,
      }],
    },
    {
      kind: "facts",
      rows: [
        { label: "Branch", value: [[{ text: task.branch }]] },
        ...(task.head === undefined
          ? []
          : [{ label: "Head", value: [[{ text: task.head.slice(0, 12) }]] }]),
      ],
    },
    ...(task.proof_line === undefined ? [] : [proofLineBlock(task.proof_line)]),
    nextSection([{
      key: "enter",
      label: DESK_COMMAND_LABELS.landed_proof,
      description: "The Proof recorded when it landed",
      primary: true,
    }]),
  ];
}
