/**
 * `await`: block until a fleet condition holds, then answer with the observed
 * state and the sensible next step — so a dependent agent spends one call
 * waiting instead of guessing at poll intervals.
 *
 * Three conditions, one per call:
 *  - `--green <branch>` — the branch's worktree holds an honored gate receipt
 *    (or this call watched its work land, which implies the receipt held);
 *  - `--landed <branch>` — the branch's work is reachable from the trunk. The
 *    tip sha is pinned at call start, because acceptance deletes the branch as
 *    it lands — the sha outlives the ref;
 *  - `--trunk-moved` — the trunk ref differs from its position at call start.
 *
 * The architectural line (the logbook's advisory-only constitution): every
 * condition grounds in AUTHORITATIVE state — git ancestry for "landed", the
 * gate receipt for "green" — while the logbook serves only as a wake signal
 * (every verb completion anywhere in the fleet is one append to one file) and
 * as advisory retry timing. History never decides truth, and `await` gates
 * nothing: it blocks only its own caller, at the caller's request.
 *
 * Timing out is NOT a failure: the envelope stays `ok: true` with `met: false`
 * and a `retry_after_seconds` priced from the fleet's duration priors — the
 * caller is told when to come back, never left guessing. The CLI still exits
 * {@link AWAIT_TIMEOUT_EXIT_CODE} on "not yet" so `discern await … && discern
 * update` composes in a shell, without the envelope calling the wait a defect.
 *
 * Read-only and stateless: no plan/apply (there is no effect to plan), no
 * locks, no daemon — the verb holds nothing beyond its own process. It IS
 * begin-recorded (deliberately not a pure-observation verb), so a blocked
 * agent's fleet row reads `running: await` while it holds.
 */

import { join } from "@std/path";
import { loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  AwaitConditionKind,
  AwaitData,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { observeResult } from "../../shared/result_capture.ts";
import {
  type CommandRef,
  discernCommand,
  flag,
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
  commitIsMerged,
  incomingOverlap,
  integrationBranch,
  localBranchExists,
  refMergedState,
  resolveCommitRef,
  resolveCommonGitDir,
  worktreeGitKey,
  worktreePathForBranch,
} from "../worktree/git.ts";
import { inspectGateReceipt } from "../gate/receipt.ts";
import { nearestContainingBranch } from "../worktree/containment.ts";
import { readFleetLogbookActivity } from "../logbook/read.ts";
import { configEpoch } from "../logbook/epoch.ts";
import { logbookDir } from "../logbook/store.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";

import {
  AWAIT_CLI_DEFAULT_TIMEOUT_SECONDS,
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_TIMEOUT_EXIT_CODE,
} from "./defaults.ts";

export {
  AWAIT_CLI_DEFAULT_TIMEOUT_SECONDS,
  AWAIT_MCP_DEFAULT_TIMEOUT_SECONDS,
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_TIMEOUT_EXIT_CODE,
} from "./defaults.ts";

/** Floor for priced retry advice, and the suggestion once in-flight work runs
 * past its typical duration (completion is imminent or the prior is off). */
const AWAIT_RETRY_MIN_SECONDS = 30;
/** Retry suggestion when work is in flight but no prior prices its verb. */
const AWAIT_RETRY_NO_PRIOR_SECONDS = 60;
/** Retry suggestion when nothing relevant is in flight — the long backoff. */
const AWAIT_RETRY_IDLE_SECONDS = 300;

/** Cap on the overlap preview a met condition attaches — matches the bounded
 * hot-zone read `status` reports, enough to name the files worth re-reading. */
const AWAIT_OVERLAP_CAP = 20;

/** Options for one `await` call. Exactly one condition must be set. */
export interface AwaitOptions {
  /** Wait for this branch's worktree to hold an honored gate receipt. */
  green?: string;
  /** Wait for this branch's work to become reachable from the trunk. */
  landed?: string;
  /** Wait for the trunk ref to move from its position at call start. */
  trunkMoved?: boolean;
  /** Seconds before answering "not yet" ({@link AWAIT_CLI_DEFAULT_TIMEOUT_SECONDS};
   * 0 evaluates once and answers immediately). */
  timeoutSeconds?: number;
  /** Test seam: the polling fallback cadence ({@link AWAIT_POLL_INTERVAL_MS}). */
  pollIntervalMs?: number;
}

/** One condition evaluation: the verdict now, and the state behind it. */
interface Evaluation {
  met: boolean;
  observed: AwaitData["observed"];
  /** How the condition was satisfied — landing satisfies `green` too, and the
   * next-step hint differs (`update` vs `update --from`). */
  via?: "receipt" | "landed" | "trunk";
}

/** The advisory retry pricing for a "not yet" answer. */
interface RetryAdvice {
  seconds: number;
  basis: NonNullable<AwaitData["retry_basis"]>;
  running?: AwaitData["running"];
}

function refusal(
  error: "invalid_arguments" | "not_found" | "no_repository",
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
    watcher = undefined; // watching is best-effort; polling carries the wait
  }
  const pump = (async (): Promise<void> => {
    if (watcher === undefined) {
      return;
    }
    try {
      for await (const _event of watcher) {
        if (finished) {
          break;
        }
        kick();
      }
    } catch {
      // A dying watcher silently hands the wait to the polling fallback.
    }
  })();
  signal?.addEventListener("abort", kick, { once: true });
  try {
    while (true) {
      if (signal?.aborted === true || Date.now() >= deadlineMs) {
        return "timeout";
      }
      const waitMs = Math.min(pollMs, deadlineMs - Date.now());
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, waitMs);
        wake = (): void => {
          clearTimeout(timer);
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
    try {
      watcher?.close();
    } catch {
      // Already closed by its own failure path.
    }
    await pump;
  }
}

/** The existing subset of candidate watch paths — `Deno.watchFs` refuses a
 * missing path outright, and an absent one (no packed-refs yet, logbook off)
 * is simply not a wake source. */
async function existingPaths(candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of candidates) {
    try {
      await Deno.lstat(path);
      out.push(path);
    } catch {
      // Missing → not watchable; the polling fallback covers it.
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
    const merged = await refMergedState(root, `refs/heads/${sourceRef}`);
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
    return {};
  }
}

/**
 * Price the retry for a "not yet" answer from the logbook's advisory evidence:
 * in-flight work on the awaited branch (any branch, for `--trunk-moved`) with
 * a duration prior suggests the remainder of its typical run; in-flight work
 * without a prior gets a short check-back; a quiet fleet gets the long
 * backoff; a disabled logbook gets the flat default, honestly labelled.
 */
async function retryAdvice(
  commonGitDir: string | undefined,
  logbookEnabled: boolean,
  epochFingerprint: string,
  branch: string | undefined,
  nowMs: number,
): Promise<RetryAdvice> {
  if (!logbookEnabled || commonGitDir === undefined) {
    return { seconds: AWAIT_RETRY_IDLE_SECONDS, basis: "logbook-off" };
  }
  const activity = await readFleetLogbookActivity(
    commonGitDir,
    epochFingerprint,
    nowMs,
  );
  const candidates = branch !== undefined
    ? [activity.byBranch.get(branch)]
    : [...activity.byBranch.values()];
  let best: RetryAdvice | undefined;
  for (const entry of candidates) {
    const running = entry?.running;
    if (running === undefined) {
      continue;
    }
    const started = Date.parse(running.started);
    if (Number.isNaN(started)) {
      continue;
    }
    const elapsed = Math.max(0, nowMs - started);
    const typical = activity.typicalDurationMs.get(running.verb);
    const seconds = typical === undefined
      ? AWAIT_RETRY_NO_PRIOR_SECONDS
      : Math.max(
        AWAIT_RETRY_MIN_SECONDS,
        Math.ceil((typical - elapsed) / 1000),
      );
    const advice: RetryAdvice = {
      seconds,
      basis: typical === undefined ? "no-prior" : "running",
      running: {
        verb: running.verb,
        started: running.started,
        elapsed_ms: Math.round(elapsed),
        ...(typical === undefined
          ? {}
          : { typical_duration_ms: Math.round(typical) }),
      },
    };
    if (best === undefined || advice.seconds < best.seconds) {
      best = advice;
    }
  }
  return best ?? { seconds: AWAIT_RETRY_IDLE_SECONDS, basis: "idle" };
}

/** The exact call that re-asks this question, for the "not yet" hint. */
function retryCommand(
  condition: AwaitConditionKind,
  branch: string | undefined,
  seconds: number,
): CommandRef {
  const conditionArg = condition === "green"
    ? flag("green", `${branch}`)
    : condition === "landed"
    ? flag("landed", `${branch}`)
    : flag("trunk-moved");
  return discernCommand("await", conditionArg, flag("timeout", `${seconds}`));
}

/** The one-line "what is still untrue" for the "not yet" hint. */
function notYetSummary(
  condition: AwaitConditionKind,
  branch: string | undefined,
  trunk: string,
  observed: AwaitData["observed"],
): string {
  if (condition === "green") {
    const status = observed.receipt_status;
    const detail = status === "no-worktree"
      ? "no checkout holds it"
      : `receipt ${status ?? "unreadable"}`;
    return `\`${branch}\` has no honored receipt yet (${detail})`;
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
): Promise<DiscernResult<AwaitData>> {
  const picked: AwaitConditionKind[] = [
    ...(opts.green !== undefined ? ["green" as const] : []),
    ...(opts.landed !== undefined ? ["landed" as const] : []),
    ...(opts.trunkMoved === true ? ["trunk-moved" as const] : []),
  ];
  const condition = picked[0];
  if (condition === undefined || picked.length > 1) {
    return refusal(
      "invalid_arguments",
      "Pass exactly one condition: --green <branch>, --landed <branch>, or --trunk-moved.",
      failureRecoveryHintTexts("await"),
    );
  }
  const timeoutSeconds = opts.timeoutSeconds ??
    AWAIT_CLI_DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
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
      "not_found",
      `The trunk branch \`${trunk}\` does not exist locally, so no fleet condition can be observed against it.`,
      failureRecoveryHintTexts("await"),
    );
  }

  // Pin the at-start state. For a branch condition the tip sha is the pin:
  // acceptance deletes a landed branch, and the sha stays answerable when the
  // ref is gone. A branch already missing at call start is an honest refusal —
  // there is nothing left to pin, and guessing would report someone else's sha.
  const branch = condition === "green" ? opts.green : opts.landed;
  let tip: string | undefined;
  if (branch !== undefined) {
    if (!(await localBranchExists(root, branch))) {
      return refusal(
        "not_found",
        `Branch \`${branch}\` was not found in this repository.`,
        hintTexts([fire(HINTS["await-branch-missing"], { branch, trunk })]),
      );
    }
    tip = await resolveCommitRef(root, `refs/heads/${branch}`);
  }
  // `green` needs a checkout for the receipt to ever be recorded in: it lives
  // in per-worktree state and dies with the worktree (a contained checkout
  // reclaimed by `worktree prune --contained` is the usual shape). A branch
  // with no worktree at call start therefore cannot meet the condition —
  // waiting would be dishonest, so refuse and point at the target that can
  // answer: the containing branch when one exists, else `--landed`.
  if (condition === "green" && branch !== undefined && tip !== undefined) {
    if (await worktreePathForBranch(root, branch) === undefined) {
      const containing = await nearestContainingBranch(root, branch, trunk);
      return refusal(
        "not_found",
        `No checkout holds branch \`${branch}\` — its worktree was reclaimed ` +
          `or removed, and a gate receipt can only be recorded inside one, so ` +
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
  const trunkStart = await resolveCommitRef(root, `refs/heads/${trunk}`);
  // `green`'s landed-satisfies-it rule is TRANSITION-based: only a tip this
  // call observed unreachable and later reachable counts as a landing. A tip
  // reachable from the very start proves nothing — a freshly forked branch's
  // tip is trivially an ancestor of the trunk, and answering "green" before
  // the sibling has committed anything is the exact false positive a
  // wave-dispatched dependent cannot afford.
  const greenState = condition === "green" && tip !== undefined
    ? {
      tip,
      everUnreachable: !(await commitIsMerged(root, tip, trunk)),
    }
    : undefined;

  let last: Evaluation = { met: false, observed: {} };
  const evaluate = async (): Promise<boolean> => {
    last = await evaluateCondition(root, condition, {
      branch,
      tip,
      trunk,
      trunkStart,
      greenState,
    });
    return last.met;
  };

  const startMs = Date.now();
  const outcome = await waitForWakes(
    evaluate,
    await existingPaths([
      join(commonGitDir, "refs", "heads"),
      join(commonGitDir, "packed-refs"),
      ...(cfg.project.logbook ? [logbookDir(commonGitDir)] : []),
    ]),
    startMs + timeoutSeconds * 1000,
    opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS,
    signal,
  );
  const waitedMs = Math.round(Date.now() - startMs);

  const base: AwaitData = {
    condition,
    ...(branch !== undefined ? { branch } : {}),
    trunk,
    met: outcome === "met",
    waited_ms: waitedMs,
    timeout_seconds: timeoutSeconds,
    observed: last.observed,
  };

  if (outcome === "met") {
    const source = last.via === "receipt" && branch !== undefined
      ? branch
      : trunk;
    const observed = {
      ...last.observed,
      ...(await updatePreview(root, source)),
    };
    const overlapTotal = observed.overlap_total ?? 0;
    const hint = last.via === "receipt" && branch !== undefined
      ? fire(HINTS["await-green-met"], { branch })
      : last.via === "landed" && branch !== undefined
      ? fire(HINTS["await-landed-met"], { branch, trunk, overlapTotal })
      : fire(HINTS["await-trunk-moved-met"], { trunk, overlapTotal });
    return {
      ok: true,
      verb: "await",
      data: { ...base, observed },
      hints: hintTexts([hint]),
    };
  }

  const advice = await retryAdvice(
    commonGitDir,
    cfg.project.logbook,
    configEpoch(cfg).fingerprint,
    branch,
    Date.now(),
  );
  const hints: FiredHint[] = [
    fire(HINTS["await-not-yet"], {
      summary: notYetSummary(condition, branch, trunk, last.observed),
      seconds: advice.seconds,
      command: retryCommand(condition, branch, advice.seconds),
    }),
    ...(advice.basis === "logbook-off"
      ? [fire(HINTS["await-timing-degraded"])]
      : []),
  ];
  return {
    ok: true,
    verb: "await",
    data: {
      ...base,
      retry_after_seconds: advice.seconds,
      retry_basis: advice.basis,
      ...(advice.running !== undefined ? { running: advice.running } : {}),
    },
    hints: hintTexts(hints),
  };
}

/** `green`'s cross-evaluation memory: the freshest tip observed while the ref
 * lived (mid-wait commits move it, and acceptance then deletes the ref), and
 * whether any evaluation saw that work unreachable from the trunk — the arming
 * half of the landing transition. */
interface GreenState {
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
    greenState: GreenState | undefined;
  },
): Promise<Evaluation> {
  const { branch, tip, trunk, trunkStart, greenState } = pins;
  if (condition === "trunk-moved") {
    let head: string | undefined;
    try {
      head = await resolveCommitRef(root, `refs/heads/${trunk}`);
    } catch {
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
  if (condition === "landed") {
    const landed = await commitIsMerged(root, tip, trunk);
    return { met: landed, observed: { tip, landed }, via: "landed" };
  }
  // green: the receipt is the truth. A landing observed MID-WAIT satisfies it
  // too — only a validated tree crosses to the trunk, and the whole
  // green-to-landed window can fit between two wakes — but only as a
  // transition this call witnessed (unreachable, then reachable). A tip
  // reachable from the start proves nothing: a freshly forked branch is
  // trivially an ancestor of the trunk, and a wave-dispatched dependent must
  // keep waiting for the sibling's actual work.
  const state = greenState ?? { tip, everUnreachable: false };
  try {
    state.tip = await resolveCommitRef(root, `refs/heads/${branch}`);
  } catch {
    // The ref is gone (a landing removes it) — the last observed tip answers.
  }
  const reachable = await commitIsMerged(root, state.tip, trunk);
  const worktree = await worktreePathForBranch(root, branch);
  let receiptStatus: NonNullable<AwaitData["observed"]["receipt_status"]> =
    "no-worktree";
  if (worktree !== undefined) {
    const receipt = await inspectGateReceipt(worktree);
    if (receipt.status === "honored") {
      return {
        met: true,
        observed: { receipt_status: "honored", worktree, tip: state.tip },
        via: "receipt",
      };
    }
    receiptStatus = receipt.status;
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
  if (!reachable) {
    state.everUnreachable = true;
  }
  return {
    met: false,
    observed: {
      receipt_status: receiptStatus,
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
  const waited = `${Math.round(data.waited_ms / 1000)}s`;
  if (data.met) {
    out.ok(`Condition met after ${waited}.`);
  } else {
    out.info(
      `Not yet — waited ${waited} of the ${data.timeout_seconds}s timeout.`,
    );
  }
  for (const hint of interactiveHintTexts(result.hints)) {
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
  const result = await awaitResult(root, opts, signal);
  observeResult(result);
  if (opts.json === true) {
    emitResult(result);
  } else {
    const out = makeOut(colorEnabled());
    if (!result.ok) {
      out.error(result.message ?? "await refused.");
      for (const hint of interactiveHintTexts(result.hints)) {
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
