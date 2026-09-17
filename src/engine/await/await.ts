/**
 * `await`: block until a fleet condition holds, then answer with the observed
 * state and the sensible next step — so a dependent agent spends one call
 * waiting instead of guessing at poll intervals.
 *
 * Three conditions, one per call:
 *  - `--green <worktree>` — the selected worktree holds an honored gate proof
 *    (or a durable proof note proves its work landed);
 *  - `--landed <worktree>` — the selected branch's work is reachable from the trunk. The
 *    freshest observed tip follows the live branch, then outlives the ref when
 *    acceptance deletes it;
 *  - `--trunk-moved` — the trunk ref differs from its position at call start.
 *
 * The architectural line (the logbook's advisory-only constitution): every
 * condition grounds in AUTHORITATIVE state — git ancestry for "landed", the
 * gate proof for "green" — while the logbook serves only as a wake signal
 * (every verb completion anywhere in the fleet is one append to one file).
 * History never decides truth, and `await` gates nothing: it blocks only its
 * own caller, at the caller's request.
 *
 * Timing out is NOT a failure: the envelope stays `ok: true` with `met: false`
 * and carries a short continuation handle plus the longest reliable next-call
 * bound. Repository-local state behind that handle keeps the branch's latest
 * observed tip and landing transition, or the original trunk baseline, across
 * transport slices. The CLI still exits {@link AWAIT_TIMEOUT_EXIT_CODE} on
 * "not yet" so `discern await … && discern update` composes in a shell,
 * without the envelope calling the wait a defect.
 *
 * The verdict remains observational: continuation state changes no project
 * file, ref, proof, or condition truth. It lives under the Git common dir,
 * shared by sibling worktrees and reaped by age and capacity. `await` needs no
 * daemon. It IS begin-recorded (deliberately not a pure-observation verb), so a
 * blocked agent's fleet row reads `running: await` while it holds.
 */

import { join } from "@std/path";
import {
  awaitConditionDescription,
  awaitObservationSentence,
} from "../../shared/await_prose.ts";
import {
  type ProgressWaitScope,
  withProgressWait,
} from "../completion/progress_wait.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  AWAIT_CONDITIONS,
  type AwaitConditionKind,
  type AwaitData,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import {
  type CommandRef,
  discernCommand,
  flag,
  renderCommandRefsCli,
} from "../../shared/command_reference.ts";
import {
  failureRecoveryHintTexts,
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import {
  commitIsAncestorOf,
  commitIsMerged,
  incomingOverlap,
  integrationBranch,
  localBranchExists,
  refMergedState,
  resolveCommitRef,
  resolveCommonGitDir,
  worktreeGitKey,
} from "../worktree/git.ts";
import { inspectGateProof } from "../gate/proof.ts";
import {
  findLandedProofNoteForBranch,
  findLatestLandedProofNoteForBranch,
  type LandedProofNote,
} from "../gate/proof_notes.ts";
import { nearestContainingBranch } from "../worktree/containment.ts";
import {
  conventionalBranchForWorktreeId,
  resolveWorktreeTarget,
  worktreePathForEffortBranch,
  WorktreeTargetError,
} from "../worktree/target_resolution.ts";
import { logbookDir } from "../logbook/store.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { observedGateOperation } from "../gate/observed_operation.ts";
import { createGateProgressPresenter } from "../gate/progress_presenter.ts";
import {
  AWAIT_CALL_SECONDS,
  type AwaitCallProfile,
} from "../../shared/mcp_timeout_policy.ts";
import { experimentalAwaitCallSeconds } from "../../shared/experimental.ts";
import type { EnvReader } from "../../shared/env.ts";
import { bestEffort, bestEffortSync } from "../../shared/best_effort.ts";
import { pathExists } from "../../shared/fs_presence.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

import { AWAIT_POLL_INTERVAL_MS, AWAIT_TIMEOUT_EXIT_CODE } from "./defaults.ts";
import {
  readContinuation,
  removeContinuation,
  saveContinuation,
} from "../continuations/store.ts";

export {
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_STRICT_CALL_SECONDS,
  AWAIT_TIMEOUT_EXIT_CODE,
} from "./defaults.ts";

/** Cap on the overlap preview a met condition attaches — matches the bounded
 * hot-zone read `status` reports, enough to name the files worth re-reading. */
const AWAIT_OVERLAP_CAP = 20;

/** Options for one `await` call. Exactly one condition must be set. */
export interface AwaitOptions {
  /** Wait for this branch's worktree to hold an honored gate proof. */
  green?: string;
  /** Wait for this branch's work to become reachable from the trunk. */
  landed?: string;
  /** Wait for the trunk ref to move from its position at call start. */
  trunkMoved?: boolean;
  /** Continue a previous not-met wait without resetting its pinned state.
   * Mutually exclusive with the three condition options. */
  resume?: string;
  /** Seconds before answering "not yet". Omit for the caller profile's longest
   * safe bound; 0 evaluates once and answers immediately. */
  timeoutSeconds?: number;
  /** Test seam: the polling fallback cadence ({@link AWAIT_POLL_INTERVAL_MS}). */
  pollIntervalMs?: number;
  /** Monotonic clock for the elapsed wait bound. */
  clock?: Clock;
  /** Timer lifecycle for the polling fallback. */
  scheduler?: Scheduler;
}

/** Surface context that selects a transport-safe duration for one call. */
export interface AwaitExecutionContext {
  callProfile: AwaitCallProfile;
  /** Test seam for the environment consulted by the experimental cap. */
  env?: EnvReader;
}

/** Versioned state saved behind one short continuation handle. */
interface AwaitContinuationPayload {
  version: typeof ON_DISK_FORMATS.awaitContinuation.version;
  condition: AwaitConditionKind;
  branch?: string;
  trunk: string;
  tip?: string;
  trunk_start: string;
  branch_ever_unreachable?: boolean;
}

const AWAIT_CONTINUATION_KEYS = new Set([
  "version",
  "condition",
  "branch",
  "trunk",
  "tip",
  "trunk_start",
  "branch_ever_unreachable",
]);

/** Narrow unknown input to one of the closed continuation wait conditions. */
function isAwaitCondition(value: unknown): value is AwaitConditionKind {
  return AWAIT_CONDITIONS.some((condition) => condition === value);
}

/** Validate persisted wait targets, condition, and progress needed to resume polling. */
function parseAwaitContinuationPayload(
  decoded: unknown,
): AwaitContinuationPayload | undefined {
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    return undefined;
  }
  const value = decoded as Record<string, unknown>;
  if (Object.keys(value).some((key) => !AWAIT_CONTINUATION_KEYS.has(key))) {
    return undefined;
  }
  if (
    value.version !== ON_DISK_FORMATS.awaitContinuation.version ||
    !isAwaitCondition(value.condition) ||
    typeof value.trunk !== "string" ||
    value.trunk === "" ||
    typeof value.trunk_start !== "string" ||
    value.trunk_start === ""
  ) {
    return undefined;
  }
  const branch = value.branch;
  const tip = value.tip;
  const branchEverUnreachable = value.branch_ever_unreachable;
  if (value.condition === "trunk-moved") {
    if (
      branch !== undefined ||
      tip !== undefined ||
      branchEverUnreachable !== undefined
    ) {
      return undefined;
    }
  } else if (
    typeof branch !== "string" ||
    branch === "" ||
    typeof tip !== "string" ||
    tip === ""
  ) {
    return undefined;
  } else if (typeof branchEverUnreachable !== "boolean") {
    return undefined;
  }
  return {
    version: ON_DISK_FORMATS.awaitContinuation.version,
    condition: value.condition,
    ...(typeof branch === "string" ? { branch } : {}),
    trunk: value.trunk,
    ...(typeof tip === "string" ? { tip } : {}),
    trunk_start: value.trunk_start,
    ...(typeof branchEverUnreachable === "boolean"
      ? { branch_ever_unreachable: branchEverUnreachable }
      : {}),
  };
}

/** One condition evaluation: the verdict now, and the state behind it. */
interface Evaluation {
  met: boolean;
  observed: AwaitData["observed"];
  /** How the condition was satisfied — landing satisfies `green` too, and the
   * next-step hint differs (`update` vs `update --from`). */
  via?: "proof" | "landed" | "trunk";
}

/** Build a failed await result with the recovery hint appropriate to its cause. */
function refusal(
  error:
    | "invalid_arguments"
    | "no_repository"
    | "no_trunk"
    | "read_failed"
    | "unknown_target"
    | "write_denied",
  message: string,
  hints: string[],
): DiscernResult<AwaitData> {
  return { ok: false, verb: "await", error, message, hints };
}

/**
 * Wait for wake signals until `deadlineMs`: any filesystem event under
 * `watchPaths` (the logbook — one append per verb completion anywhere in the
 * fleet — and the git refs), a `pollMs` tick, or `signal` aborting. The caller
 * re-evaluates after every wake; a watcher that cannot start (or a platform
 * that drops events) degrades to the polling cadence alone.
 */
async function waitForWakes(
  evaluate: () => Promise<boolean>,
  watchPaths: string[],
  deadlineMs: number,
  pollMs: number,
  clock: Clock,
  scheduler: Scheduler,
  signal?: AbortSignal,
): Promise<"met" | "timeout"> {
  if (await evaluate()) {
    return "met";
  }
  let finished = false;
  let wake: (() => void) | undefined;
  const kick = (): void => {
    wake?.();
  };
  let watcher: Deno.FsWatcher | undefined;
  try {
    watcher = watchPaths.length > 0 ? Deno.watchFs(watchPaths) : undefined;
  } catch {
    // discern-best-effort: await-watcher-open-fallback
    watcher = undefined; // watching is best-effort; polling carries the wait
  }
  const pump = (async (): Promise<void> => {
    if (watcher === undefined) {
      return;
    }
    await bestEffort("await-watcher-pump-fallback", async () => {
      for await (const _event of watcher) {
        if (finished) {
          break;
        }
        kick();
      }
    });
  })();
  signal?.addEventListener("abort", kick, { once: true });
  try {
    while (true) {
      if (signal?.aborted === true || clock.monotonicNow() >= deadlineMs) {
        return "timeout";
      }
      const waitMs = Math.min(pollMs, deadlineMs - clock.monotonicNow());
      await new Promise<void>((resolve) => {
        const timer = scheduler.scheduleTimeout(() => {
          wake = undefined;
          resolve();
        }, waitMs);
        wake = (): void => {
          scheduler.cancelTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
      if (await evaluate()) {
        return "met";
      }
    }
  } finally {
    finished = true;
    signal?.removeEventListener("abort", kick);
    bestEffortSync("await-watcher-close", () => {
      watcher?.close();
    });
    await pump;
  }
}

/** The existing subset of candidate watch paths — `Deno.watchFs` refuses a
 * missing path outright, and an absent one (no packed-refs yet, logbook off)
 * is simply not a wake source. */
async function existingPaths(candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of candidates) {
    let exists = false;
    try {
      exists = await pathExists(path);
    } catch {
      // discern-best-effort: await-watch-path-presence-fallback
    }
    if (exists) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Preview what `discern update` (from `sourceRef`) would bring into THIS
 * checkout once the condition is met: how far behind it sits and which of its
 * own files the incoming work also touched — the hot zone to re-read. Only a
 * linked worktree gets one (the main checkout has nothing to update onto);
 * best-effort, because the preview decorates the answer and never gates it.
 */
async function updatePreview(
  root: string,
  sourceRef: string,
): Promise<Partial<AwaitData["observed"]>> {
  try {
    if (await worktreeGitKey(root) === undefined) {
      return {};
    }
    const merged = await refMergedState(root, sourceRef);
    if (merged.already) {
      return { behind: 0 };
    }
    const o = await incomingOverlap(root, sourceRef, AWAIT_OVERLAP_CAP);
    return {
      behind: merged.behind,
      overlap_total: o.total,
      ...(o.total > 0 ? { incoming_overlap: o.overlap } : {}),
    };
  } catch {
    // discern-best-effort: await-update-preview-fallback
    return {};
  }
}

interface AwaitTiming {
  timeoutSeconds: number;
  timeoutBasis: NonNullable<AwaitData["timeout_basis"]>;
  requestedTimeoutSeconds?: number;
  retrySeconds: number;
  retryBasis: NonNullable<AwaitData["retry_basis"]>;
}

/**
 * Choose the longest reliable call for this surface. A condition returns early,
 * so repository duration estimates cannot improve on the transport-safe maximum;
 * shorter evidence-priced calls only add round trips. An explicit CLI bound is
 * uncapped. MCP bounds above the known profile are sliced, with the continuation
 * preserving the original question. An environment-supplied experimental cap
 * may shorten the profile's bound — never lengthen it — so a user can trade
 * extra lossless slices for calls that end inside a chosen window.
 */
function awaitTiming(
  requested: number | undefined,
  profile: AwaitCallProfile,
  env: EnvReader = Deno.env,
): AwaitTiming {
  const transportSeconds = AWAIT_CALL_SECONDS[profile];
  const cap = experimentalAwaitCallSeconds(env);
  const capped = cap !== undefined && cap < transportSeconds;
  const profileSeconds = capped ? cap : transportSeconds;
  const profileBasis: AwaitTiming["timeoutBasis"] = capped
    ? "cache-window"
    : profile;
  if (requested === undefined) {
    return {
      timeoutSeconds: profileSeconds,
      timeoutBasis: profileBasis,
      retrySeconds: profileSeconds,
      retryBasis: profileBasis,
    };
  }
  if (requested === 0) {
    return {
      timeoutSeconds: 0,
      timeoutBasis: "explicit",
      retrySeconds: profileSeconds,
      retryBasis: profileBasis,
    };
  }
  if (profile === "cli" || requested <= profileSeconds) {
    return {
      timeoutSeconds: requested,
      timeoutBasis: "explicit",
      retrySeconds: Math.max(1, Math.ceil(requested)),
      retryBasis: "explicit",
    };
  }
  return {
    timeoutSeconds: profileSeconds,
    timeoutBasis: profileBasis,
    requestedTimeoutSeconds: requested,
    retrySeconds: profileSeconds,
    retryBasis: profileBasis,
  };
}

/** The exact call that continues this question without resetting its pins. */
function retryCommand(
  resume: string,
  seconds: number,
): CommandRef {
  return discernCommand(
    "await",
    flag("resume", resume),
    flag("timeout", `${seconds}`),
  );
}

/** The one-line "what is still untrue" for the "not yet" hint. */
function notYetSummary(
  condition: AwaitConditionKind,
  branch: string | undefined,
  trunk: string,
  observed: AwaitData["observed"],
): string {
  if (condition === "green") {
    const status = observed.proof_status;
    const detail = status === "no-worktree"
      ? "no checkout holds it"
      : `Proof ${status ?? "unreadable"}`;
    return `\`${branch}\` has no valid Proof yet (${detail})`;
  }
  if (condition === "landed") {
    return `the work from \`${branch}\` has not reached \`${trunk}\` yet`;
  }
  return `\`${trunk}\` has not moved yet`;
}

/**
 * Compute the `await` {@link DiscernResult}: validate the single condition,
 * pin the at-start state, then hold — woken by the logbook and the git refs,
 * re-checked on a slow poll — until the condition is met, the timeout lapses,
 * or `signal` aborts (an abort answers early with the honest "not yet"). The
 * one entry point the MCP tool renders and the CLI's `--json` serializes.
 */
export async function awaitResult(
  root: string,
  opts: AwaitOptions = {},
  signal?: AbortSignal,
  context: AwaitExecutionContext = { callProfile: "cli" },
): Promise<DiscernResult<AwaitData>> {
  const picked: AwaitConditionKind[] = [
    ...(opts.green !== undefined ? ["green" as const] : []),
    ...(opts.landed !== undefined ? ["landed" as const] : []),
    ...(opts.trunkMoved === true ? ["trunk-moved" as const] : []),
  ];
  if (
    (opts.resume === undefined && picked.length !== 1) ||
    (opts.resume !== undefined && picked.length !== 0)
  ) {
    return refusal(
      "invalid_arguments",
      "Pass exactly one condition (--green <worktree>, --landed <worktree>, or --trunk-moved), or pass --resume by itself.",
      failureRecoveryHintTexts("await"),
    );
  }
  if (
    opts.timeoutSeconds !== undefined &&
    (!Number.isFinite(opts.timeoutSeconds) || opts.timeoutSeconds < 0)
  ) {
    return refusal(
      "invalid_arguments",
      "--timeout must be a non-negative number of seconds.",
      failureRecoveryHintTexts("await"),
    );
  }

  const cfg = await loadConfig(root);
  const trunk = integrationBranch(cfg.repository.trunk);
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return refusal(
      "no_repository",
      "Not inside a git repository — `await` watches git state, so there is nothing to watch here.",
      failureRecoveryHintTexts("await"),
    );
  }
  if (!(await localBranchExists(root, trunk))) {
    return refusal(
      "no_trunk",
      `The trunk branch \`${trunk}\` does not exist locally, so no fleet condition can be observed against it.`,
      hintTexts([fire(HINTS["await-trunk-missing"], { trunk })]),
    );
  }
  const callerHasWorktree = await worktreeGitKey(root) !== undefined;

  let resumed: AwaitContinuationPayload | undefined;
  let resumeHandle: string | undefined;
  if (opts.resume !== undefined) {
    const stored = await readContinuation(root, opts.resume);
    if (stored.kind === "invalid-handle") {
      return refusal(
        "invalid_arguments",
        "The `--resume` handle has a typo or an incompatible format.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.kind === "missing") {
      return refusal(
        "invalid_arguments",
        "The `--resume` handle was not found in this repository or has expired. Restart the watch with its condition.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.kind === "corrupt") {
      return refusal(
        "read_failed",
        "discern couldn't read the saved `--resume` handle. Restart the watch with its condition.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.kind === "newer") {
      return refusal(
        "read_failed",
        stored.reason,
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.kind === "unavailable") {
      return refusal(
        "read_failed",
        "discern couldn't open continuation state in Git's administrative directory. Check that the Git directory is readable, then retry the same `--resume` handle.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.record.kind !== "await") {
      return refusal(
        "invalid_arguments",
        "The `--resume` handle belongs to a different discern operation.",
        failureRecoveryHintTexts("await"),
      );
    }
    const payloadVersion = inspectOnDiskRecordVersion(
      "awaitContinuation",
      stored.record.payload,
    );
    if (payloadVersion.status === "newer") {
      return refusal(
        "read_failed",
        newerOnDiskFormatMessage(
          "awaitContinuation",
          payloadVersion.found,
        ),
        failureRecoveryHintTexts("await"),
      );
    }
    resumed = parseAwaitContinuationPayload(stored.record.payload);
    if (resumed === undefined) {
      return refusal(
        "read_failed",
        "discern couldn't read the saved `--resume` handle. Restart the watch with its condition.",
        failureRecoveryHintTexts("await"),
      );
    }
    resumeHandle = stored.handle;
  }
  if (resumed !== undefined && resumed.trunk !== trunk) {
    return refusal(
      "invalid_arguments",
      "The `--resume` handle belongs to a different trunk branch.",
      failureRecoveryHintTexts("await"),
    );
  }
  const condition = resumed?.condition ?? picked[0];
  if (condition === undefined) {
    return refusal(
      "invalid_arguments",
      "Pass one await condition or a continuation handle.",
      failureRecoveryHintTexts("await"),
    );
  }

  // A fresh branch condition seeds the branch state. Evaluations follow its
  // tip while the ref lives; a continuation restores the last observation
  // after acceptance may have deleted that ref.
  let branch = resumed?.branch ??
    (condition === "green" ? opts.green : opts.landed);
  const suppliedBranch = branch;
  let tip: string | undefined;
  let recoveredLanding: LandedProofNote | undefined;
  if (resumed !== undefined) {
    tip = resumed.tip;
  } else if (branch !== undefined) {
    try {
      const resolved = await resolveWorktreeTarget(root, branch, {
        cwd: root,
        mode: "branch",
        command: "discern await",
      });
      if (resolved.branch !== undefined) {
        branch = resolved.branch;
        tip = resolved.commit;
      } else {
        // A managed checkout mid-candidate-installation is detached; its
        // durable effort identity still names the branch to watch. An
        // unmanaged detached target has no such identity — refuse rather
        // than publish a handle its own reader would reject.
        const durable = resolved.id === undefined
          ? undefined
          : await conventionalBranchForWorktreeId(root, resolved.id);
        if (
          durable === undefined || !(await localBranchExists(root, durable))
        ) {
          return refusal(
            "invalid_arguments",
            `'${suppliedBranch}' names a detached checkout with no durable effort branch. Pass the branch to watch, then re-run discern await.`,
            failureRecoveryHintTexts("await"),
          );
        }
        branch = durable;
        tip = await resolveCommitRef(root, `refs/heads/${durable}`);
      }
    } catch (error) {
      if (error instanceof WorktreeTargetError) {
        return refusal(
          "invalid_arguments",
          error.message,
          failureRecoveryHintTexts("await"),
        );
      }
      throw error;
    }
  }
  if (resumed === undefined && branch !== undefined && tip === undefined) {
    try {
      tip = await resolveCommitRef(root, `refs/heads/${branch}`);
    } catch {
      // Acceptance can remove the ref between the caller choosing it and this
      // first read. Its durable note is the only branch-bound recovery.
      const conventional = suppliedBranch === undefined
        ? undefined
        : await conventionalBranchForWorktreeId(root, suppliedBranch);
      const proofBranches = [
        ...new Set([
          branch,
          ...(conventional === undefined ? [] : [conventional]),
        ]),
      ];
      const recovered =
        (await Promise.all(proofBranches.map(async (candidate) => ({
          branch: candidate,
          note: await findLatestLandedProofNoteForBranch(
            root,
            candidate,
            trunk,
          ),
        })))).filter((candidate) => candidate.note !== undefined);
      if (recovered.length > 1) {
        return refusal(
          "invalid_arguments",
          `'${suppliedBranch}' identifies accepted work for more than one branch (${
            recovered.map((candidate) => candidate.branch).join(" and ")
          }). Pass the intended full local branch ref, then re-run discern await.`,
          failureRecoveryHintTexts("await"),
        );
      }
      const recoveredMatch = recovered[0];
      if (recoveredMatch !== undefined) {
        branch = recoveredMatch.branch;
        recoveredLanding = recoveredMatch.note;
      }
      if (recoveredLanding === undefined) {
        return refusal(
          "unknown_target",
          `Branch \`${branch}\` was not found in this repository, and no accepted proof identifies its work on \`${trunk}\`.`,
          hintTexts([fire(HINTS["await-branch-missing"], { branch, trunk })]),
        );
      }
      tip = recoveredLanding.commit;
    }
  }
  // `green` needs a checkout for the proof to ever be recorded in: it lives
  // in per-worktree state and dies with the worktree (a contained checkout
  // reclaimed by `worktree prune --contained` is the usual shape). A branch
  // with no worktree at call start therefore cannot meet the condition —
  // waiting would be dishonest, so refuse and point at the target that can
  // answer: the containing branch when one exists, else `--landed`.
  if (
    resumed === undefined &&
    recoveredLanding === undefined &&
    condition === "green" &&
    branch !== undefined &&
    tip !== undefined
  ) {
    if (await worktreePathForEffortBranch(root, branch) === undefined) {
      const containing = await nearestContainingBranch(root, branch, trunk);
      return refusal(
        "unknown_target",
        `No checkout holds branch \`${branch}\` — its worktree was reclaimed ` +
          `or removed, and a gate Proof can only be recorded inside one, so ` +
          `\`--green ${branch}\` can never be met.`,
        hintTexts([
          fire(HINTS["await-green-no-worktree"], {
            branch,
            trunk,
            containing,
            reachable: await commitIsMerged(root, tip, trunk),
          }),
        ]),
      );
    }
  }
  const timing = awaitTiming(
    opts.timeoutSeconds,
    context.callProfile,
    context.env,
  );
  const timeoutSeconds = timing.timeoutSeconds;
  const timeoutBasis = timing.timeoutBasis;
  const trunkStart = resumed?.trunk_start ??
    await resolveCommitRef(root, `refs/heads/${trunk}`);
  // A branch landing is TRANSITION-based: only work observed unreachable and
  // later reachable counts without a proof note. A freshly forked branch's
  // tip already belongs to the trunk, so it cannot release a dependent before
  // the branch commits any work. The state follows later branch tips and
  // survives continuation boundaries.
  const branchState = condition !== "trunk-moved" && tip !== undefined
    ? {
      tip,
      everUnreachable: resumed?.branch_ever_unreachable ??
        !(await commitIsMerged(root, tip, trunk)),
    }
    : undefined;

  // Every continuation is validated against its own reader before
  // publication: a handle whose payload the resume parser would reject must
  // never reach the caller as a usable-looking `--resume` value.
  const continuationPayload = (): AwaitContinuationPayload | undefined => {
    const currentTip = branchState?.tip ?? tip;
    return parseAwaitContinuationPayload({
      version: ON_DISK_FORMATS.awaitContinuation.version,
      condition,
      ...(branch !== undefined ? { branch } : {}),
      trunk,
      ...(currentTip !== undefined ? { tip: currentTip } : {}),
      trunk_start: trunkStart,
      ...(branchState !== undefined
        ? { branch_ever_unreachable: branchState.everUnreachable }
        : {}),
    });
  };
  const unpublishable = (): DiscernResult<AwaitData> =>
    refusal(
      "invalid_arguments",
      "discern cannot save a resumable handle for this watch because its target has no durable branch. Re-run discern await with the branch to watch.",
      failureRecoveryHintTexts("await"),
    );

  let last: Evaluation = { met: false, observed: {} };
  let activeWait: ProgressWaitScope | undefined;
  const describeWait = (): void => {
    const watch = {
      condition,
      ...(branch === undefined ? {} : { branch }),
      trunk,
      observed: last.observed,
      timeout_s: timeoutSeconds,
      ...(resumeHandle === undefined ? {} : { resume: resumeHandle }),
    };
    activeWait?.update({
      kind: "condition",
      condition: watch,
      reason: `Waiting for ${awaitConditionDescription(watch)}. ${
        awaitObservationSentence(watch)
      }`,
      next:
        `This call checks automatically for up to ${timeoutSeconds} s. If its observation window ends first, resume the same watch using the returned continuation. No action is needed while this call is waiting.`,
    });
  };
  const evaluate = async (): Promise<boolean> => {
    last = await evaluateCondition(root, condition, {
      branch,
      tip,
      trunk,
      trunkStart,
      branchState,
      recoveredLanding,
    });
    if (!last.met) describeWait();
    return last.met;
  };

  const clock = opts.clock ?? SYSTEM_CLOCK;
  const scheduler = opts.scheduler ?? SYSTEM_SCHEDULER;
  const startMs = clock.monotonicNow();
  let outcome: "met" | "timeout";
  if (await evaluate()) {
    outcome = "met";
  } else {
    const initialPayload = continuationPayload();
    if (initialPayload === undefined) return unpublishable();
    const initialSave = await saveContinuation(
      root,
      "await",
      initialPayload,
      resumeHandle,
    );
    if (initialSave.kind === "unavailable") {
      return refusal(
        "write_denied",
        "discern couldn't save this await continuation in Git's administrative directory. Check that the Git directory is writable, then retry the watch.",
        failureRecoveryHintTexts("await"),
      );
    }
    resumeHandle = initialSave.handle;
    const continuation = initialSave.handle;
    outcome = await withProgressWait(async (wait) => {
      activeWait = wait;
      describeWait();
      const settled = await waitForWakes(
        evaluate,
        await existingPaths([
          join(commonGitDir, "refs", "heads"),
          join(commonGitDir, "refs", "notes"),
          join(commonGitDir, "packed-refs"),
          ...(cfg.project.record_logbook ? [logbookDir(commonGitDir)] : []),
        ]),
        startMs + timeoutSeconds * 1000,
        opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS,
        clock,
        scheduler,
        signal,
      );
      if (signal?.aborted !== true) {
        wait.end(
          settled === "met" ? "resumed" : "unmet",
          settled === "met"
            ? "The awaited condition is now met."
            : "The observation window ended; the condition is still unmet.",
          settled === "met"
            ? "Read the result for the next action."
            : `Resume this watch with \`${
              renderCommandRefsCli(
                retryCommand(continuation, timing.retrySeconds),
              )
            }\`.`,
        );
      }
      return settled;
    }, { clock, ...(signal === undefined ? {} : { signal }) });
  }
  const waitedMs = Math.round(clock.monotonicNow() - startMs);

  const base: AwaitData = {
    condition,
    ...(branch !== undefined ? { branch } : {}),
    trunk,
    met: outcome === "met",
    elapsed_ms: waitedMs,
    timeout_s: timeoutSeconds,
    timeout_basis: timeoutBasis,
    ...(timing.requestedTimeoutSeconds !== undefined
      ? { requested_timeout_s: timing.requestedTimeoutSeconds }
      : {}),
    observed: last.observed,
  };

  if (outcome === "met") {
    if (resumeHandle !== undefined) {
      await removeContinuation(root, resumeHandle);
    }
    const greenSource = last.via === "proof"
      ? last.observed.tip ?? branchState?.tip
      : undefined;
    const source = greenSource !== undefined ? greenSource : trunk;
    const observed = {
      ...last.observed,
      ...(await updatePreview(root, source)),
    };
    const overlapTotal = observed.overlap_total ?? 0;
    const hint = last.via === "proof" &&
        branch !== undefined &&
        greenSource !== undefined
      ? fire(HINTS["await-green-met"], {
        branch,
        tip: greenSource,
        callerHasWorktree,
      })
      : last.via === "landed" && branch !== undefined
      ? fire(HINTS["await-landed-met"], {
        branch,
        trunk,
        overlapTotal,
        callerHasWorktree,
      })
      : fire(HINTS["await-trunk-moved-met"], {
        trunk,
        overlapTotal,
        callerHasWorktree,
      });
    return {
      ok: true,
      verb: "await",
      data: { ...base, observed },
      hints: hintTexts([hint]),
    };
  }

  const finalPayload = continuationPayload();
  if (finalPayload === undefined) return unpublishable();
  const finalSave = await saveContinuation(
    root,
    "await",
    finalPayload,
    resumeHandle,
  );
  if (finalSave.kind === "unavailable") {
    const retry = opts.resume === undefined
      ? "restart the watch with its condition"
      : "retry the same `--resume` handle";
    return refusal(
      "write_denied",
      `discern couldn't update this await continuation in Git's administrative directory. Check that the Git directory is writable, then ${retry}.`,
      failureRecoveryHintTexts("await"),
    );
  }
  const resume = finalSave.handle;
  const cancelled = signal?.aborted === true;
  const hints: FiredHint[] = [
    fire(HINTS["await-not-yet"], {
      summary: notYetSummary(condition, branch, trunk, last.observed),
      seconds: timing.retrySeconds,
      command: retryCommand(resume, timing.retrySeconds),
    }),
  ];
  return {
    ok: true,
    verb: "await",
    ...(cancelled
      ? {
        message:
          "The watch was cancelled before its condition was met. It will not resume automatically; its continuation remains available.",
      }
      : {}),
    data: {
      ...base,
      resume,
      retry_after_s: timing.retrySeconds,
      retry_basis: timing.retryBasis,
    },
    hints: cancelled ? [] : hintTexts(hints),
  };
}

/** A branch condition's cross-evaluation memory: the freshest tip observed
 * while the ref lived, and whether any evaluation saw that work unreachable
 * from the trunk — the arming half of a landing transition. */
interface BranchState {
  tip: string;
  everUnreachable: boolean;
}

/** One evaluation of the chosen condition against authoritative state. */
async function evaluateCondition(
  root: string,
  condition: AwaitConditionKind,
  pins: {
    branch: string | undefined;
    tip: string | undefined;
    trunk: string;
    trunkStart: string;
    branchState: BranchState | undefined;
    recoveredLanding: LandedProofNote | undefined;
  },
): Promise<Evaluation> {
  const {
    branch,
    tip,
    trunk,
    trunkStart,
    branchState,
    recoveredLanding,
  } = pins;
  if (condition === "trunk-moved") {
    let head: string | undefined;
    try {
      head = await resolveCommitRef(root, `refs/heads/${trunk}`);
    } catch {
      // discern-best-effort: await-trunk-ref-fallback
      head = undefined; // the trunk vanished mid-wait — not-met, not a crash
    }
    return {
      met: head !== undefined && head !== trunkStart,
      observed: {
        trunk_start: trunkStart,
        ...(head !== undefined ? { trunk_head: head } : {}),
      },
      via: "trunk",
    };
  }
  if (branch === undefined || tip === undefined) {
    return { met: false, observed: {} };
  }
  if (recoveredLanding !== undefined) {
    return {
      met: true,
      observed: { landed: true, tip: recoveredLanding.commit },
      via: "landed",
    };
  }
  const state = branchState ?? { tip, everUnreachable: false };
  try {
    const liveTip = await resolveCommitRef(root, `refs/heads/${branch}`);
    if (liveTip !== state.tip) {
      // Carry an armed transition only while the replacement tip still
      // contains the work that armed it. A force-reset to the trunk abandons
      // that work; reachability of the replacement is not a landing.
      state.everUnreachable = state.everUnreachable &&
        await commitIsAncestorOf(root, state.tip, liveTip);
      state.tip = liveTip;
    }
  } catch {
    // discern-best-effort: await-branch-ref-fallback
    // The ref is gone (a landing removes it) — the last observed tip answers.
  }
  const reachable = await commitIsMerged(root, state.tip, trunk);
  if (condition === "landed") {
    if (reachable && state.everUnreachable) {
      return {
        met: true,
        observed: { landed: true, tip: state.tip },
        via: "landed",
      };
    }
    if (reachable) {
      const landed = await findLandedProofNoteForBranch(
        root,
        branch,
        trunk,
        trunkStart,
      );
      if (landed !== undefined) {
        return {
          met: true,
          observed: { landed: true, tip: landed.commit },
          via: "landed",
        };
      }
    } else {
      state.everUnreachable = true;
    }
    return {
      met: false,
      observed: { tip: state.tip, landed: false },
    };
  }
  // green: the proof is the truth. A landing observed mid-wait satisfies it
  // too, but only after the branch armed the transition above or a durable
  // landed proof note identifies the accepted work.
  const worktree = await worktreePathForEffortBranch(root, branch);
  let proofStatus: NonNullable<AwaitData["observed"]["proof_status"]> =
    "no-worktree";
  if (worktree !== undefined) {
    const proof = await inspectGateProof(worktree);
    // An honored proof satisfies the watch only when it covers the effort's
    // own branch tip, never some other revision the checkout may sit on.
    if (
      proof.status === "honored" &&
      (proof.recorded === undefined || proof.recorded === state.tip)
    ) {
      return {
        met: true,
        observed: { proof_status: "honored", worktree, tip: state.tip },
        via: "proof",
      };
    }
    proofStatus = proof.status;
  }
  if (reachable && state.everUnreachable) {
    return {
      met: true,
      observed: {
        landed: true,
        tip: state.tip,
        ...(worktree !== undefined ? { worktree } : {}),
      },
      via: "landed",
    };
  }
  if (reachable) {
    const landed = await findLandedProofNoteForBranch(
      root,
      branch,
      trunk,
      trunkStart,
    );
    if (landed !== undefined) {
      return {
        met: true,
        observed: {
          landed: true,
          tip: landed.commit,
          ...(worktree !== undefined ? { worktree } : {}),
        },
        via: "landed",
      };
    }
  }
  if (!reachable) {
    state.everUnreachable = true;
  }
  return {
    met: false,
    observed: {
      proof_status: proofStatus,
      tip: state.tip,
      ...(worktree !== undefined ? { worktree } : {}),
    },
  };
}

/** Options for the `await` subcommand surface. */
export interface RunAwaitOptions extends AwaitOptions {
  json?: boolean;
}

/** One human line for the settled wait — the hints carry the next step. */
function renderAwaitHuman(
  result: DiscernResult<AwaitData>,
  out: Out,
): void {
  const data = result.data;
  if (data === undefined || !("condition" in data)) {
    return;
  }
  const waited = `${Math.round(data.elapsed_ms / 1000)}s`;
  if (data.met) {
    out.ok(`Condition met after ${waited}.`);
  } else {
    out.info(
      `Not yet — waited ${waited} of the ${data.timeout_s}s timeout.`,
    );
  }
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
}

/**
 * The `await` subcommand: run the wait, then emit the JSON envelope or the
 * human summary. Exit codes: 0 when the condition was met, 1 on a refusal,
 * {@link AWAIT_TIMEOUT_EXIT_CODE} on "not yet" — the envelope's `ok` stays
 * true for a timeout, so only the shell sees the distinction.
 */
export async function runAwait(
  root: string,
  opts: RunAwaitOptions,
  signal?: AbortSignal,
): Promise<number> {
  const out = makeOut(colorEnabled());
  // The wait is a journalled operation like every other long verb, so a
  // closed terminal can read it back through its progress handle.
  const result = await observedGateOperation(
    root,
    "await",
    signal,
    (presenter) => {
      if (opts.json !== true) {
        presenter.set(createGateProgressPresenter({
          write: (line): void => out.info(line.trimEnd()),
        }));
      }
      return awaitResult(root, opts, signal);
    },
    (value) => value,
  );
  observeResult(result);
  if (opts.json === true) {
    emitResult(result);
  } else {
    if (!result.ok) {
      out.error(result.message ?? "await refused.");
      const hints = interactiveHintTexts(result.hints);
      if (hints.length > 0) out.group("next");
      for (const hint of hints) {
        out.info(hint);
      }
    } else {
      renderAwaitHuman(result, out);
    }
  }
  if (!result.ok) {
    return 1;
  }
  return result.data !== undefined && "met" in result.data && result.data.met
    ? 0
    : AWAIT_TIMEOUT_EXIT_CODE;
}
