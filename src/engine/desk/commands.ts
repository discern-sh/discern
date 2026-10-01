/**
 * The Desk-level command authority.
 *
 * Commands are everything the Desk offers beyond one task's actions: creating
 * work, readers over the fleet and main checkout, help, session toggles, and
 * the routes of parked and landed branch rows. Each command declares its
 * label, key, palette section, effect, confirmation, revision binding, and
 * consequences once, on the action registry's pattern, so the palette, the
 * keys sheet, footers, and any consent disclosure read the same facts.
 */

import type { StatusData } from "../../shared/result_schemas.ts";
import { DISCERN_URL } from "../../shared/product_identity.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import {
  DESK_COMMANDS,
  type DeskCommand,
} from "../../shared/desk_vocabulary.ts";
import type {
  DeskBindingFact,
  DeskCommandEvidence,
  DeskConfirmationPolicy,
  DeskConsequenceLine,
  DeskConsequenceMark,
  DeskEffect,
} from "./model.ts";

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

/** Palette sections in display order, after the dynamic Needs you section. */
export const DESK_PALETTE_SECTIONS = [
  "go",
  "create",
  "help",
  "session",
] as const;
export type DeskPaletteSection = (typeof DESK_PALETTE_SECTIONS)[number];

/** Palette section titles, as the palette shows them. */
export const DESK_PALETTE_SECTION_TITLES = {
  go: "Go to",
  create: "Create",
  help: "Help",
  session: "Session",
} as const satisfies Record<DeskPaletteSection, string>;

/** The observed facts a command's meta, summary, or consequences read. */
export interface DeskCommandFacts {
  readonly data?: StatusData;
  /** The running discern version, which the release page receives. */
  readonly version: string;
  /** The configured trunk, when the observation reported it. */
  readonly trunk?: string;
  /** Operations this Desk session has run, for Session activity. */
  readonly sessionOperations?: number;
}

/** One declared consequence of a command, resolved against its facts. */
export interface DeskCommandConsequence {
  readonly mark: DeskConsequenceMark;
  readonly text: (facts: DeskCommandFacts) => string;
}

/** One registered command's complete contract. */
export interface DeskCommandMetadata {
  /** A shorter footer form, only where the label cannot fit. The labels
   * themselves are the vocabulary's (`DESK_COMMAND_LABELS`, and
   * `DESK_COMMAND_TOGGLED_LABELS` for a used toggle), never a copy here. */
  readonly short?: string;
  /** The key that runs it in its scope's layer. */
  readonly key?: string;
  readonly scope: DeskCommandScope;
  /** The palette section a global command is listed under. */
  readonly section?: DeskPaletteSection;
  /** Whether it asks for values (a form or arguments) before it runs. */
  readonly parameters: boolean;
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
  text: string | ((facts: DeskCommandFacts) => string),
): DeskCommandConsequence {
  return { mark, text: typeof text === "string" ? (): string => text : text };
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
    parameters: true,
    effect: "change",
    confirmation: confirm("Cancel", "Create"),
    binding: ["base-commit", "branch-name"],
    summary: "Start a task in its own checkout and branch",
    consequence: [
      said("changes", "Creates a branch and its own checkout, then runs setup"),
      said("keeps", "Landing permission stays a separate decision"),
    ],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "start", "<title>"],
      workingDirectory: "main",
    }),
  },
  main_scripts: {
    scope: "global",
    section: "create",
    parameters: true,
    effect: "launch",
    confirmation: confirm("Cancel", "Run"),
    binding: ["main-path", "script-path", "script-digest", "argv"],
    summary: "Run one of the project's scripts in the main checkout",
    consequence: [
      said(
        "changes",
        "Runs the chosen script in the main checkout; it owns the terminal until it exits",
      ),
      said("warning", "Scripts don't declare what they change"),
    ],
    command: (): DeskCommandEvidence => ({
      argv: ["discern", "scripts", "<name>"],
      workingDirectory: "main",
    }),
  },
  landing: {
    scope: "global",
    section: "go",
    parameters: false,
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
    key: "6",
    scope: "global",
    section: "go",
    parameters: false,
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
    parameters: false,
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
    parameters: false,
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
    parameters: false,
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Every key the desk understands, by where you are",
    consequence: [said("keeps", "Nothing changes; the sheet only reads")],
  },
  manual: {
    scope: "global",
    section: "help",
    parameters: false,
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
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "This session's tip in full",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
  },
  updates: {
    scope: "global",
    section: "help",
    parameters: false,
    effect: "launch",
    confirmation: confirm("Cancel", "Open"),
    binding: ["running-version"],
    summary: "See what's new and whether an upgrade is available",
    // The reminder says a check is due, never that a release exists.
    meta: (facts: DeskCommandFacts): string | undefined =>
      facts.data?.release_reminder === undefined ? undefined : "check due",
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
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Leave the desk; running work asks first",
    consequence: [said("keeps", "Every task stays as it is")],
  },
  resume: {
    scope: "parked-row",
    parameters: true,
    effect: "change",
    confirmation: confirm("Cancel", "Create"),
    binding: ["parked-record", "parked-head"],
    summary: "Give the branch a checkout again, with its title and brief",
    consequence: [
      said("changes", "Creates a checkout from the branch's last commit"),
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
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "The Proof recorded when it landed, in words",
    consequence: [said("keeps", "Nothing changes; the reader only reads")],
  },
  progress: {
    scope: "task",
    parameters: false,
    effect: "read",
    confirmation: NO_CONFIRMATION,
    binding: [],
    summary: "Reopen the progress of what this desk is running",
    consequence: [said("keeps", "Nothing changes; it shows the running work")],
  },
} as const satisfies Readonly<Record<DeskCommand, DeskCommandMetadata>>;

/** Resolve one command's consequences against its observed facts. */
export function commandConsequenceLines(
  command: DeskCommand,
  facts: DeskCommandFacts,
): DeskConsequenceLine[] {
  const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
  return metadata.consequence.map((item) => ({
    mark: item.mark,
    text: item.text(facts),
  }));
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
