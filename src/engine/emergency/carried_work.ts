/** What an emergency lands beyond actual trunk, and whose recorded work is among it. */
import { INTEGRATION_BRANCH_NAMESPACE } from "../../shared/git_conventions.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { ParkedTaskMetadata } from "../../shared/task_metadata.ts";
import { short } from "../worktree/accept_support.ts";
import { listRegisteredWorktrees } from "../worktree/git.ts";
import { listParkedTaskMetadata } from "../worktree/parked_task_metadata.ts";
import { readSubmission } from "../worktree/submission.ts";
import { inspectTaskMetadata } from "../worktree/task_metadata.ts";

/** One commit the repair lands beyond actual trunk. */
export interface LandedCommit {
  readonly commit: string;
  readonly subject: string;
}

/** Another effort whose recorded unlanded revision lands with the repair. */
export interface CarriedEffort {
  readonly effort: string;
  readonly branch: string;
  /** The newest of its recorded revisions inside the repair. */
  readonly revision: string;
}

/** One other effort's recorded revisions, keyed by its branch. */
interface RecordedEffort {
  effort: string;
  readonly revisions: Set<string>;
}

const COMMIT_HEADER = /^commit ([0-9a-f]{40}|[0-9a-f]{64})$/;
const UNREADABLE_LANDING =
  "The commits between actual trunk and the repair could not be read. Restore repository access, then prepare a new emergency plan.";

/** Every commit the repair holds beyond actual trunk, newest first. Git
 * prints each commit as a header line followed by its subject line. */
export async function landedCommits(
  root: string,
  trunk: string,
  head: string,
): Promise<LandedCommit[]> {
  const run = await runGit(["rev-list", "--format=%s", `${trunk}..${head}`], {
    cwd: root,
  });
  if (!run.success) throw new Error(UNREADABLE_LANDING);
  const lines = run.stdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const commits: LandedCommit[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const commit = COMMIT_HEADER.exec(lines[index] ?? "")?.[1];
    const subject = lines[index + 1];
    if (commit === undefined || subject === undefined) {
      throw new Error(UNREADABLE_LANDING);
    }
    commits.push({ commit, subject });
  }
  return commits;
}

/**
 * Every other effort whose recorded revision lands with the repair: a
 * registered checkout's head, its submitted commit, a parked head, the tip
 * of a parked or task branch, or the commit the repair's task record says it
 * started from on another local branch. The repair's own branch and the
 * disposable integration copies are never another effort.
 */
export async function carriedEfforts(
  root: string,
  repair: { readonly branch: string; readonly worktree: string },
  branchPrefix: string,
  landed: readonly LandedCommit[],
): Promise<CarriedEffort[]> {
  const tips = await localBranchTips(root);
  const efforts = new Map<string, RecordedEffort>();
  const taskBranch = (branch: string): boolean =>
    branchPrefix !== "" && branch.startsWith(branchPrefix);
  const record = (
    branch: string,
    effort?: string,
  ): RecordedEffort | undefined => {
    if (
      branch === "" || branch === repair.branch ||
      branch.startsWith(INTEGRATION_BRANCH_NAMESPACE)
    ) return undefined;
    const entry = efforts.get(branch) ?? {
      effort: effort ??
        (taskBranch(branch) ? branch.slice(branchPrefix.length) : branch),
      revisions: new Set<string>(),
    };
    efforts.set(branch, entry);
    return entry;
  };
  for (const registration of await listRegisteredWorktrees(root)) {
    if (registration.isMain) continue;
    const entry = record(registration.branch);
    entry?.revisions.add(registration.head);
    if (entry === undefined || registration.prunable) continue;
    const read = await readSubmission(registration.path);
    if (read.status !== "submitted") continue;
    entry.effort = read.submission.effort_id;
    entry.revisions.add(read.submission.head);
  }
  for (const parked of await parkedTasks(root)) {
    record(parked.branch, parked.id)?.revisions.add(parked.head);
  }
  // The task record keeps the start point as given: a full branch ref, a
  // local branch name, or a tag or commit, which names no effort.
  const task = await inspectTaskMetadata(repair.worktree);
  const origin = task.kind === "recorded"
    ? task.metadata.created_from
    : undefined;
  const originBranch = origin === undefined
    ? undefined
    : origin.ref.startsWith("refs/heads/")
    ? origin.ref.slice("refs/heads/".length)
    : tips.has(origin.ref)
    ? origin.ref
    : undefined;
  if (origin !== undefined && originBranch !== undefined) {
    record(originBranch)?.revisions.add(origin.commit);
  }
  for (const [branch, tip] of tips) {
    if (efforts.has(branch) || taskBranch(branch)) {
      record(branch)?.revisions.add(tip);
    }
  }
  const order = new Map(landed.map(({ commit }, index) => [commit, index]));
  const carried: CarriedEffort[] = [];
  for (const [branch, { effort, revisions }] of efforts) {
    const revision = [...revisions].filter((candidate) => order.has(candidate))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0];
    if (revision !== undefined) carried.push({ effort, branch, revision });
  }
  return carried.sort((a, b) => a.branch.localeCompare(b.branch));
}

/** The refusal naming each other effort whose unlanded work the repair contains. */
export function carriedEffortsRefusal(
  carried: readonly CarriedEffort[],
): string {
  const named = carried.map(({ effort, branch, revision }) =>
    `${markdownCodeSpan(effort)} on branch ${markdownCodeSpan(branch)} at ${
      markdownCodeSpan(short(revision))
    }`
  ).join("; ");
  return `The repair contains unlanded work from ${
    carried.length === 1 ? "another effort" : "other efforts"
  }: ${named}. An emergency landing issues no Proof, so it lands only the repair's own work on actual trunk. Prepare a repair against actual trunk without that work, then prepare a new emergency plan.`;
}

/** Parked task records; an unreadable record refuses the plan. */
async function parkedTasks(root: string): Promise<ParkedTaskMetadata[]> {
  try {
    return await listParkedTaskMetadata(root);
  } catch (error) {
    throw new Error(
      `Parked task records could not be read: ${
        error instanceof Error ? error.message : String(error)
      } Run discern doctor, repair the metadata store, then prepare a new emergency plan.`,
      { cause: error },
    );
  }
}

/** Every local branch tip, read at once; an unreadable ref store refuses the plan. */
async function localBranchTips(root: string): Promise<Map<string, string>> {
  const run = await runGit(
    ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"],
    { cwd: root },
  );
  if (!run.success) {
    throw new Error(
      "Local branches could not be read. Restore repository access, then prepare a new emergency plan.",
    );
  }
  const tips = new Map<string, string>();
  for (const line of run.stdout.split("\n")) {
    const at = line.indexOf(" refs/heads/");
    if (at > 0) {
      tips.set(line.slice(at + " refs/heads/".length), line.slice(0, at));
    }
  }
  return tips;
}
