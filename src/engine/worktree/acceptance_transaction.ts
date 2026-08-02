/**
 * The durable transaction around acceptance's one-shot authority, trunk CAS,
 * and checked-out-tree convergence.
 *
 * The journal is written before either durable boundary. A normal successful
 * acceptance keeps it until Git removes the worktree admin directory; an
 * interrupted retry reconciles facts before ordinary authority and dirty-tree
 * guards can mistake the transaction's own state for user work.
 */

import { dirname, isAbsolute } from "@std/path";
import {
  LANDING_CONSENT_SOURCES,
  type LandingConsent,
} from "../../shared/consent.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  claimEffortGrant,
  consumeEffortGrantClaimById,
  type EffortGrantClaim,
  type EffortGrantClaimRead,
  type EffortGrantClaimSettlement,
  readEffortGrantClaim,
  restoreEffortGrantClaim,
  settleEffortGrantClaim,
} from "./effort_grant_cleanup.ts";
import {
  type CheckedOutFastForwardResult,
  fastForwardCheckedOutBranch,
  mainRepoPath,
  readAcceptanceTransactionMarker,
  recoverCheckedOutFastForward,
  WorktreeGitError,
} from "./git.ts";

/** Durable facts that precede a later acceptance phase. */
export const ACCEPTANCE_TRANSACTION_BOUNDARIES = [
  {
    id: "effort-claim",
    evidence: "the deterministic claim named by the transaction id",
  },
  {
    id: "trunk-ref",
    evidence:
      "the expected/target refs plus the atomically coupled per-worktree marker ref",
  },
] as const;

export type AcceptanceTransactionBoundary =
  (typeof ACCEPTANCE_TRANSACTION_BOUNDARIES)[number]["id"];

interface AcceptanceTransactionBase {
  readonly id: string;
  readonly worktree_branch: string;
  readonly trunk: string;
  readonly expected_trunk: string;
  readonly target: string;
  readonly main_repo: string;
  readonly effort_claim: boolean;
}

type AcceptanceTransaction =
  | (AcceptanceTransactionBase & {
    readonly version: 1;
  })
  | (AcceptanceTransactionBase & {
    readonly version: 2;
    /** Consent already checked before this exact expected→target boundary. */
    readonly consent: LandingConsent;
  });

export interface RecordedAcceptanceTransaction {
  readonly path: string;
  readonly transaction: AcceptanceTransaction;
}

type AcceptanceTransactionRead =
  | { readonly status: "missing"; readonly path: string }
  | {
    readonly status: "invalid";
    readonly path: string;
    readonly reason: string;
  }
  | ({ readonly status: "recorded" } & RecordedAcceptanceTransaction);

/** Read-only interrupted-transaction evidence consulted before recovery acts. */
export type InterruptedAcceptanceInspection =
  | { readonly kind: "none" }
  | (RecordedAcceptanceTransaction & {
    readonly kind: "recorded";
    /** Prior consent bound to this transaction, when it can be proven. */
    readonly consent?: LandingConsent;
  });

/** What one authorized recovery did and whether ordinary acceptance may resume. */
export type InterruptedAcceptanceRecovery =
  | {
    readonly kind: "ready";
    readonly recoveryPerformed: boolean;
  }
  | {
    readonly kind: "stopped";
    readonly recoveryPerformed: boolean;
    readonly trunkLanded: boolean;
    readonly message: string;
  };

export type AcceptanceTransitionResult =
  | {
    readonly kind: "authority-changed";
    readonly claim: Exclude<
      EffortGrantClaimRead,
      { readonly status: "claimed" }
    >;
  }
  | {
    readonly kind: "attempted";
    readonly outcome: CheckedOutFastForwardResult;
    readonly effortSettlement?: EffortGrantClaimSettlement;
  };

const TRANSACTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Run one acceptance apply while holding this worktree's OS advisory lock.
 *
 * `tryLock` refuses a concurrent caller instead of letting it mistake an active
 * journal for an interrupted transaction. Closing the file releases the lock,
 * including when the process exits unexpectedly; the worktree's Git-admin
 * lifecycle reaps the otherwise inert lock file.
 */
export async function withAcceptanceTransactionLock<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  const path = await gitAdminStatePath(cwd, "acceptanceTransactionLock");
  if (path === undefined) {
    throw new WorktreeGitError(
      "Git could not resolve Discern's per-worktree acceptance lock. " +
        "Nothing was claimed or landed.",
    );
  }
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
  } catch (error) {
    throw new WorktreeGitError(
      `Discern could not prepare its per-worktree acceptance lock at ${path}. ` +
        `Nothing was claimed or landed. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, {
      create: true,
      read: true,
      write: true,
    });
  } catch (error) {
    throw new WorktreeGitError(
      `Discern could not open its per-worktree acceptance lock at ${path}. ` +
        `Nothing was claimed or landed. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  let acquired: boolean;
  try {
    acquired = await file.tryLock(true);
  } catch (error) {
    file.close();
    throw new WorktreeGitError(
      `Discern could not check its per-worktree acceptance lock at ${path}. ` +
        `Nothing was claimed or landed. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  if (!acquired) {
    file.close();
    throw new WorktreeGitError(
      "Another acceptance is already running for this worktree. It still owns " +
        "the recovery journal, authority claim, and trunk transition. Wait for " +
        "it to finish, then re-run `discern accept`. This call changed nothing.",
    );
  }

  try {
    return await operation();
  } finally {
    // Closing an FsFile releases its advisory lock even if Git removed this
    // worktree's administrative directory during successful cleanup.
    file.close();
  }
}

/** Narrow decoded journal data to a non-null, non-array record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject C0 and DEL bytes that make persisted ref text unsafe. */
function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Accept nonempty journal ref text only when it contains no control characters. */
function isRefName(value: unknown): value is string {
  return typeof value === "string" && value !== "" &&
    !containsControlCharacter(value);
}

/** Validate a journaled consent source and restrict scoped authority to standing grants. */
function parseLandingConsent(value: unknown): LandingConsent | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const source = value.source;
  if (
    typeof source !== "string" ||
    !LANDING_CONSENT_SOURCES.includes(
      source as (typeof LANDING_CONSENT_SOURCES)[number],
    )
  ) {
    return undefined;
  }
  const scopes = value.scopes;
  if (
    scopes !== undefined &&
    (!Array.isArray(scopes) ||
      !scopes.every((scope) => typeof scope === "string"))
  ) {
    return undefined;
  }
  if (source !== "standing-grant" && scopes !== undefined) {
    return undefined;
  }
  return {
    source: source as LandingConsent["source"],
    ...(scopes === undefined ? {} : { scopes: [...scopes] as string[] }),
  };
}

/** Decode and validate the versioned journal that binds authority to one expected-to-target transition. */
function parseAcceptanceTransaction(raw: string): AcceptanceTransaction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("the record is not valid JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new Error("the record is not a JSON object");
  }
  const consent = parsed.version === 2
    ? parseLandingConsent(parsed.consent)
    : undefined;
  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.id !== "string" ||
    !TRANSACTION_ID.test(parsed.id) ||
    !isRefName(parsed.worktree_branch) ||
    !isRefName(parsed.trunk) ||
    typeof parsed.expected_trunk !== "string" ||
    !OBJECT_ID.test(parsed.expected_trunk) ||
    typeof parsed.target !== "string" ||
    !OBJECT_ID.test(parsed.target) ||
    typeof parsed.main_repo !== "string" ||
    !isAbsolute(parsed.main_repo) ||
    typeof parsed.effort_claim !== "boolean" ||
    (parsed.version === 2 && consent === undefined) ||
    (parsed.version === 2 &&
      (consent?.source === "effort-grant") !== parsed.effort_claim)
  ) {
    throw new Error(
      "the record needs version 1 or 2, a transaction id, branch/trunk names, " +
        "expected and target object IDs, an absolute main checkout, and an " +
        "effort-claim flag; version 2 also binds matching consent evidence",
    );
  }
  const base: AcceptanceTransactionBase = {
    id: parsed.id,
    worktree_branch: parsed.worktree_branch,
    trunk: parsed.trunk,
    expected_trunk: parsed.expected_trunk,
    target: parsed.target,
    main_repo: parsed.main_repo,
    effort_claim: parsed.effort_claim,
  };
  return parsed.version === 1
    ? { version: 1, ...base }
    : { version: 2, ...base, consent: consent as LandingConsent };
}

/** Classify the recovery journal as missing, valid, or unusable without hiding read failures. */
async function readAcceptanceTransaction(
  cwd: string,
): Promise<AcceptanceTransactionRead> {
  const path = await gitAdminStatePath(cwd, "acceptanceTransaction");
  if (path === undefined) {
    throw new WorktreeGitError(
      "Git could not resolve Discern's acceptance-transaction journal. " +
        "Nothing was landed or claimed.",
    );
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing", path };
    }
    return {
      status: "invalid",
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    return {
      status: "recorded",
      path,
      transaction: parseAcceptanceTransaction(raw),
    };
  } catch (error) {
    return {
      status: "invalid",
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Delete a recovery journal while treating prior cleanup as success. */
async function removeJournal(path: string): Promise<boolean> {
  try {
    await Deno.remove(path);
    return true;
  } catch (error) {
    return error instanceof Deno.errors.NotFound;
  }
}

/** Persist every byte, retrying partial writes and rejecting a zero-byte write. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new Error("short write while recording acceptance transaction");
    }
    offset += written;
  }
}

/** Sync and atomically publish a unique journal before authority or refs can change. */
async function writeAcceptanceTransaction(
  cwd: string,
  input: Omit<AcceptanceTransactionBase, "id"> & {
    readonly consent: LandingConsent;
  },
): Promise<RecordedAcceptanceTransaction> {
  const current = await readAcceptanceTransaction(cwd);
  if (current.status !== "missing") {
    const detail = current.status === "invalid"
      ? ` It is invalid: ${current.reason}.`
      : "";
    throw new WorktreeGitError(
      `Discern found an existing acceptance-transaction journal at ${current.path}.` +
        `${detail} Re-run \`discern accept\` so recovery can reconcile it before ` +
        "starting another landing.",
    );
  }
  const transaction: AcceptanceTransaction = {
    version: 2,
    id: crypto.randomUUID(),
    ...input,
  };
  await Deno.mkdir(dirname(current.path), { recursive: true });
  const temp = `${current.path}.tmp-${crypto.randomUUID()}`;
  try {
    const file = await Deno.open(temp, { createNew: true, write: true });
    try {
      await writeAll(
        file,
        new TextEncoder().encode(`${JSON.stringify(transaction)}\n`),
      );
      await file.sync();
    } finally {
      file.close();
    }
    // A hard link publishes the already-synced bytes atomically and refuses to
    // replace a journal another acceptance won the race to create.
    await Deno.link(temp, current.path);
  } catch (error) {
    throw new WorktreeGitError(
      `Discern could not record the acceptance transaction before its authority ` +
        `boundary. Nothing was claimed or landed. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  } finally {
    try {
      await Deno.remove(temp);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        // Publishing the hard link already decided whether mutation may
        // proceed. A same-directory temp is inert, so cleanup cannot blur it.
      }
    }
  }
  return { path: current.path, transaction };
}

/** Keep recovery evidence whenever the ref moved or checkout rollback failed. */
function transitionRetainsJournal(
  outcome: CheckedOutFastForwardResult,
): boolean {
  return outcome.kind === "updated" ||
    (outcome.kind === "checkout-failed" && !outcome.rolledBack);
}

/**
 * Claim optional effort authority and perform the checked-out trunk CAS under
 * one prewritten journal. Pre-CAS refusals clear it after restoring authority;
 * a durable landed ref retains it until worktree removal or retry recovery.
 */
export async function performAcceptanceTransition(
  cwd: string,
  input: {
    readonly mainRepo: string;
    readonly trunk: string;
    readonly worktreeBranch: string;
    readonly expectedTrunk: string;
    readonly target: string;
    readonly effortClaim: boolean;
    readonly consent: LandingConsent;
  },
): Promise<AcceptanceTransitionResult> {
  const recorded = await writeAcceptanceTransaction(cwd, {
    worktree_branch: input.worktreeBranch,
    trunk: input.trunk,
    expected_trunk: input.expectedTrunk,
    target: input.target,
    main_repo: input.mainRepo,
    effort_claim: input.effortClaim,
    consent: input.consent,
  });
  const { transaction } = recorded;

  let claim: EffortGrantClaim | undefined;
  if (input.effortClaim) {
    const claimed = await claimEffortGrant(
      cwd,
      input.worktreeBranch,
      transaction.id,
    );
    if (claimed.status !== "claimed") {
      await removeJournal(recorded.path);
      return { kind: "authority-changed", claim: claimed };
    }
    claim = claimed.claim;
  }

  const outcome = await fastForwardCheckedOutBranch(
    input.mainRepo,
    input.trunk,
    input.expectedTrunk,
    input.target,
    { transactionId: transaction.id, transactionCwd: cwd },
  );
  const effortSettlement = claim === undefined
    ? undefined
    : await settleEffortGrantClaim(cwd, claim, outcome);
  if (
    !transitionRetainsJournal(outcome) &&
    (effortSettlement === undefined || effortSettlement.settled)
  ) {
    await removeJournal(recorded.path);
  }
  return {
    kind: "attempted",
    outcome,
    ...(effortSettlement === undefined ? {} : { effortSettlement }),
  };
}

/** Resolve symlinks for repository identity checks while preserving a missing path. */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
}

/** Restore an unconsumed effort claim, accepting an already-restored marker. */
async function restoreRecordedClaim(
  cwd: string,
  transaction: AcceptanceTransaction,
): Promise<boolean> {
  if (!transaction.effort_claim) {
    return true;
  }
  const read = await readEffortGrantClaim(
    cwd,
    transaction.worktree_branch,
    transaction.id,
  );
  return read.status === "missing"
    ? true
    : read.status === "claimed"
    ? await restoreEffortGrantClaim(cwd, read.claim)
    : false;
}

/** Consume one-shot effort authority after the journaled landing became durable. */
async function consumeRecordedClaim(
  cwd: string,
  transaction: AcceptanceTransaction,
): Promise<boolean> {
  return !transaction.effort_claim ||
    await consumeEffortGrantClaimById(cwd, transaction.id);
}

/** Explain grant consumption only for transactions that claimed one-shot authority. */
function effortConsumedClause(transaction: AcceptanceTransaction): string {
  return transaction.effort_claim
    ? " Its effort grant was consumed and will not be replayed."
    : "";
}

/** Copy consent scopes so recovery state cannot alias caller-owned arrays. */
function cloneConsent(consent: LandingConsent): LandingConsent {
  return {
    source: consent.source,
    ...(consent.scopes === undefined ? {} : { scopes: [...consent.scopes] }),
  };
}

/**
 * Inspect interrupted-transaction evidence without mutating it. A v2 journal
 * carries the consent checked before its exact expected→target boundary. A
 * legacy effort journal can still prove authority through its matching claim.
 * Legacy conversation/standing journals carry no such proof and therefore need
 * current authority before recovery may act.
 */
export async function inspectInterruptedAcceptance(
  cwd: string,
  configuredTrunk: string,
): Promise<InterruptedAcceptanceInspection> {
  const read = await readAcceptanceTransaction(cwd);
  if (read.status === "missing") {
    return { kind: "none" };
  }
  if (read.status === "invalid") {
    throw new WorktreeGitError(
      `Discern found an invalid interrupted-acceptance journal at ${read.path}: ` +
        `${read.reason}. It preserved every ref, authority marker, and checkout ` +
        "file. Inspect that journal before retrying acceptance.",
    );
  }
  const recorded: RecordedAcceptanceTransaction = read;
  const transaction = recorded.transaction;
  if (transaction.trunk !== configuredTrunk) {
    throw new WorktreeGitError(
      `Discern found an interrupted acceptance for trunk ${transaction.trunk}, ` +
        `but this branch now configures ${configuredTrunk}. It preserved the ` +
        `journal at ${recorded.path}; restore the recorded trunk setting or ` +
        "inspect the journal before retrying.",
    );
  }
  const actualMain = await mainRepoPath(cwd);
  if (
    actualMain === undefined ||
    await canonicalPath(transaction.main_repo) !==
      await canonicalPath(actualMain)
  ) {
    throw new WorktreeGitError(
      `Discern found an interrupted acceptance for main checkout ` +
        `${transaction.main_repo}, but this worktree now resolves a different ` +
        `repository. It preserved the journal at ${recorded.path}.`,
    );
  }
  let consent: LandingConsent | undefined;
  if (transaction.version === 2) {
    consent = cloneConsent(transaction.consent);
  } else if (transaction.effort_claim) {
    const claim = await readEffortGrantClaim(
      cwd,
      transaction.worktree_branch,
      transaction.id,
    );
    if (claim.status === "claimed") {
      consent = { source: "effort-grant" };
    }
  }
  return {
    kind: "recorded",
    path: recorded.path,
    transaction,
    ...(consent === undefined ? {} : { consent }),
  };
}

/** Remove a reconciled journal after its recorded effects converge. */
async function clearRecoveredJournal(
  recorded: RecordedAcceptanceTransaction,
): Promise<boolean> {
  return await removeJournal(recorded.path);
}

/** Explain the idempotent retry when recovery succeeded but journal deletion failed. */
function journalCleanupFailure(
  recorded: RecordedAcceptanceTransaction,
): string {
  return `Discern reconciled the interrupted acceptance but could not remove its ` +
    `journal at ${recorded.path}. Re-run \`discern accept\` to retry that ` +
    "idempotent cleanup before starting another landing.";
}

/** Record a recovery stop together with the irreversible effects already observed. */
function stoppedRecovery(
  message: string,
  recoveryPerformed: boolean,
  trunkLanded: boolean,
): InterruptedAcceptanceRecovery {
  return { kind: "stopped", recoveryPerformed, trunkLanded, message };
}

/**
 * Reconcile one already-inspected, already-authorized interrupted acceptance.
 * A pre-CAS/explicitly rolled-back claim is restored and ordinary acceptance
 * may continue under freshly checked authority. A durable CAS consumes its
 * one-shot authority, converges only an exact journal-owned old checkout, and
 * stops with the cleanup command instead of replaying the landing.
 */
export async function recoverInterruptedAcceptance(
  cwd: string,
  inspected: Exclude<
    InterruptedAcceptanceInspection,
    { readonly kind: "none" }
  >,
): Promise<InterruptedAcceptanceRecovery> {
  const recorded: RecordedAcceptanceTransaction = inspected;
  const transaction = recorded.transaction;

  const ref = await runGit(
    [
      "rev-parse",
      "--verify",
      `refs/heads/${transaction.trunk}^{commit}`,
    ],
    { cwd: transaction.main_repo },
  );
  if (!ref.success) {
    throw new WorktreeGitError(
      `Discern could not read the recorded trunk ${transaction.trunk} while ` +
        `recovering ${recorded.path}. It preserved the journal and checkout.`,
    );
  }
  const current = ref.stdout.trim();
  const marker = await readAcceptanceTransactionMarker(
    cwd,
    transaction.id,
  );
  if (
    marker.kind === "present" && marker.target !== transaction.target
  ) {
    throw new WorktreeGitError(
      `Discern found an interrupted-acceptance marker for ${marker.target}, ` +
        `but the journal records ${transaction.target}. It preserved the marker, ` +
        `journal, authority state, and checkout for inspection.`,
    );
  }

  const provenPreCas = marker.kind === "missing";
  if (current === transaction.expected_trunk && provenPreCas) {
    if (!(await restoreRecordedClaim(cwd, transaction))) {
      return stoppedRecovery(
        `Discern found the interrupted acceptance before its trunk transition, ` +
          `but could not restore its effort claim. It preserved the journal at ` +
          `${recorded.path}; inspect the desk grant and claim before retrying.`,
        transaction.effort_claim,
        false,
      );
    }
    if (!(await clearRecoveredJournal(recorded))) {
      return stoppedRecovery(
        journalCleanupFailure(recorded),
        transaction.effort_claim,
        false,
      );
    }
    return { kind: "ready", recoveryPerformed: true };
  }

  if (
    current === transaction.expected_trunk && marker.kind === "present"
  ) {
    const consumed = await consumeRecordedClaim(cwd, transaction);
    const cleared = consumed && await clearRecoveredJournal(recorded);
    if (consumed && !cleared) {
      return stoppedRecovery(
        journalCleanupFailure(recorded),
        transaction.effort_claim,
        false,
      );
    }
    return stoppedRecovery(
      `The interrupted acceptance advanced ${transaction.trunk} to ` +
        `${transaction.target} and was later reset to its expected commit ` +
        `${transaction.expected_trunk} without Discern's marker-clearing ` +
        `rollback.` +
        (consumed ? effortConsumedClause(transaction) : "") +
        ` Inspect \`git reflog show ${transaction.trunk}\` in ` +
        `${transaction.main_repo} before deciding whether to re-authorize and ` +
        `retry the intact branch ${transaction.worktree_branch}.` +
        (cleared ? "" : ` The recovery journal remains at ${recorded.path}.`),
      cleared || (transaction.effort_claim && consumed),
      false,
    );
  }

  if (current === transaction.target) {
    const consumed = await consumeRecordedClaim(cwd, transaction);
    const checkout = await recoverCheckedOutFastForward(
      transaction.main_repo,
      transaction.trunk,
      transaction.expected_trunk,
      transaction.target,
    );
    if (checkout.kind === "preserved") {
      return stoppedRecovery(
        `Discern found that the interrupted landing already advanced ` +
          `${transaction.trunk} to ${transaction.target}, but preserved the ` +
          `trunk checkout because ${checkout.detail}. Run \`git diff\` in ` +
          `${transaction.main_repo} and preserve or move any local data; then ` +
          `re-run \`discern accept\` to retry convergence. The recovery journal ` +
          `remains at ${recorded.path}.` +
          (consumed ? effortConsumedClause(transaction) : ""),
        transaction.effort_claim && consumed,
        true,
      );
    }
    const cleared = consumed && await clearRecoveredJournal(recorded);
    const performed = checkout.changed || cleared ||
      (transaction.effort_claim && consumed);
    if (consumed && !cleared) {
      return stoppedRecovery(
        journalCleanupFailure(recorded),
        performed,
        true,
      );
    }
    return stoppedRecovery(
      `Discern reconciled the interrupted landing of ${transaction.target} ` +
        `onto ${transaction.trunk}. No landing authority was replayed.` +
        effortConsumedClause(transaction) +
        ` Run \`discern worktree prune\` from ${transaction.main_repo} to finish ` +
        `the already-landed branch's cleanup.` +
        (cleared ? "" : ` The recovery journal remains at ${recorded.path}.`),
      performed,
      true,
    );
  }

  if (provenPreCas) {
    if (!(await restoreRecordedClaim(cwd, transaction))) {
      return stoppedRecovery(
        `Another process moved ${transaction.trunk} before this acceptance's ` +
          `trunk ref update, ` +
          `and Discern could not restore its effort claim. The journal remains at ` +
          `${recorded.path}.`,
        transaction.effort_claim,
        false,
      );
    }
    if (!(await clearRecoveredJournal(recorded))) {
      return stoppedRecovery(
        journalCleanupFailure(recorded),
        transaction.effort_claim,
        false,
      );
    }
    return { kind: "ready", recoveryPerformed: true };
  }

  const consumed = await consumeRecordedClaim(cwd, transaction);
  const cleared = consumed && await clearRecoveredJournal(recorded);
  if (consumed && !cleared) {
    return stoppedRecovery(
      journalCleanupFailure(recorded),
      transaction.effort_claim,
      false,
    );
  }
  const evidenceDetail = marker.kind === "present"
    ? `its per-worktree marker proves it previously advanced to ${transaction.target}`
    : `Git could not read the per-worktree marker (${marker.detail}), so Discern cannot prove that the trunk transition never happened`;
  return stoppedRecovery(
    `Discern found interrupted acceptance ${transaction.id} after ` +
      `${transaction.trunk} moved to ${current}; ${evidenceDetail}. It preserved ` +
      `the checkout and will not replay one-shot authority.` +
      (consumed ? effortConsumedClause(transaction) : "") +
      ` Inspect \`git reflog show ${transaction.trunk}\` and the intact branch ` +
      `${transaction.worktree_branch} before deciding whether to update or ` +
      `re-authorize it.` +
      (cleared ? "" : ` The recovery journal remains at ${recorded.path}.`),
    cleared || (transaction.effort_claim && consumed),
    false,
  );
}
