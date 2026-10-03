/**
 * The Desk-level command authority.
 *
 * Commands are everything the Desk offers beyond one task's actions: creating
 * work, readers over the fleet and main checkout, help, session toggles, and
 * the routes of parked and landed branch rows. Each command declares its
 * key, palette section, effect, confirmation, revision binding, and
 * consequences once, on the action registry's pattern, so every surface that
 * offers a command reads the same facts: the palette, the home panel beside
 * the Commands row, the keys reader, and each review and confirmation.
 */

import type { StatusData } from "../../shared/result_schemas.ts";
import { DISCERN_URL } from "../../shared/product_identity.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import type { ReleaseCheckHistory } from "../../shared/release_check.ts";
import { relativeAge } from "../status/row_facts.ts";
import { FLEET_ROW_DECISIONS } from "../../shared/fleet_row_vocabulary.ts";
import {
  DESK_COMMANDS,
  type DeskCommand,
} from "../../shared/desk_vocabulary.ts";
import {
  type DeskBindingFact,
  type DeskCommandEvidence,
  type DeskConfirmationPolicy,
  type DeskConsequenceMark,
  type DeskEffect,
  SCRIPT_CONSEQUENCES,
  START_CONSEQUENCES,
} from "./model.ts";
import {
  consequence,
  type DeskConsequenceItem,
  type DeskConsequenceLine,
  type DeskReviewFacts,
  resolveConsequences,
} from "./review_facts.ts";

export { DESK_COMMANDS, type DeskCommand };

/** Where a command is reached from. */
export type DeskCommandScope =
  /** From anywhere in the inbox: the palette, a global key, or a chip. */
  | "global"
  /** The route of a selected parked branch row. */
  | "parked-row"
  /** The route of a selected landed row. */
  | "landed-row"
  /** A task route that overrides the task's next step. */
  | "task";

/**
 * Command sections in display order: the palette's after its dynamic Needs
 * you section, and the home panel's. Starting work leads, as an empty desk
 * does, and help comes next, so the manual and the update check stay on a
 * standard screen; the palette that opens over the home panel keeps its
 * order.
 */
export const DESK_PALETTE_SECTIONS = [
  "create",
  "help",
  "go",
  "session",
] as const;
export type DeskPaletteSection = (typeof DESK_PALETTE_SECTIONS)[number];

/**
 * What a command reads that may still be loading when it is chosen:
 * `survey` the session's status survey, `manual` its one read of the
 * manual, `tip` the choice of its tip, and `own` a read the command starts
 * itself as it opens (a review's plan, a form's preview, the script
 * inventory, a reader's reading).
 */
export const DESK_COMMAND_READS = ["survey", "manual", "tip", "own"] as const;
export type DeskCommandRead = (typeof DESK_COMMAND_READS)[number];

/** Section titles, as the palette and the home panel show them. */
export const DESK_PALETTE_SECTION_TITLES = {
  create: "Create",
  help: "Help",
  go: "Go to",
  session: "Session",
} as const satisfies Record<DeskPaletteSection, string>;

/**
 * Every word the desk says about checking for a release, one family from
 * one place. `due` is status's release reminder, in the Commands row's
 * label cell (as wide as a task's state label), the header chip and the
 * Needs you entry it routes from, and the narrow strip; it names what to
 * do, Check for updates, as Enter on the row then offers it. `never` and
 * `checked` say when this clone last opened the release page, beside Check
 * for updates wherever a tier lists it: the home panel, its zoom, the
 * palette and the strip. Both count on this clone's own clock; discern
 * fetches nothing, so no cue says a release exists.
 */
export const RELEASE_CHECK_CUES = {
  due: "Check updates",
  never: "never checked",
  checked: (ago: string): string => `checked ${ago}`,
} as const;

/** The observed facts a command's meta, summary, or consequences read. */
export interface DeskCommandFacts {
  readonly data?: StatusData;
  /** The running discern version, which the release page receives. */
  readonly version: string;
  /** The configured trunk, when the observation reported it. */
  readonly trunk?: string;
  /** Operations this Desk session has run, for Session activity. */
  readonly sessionOperations?: number;
  /** When this clone last opened the release page, for Check for updates. */
  readonly releaseCheck?: ReleaseCheckHistory;
  /** Wall time, for how long ago that was. */
  readonly now?: number;
}

/**
 * When this clone last checked for updates, beside Check for updates:
 * `checked 3w ago`, or `never checked`. It reads the clone's own record,
 * never a fetch, so it says nothing of a release; an unreadable record
 * says nothing at all.
 */
export function lastUpdateCheck(facts: DeskCommandFacts): string | undefined {
  const history = facts.releaseCheck;
  if (history?.state === "never") return RELEASE_CHECK_CUES.never;
  if (history?.state !== "checked" || facts.now === undefined) return undefined;
  return RELEASE_CHECK_CUES.checked(relativeAge(history.at, facts.now));
}

/** What a command's review lines read: its facts and what it previewed. */
export interface DeskCommandReviewFacts
  extends DeskReviewFacts, DeskCommandFacts {}

/** One declared consequence of a command, resolved against its facts. */
export type DeskCommandConsequence = DeskConsequenceItem<
  DeskCommandReviewFacts
>;

/** One registered command's complete contract. */
export interface DeskCommandMetadata {
  /** A shorter form, only where the label cannot fit: the footer, and the
   * Commands row's strip below the split. The labels themselves are the
   * vocabulary's (`DESK_COMMAND_LABELS`, and `DESK_COMMAND_TOGGLED_LABELS`
   * for a used toggle), never a copy here. */
  readonly short?: string;
  /** The key that runs it in its scope's layer. */
  readonly key?: string;
  readonly scope: DeskCommandScope;
  /** The palette section a global command is listed under. */
  readonly section?: DeskPaletteSection;
  /**
   * Listed on the home panel beside the Commands row, under its section,
   * so a newcomer sees it without knowing the palette's key. Its key, when
   * it has one, is one character, shown as typed.
   */
  readonly home?: true;
  /** Whether it asks for values (a form or arguments) before it runs. */
  readonly parameters: boolean;
  /**
   * What it reads that may still be loading when it is chosen; empty when
   * it reads nothing that loads. Chosen early, a command never refuses: a
   * reader or sheet opens at once and fills in as its read arrives, a
   * selection runs once the survey has read the tasks, and the manual opens
   * as soon as it has been read.
   */
  readonly reads: readonly DeskCommandRead[];
  readonly effect: DeskEffect;
  readonly confirmation: DeskConfirmationPolicy;
  /** What a review binds; empty only for commands that read. */
  readonly binding: readonly DeskBindingFact[];
  /** One line for the palette and the keys sheet. */
  readonly summary: string;
  /** Faint prose beside the label in the palette: "1 queued". */
  readonly meta?: (facts: DeskCommandFacts) => string | undefined;
  /** What running it does, in the order a review shows it. */
  readonly consequence: readonly DeskCommandConsequence[];
  /** The CLI equivalent, when one exists. */
  readonly command?: (facts: DeskCommandFacts) => DeskCommandEvidence;
}

/** One consequence of a command, in the registry's line shape. */
function said(
  mark: DeskConsequenceMark,
  text: DeskCommandConsequence["text"],
): DeskCommandConsequence {
  return consequence(mark, text);
}

/** A no-default confirmation with its safe and effect buttons. */
function confirm(noLabel: string, yesLabel: string): DeskConfirmationPolicy {
  return { kind: "confirm", defaultTo: false, noLabel, yesLabel };
}

const NO_CONFIRMATION = { kind: "none" } as const;
const RELEASE_HOST = new URL(DISCERN_URL).host;

/** Branches without a checkout, counted once whether parked or unlanded. */
function branchesWithoutCheckout(data: StatusData | undefined): number {
  return new Set([
    ...(data?.parked_tasks ?? []).map((task) => task.branch),
    ...(data?.unlanded_branches ?? []),
  ]).size;
}

/** The single Desk-level command authority. */
export const DESK_COMMAND_REGISTRY = {
  new_task: {
    key: "n",
    scope: "global",
    section: "create",
    home: true,
    parameters: true,
    reads: ["own"],
    effect: "change",
    confirmation: confirm("Cancel", "Create"),
    binding: ["base-commit", "branch-name"],
    summary: "Start a task in its own checkout and branch",
    consequence: [
      ...START_CONSEQUENCES,
      said("keeps", "Landing permission stays a separate decision"),
    ],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "start", "<title>"],
      workingDirectory: "main",
    }),
  },
  main_scripts: {
    short: "Scripts",
    scope: "global",
    section: "create",
    home: true,
    parameters: true,
    reads: ["own"],
    effect: "launch",
    confirmation: confirm("Cancel", "Run"),
    binding: ["main-path", "script-path", "script-digest", "argv"],
    summary: "Run one of the project's scripts in the main checkout",
    consequence: SCRIPT_CONSEQUENCES,
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "scripts", "<name>"],
      workingDirectory: "main",
    }),
  },
  landing: {
    scope: "global",
    section: "go",
    home: true,
    parameters: false,
    reads: ["survey"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "The landing queue, any running landing, and recent landings",
    meta: (facts: DeskCommandFacts): string => {
      const landed = facts.data?.recent_completed_tasks?.length ?? 0;
      return `${facts.data?.queue?.length ?? 0} queued${
        landed === 0 ? "" : ` · ${landed} landed`
      }`;
    },
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "accept", "--dry-run"],
      workingDirectory: "main",
    }),
  },
  parked: {
    // The number after the decision groups' own jump keys.
    key: String(FLEET_ROW_DECISIONS.length + 1),
    scope: "global",
    section: "go",
    home: true,
    parameters: false,
    reads: ["survey"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Branches kept without a checkout, ready to resume",
    meta: (facts: DeskCommandFacts): string =>
      plural(branchesWithoutCheckout(facts.data), "branch", "branches"),
    consequence: [said("keeps", "Nothing changes; it selects the group")],
  },
  main_checkout: {
    scope: "global",
    section: "go",
    home: true,
    parameters: false,
    reads: ["survey"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary:
      "Shared project state: changed paths, generated files, and the shell",
    meta: (facts: DeskCommandFacts): string | undefined =>
      facts.data?.git?.clean === undefined
        ? undefined
        : facts.data.git.clean
        ? "clean"
        : "has changes",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
    command: (): DeskCommandEvidence => ({
      argv: ["git", "status", "--short", "--branch"],
      workingDirectory: "main",
    }),
  },
  activity: {
    scope: "global",
    section: "go",
    home: true,
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "What this session ran, with each command and its output",
    meta: (facts: DeskCommandFacts): string =>
      (facts.sessionOperations ?? 0) === 0
        ? "nothing yet"
        : `${facts.sessionOperations} this session`,
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
  },
  keys: {
    short: "Keys",
    key: "?",
    scope: "global",
    section: "help",
    home: true,
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Every key the desk understands, by where you are",
    consequence: [said("keeps", "Nothing changes; the sheet only reads")],
  },
  manual: {
    short: "Manual",
    scope: "global",
    section: "help",
    home: true,
    parameters: false,
    reads: ["manual"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "The offline manual, in the same reader as discern docs",
    consequence: [said("keeps", "Nothing changes; the manual only reads")],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "docs"],
      workingDirectory: "main",
    }),
  },
  tip: {
    scope: "global",
    section: "help",
    parameters: false,
    reads: ["tip"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "This session's tip in full",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
  },
  updates: {
    short: "Updates",
    scope: "global",
    section: "help",
    home: true,
    parameters: false,
    // The survey reads the release record its faint value reports.
    reads: ["survey", "own"],
    effect: "open",
    confirmation: confirm("Cancel", "Open"),
    binding: ["running-version"],
    summary: "See what's new and whether an upgrade is available",
    meta: lastUpdateCheck,
    consequence: [
      said(
        "changes",
        `Opens the ${RELEASE_HOST} release page in your browser`,
      ),
      said(
        "changes",
        (facts) =>
          `The page is told you run ${facts.version}, so it can say what's new`,
      ),
      said("keeps", "Nothing is installed; upgrading stays your choice"),
    ],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "releases"],
      workingDirectory: "main",
    }),
  },
  refresh: {
    key: "r",
    scope: "global",
    section: "session",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Survey every task now",
    consequence: [said("keeps", "Nothing changes; it reads status again")],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "status", "--all"],
      workingDirectory: "main",
    }),
  },
  sort: {
    scope: "global",
    section: "session",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "List tasks by title, or group them by who moves next",
    consequence: [said("keeps", "Changes only how this desk lists tasks")],
  },
  details: {
    scope: "global",
    section: "session",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Show or hide the selected task's details beside the list",
    consequence: [said("keeps", "Changes only how this desk lays out")],
  },
  mouse: {
    scope: "global",
    section: "session",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Let clicks and the wheel move through the desk",
    consequence: [
      said("keeps", "Changes only how this desk reads input"),
      said("warning", "While it is on, Shift-drag selects text"),
    ],
  },
  quit: {
    key: "q",
    scope: "global",
    section: "session",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Leave the desk; running work asks first",
    consequence: [said("keeps", "Every task stays as it is")],
  },
  resume: {
    scope: "parked-row",
    parameters: true,
    reads: ["own"],
    effect: "change",
    confirmation: confirm("Cancel", "Create"),
    binding: ["parked-record", "parked-head"],
    summary: "Give the branch a checkout again, with its title and brief",
    consequence: [
      ...START_CONSEQUENCES,
      said("keeps", "Keeps the branch and its commits"),
    ],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "start", "--from", "<branch>"],
      workingDirectory: "main",
    }),
  },
  branch_commits: {
    key: "v",
    scope: "parked-row",
    parameters: false,
    reads: ["own"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary:
      "The branch's commits that aren't on main, and the files they change",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
    command: (facts: DeskCommandFacts): DeskCommandEvidence => ({
      argv: [
        "git",
        "log",
        "--oneline",
        `${facts.trunk ?? "<trunk>"}..<branch>`,
      ],
      workingDirectory: "main",
    }),
  },
  landed_proof: {
    scope: "landed-row",
    parameters: false,
    reads: ["own"],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "The Proof recorded when it landed, in words",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
  },
  progress: {
    scope: "task",
    parameters: false,
    reads: [],
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Reopen the progress of what this desk is running",
    consequence: [said("keeps", "Nothing changes; it shows the running work")],
  },
} as const satisfies Readonly<Record<DeskCommand, DeskCommandMetadata>>;

/**
 * The commands that open a reader over what the desk already holds, by the
 * reader each opens. The reader paints from the session's reads, so it
 * shows any its command declares still loading and fills in as they arrive.
 */
export const DESK_COMMAND_READERS = {
  landing: "landing",
  main_checkout: "main",
  activity: "activity",
  keys: "keys",
  tip: "tip",
} as const satisfies Partial<Record<DeskCommand, string>>;

/** A reader one of those commands opens. */
export type DeskCommandReader =
  (typeof DESK_COMMAND_READERS)[keyof typeof DESK_COMMAND_READERS];

/** The reader a command opens, when it opens one over what the desk holds. */
export function commandReaderKind(
  command: DeskCommand,
): DeskCommandReader | undefined {
  const readers: Partial<Record<DeskCommand, DeskCommandReader>> =
    DESK_COMMAND_READERS;
  return readers[command];
}

/** The reads a reader shows while they load: its command's declared reads. */
export function readerReads(kind: string): readonly DeskCommandRead[] {
  const command = DESK_COMMANDS.find((candidate) =>
    commandReaderKind(candidate) === kind
  );
  return command === undefined ? [] : DESK_COMMAND_REGISTRY[command].reads;
}

/** Resolve one command's consequences against its facts and preview. */
export function commandConsequenceLines(
  command: DeskCommand,
  facts: DeskCommandFacts & Partial<Pick<DeskReviewFacts, "plan">>,
): DeskConsequenceLine[] {
  const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
  return resolveConsequences(command, metadata.consequence, {
    ...facts,
    plan: facts.plan ?? {},
  });
}

/**
 * One sentence that discloses everything a command does, for a surface that
 * runs it without a review sheet: "Opens the discern.sh release page in your
 * browser. The page is told you run 1.1.0, …".
 */
export function commandDisclosure(
  command: DeskCommand,
  facts: DeskCommandFacts,
): string {
  return commandConsequenceLines(command, facts)
    .map((line) => `${line.text}.`)
    .join(" ");
}
