/**
 * `worktrees` is the one-shot interactive route into another checkout.
 *
 * Fleet facts come from `statusResult`; this module owns only presentation,
 * selection, project-relative directory mapping, and the child-shell handoff.
 */

import { dirname, isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { emitResult } from "../../shared/emit.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { directoryExists, realPathIfExists } from "../../shared/fs_presence.ts";
import type {
  StatusAdrCollision,
  StatusData,
  StatusFleetCollision,
  StatusFleetEntry,
} from "../../shared/result_schemas.ts";
import { Logger } from "../../lib/log.ts";
import {
  canInteract,
  groupedSelectionEntries,
  isInteractionCancelled,
  requestSelection,
  type SelectionGroup,
  type SelectionRequestOptions,
} from "../../lib/terminal_interaction.ts";
import { terminalLine } from "../../lib/terminal.ts";
import { buildDeskDecision, decisionSummary } from "../desk/model.ts";
import { runOwnedChild } from "../owned_child.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { statusResult } from "../status/status.ts";
import { userShell } from "../user_shell.ts";
import { mainRepoPath } from "./git.ts";
import { taskLabel } from "./task_label.ts";

const FILTER_THRESHOLD = 8;

/** Flags accepted by `worktrees`. */
export interface WorktreesOptions {
  /** Present for result-format parity. The interactive command refuses it. */
  readonly json?: boolean;
}

type WorktreesMaybePromise<T> = T | Promise<T>;

/** Terminal, filesystem, and process seams behind the interactive command. */
export interface WorktreesRuntime {
  canInteract(): boolean;
  findRoot(): WorktreesMaybePromise<string | undefined>;
  mainRepoPath(root: string): WorktreesMaybePromise<string | undefined>;
  status(root: string): WorktreesMaybePromise<{
    ok: boolean;
    data?: StatusData | undefined;
    message?: string | undefined;
  }>;
  canonicalPath(path: string): WorktreesMaybePromise<string>;
  cwd(): string;
  isDirectory(path: string): WorktreesMaybePromise<boolean>;
  makeOut(): Out;
  error(message: string): void;
  select(
    options: SelectionRequestOptions<string>,
  ): WorktreesMaybePromise<string>;
  shell(): string;
  launchShell(shell: string, cwd: string): WorktreesMaybePromise<number>;
  now(): number;
}

/** One fleet row prepared for the worktree picker. */
export interface WorktreeShellRow {
  readonly path: string;
  readonly branch: string;
  readonly name: string;
  readonly description: string;
  readonly current: boolean;
  readonly main: boolean;
  readonly lastActivity?: string;
}

/** Candidate directories in the selected checkout, nearest equivalent first. */
export interface EquivalentDirectoryCandidates {
  /** Project-relative directory in the source checkout; empty means its root. */
  readonly relativeDirectory: string;
  /** Exact equivalent followed by each ancestor through the selected root. */
  readonly candidates: readonly string[];
}

/** The directory chosen for a selected worktree shell. */
export interface EquivalentDirectory {
  readonly path: string;
  readonly relativeDirectory: string;
  readonly exact: boolean;
}

/** Whether `candidate` is within `root`, including the root itself. */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${SEPARATOR}`));
}

/**
 * Plan cwd-equivalent lookup without touching the filesystem. Missing branch-
 * local directories fall back one ancestor at a time, never outside the
 * selected worktree.
 */
export function equivalentDirectoryCandidates(
  sourceRoot: string,
  sourceCwd: string,
  targetRoot: string,
): EquivalentDirectoryCandidates {
  const source = resolve(sourceRoot);
  const cwd = resolve(sourceCwd);
  const target = resolve(targetRoot);
  if (!isWithin(source, cwd)) {
    throw new TypeError(
      `Current directory ${sourceCwd} is outside project root ${sourceRoot}.`,
    );
  }
  const relativeDirectory = relative(source, cwd);
  let candidate = resolve(target, relativeDirectory);
  if (!isWithin(target, candidate)) {
    throw new TypeError(
      `Equivalent directory ${candidate} is outside worktree ${targetRoot}.`,
    );
  }
  const candidates: string[] = [];
  while (true) {
    candidates.push(candidate);
    if (candidate === target) break;
    const parent = dirname(candidate);
    if (parent === candidate || !isWithin(target, parent)) {
      candidates.push(target);
      break;
    }
    candidate = parent;
  }
  return { relativeDirectory, candidates };
}

/** Choose the nearest existing cwd-equivalent directory in one worktree. */
export async function resolveEquivalentDirectory(
  sourceRoot: string,
  sourceCwd: string,
  targetRoot: string,
  isDirectory: (path: string) => WorktreesMaybePromise<boolean>,
): Promise<EquivalentDirectory | undefined> {
  const planned = equivalentDirectoryCandidates(
    sourceRoot,
    sourceCwd,
    targetRoot,
  );
  for (const [index, candidate] of planned.candidates.entries()) {
    if (await isDirectory(candidate)) {
      return {
        path: candidate,
        relativeDirectory: planned.relativeDirectory,
        exact: index === 0,
      };
    }
  }
  return undefined;
}

/** Project-relative path rendered in the portable path dialect. */
function displayRelative(path: string): string {
  return path === "" ? "." : path.split(SEPARATOR).join("/");
}

/** Most-recent-first, with unknown activity last. */
function byActivityDesc(a: WorktreeShellRow, b: WorktreeShellRow): number {
  const at = a.lastActivity === undefined ? 0 : Date.parse(a.lastActivity);
  const bt = b.lastActivity === undefined ? 0 : Date.parse(b.lastActivity);
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

/**
 * Derive picker rows from the fleet survey. The current checkout and main
 * checkout are presentation roles; branch, Git, Proof, and activity facts stay
 * owned by `StatusFleetEntry` and the Desk's shared row summary.
 */
export function buildWorktreeShellRows(
  fleet: readonly StatusFleetEntry[],
  currentRoot: string,
  nowMs: number,
  options: {
    readonly trunk: string;
    readonly fleetCollisions?: readonly StatusFleetCollision[];
    readonly adrCollisions?: readonly StatusAdrCollision[];
  },
): WorktreeShellRow[] {
  const labels = fleet.map((entry) => ({ entry, task: taskLabel(entry) }));
  const counts = new Map<string, number>();
  for (const { entry, task } of labels) {
    if (!entry.is_main) {
      counts.set(task.name, (counts.get(task.name) ?? 0) + 1);
    }
  }
  const current = resolve(currentRoot);
  const rows = labels.map(({ entry, task }): WorktreeShellRow => {
    const duplicate = !entry.is_main && (counts.get(task.name) ?? 0) > 1;
    const disambiguator = duplicate
      ? task.disambiguator ?? entry.id ?? entry.branch
      : undefined;
    const name = entry.is_main
      ? "Main checkout"
      : disambiguator === undefined
      ? task.name
      : `${task.name}  ${disambiguator}`;
    const branch = entry.branch === "" ? "(detached)" : entry.branch;
    const decision = buildDeskDecision(entry, {
      trunk: options.trunk,
      nowMs,
      ...(options.fleetCollisions === undefined
        ? {}
        : { fleetCollisions: options.fleetCollisions }),
      ...(options.adrCollisions === undefined
        ? {}
        : { adrCollisions: options.adrCollisions }),
    });
    const description = `${branch} · ${
      decisionSummary(decision)
    } · ${entry.path}`;
    return {
      path: entry.path,
      branch,
      name,
      description,
      current: resolve(entry.path) === current,
      main: entry.is_main,
      ...(entry.last_activity === undefined
        ? {}
        : { lastActivity: entry.last_activity }),
    };
  });
  return rows.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.main !== b.main) return a.main ? -1 : 1;
    return byActivityDesc(a, b);
  });
}

/** Turn one row into a terminal selection option. */
function rowOption(
  row: WorktreeShellRow,
  state: "current" | "available" | "unavailable",
): SelectionGroup<string>["items"][number] {
  const prefix = state === "current"
    ? "Current · "
    : state === "unavailable"
    ? "Checkout unavailable · "
    : "";
  return {
    id: `worktree:${row.path}`,
    name: row.name,
    description: `${prefix}${row.description}`,
    value: row.path,
    disabled: state !== "available",
  };
}

/** Build the complete grouped selection surface from one status survey. */
function selectionGroups(
  rows: readonly WorktreeShellRow[],
  availablePaths: ReadonlySet<string>,
  data: StatusData,
): SelectionGroup<string>[] {
  const current = rows.filter((row) => row.current);
  const available = rows.filter((row) =>
    !row.current && availablePaths.has(row.path)
  );
  const unavailable = rows.filter((row) =>
    !row.current && !availablePaths.has(row.path)
  );
  const unlanded = (data.unlanded_branches ?? []).map((branch) => ({
    id: `branch:${branch}`,
    name: branch,
    description:
      `No worktree checkout · Run discern start --from ${branch} to open one.`,
    value: `\x00branch:${branch}`,
    disabled: true,
  }));
  const contained = (data.contained_refs ?? []).map((entry) => ({
    id: `contained:${entry.branch}`,
    name: entry.branch,
    description:
      `Checkout reclaimed · Commits are contained in ${entry.contained_in}.`,
    value: `\x00contained:${entry.branch}`,
    disabled: true,
  }));
  return [
    {
      id: "worktrees-current",
      label: "Current checkout",
      items: current.map((row) => rowOption(row, "current")),
    },
    {
      id: "worktrees-available",
      label: "Worktrees",
      items: available.map((row) => rowOption(row, "available")),
    },
    {
      id: "worktrees-unavailable",
      label: "Unavailable checkouts",
      items: unavailable.map((row) => rowOption(row, "unavailable")),
    },
    {
      id: "worktrees-unlanded",
      label: "Branches without worktrees",
      items: unlanded,
    },
    {
      id: "worktrees-contained",
      label: "Reclaimed stage branches",
      items: contained,
    },
  ];
}

/** Canonicalize an existing path, retaining an absolute fallback for failures. */
async function canonicalPath(path: string): Promise<string> {
  return await realPathIfExists(path) ?? resolve(path);
}

/** Default terminal and process implementation. */
const DEFAULT_WORKTREES_RUNTIME: WorktreesRuntime = {
  canInteract: () => canInteract(false),
  findRoot: () => findRoot(),
  mainRepoPath: (root) => mainRepoPath(root),
  status: (root) => statusResult(root, { all: true }),
  canonicalPath,
  cwd: () => Deno.cwd(),
  isDirectory: directoryExists,
  makeOut: () => makeOut(colorEnabled()),
  error: (message) =>
    new Logger({ json: false, noColor: false }).error(message),
  select: (options) => requestSelection(options),
  shell: () => userShell(),
  launchShell: async (shell, cwd) =>
    (await runOwnedChild(shell, { cwd })).status.code,
  now: () => Date.now(),
};

/** Run the interactive worktree shell picker. */
export async function runWorktrees(
  opts: WorktreesOptions = {},
  runtime: WorktreesRuntime = DEFAULT_WORKTREES_RUNTIME,
): Promise<number> {
  if (opts.json ?? false) {
    emitResult({
      ok: false,
      verb: "worktrees",
      error: "invalid_arguments",
      message:
        "discern worktrees is interactive only. Run `discern status --all --json` to inspect the fleet.",
    });
    return 1;
  }
  if (!runtime.canInteract()) {
    runtime.error(
      "discern worktrees needs an interactive terminal (stdin and stdout TTYs). Run `discern status --all` to inspect the fleet.",
    );
    return 1;
  }
  const foundRoot = await runtime.findRoot();
  if (foundRoot === undefined) {
    runtime.error(NO_PROJECT_MESSAGE);
    return 1;
  }
  const currentRoot = await runtime.canonicalPath(foundRoot);
  const mainRoot = await runtime.mainRepoPath(currentRoot);
  const survey = await runtime.status(mainRoot ?? currentRoot);
  const out = runtime.makeOut();
  if (!survey.ok || survey.data === undefined) {
    out.error(survey.message ?? "The worktree fleet survey failed.");
    return 1;
  }
  const rows = buildWorktreeShellRows(
    survey.data.fleet ?? [],
    currentRoot,
    runtime.now(),
    {
      trunk: survey.data.fleet?.find((entry) => entry.is_main)?.branch ??
        survey.data.git?.trunk ?? "trunk",
      ...(survey.data.fleet_collisions === undefined
        ? {}
        : { fleetCollisions: survey.data.fleet_collisions }),
      ...(survey.data.adr_collisions === undefined
        ? {}
        : { adrCollisions: survey.data.adr_collisions }),
    },
  );
  const availability = await Promise.all(
    rows.map(async (row) =>
      [row.path, await runtime.isDirectory(row.path)] as const
    ),
  );
  const availablePaths = new Set(
    availability.filter(([, available]) => available).map(([path]) => path),
  );
  const targets = rows.filter((row) =>
    !row.current && availablePaths.has(row.path)
  );
  if (targets.length === 0) {
    out.info(
      "No other worktree checkout is available. Run `discern start` to create one.",
    );
    return 0;
  }

  const sourceCwd = await runtime.canonicalPath(runtime.cwd());
  const planned = equivalentDirectoryCandidates(
    currentRoot,
    sourceCwd,
    currentRoot,
  );
  const relativeLabel = displayRelative(planned.relativeDirectory);
  let selectedPath: string;
  try {
    selectedPath = await runtime.select({
      message: relativeLabel === "."
        ? "Choose a worktree to open at its project root"
        : `Choose a worktree to open at ${relativeLabel}`,
      options: groupedSelectionEntries(
        selectionGroups(rows, availablePaths, survey.data),
      ),
      search: rows.length > FILTER_THRESHOLD,
      ...(rows.length > FILTER_THRESHOLD ? { searchLabel: "filter" } : {}),
      hint: rows.length > FILTER_THRESHOLD
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return 0;
  }

  const selected = rows.find((row) => row.path === selectedPath);
  if (selected === undefined) {
    out.error("The selected worktree is no longer in the fleet survey.");
    return 1;
  }
  const destination = await resolveEquivalentDirectory(
    currentRoot,
    sourceCwd,
    selected.path,
    (path) => runtime.isDirectory(path),
  );
  if (destination === undefined) {
    out.error(
      `The selected worktree checkout is unavailable: ${
        terminalLine(selected.path)
      }. Run \`discern status --all\` to inspect the fleet again.`,
    );
    return 1;
  }
  if (!destination.exact) {
    const fallback = displayRelative(relative(selected.path, destination.path));
    out.warn(
      `${relativeLabel} is unavailable on ${
        terminalLine(selected.branch)
      }. Opening ${fallback}.`,
    );
  }
  const shell = runtime.shell();
  out.info(
    `Opening ${terminalLine(selected.branch)} at ${
      terminalLine(destination.path)
    }. Exit the shell to return to ${terminalLine(sourceCwd)}.`,
  );
  try {
    return await runtime.launchShell(shell, destination.path);
  } catch (error) {
    out.error(
      `Could not open ${terminalLine(shell)} in ${
        terminalLine(destination.path)
      }: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
