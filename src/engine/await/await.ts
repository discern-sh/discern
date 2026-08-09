/**
 * `await`: block until a fleet condition holds, then answer with the observed
 * state and the sensible next step — so a dependent agent spends one call
 * waiting instead of guessing at poll intervals.
 *
 * Three conditions, one per call:
 *  - `--green <branch>` — the branch's worktree holds an honored gate proof
 *    (or a durable proof note proves its work landed);
 *  - `--landed <branch>` — the branch's work is reachable from the trunk. The
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
import { decodeBase64 } from "@std/encoding/base64";
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
  worktreePathForBranch,
} from "../worktree/git.ts";
import { inspectGateProof } from "../gate/proof.ts";
import {
  findLandedProofNoteForBranch,
  findLatestLandedProofNoteForBranch,
  type LandedProofNote,
} from "../gate/proof_notes.ts";
import { nearestContainingBranch } from "../worktree/containment.ts";
import { logbookDir } from "../logbook/store.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import {
  AWAIT_CALL_SECONDS,
  type AwaitCallProfile,
} from "../../shared/mcp_timeout_policy.ts";

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
}

/** Surface context that selects a transport-safe duration for one call. */
export interface AwaitExecutionContext {
  callProfile: AwaitCallProfile;
}

/** Versioned state saved behind one short continuation handle. */
interface AwaitContinuationPayload {
  version: 1;
  condition: AwaitConditionKind;
  branch?: string;
  trunk: string;
  tip?: string;
  trunk_start: string;
  branch_ever_unreachable?: boolean;
}

/** The self-contained format emitted before repository-local handles. It stays
 * readable so a watch already between calls survives an engine upgrade. */
interface LegacyAwaitResumePayload extends AwaitContinuationPayload {
  repository: string;
}

const LEGACY_AWAIT_RESUME_PREFIX = "v1.";
const LEGACY_AWAIT_RESUME_TOKEN_MAX_LENGTH = 16_384;
const AWAIT_CONTINUATION_KEYS = new Set([
  "version",
  "condition",
  "branch",
  "trunk",
  "tip",
  "trunk_start",
  "branch_ever_unreachable",
]);
const LEGACY_AWAIT_RESUME_KEYS = new Set([
  ...AWAIT_CONTINUATION_KEYS,
  "repository",
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
    value.version !== 1 ||
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
    version: 1,
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

/** Decode the former inline token so stored-handle migration remains resumable. */
function decodeLegacyResumeToken(
  token: string,
): LegacyAwaitResumePayload | undefined {
  if (
    token.length > LEGACY_AWAIT_RESUME_TOKEN_MAX_LENGTH ||
    !token.startsWith(LEGACY_AWAIT_RESUME_PREFIX)
  ) {
    return undefined;
  }
  const encoded = token.slice(LEGACY_AWAIT_RESUME_PREFIX.length);
  if (encoded === "" || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return undefined;
  }
  const remainder = encoded.length % 4;
  if (remainder === 1) {
    return undefined;
  }
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - remainder) % 4);
  let decoded: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64(padded),
    );
    decoded = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (
    typeof decoded !== "object" || decoded === null || Array.isArray(decoded)
  ) {
    return undefined;
  }
  const value = decoded as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !LEGACY_AWAIT_RESUME_KEYS.has(key)) ||
    typeof value.repository !== "string" || value.repository === ""
  ) {
    return undefined;
  }
  const payload = parseAwaitContinuationPayload(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "repository"),
    ),
  );
  return payload === undefined
    ? undefined
    : { ...payload, repository: value.repository };
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
    | "not_found"
    | "no_repository"
    | "read_error"
    | "write_access",
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
 * preserving the original question.
 */
function awaitTiming(
  requested: number | undefined,
  profile: AwaitCallProfile,
): AwaitTiming {
  const profileSeconds = AWAIT_CALL_SECONDS[profile];
  if (requested === undefined) {
    return {
      timeoutSeconds: profileSeconds,
      timeoutBasis: profile,
      retrySeconds: profileSeconds,
      retryBasis: profile,
    };
  }
  if (requested === 0) {
    return {
      timeoutSeconds: 0,
      timeoutBasis: "explicit",
      retrySeconds: profileSeconds,
      retryBasis: profile,
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
    timeoutBasis: profile,
    requestedTimeoutSeconds: requested,
    retrySeconds: profileSeconds,
    retryBasis: profile,
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
      : `proof ${status ?? "unreadable"}`;
    return `\`${branch}\` has no valid proof yet (${detail})`;
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
      "Pass exactly one condition (--green <branch>, --landed <branch>, or --trunk-moved), or pass --resume by itself.",
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
      "not_found",
      `The trunk branch \`${trunk}\` does not exist locally, so no fleet condition can be observed against it.`,
      hintTexts([fire(HINTS["await-trunk-missing"], { trunk })]),
    );
  }
  const callerHasWorktree = await worktreeGitKey(root) !== undefined;

  let resumed: AwaitContinuationPayload | undefined;
  let resumeHandle: string | undefined;
  if (opts.resume?.startsWith(LEGACY_AWAIT_RESUME_PREFIX) === true) {
    const legacy = decodeLegacyResumeToken(opts.resume);
    if (legacy === undefined) {
      return refusal(
        "invalid_arguments",
        "The `--resume` token is invalid or was written by an incompatible discern version.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (legacy.repository !== commonGitDir || legacy.trunk !== trunk) {
      return refusal(
        "invalid_arguments",
        "The `--resume` token belongs to a different repository or trunk branch.",
        failureRecoveryHintTexts("await"),
      );
    }
    resumed = legacy;
  } else if (opts.resume !== undefined) {
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
        "read_error",
        "discern couldn't read the saved `--resume` handle. Restart the watch with its condition.",
        failureRecoveryHintTexts("await"),
      );
    }
    if (stored.kind === "unavailable") {
      return refusal(
        "read_error",
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
    resumed = parseAwaitContinuationPayload(stored.record.payload);
    if (resumed === undefined) {
      return refusal(
        "read_error",
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
  const branch = resumed?.branch ??
    (condition === "green" ? opts.green : opts.landed);
  let tip: string | undefined;
  let recoveredLanding: LandedProofNote | undefined;
  if (resumed !== undefined) {
    tip = resumed.tip;
  } else if (branch !== undefined) {
    try {
      tip = await resolveCommitRef(root, `refs/heads/${branch}`);
    } catch {
      // Acceptance can remove the ref between the caller choosing it and this
      // first read. Its durable note is the only branch-bound recovery.
      recoveredLanding = await findLatestLandedProofNoteForBranch(
        root,
        branch,
        trunk,
      );
      if (recoveredLanding === undefined) {
        return refusal(
          "not_found",
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
    if (await worktreePathForBranch(root, branch) === undefined) {
      const containing = await nearestContainingBranch(root, branch, trunk);
      return refusal(
        "not_found",
        `No checkout holds branch \`${branch}\` — its worktree was reclaimed ` +
          `or removed, and a gate proof can only be recorded inside one, so ` +
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
  const timing = awaitTiming(opts.timeoutSeconds, context.callProfile);
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

  const continuationPayload = (): AwaitContinuationPayload => {
    const currentTip = branchState?.tip ?? tip;
    return {
      version: 1,
      condition,
      ...(branch !== undefined ? { branch } : {}),
      trunk,
      ...(currentTip !== undefined ? { tip: currentTip } : {}),
      trunk_start: trunkStart,
      ...(branchState !== undefined
        ? { branch_ever_unreachable: branchState.everUnreachable }
        : {}),
    };
  };

  let last: Evaluation = { met: false, observed: {} };
  const evaluate = async (): Promise<boolean> => {
    last = await evaluateCondition(root, condition, {
      branch,
      tip,
      trunk,
      trunkStart,
      branchState,
      recoveredLanding,
    });
    return last.met;
  };

  const startMs = Date.now();
  let outcome: "met" | "timeout";
  if (await evaluate()) {
    outcome = "met";
  } else {
    const initialSave = await saveContinuation(
      root,
      "await",
      continuationPayload(),
      resumeHandle,
    );
    if (initialSave.kind === "unavailable") {
      return refusal(
        "write_access",
        "discern couldn't save this await continuation in Git's administrative directory. Check that the Git directory is writable, then retry the watch.",
        failureRecoveryHintTexts("await"),
      );
    }
    resumeHandle = initialSave.handle;
    outcome = await waitForWakes(
      evaluate,
      await existingPaths([
        join(commonGitDir, "refs", "heads"),
        join(commonGitDir, "refs", "notes"),
        join(commonGitDir, "packed-refs"),
        ...(cfg.project.logbook ? [logbookDir(commonGitDir)] : []),
      ]),
      startMs + timeoutSeconds * 1000,
      opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS,
      signal,
    );
  }
  const waitedMs = Math.round(Date.now() - startMs);

  const base: AwaitData = {
    condition,
    ...(branch !== undefined ? { branch } : {}),
    trunk,
    met: outcome === "met",
    waited_ms: waitedMs,
    timeout_seconds: timeoutSeconds,
    timeout_basis: timeoutBasis,
    ...(timing.requestedTimeoutSeconds !== undefined
      ? { requested_timeout_seconds: timing.requestedTimeoutSeconds }
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

  const finalSave = await saveContinuation(
    root,
    "await",
    continuationPayload(),
    resumeHandle,
  );
  if (finalSave.kind === "unavailable") {
    const retry = opts.resume === undefined
      ? "restart the watch with its condition"
      : "retry the same `--resume` handle";
    return refusal(
      "write_access",
      `discern couldn't update this await continuation in Git's administrative directory. Check that the Git directory is writable, then ${retry}.`,
      failureRecoveryHintTexts("await"),
    );
  }
  const resume = finalSave.handle;
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
    data: {
      ...base,
      resume,
      retry_after_seconds: timing.retrySeconds,
      retry_basis: timing.retryBasis,
    },
    hints: hintTexts(hints),
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
  const worktree = await worktreePathForBranch(root, branch);
  let proofStatus: NonNullable<AwaitData["observed"]["proof_status"]> =
    "no-worktree";
  if (worktree !== undefined) {
    const proof = await inspectGateProof(worktree);
    if (proof.status === "honored") {
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
  const waited = `${Math.round(data.waited_ms / 1000)}s`;
  if (data.met) {
    out.ok(`Condition met after ${waited}.`);
  } else {
    out.info(
      `Not yet — waited ${waited} of the ${data.timeout_seconds}s timeout.`,
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
  const result = await awaitResult(root, opts, signal);
  observeResult(result);
  if (opts.json === true) {
    emitResult(result);
  } else {
    const out = makeOut(colorEnabled());
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
