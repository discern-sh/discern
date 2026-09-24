/**
 * The durable transaction around acceptance's one-shot authority, trunk CAS,
 * and checked-out-tree convergence.
 *
 * The journal is written before either durable boundary. A landing that
 * removes its worktree lets Git reap the journal with the admin directory; a
 * landing that keeps its checkout retires the journal once every
 * post-transition step settles; an interrupted retry reads recorded facts
 * before ordinary authority and dirty-tree guards can mistake the
 * transaction's own state for user work.
 */

import { dirname, isAbsolute } from "@std/path";
import {
  LANDING_CONSENT_SOURCES,
  type LandingConsent,
} from "../../shared/consent.ts";
import {
  type AuthorizedVarianceData,
  type StandardLimitProposalData,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  claimEffortGrant,
  consumeEffortGrantClaimById,
  type EffortGrantClaim,
  type EffortGrantClaimRead,
  type EffortGrantClaimSettlement,
  readRecoveryEffortGrantClaim,
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
  WorktreeResultError,
} from "./git.ts";
import {
  OperationLockError,
  type OperationLockWait,
  withAcceptanceRecoveryBoundary,
} from "../operation_lock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

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
  {
    id: "proof-note",
    evidence:
      "the honored worktree Proof and journal-bound acceptance evidence on the landed commit",
  },
] as const;

export type AcceptanceTransactionBoundary =
  (typeof ACCEPTANCE_TRANSACTION_BOUNDARIES)[number]["id"];

/** The integration worktree one recorded landing owns, when it composed. */
export interface AcceptanceTransactionIntegration {
  readonly worktree_id: string;
  readonly worktree_branch: string;
  readonly worktree_path: string;
}

interface AcceptanceTransactionBase {
  readonly id: string;
  readonly worktree_branch: string;
  readonly trunk: string;
  readonly expected_trunk: string;
  readonly target: string;
  readonly main_repo: string;
  readonly effort_claim: boolean;
  /** The exact submission this landing consumes, when one was recorded. */
  readonly submission_id?: string;
  /** The complete Proof the landed target carries, for post-transition
   * recording; recovery reads it from common storage. */
  readonly proof?: {
    readonly candidate_id: string;
    readonly proof_id: string;
  };
  /** Present when the landing composed a moved trunk in an integration
   * worktree it owns; recovery and pruning finish that copy's cleanup. */
  readonly integration?: AcceptanceTransactionIntegration;
}

type AcceptanceTransaction = AcceptanceTransactionBase & {
  readonly version: typeof ON_DISK_FORMATS.acceptanceTransaction.version;
  /** Consent already checked before this exact expected→target boundary. */
  readonly consent: LandingConsent;
  /** Owner-authorized variances bound to this exact transition. */
  readonly variances: readonly AuthorizedVarianceData[];
  /** Exact Standard/value/reason tuples approved for this transition. */
  readonly standard_proposals: readonly StandardLimitProposalData[];
};

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
    /** The recorded transition stands at the trunk tip with its one-shot
     * authority spent and the trunk checkout settled. The journal stays: the
     * caller retires it with {@link clearCompletedAcceptanceJournal} once it
     * has settled what the landing still owes. */
    readonly kind: "landed";
    readonly recoveryPerformed: boolean;
    readonly message: string;
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
 * Run one acceptance apply while holding the repository-wide acceptance policy.
 *
 * The shared capability acquires the acceptance lock before this checkout's
 * lock, so two linked worktrees cannot inspect one another's active
 * acceptance as interrupted state or overlap the shared trunk transition.
 * With `wait`, a contended boundary queues behind the running landing and
 * resumes on its own instead of refusing.
 */
export async function withAcceptanceTransactionLock<T>(
  cwd: string,
  operation: () => Promise<T>,
  wait?: OperationLockWait,
): Promise<T> {
  try {
    return await withAcceptanceRecoveryBoundary(cwd, operation, wait);
  } catch (error) {
    if (error instanceof OperationLockError) {
      throw new WorktreeResultError(error.message, error.result, {
        cause: error,
      });
    }
    throw error;
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

/** Validate one journaled variance binding: the four opaque strings that tie
 * an owner decision to its exact declaration. */
function parseVariance(value: unknown): AuthorizedVarianceData | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { checkpoint, definition_hash, subject, why } = value;
  if (
    typeof checkpoint !== "string" || checkpoint === "" ||
    typeof definition_hash !== "string" || definition_hash === "" ||
    typeof subject !== "string" || subject === "" ||
    typeof why !== "string" || why === ""
  ) {
    return undefined;
  }
  return { checkpoint, definition_hash, subject, why };
}

/** Validate a journaled variance list, or undefined when any entry is unusable. */
function parseVariances(
  value: unknown,
): AuthorizedVarianceData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: AuthorizedVarianceData[] = [];
  for (const entry of value) {
    const variance = parseVariance(entry);
    if (variance === undefined) {
      return undefined;
    }
    out.push(variance);
  }
  return out;
}

/** Validate the exact Standard proposal tuples journaled at approval time. */
function parseStandardProposals(
  value: unknown,
): StandardLimitProposalData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const proposals: StandardLimitProposalData[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    const parsed = StandardLimitProposalSchema.safeParse(entry);
    if (!parsed.success || names.has(parsed.data.standard)) {
      return undefined;
    }
    names.add(parsed.data.standard);
    proposals.push(parsed.data);
  }
  return proposals;
}

/** Validate an optional journaled proof pointer. */
function parseProofPointer(
  value: unknown,
): AcceptanceTransactionBase["proof"] | undefined | false {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return false;
  const { candidate_id, proof_id } = value;
  if (
    typeof candidate_id !== "string" || !TRANSACTION_ID.test(candidate_id) ||
    typeof proof_id !== "string" || !TRANSACTION_ID.test(proof_id)
  ) return false;
  return { candidate_id, proof_id };
}

/** Validate an optional journaled integration-worktree block. */
function parseIntegration(
  value: unknown,
): AcceptanceTransactionIntegration | undefined | false {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return false;
  const { worktree_id, worktree_branch, worktree_path } = value;
  if (
    typeof worktree_id !== "string" || worktree_id === "" ||
    !isRefName(worktree_branch) ||
    typeof worktree_path !== "string" || !isAbsolute(worktree_path)
  ) return false;
  return {
    worktree_id,
    worktree_branch: worktree_branch as string,
    worktree_path,
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
  const version = inspectOnDiskRecordVersion("acceptanceTransaction", parsed);
  if (version.status === "newer") {
    throw new Error(
      newerOnDiskFormatMessage("acceptanceTransaction", version.found),
    );
  }
  const consent = parseLandingConsent(parsed.consent);
  const variances = parseVariances(parsed.variances);
  const standardProposals = parseStandardProposals(
    parsed.standard_proposals,
  );
  const proof = parseProofPointer(parsed.proof);
  const integration = parseIntegration(parsed.integration);
  if (
    proof === false || integration === false ||
    (parsed.submission_id !== undefined &&
      (typeof parsed.submission_id !== "string" ||
        !TRANSACTION_ID.test(parsed.submission_id))) ||
    parsed.version !== ON_DISK_FORMATS.acceptanceTransaction.version ||
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
    consent === undefined ||
    (consent.source === "effort-grant") !== parsed.effort_claim ||
    variances === undefined ||
    standardProposals === undefined ||
    // A variance forces current-conversation consent; a journal claiming one
    // under any recorded grant is not a record this engine ever wrote.
    variances.length > 0 && consent.source !== "conversation" ||
    standardProposals.length > 0 && consent.source !== "conversation"
  ) {
    throw new Error(
      `the record needs version ${ON_DISK_FORMATS.acceptanceTransaction.version}, a transaction id, branch/trunk ` +
        "names, expected and target object IDs, an absolute main checkout, " +
        "an effort-claim flag, matching consent evidence, authorized variances, " +
        "and exact standard proposals; decisions bind to conversation consent",
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
    ...(typeof parsed.submission_id === "string"
      ? { submission_id: parsed.submission_id }
      : {}),
    ...(proof === undefined ? {} : { proof }),
    ...(integration === undefined ? {} : { integration }),
  };
  return {
    version: ON_DISK_FORMATS.acceptanceTransaction.version,
    ...base,
    consent: consent as LandingConsent,
    variances: variances as AuthorizedVarianceData[],
    standard_proposals: standardProposals as StandardLimitProposalData[],
  };
}

/** Classify the recovery journal as missing, valid, or unusable without hiding read failures. */
async function readAcceptanceTransaction(
  cwd: string,
): Promise<AcceptanceTransactionRead> {
  const path = await gitAdminStatePath(cwd, "acceptanceTransaction");
  if (path === undefined) {
    throw new WorktreeGitError(
      "Git could not resolve discern's acceptance-transaction journal. " +
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

/** Retire the journal of a landing whose post-transition obligations settled.
 *
 * A journal recording exactly the landed target is the spent retry vehicle of
 * a transaction whose post-transition obligations all settled — in the
 * landing itself, or in the retry that recovered it; leaving it in a
 * surviving checkout would send the next acceptance into recovery for a
 * finished landing instead of landing new work. The worktree-scoped marker
 * ref stays, so landed authority remains spent. Any other journal — another
 * target, or unreadable — stays for recovery to classify. */
export async function clearCompletedAcceptanceJournal(
  cwd: string,
  landedTarget: string,
): Promise<boolean> {
  const read = await readAcceptanceTransaction(cwd);
  if (read.status === "missing") return true;
  if (read.status === "invalid") return false;
  if (read.transaction.target !== landedTarget) return false;
  return await removeJournal(read.path);
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
    readonly variances: readonly AuthorizedVarianceData[];
    readonly standardProposals: readonly StandardLimitProposalData[];
  },
  entropy: SecureEntropy,
): Promise<RecordedAcceptanceTransaction> {
  const optional = {
    ...(input.submission_id === undefined
      ? {}
      : { submission_id: input.submission_id }),
    ...(input.proof === undefined ? {} : { proof: { ...input.proof } }),
    ...(input.integration === undefined
      ? {}
      : { integration: { ...input.integration } }),
  };
  const current = await readAcceptanceTransaction(cwd);
  if (current.status !== "missing") {
    const detail = current.status === "invalid"
      ? ` It is invalid: ${current.reason}.`
      : "";
    throw new WorktreeGitError(
      `discern found an existing acceptance-transaction journal at ${current.path}.` +
        `${detail} Re-run \`discern accept\` so recovery can reconcile it before ` +
        "starting another landing.",
    );
  }
  const id = entropy.uuid();
  const transaction: AcceptanceTransaction = {
    version: ON_DISK_FORMATS.acceptanceTransaction.version,
    id,
    worktree_branch: input.worktree_branch,
    trunk: input.trunk,
    expected_trunk: input.expected_trunk,
    target: input.target,
    main_repo: input.main_repo,
    effort_claim: input.effort_claim,
    ...optional,
    consent: cloneConsent(input.consent),
    variances: input.variances.map((variance) => ({ ...variance })),
    standard_proposals: input.standardProposals.map((proposal) => ({
      ...proposal,
      evidence_paths: [...proposal.evidence_paths],
    })),
  };
  await Deno.mkdir(dirname(current.path), { recursive: true });
  const temp = `${current.path}.tmp-${entropy.uuid()}`;
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
      `discern could not record the acceptance transaction before its authority ` +
        `boundary. Nothing was claimed or landed. ${
          error instanceof Error ? error.message : String(error)
        }`,
      { cause: error },
    );
  } finally {
    await bestEffort("acceptance-transaction-temp-cleanup", async () => {
      await Deno.remove(temp);
    });
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
    readonly grantId?: string;
    readonly consent: LandingConsent;
    /** The owner-authorized variances this exact transition lands under. */
    readonly variances: readonly AuthorizedVarianceData[];
    readonly standardProposals: readonly StandardLimitProposalData[];
    /** The exact submission this landing consumes, when one is recorded. */
    readonly submissionId?: string;
    /** The landed target's complete Proof pointer, for recovery recording. */
    readonly proof?: { candidate_id: string; proof_id: string };
    /** The integration worktree this landing owns, when it composed. */
    readonly integration?: AcceptanceTransactionIntegration;
  },
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<AcceptanceTransitionResult> {
  const recorded = await writeAcceptanceTransaction(cwd, {
    worktree_branch: input.worktreeBranch,
    trunk: input.trunk,
    expected_trunk: input.expectedTrunk,
    target: input.target,
    main_repo: input.mainRepo,
    effort_claim: input.effortClaim,
    ...(input.submissionId === undefined
      ? {}
      : { submission_id: input.submissionId }),
    ...(input.proof === undefined ? {} : { proof: input.proof }),
    ...(input.integration === undefined
      ? {}
      : { integration: input.integration }),
    consent: input.consent,
    variances: input.variances,
    standardProposals: input.standardProposals,
  }, entropy);
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
    // The grant binds to the effort: its branch must be the one landing, and
    // a caller that reviewed a specific grant must still hold that one.
    const valid = claim.grant.branch === input.worktreeBranch &&
      (input.grantId === undefined || input.grantId === claim.grant.id);
    if (!valid) {
      const restored = await restoreEffortGrantClaim(cwd, claim);
      if (restored) await removeJournal(recorded.path);
      return {
        kind: "authority-changed",
        claim: {
          status: "invalid",
          reason: restored
            ? "The recorded grant is not the one this landing reviewed. Review the desk's current grant; the trunk did not move."
            : "The recorded grant changed and could not be restored. Recover the recorded acceptance before retrying; the trunk did not move.",
        },
      };
    }
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
  const read = await readRecoveryEffortGrantClaim(
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
 * Inspect interrupted-transaction evidence without mutating it. The journal
 * carries the consent checked before its exact expected→target boundary.
 * Malformed or noncanonical journals cannot recover authority.
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
      `discern found an invalid interrupted-acceptance journal at ${read.path}: ` +
        `${read.reason}. It preserved every ref, authority marker, and checkout ` +
        "file. Inspect that journal before retrying acceptance.",
    );
  }
  const recorded: RecordedAcceptanceTransaction = read;
  const transaction = recorded.transaction;
  if (transaction.trunk !== configuredTrunk) {
    throw new WorktreeGitError(
      `discern found an interrupted acceptance for trunk ${transaction.trunk}, ` +
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
      `discern found an interrupted acceptance for main checkout ` +
        `${transaction.main_repo}, but this worktree now resolves a different ` +
        `repository. It preserved the journal at ${recorded.path}.`,
    );
  }
  const consent = cloneConsent(transaction.consent);
  return {
    kind: "recorded",
    path: recorded.path,
    transaction,
    ...(consent === undefined ? {} : { consent }),
  };
}

/** Remove a recovered journal after its recorded effects converge. */
async function clearRecoveredJournal(
  recorded: RecordedAcceptanceTransaction,
): Promise<boolean> {
  return await removeJournal(recorded.path);
}

/** Explain the idempotent retry when recovery succeeded but journal deletion failed. */
function journalCleanupFailure(
  recorded: RecordedAcceptanceTransaction,
): string {
  return `discern completed the interrupted acceptance but could not remove its ` +
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
 * Complete or roll back one already-inspected, already-authorized interrupted acceptance.
 * A pre-CAS/explicitly rolled-back claim is restored and ordinary acceptance
 * may continue under freshly checked authority. A durable CAS consumes its
 * one-shot authority, converges only an exact journal-owned old checkout, and
 * reports the landing without replaying it; the caller settles what the
 * landing still owes before retiring the journal.
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
      `discern could not read the recorded trunk ${transaction.trunk} while ` +
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
      `discern found an interrupted-acceptance marker for ${marker.target}, ` +
        `but the journal records ${transaction.target}. It preserved the marker, ` +
        `journal, authority state, and checkout for inspection.`,
    );
  }

  const provenPreCas = marker.kind === "missing";
  if (current === transaction.expected_trunk && provenPreCas) {
    if (!(await restoreRecordedClaim(cwd, transaction))) {
      return stoppedRecovery(
        `discern found the interrupted acceptance before its trunk transition, ` +
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
        `${transaction.expected_trunk} without discern's marker-clearing ` +
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
        `discern found that the interrupted landing already advanced ` +
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
    const performed = checkout.changed ||
      (transaction.effort_claim && consumed);
    const resumed =
      `discern resumed the recorded landing of ${transaction.target} ` +
      `onto ${transaction.trunk}. No landing authority was replayed.` +
      (consumed ? effortConsumedClause(transaction) : "");
    if (!consumed) {
      return stoppedRecovery(
        `${resumed} Its effort claim could not be consumed, so the ` +
          `recovery journal remains at ${recorded.path}; re-run ` +
          "`discern accept` to retry.",
        performed,
        true,
      );
    }
    return { kind: "landed", recoveryPerformed: performed, message: resumed };
  }

  if (provenPreCas) {
    if (!(await restoreRecordedClaim(cwd, transaction))) {
      return stoppedRecovery(
        `Another process moved ${transaction.trunk} before this acceptance's ` +
          `trunk ref update, ` +
          `and discern could not restore its effort claim. The journal remains at ` +
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
    : `Git could not read the per-worktree marker (${marker.detail}), so discern cannot prove that the trunk transition never happened`;
  return stoppedRecovery(
    `discern found interrupted acceptance ${transaction.id} after ` +
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
