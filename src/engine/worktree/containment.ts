/**
 * The **contained-worktree scan** — the one home for the containment predicate,
 * shared by `worktree prune`'s offer, the `status` fleet survey, and the desk,
 * so no two surfaces can disagree on what "contained" means.
 *
 * A worktree is CONTAINED when every clause holds:
 *
 *  - its branch tip is a **strict** ancestor of another local branch's tip
 *    (equal tips are ambiguous twins, not containment — left alone);
 *  - its working tree is clean (no staged, unstaged, or untracked files —
 *    uncommitted work is not contained anywhere);
 *  - it is **idle**: no verb in flight per the logbook's begin/finish pairing
 *    when the logbook is on; with the logbook off, the git-derived activity
 *    timestamp must be at least {@link CONTAINED_QUIET_PERIOD_MS} old;
 *  - it is neither the main checkout nor the checkout running the scan.
 *
 * This is the spent-early-stage shape of a `start --from` train: every commit
 * the worktree holds already travels inside a live descendant branch, so the
 * CHECKOUT is redundant while the branch ref stays as cheap insurance. The
 * scan only ever reports facts — reclaiming is offer-only, behind an explicit
 * human confirmation, and never deletes a branch ref.
 *
 * The logbook read here is advisory in the constitutional sense: it only makes
 * the OFFER more conservative (an in-flight verb withholds the row); it never
 * decides an action — the human confirmation does — and a logbook-off install
 * gets the full feature through the weaker git-derived quiet period.
 */

import { runGit } from "../../shared/subprocess.ts";
import {
  type FleetWorktree,
  integrationBranch,
  listWorktreeFleet,
  parseWorktreeList,
} from "./git.ts";
import type { FleetLogbookActivity } from "../logbook/read.ts";

/** How long a worktree's git-derived activity must be quiet before the
 * logbook-off fallback calls it idle — deliberately the same floor as the
 * logbook's own minimum in-flight horizon, so both idle signals age alike. */
export const CONTAINED_QUIET_PERIOD_MS = 60 * 60 * 1000;

/** One contained worktree, with the evidence a human confirms against. */
export interface ContainedWorktree {
  /** The canonical checkout path (as git lists it). */
  path: string;
  /** The branch whose ref is KEPT if the checkout is reclaimed. */
  branch: string;
  /** The branch's tip sha at scan time. */
  tip: string;
  /** The nearest live descendant holding every commit of `branch`. */
  containingBranch: string;
  /** The containing branch's tip sha at scan time. */
  containingTip: string;
  /** Commits the containing branch is ahead of `branch` (always ≥ 1). */
  containerAhead: number;
}

/** The idle half of the containment predicate: true when nothing suggests the
 * worktree's branch is being worked on right now. */
export type ContainmentIdleCheck = (
  branch: string,
  lastActivityUnixSeconds: number | undefined,
) => boolean;

/**
 * Build the idle check from the logbook's fleet activity when the logbook is
 * on (`activity` present): a branch with a fresh unmatched begin event is in
 * flight, never offered. With the logbook off (`activity` undefined), fall
 * back to the git-derived activity timestamp with the conservative
 * {@link CONTAINED_QUIET_PERIOD_MS}; an unknowable timestamp fails safe as
 * "not idle".
 */
export function containmentIdleCheck(
  activity: FleetLogbookActivity | undefined,
  nowMs: number,
): ContainmentIdleCheck {
  if (activity !== undefined) {
    return (branch) => activity.byBranch.get(branch)?.running === undefined;
  }
  return (_branch, lastActivityUnixSeconds) =>
    lastActivityUnixSeconds !== undefined &&
    nowMs - lastActivityUnixSeconds * 1000 >= CONTAINED_QUIET_PERIOD_MS;
}

/**
 * Whether the checkout at `path` is PROVABLY clean: `git status` ran and
 * reported nothing. A failed read is "unknown", and unknown fails safe — the
 * checkout may hold anything, so it never qualifies for a forced removal.
 * The fleet snapshot applies the same rule; this second read revalidates the
 * destructive edge after the fleet survey.
 */
export async function treeProvablyClean(path: string): Promise<boolean> {
  const run = await runGit(
    ["status", "--porcelain", "-z", "--untracked-files=normal"],
    { cwd: path },
  );
  return run.success && run.stdout.trim() === "";
}

/** The short branch names currently checked out in registered worktrees. */
async function checkoutHoldingBranches(
  repoRoot: string,
): Promise<Set<string>> {
  const run = await runGit(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  const held = new Set<string>();
  if (!run.success) {
    return held;
  }
  for (const rec of parseWorktreeList(run.stdout)) {
    if (rec.branch.startsWith("refs/heads/")) {
      held.add(rec.branch.slice("refs/heads/".length));
    }
  }
  return held;
}

/** Every local branch's tip sha, in one `for-each-ref` read. */
async function localBranchTips(
  repoRoot: string,
): Promise<Map<string, string>> {
  const run = await runGit(
    ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"],
    { cwd: repoRoot },
  );
  const tips = new Map<string, string>();
  if (!run.success) {
    return tips;
  }
  for (const line of run.stdout.split("\n")) {
    const at = line.lastIndexOf(" ");
    if (at <= 0) {
      continue;
    }
    tips.set(line.slice(0, at), line.slice(at + 1));
  }
  return tips;
}

/**
 * Every local branch whose tip holds `commit` (equal tips included), in ONE
 * ref scan — ancestry for a whole candidate set at the cost of a single git
 * read, so a growing fleet never multiplies per-pair probes. A failed read
 * returns the empty set, which fails safe: no containment is claimed.
 */
async function branchesContaining(
  repoRoot: string,
  commit: string,
): Promise<Set<string>> {
  const run = await runGit(
    [
      "for-each-ref",
      "--format=%(refname:short)",
      "--contains",
      commit,
      "refs/heads",
    ],
    { cwd: repoRoot },
  );
  const out = new Set<string>();
  if (!run.success) {
    return out;
  }
  for (const line of run.stdout.split("\n")) {
    const name = line.trim();
    if (name !== "") {
      out.add(name);
    }
  }
  return out;
}

/** The strict-container candidates for `tip` among `containing`: never the
 * branch itself or the trunk, and never an equal-tip twin (ambiguous, not
 * evidence). Candidates must exist in the `tips` snapshot, so a ref created
 * mid-scan cannot be measured against stale data. */
function strictContainers(
  containing: ReadonlySet<string>,
  branch: string,
  trunk: string,
  tip: string,
  tips: ReadonlyMap<string, string>,
): string[] {
  return [...containing].filter((candidate) => {
    const candidateTip = tips.get(candidate);
    return candidate !== branch && candidate !== trunk &&
      candidateTip !== undefined && candidateTip !== tip;
  });
}

/** Measure each candidate's lead over `tip` concurrently and keep the NEAREST:
 * fewest commits ahead, ties broken by branch name for determinism. */
async function nearestContainer(
  repoRoot: string,
  tip: string,
  candidates: readonly string[],
  tips: ReadonlyMap<string, string>,
): Promise<{ branch: string; tip: string; ahead: number } | undefined> {
  const measured = await Promise.all(
    candidates.map(async (branch) => {
      const candidateTip = tips.get(branch) ?? "";
      return {
        branch,
        tip: candidateTip,
        ahead: await countAhead(repoRoot, tip, candidateTip),
      };
    }),
  );
  let nearest: { branch: string; tip: string; ahead: number } | undefined;
  for (const candidate of measured) {
    if (
      nearest === undefined || candidate.ahead < nearest.ahead ||
      (candidate.ahead === nearest.ahead && candidate.branch < nearest.branch)
    ) {
      nearest = candidate;
    }
  }
  return nearest;
}

/** Commits reachable from `to` but not `from` — the container's lead. */
async function countAhead(
  repoRoot: string,
  from: string,
  to: string,
): Promise<number> {
  const run = await runGit(["rev-list", "--count", `${from}..${to}`], {
    cwd: repoRoot,
  });
  const n = Number(run.stdout.trim());
  return run.success && Number.isFinite(n) ? n : 0;
}

/** Options for {@link scanContainedWorktrees}. */
export interface ContainmentScanOptions {
  /** The trunk (`[repository].trunk`) — never a candidate, never a container. */
  mainBranch?: string | undefined;
  /** Canonical path of the checkout running the scan — never a candidate. */
  currentPath: string;
  /** A fleet survey already in hand (else one is read). */
  fleet?: FleetWorktree[];
  /** The idle half of the predicate ({@link containmentIdleCheck}). */
  idle: ContainmentIdleCheck;
}

/**
 * Scan the registered worktrees for contained ones. Read-only; the returned
 * facts carry the tip shas and the container's ahead-count so a human confirms
 * against evidence rather than a bare branch name. In a `start --from` train
 * (A → B → C) the containing branch reported for each spent stage is its
 * NEAREST live descendant (A reports B, not C).
 */
export async function scanContainedWorktrees(
  repoRoot: string,
  opts: ContainmentScanOptions,
): Promise<ContainedWorktree[]> {
  const mainBranch = integrationBranch(opts.mainBranch);
  const fleet = opts.fleet ?? await listWorktreeFleet(repoRoot, mainBranch);
  const tips = await localBranchTips(repoRoot);

  // The cheap, already-in-hand clauses first; each survivor then pays exactly
  // two git reads (the qualifying status, the one ancestry scan), and the
  // survivors are read concurrently — the scan's cost stays one round of
  // parallel reads however large the fleet grows.
  const candidates = fleet.filter((row) => {
    if (row.isMain || row.path === opts.currentPath) {
      return false; // never the main checkout, never the scanner's own checkout
    }
    if (row.locked || row.prunable) {
      return false; // git refuses to remove locked; stale metadata has its own path
    }
    // An unreadable checkout's state is UNKNOWN — fail safe, never "clean".
    if (row.snapshot === undefined || !row.snapshot.clean) {
      return false;
    }
    if (row.branch === "" || row.branch === mainBranch) {
      return false;
    }
    if (tips.get(row.branch) === undefined) {
      return false;
    }
    return opts.idle(row.branch, row.snapshot.lastActivity);
  });

  const found = await Promise.all(candidates.map(async (row) => {
    const tip = tips.get(row.branch);
    if (tip === undefined) {
      return undefined;
    }
    // The snapshot's `clean` is the cheap pre-filter; the qualifying read proves
    // the state again at the destructive edge.
    if (!(await treeProvablyClean(row.path))) {
      return undefined;
    }
    const containing = await branchesContaining(repoRoot, tip);
    // A tip reachable from the trunk is the LANDED class — the fully-merged
    // prune path owns it; containment is strictly about unlanded work.
    if (containing.has(mainBranch)) {
      return undefined;
    }
    // Strict containers: another local branch whose tip differs and holds
    // every commit of this one. Equal tips are ambiguous twins — not evidence.
    const nearest = await nearestContainer(
      repoRoot,
      tip,
      strictContainers(containing, row.branch, mainBranch, tip, tips),
      tips,
    );
    if (nearest === undefined) {
      return undefined;
    }
    return {
      path: row.path,
      branch: row.branch,
      tip,
      containingBranch: nearest.branch,
      containingTip: nearest.tip,
      containerAhead: nearest.ahead,
    };
  }));
  return found.filter((fact) => fact !== undefined);
}

/** The nearest checkout-holding strict container of `tip`, from shared reads. */
async function nearestHeldContainer(
  repoRoot: string,
  tip: string,
  branch: string,
  trunk: string,
  tips: ReadonlyMap<string, string>,
  held: ReadonlySet<string>,
): Promise<string | undefined> {
  const containing = await branchesContaining(repoRoot, tip);
  const candidates = strictContainers(containing, branch, trunk, tip, tips)
    .filter((candidate) => held.has(candidate));
  return (await nearestContainer(repoRoot, tip, candidates, tips))?.branch;
}

/**
 * The nearest branch strictly containing `branch`'s tip AND holding a
 * registered checkout, or undefined — the pointer `await --green` uses when a
 * branch's own checkout is gone. Only a checkout can ever record a proof,
 * so a ref-only container (another reclaimed stage) would be an equally
 * impossible target; the pointer skips past it to a stage that can answer.
 */
export async function nearestContainingBranch(
  repoRoot: string,
  branch: string,
  mainBranch?: string,
): Promise<string | undefined> {
  const trunk = integrationBranch(mainBranch);
  const tips = await localBranchTips(repoRoot);
  const held = await checkoutHoldingBranches(repoRoot);
  const tip = tips.get(branch);
  if (tip === undefined) {
    return undefined;
  }
  return await nearestHeldContainer(repoRoot, tip, branch, trunk, tips, held);
}

/**
 * Classify worktree-less refs by containment: for each of `branches`, the
 * nearest checkout-holding branch strictly containing its tip, when one
 * exists. This is how the "unlanded branch with no worktree" surface tells a
 * CONTAINED ref — a spent train stage kept deliberately by the reclaim, whose
 * commits ride inside the named live branch until they land — from genuinely
 * dangling abandoned work. A ref with no live container stays unclassified
 * (dangling), which fails safe: it keeps the abandoned-work warning.
 */
export async function containedRefPointers(
  repoRoot: string,
  branches: readonly string[],
  mainBranch?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (branches.length === 0) {
    return out;
  }
  const trunk = integrationBranch(mainBranch);
  const [tips, held] = await Promise.all([
    localBranchTips(repoRoot),
    checkoutHoldingBranches(repoRoot),
  ]);
  const pointers = await Promise.all(branches.map(async (branch) => {
    const tip = tips.get(branch);
    if (tip === undefined) {
      return undefined;
    }
    const container = await nearestHeldContainer(
      repoRoot,
      tip,
      branch,
      trunk,
      tips,
      held,
    );
    return container === undefined ? undefined : { branch, container };
  }));
  for (const pointer of pointers) {
    if (pointer !== undefined) {
      out.set(pointer.branch, pointer.container);
    }
  }
  return out;
}
