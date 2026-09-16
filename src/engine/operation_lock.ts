/**
 * Shared exclusion and Git-write capability for classified discern operations.
 *
 * Publication protects short shared-state transitions. Lifecycle and acceptance
 * serializers retain their own transaction ordering while project commands run
 * under worktree and resource leases. Ordinary checkout writers share the path
 * reservation that a lifecycle holds from before creation through removal.
 * Nested calls reuse authenticated leases; explicit owned-worktree scopes alone
 * may enter a second checkout. Git writers separately prove administrative
 * write access before executing their planned effects.
 */
import { FileLock, type FileLockIO } from "../shared/file_lock.ts";
import { runGit } from "../shared/subprocess.ts";

import { dirname, join, resolve } from "@std/path";
import { AsyncLocalStorage } from "../shared/module_loading.ts";
import { withTrackedRun } from "./jobs/interrupt.ts";
import { SYSTEM_CLOCK } from "../shared/clock.ts";
import { SYSTEM_SCHEDULER } from "../shared/scheduler.ts";
import { withProgressWait } from "./completion/progress_wait.ts";
import { bestEffort } from "../shared/best_effort.ts";
import {
  type OperationEffectPolicy,
  operationEffectPolicy,
  type OperationInvocationFacts,
  type OperationLockBoundary,
} from "../shared/operation_effects.ts";
import { readTextIfExists } from "../shared/fs_presence.ts";
import { findRoot } from "../shared/env.ts";
import { gitAdminStatePath } from "../shared/git_admin_state.ts";
import {
  currentOperationLocks,
  currentOperationOwner,
  type HeldOperationLocks,
  inheritedOperationLockLease,
  type OperationLockConcreteBoundary,
  type OperationLockLease,
  recordedOperationOwner,
  runWithOperationLocks,
} from "../shared/operation_lock_context.ts";
import type { DiscernResult } from "../shared/result.ts";
import { sha256Hex } from "../shared/sha256.ts";
import {
  type PlannedWriteTarget,
  preflightPlannedWrites,
  writePreflightFailureResult,
} from "../shared/write_preflight.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../shared/entropy.ts";
import {
  discoverGit,
  invalidateGitDiscovery,
  withGitDiscoveryScope,
} from "../shared/git_discovery.ts";

/** One classified operation invocation. */
export interface OperationInvocation extends OperationInvocationFacts {
  readonly command: string;
  /** Published envelope discriminator supplied by the invoking surface. */
  readonly resultVerb?: string;
  /** Copyable retry preserving the caller's invocation when that surface has it. */
  readonly reproduceCmd?: string;
}

/** A routed refusal produced before an operation body runs. */
export class OperationLockError extends Error {
  readonly result: DiscernResult;

  constructor(result: DiscernResult, options?: ErrorOptions) {
    super(
      result.message ?? "The operation lock could not be acquired.",
      options,
    );
    this.name = "OperationLockError";
    this.result = result;
  }
}

interface LockSpec {
  readonly boundary: OperationLockConcreteBoundary;
  readonly key: string;
  readonly path: string;
}

interface AcquiredLock {
  readonly file?: FileLock;
  readonly previousContents?: Uint8Array;
  readonly lease: OperationLockLease;
}

/** Keep internal callers exact unless a public surface supplies its contract. */
function resultVerb(invocation: OperationInvocation): string {
  return invocation.resultVerb ?? invocation.command;
}

/**
 * One host path independent of caller-controlled temp variables. discern ships
 * for POSIX hosts (Windows runs the Linux binary under WSL), so `/tmp` is the
 * common runtime boundary every process can resolve alike.
 */
const HOST_OPERATION_LOCK_ROOT = "/tmp";

/** The ordered concrete boundaries represented by one policy value. */
function concreteBoundaries(
  boundary: OperationLockBoundary,
): readonly OperationLockConcreteBoundary[] {
  switch (boundary) {
    case "none":
      return [];
    case "checkout":
      return ["checkout"];
    case "common":
      return ["common"];
    case "lifecycle":
      return ["lifecycle"];
    case "lifecycle-and-checkout":
      return ["lifecycle", "checkout"];
    case "common-and-checkout":
    case "phased":
      return ["common", "checkout"];
    case "acceptance-and-checkout":
      return ["acceptance", "checkout"];
  }
}

/** One stable refusal envelope for every lock-boundary failure. */
function refusal(
  invocation: OperationInvocation,
  message: string,
): OperationLockError {
  return new OperationLockError({
    ok: false,
    verb: resultVerb(invocation),
    error: "precondition_failed",
    message,
  });
}

/** Human name for a protected boundary. */
function boundaryName(boundary: OperationLockConcreteBoundary): string {
  return boundary === "common"
    ? "common repository boundary"
    : boundary === "acceptance"
    ? "acceptance boundary"
    : boundary === "lifecycle"
    ? "lifecycle boundary"
    : boundary === "resource"
    ? "resource boundary"
    : "checkout boundary";
}

/** Resolve all paths before taking any lock, in mandatory acquisition order. */
async function resolveLockSpecs(
  cwd: string,
  boundary: OperationLockBoundary,
): Promise<LockSpec[] | undefined> {
  const specs: LockSpec[] = [];
  for (const concrete of concreteBoundaries(boundary)) {
    const anchor = await gitAdminStatePath(
      cwd,
      concrete === "checkout" ? "gateProof" : "resources",
    );
    if (anchor === undefined) return undefined;
    const adminDirectory = await Deno.realPath(dirname(dirname(anchor)));
    if (concrete === "checkout") {
      const toplevel = await discoverGit(
        cwd,
        { kind: "toplevel" },
        (directory, args) => runGit(args, { cwd: directory }),
      );
      if (!toplevel.success || toplevel.stdout.trim() === "") return undefined;
      specs.push(await worktreeLockSpec(toplevel.stdout.trim()));
    }
    specs.push(await hostLockSpec(concrete, `git-admin:${adminDirectory}`));
  }
  return specs;
}

/** Place an OS lock under the host temp directory for one stable identity. */
async function hostLockSpec(
  boundary: OperationLockConcreteBoundary,
  identity: string,
): Promise<LockSpec> {
  const lockId = await sha256Hex(`${boundary}\0${identity}`);
  return {
    boundary,
    key: `${boundary}:${identity}`,
    path: join(
      HOST_OPERATION_LOCK_ROOT,
      `discern-operation-lock-${lockId}.lock`,
    ),
  };
}

/**
 * Stable exclusion while Git administration paths are unavailable. Root
 * discovery remains the command body's concern: the fallback only prevents the
 * lock layer from replacing a command's own setup or not-initialized result.
 */
async function resolvePreRepositoryLockSpecs(
  root: string,
  boundary: OperationLockBoundary,
): Promise<LockSpec[]> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await Deno.realPath(root);
  } catch {
    canonicalRoot = resolve(root);
  }
  const specs: LockSpec[] = [];
  for (const concrete of concreteBoundaries(boundary)) {
    if (concrete === "checkout") specs.push(await worktreeLockSpec(root));
    specs.push(await hostLockSpec(concrete, `project-root:${canonicalRoot}`));
  }
  return specs;
}

/** Derive the broad real Git-admin surfaces for one classified invocation. */
async function operationBoundaryWrites(
  cwd: string,
  policy: OperationEffectPolicy,
  projectRoot: string | undefined,
): Promise<{ targets: PlannedWriteTarget[]; commonGitDirectory?: string }> {
  const writesCheckout = policy.effects.includes("discern-checkout-mutation");
  const [commonAnchor, checkoutAnchor] = await Promise.all([
    gitAdminStatePath(cwd, "resources"),
    writesCheckout ? gitAdminStatePath(cwd, "gateProof") : undefined,
  ]);
  if (
    commonAnchor === undefined ||
    (writesCheckout && checkoutAnchor === undefined)
  ) {
    return { targets: [] };
  }
  const targets: PlannedWriteTarget[] = [
    {
      kind: "directory-entry",
      path: dirname(dirname(commonAnchor)),
      description: "this discern operation's common Git administration",
    },
  ];
  if (checkoutAnchor !== undefined) {
    targets.push({
      kind: "directory-entry",
      path: dirname(dirname(checkoutAnchor)),
      description: "this discern operation's checkout Git administration",
    });
    targets.push({
      kind: "directory-entry",
      path: projectRoot ?? cwd,
      description: "the checkout containing its planned discern-owned writes",
    });
  }
  return { targets, commonGitDirectory: dirname(dirname(commonAnchor)) };
}

/** Fail before the command body when its classified write boundary is denied. */
async function preflightOperationBoundary(
  cwd: string,
  invocation: OperationInvocation,
  policy: OperationEffectPolicy,
  entropy: SecureEntropy,
): Promise<string | undefined> {
  if (
    policy.gitWriteAuthority !== "boundary-plan" &&
    policy.gitWriteAuthority !== "boundary-plus-effect-plan"
  ) return;
  const projectRoot = await findRoot(cwd);
  if (projectRoot === undefined && policy.lockWithoutProject !== true) return;
  const writes = await operationBoundaryWrites(cwd, policy, projectRoot);
  const preflight = await preflightPlannedWrites(writes.targets, entropy);
  if (preflight.ok) return writes.commonGitDirectory;
  throw new OperationLockError(
    writePreflightFailureResult(
      resultVerb(invocation),
      preflight,
      invocation.reproduceCmd ?? `discern ${invocation.command}`,
    ),
  );
}

/** Replace the inert record bytes while retaining the open handle's OS lock. */
async function replaceLockRecord(
  file: FileLockIO,
  contents: Uint8Array,
): Promise<void> {
  await file.truncate(0);
  await file.seek(0, Deno.SeekMode.Start);
  let offset = 0;
  while (offset < contents.length) {
    const written = await file.write(contents.subarray(offset));
    if (written === 0) {
      throw new Error("the lock record write made no progress");
    }
    offset += written;
  }
}

/** Restore inert file bytes, then close owned handles in reverse order. */
async function releaseLocks(locks: AcquiredLock[]): Promise<void> {
  for (const lock of locks.reverse()) {
    const file = lock.file;
    if (file === undefined) continue;
    await bestEffort("operation-lock-record-restore", async () => {
      await replaceLockRecord(
        file.io,
        lock.previousContents ?? new Uint8Array(),
      );
    });
    file.close();
  }
}

/** How a caller waits for a contended boundary instead of refusing. */
export interface OperationLockWait {
  /** Cancels the wait; the refusal says the wait was cancelled, not lost. */
  readonly signal?: AbortSignal;
  /** Fired once per contended boundary, before the first blocking pause. */
  readonly onContended?: (boundary: OperationLockConcreteBoundary) => void;
}

/** Open and exclusively try-lock one inert host-temporary lock file. */
async function acquireLock(
  invocation: OperationInvocation,
  cwd: string,
  spec: LockSpec,
  entropy: SecureEntropy,
  waitForPublication: boolean,
  wait?: OperationLockWait,
): Promise<AcquiredLock> {
  let file: FileLock;
  try {
    file = await FileLock.open(spec.path, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch (error) {
    throw refusal(
      invocation,
      `discern could not open the ${boundaryName(spec.boundary)} for ${cwd}. ` +
        `This call made no change. Retry after the boundary is writable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  let acquired: boolean;
  try {
    acquired = await file.tryAcquire();
  } catch (error) {
    file.close();
    throw refusal(
      invocation,
      `discern could not check the ${
        boundaryName(spec.boundary)
      } for ${cwd}. ` +
        `This call made no change. Retry after Git's administrative area is readable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  if (!acquired) {
    const inherited = inheritedOperationLockLease(spec.key, spec.path);
    if (inherited !== undefined) {
      const record = await readTextIfExists(spec.path);
      const token = record?.match(/^discern-operation-lock-v1 ([^\n]+)(?:\n|$)/)
        ?.[1];
      const recordedToken = token === "" ? undefined : token;
      if (recordedToken === inherited.token) {
        file.close();
        return { lease: inherited };
      }
    }
  }
  try {
    if (!acquired && waitForPublication) {
      await withProgressWait(async (wait) => {
        wait.update({
          kind: "repository-update",
          reason:
            "Waiting for another operation to finish updating shared repository state.",
          next:
            "This run retries automatically for up to 10 s, then reports whether a retry is needed.",
        });
        const deadline = SYSTEM_CLOCK.monotonicNow() + 10_000;
        while (!acquired && SYSTEM_CLOCK.monotonicNow() < deadline) {
          await new Promise<void>((resolve) =>
            SYSTEM_SCHEDULER.scheduleTimeout(resolve, 25)
          );
          acquired = await file.tryAcquire();
        }
        wait.end(
          acquired ? "resumed" : "unmet",
          acquired
            ? "The shared repository state is available; this operation can continue."
            : "The other operation is still updating shared repository state.",
          acquired
            ? "No action is needed."
            : "This call could not continue. Retry after the other operation finishes.",
        );
      });
    }
    if (!acquired && wait !== undefined) {
      // A waiting caller queues behind the holder instead of refusing. The
      // pause is unbounded by design — the holder's own budgets bound it —
      // and the caller's signal remains the way out. Cancellation is checked
      // again after every acquisition attempt: an abort that arrives during
      // the pause must refuse even when the very next attempt succeeds,
      // because the caller has already stopped wanting the effects.
      wait.onContended?.(spec.boundary);
      const cancelled = (): never => {
        // The enclosing catch closes the handle exactly once, releasing any
        // lock this attempt just took.
        throw refusal(
          invocation,
          `The wait for the ${
            boundaryName(spec.boundary)
          } was cancelled while another discern operation held it. ` +
            "This call made no change. Retry when ready.",
        );
      };
      while (!acquired) {
        if (wait.signal?.aborted === true) cancelled();
        await new Promise<void>((resolve) =>
          SYSTEM_SCHEDULER.scheduleTimeout(resolve, 250)
        );
        acquired = await file.tryAcquire();
      }
      if (wait.signal?.aborted === true) cancelled();
    }
  } catch (error) {
    file.close();
    throw error;
  }
  if (!acquired) {
    const record = await readTextIfExists(spec.path);
    const holder = recordedOperationOwner(record);
    file.close();
    const identity = "unavailable" in holder
      ? `${holder.unavailable} Let the active caller finish or cancel it through its calling surface.`
      : `Holder: ${holder.command} in ${holder.path}, started ${holder.started} (operation ${holder.id}). ` +
        (holder.handle === undefined
          ? "Cancel through its calling surface if needed."
          : `Inspect it with \`discern progress ${holder.handle}\`; cancel through its calling surface if needed.`);
    throw refusal(
      invocation,
      `Another discern operation holds the ${
        boundaryName(spec.boundary)
      } for ${cwd}. ` +
        `This call made no change. Retry after that operation finishes. ${identity}`,
    );
  }
  let previousContents: Uint8Array;
  try {
    previousContents = await Deno.readFile(spec.path);
  } catch (error) {
    file.close();
    throw refusal(
      invocation,
      `discern could not read the ${boundaryName(spec.boundary)} for ${cwd}. ` +
        `This call made no change. Retry after the boundary is readable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  const lease: OperationLockLease = {
    boundary: spec.boundary,
    key: spec.key,
    path: spec.path,
    token: entropy.uuid(),
    ...(currentOperationOwner() === undefined
      ? {}
      : { owner: currentOperationOwner() }),
  };
  try {
    await replaceLockRecord(
      file.io,
      new TextEncoder().encode(
        `discern-operation-lock-v1 ${lease.token}\n${
          lease.owner === undefined ? "" : JSON.stringify(lease.owner) + "\n"
        }`,
      ),
    );
  } catch (error) {
    await bestEffort("operation-lock-acquire-rollback", async () => {
      await replaceLockRecord(file.io, previousContents);
    });
    file.close();
    throw refusal(
      invocation,
      `discern could not record the ${
        boundaryName(spec.boundary)
      } lease for ${cwd}. ` +
        `This call made no change. Retry after the boundary is writable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  return { file, previousContents, lease };
}

/**
 * Run one classified operation while holding its policy boundary and proving
 * any registry-declared Git-write authority.
 *
 * Lock files carry diagnostic metadata. Only the operating-system lock on an
 * open handle establishes ownership; an orphaned path is inert and reusable.
 */
export async function withOperationLock<T>(
  cwd: string,
  invocation: OperationInvocation,
  operation: () => Promise<T>,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<T> {
  const policy = operationEffectPolicy(invocation.command, invocation);
  if (policy === undefined) {
    throw refusal(
      invocation,
      `discern has no operation-effect policy for \`${invocation.command}\`. ` +
        "This call made no change. Retry after the command is classified.",
    );
  }
  return await withGitDiscoveryScope(() =>
    withPolicyLock(cwd, invocation, policy, operation, entropy)
  );
}

/** Version-one journal recovery holds exclusion for its whole transaction.
 * A `wait` makes a contended acceptance serializer queue behind the running
 * landing instead of refusing — the second `accept`'s turn-taking. Landings
 * serialize on the dedicated acceptance boundary and hold the author's
 * checkout; the short common publication boundary joins per phase through
 * `withLandingCommonPhase`, so a long combined check never starves ordinary
 * completion publications, and the author-checkout acquisition stays
 * nonblocking so a running `done` there can finish and publish. */
export async function withAcceptanceRecoveryBoundary<T>(
  cwd: string,
  operation: () => Promise<T>,
  wait?: OperationLockWait,
): Promise<T> {
  return await withPolicyLock(
    cwd,
    { command: "accept" },
    {
      effects: [
        "discern-checkout-mutation",
        "discern-common-mutation",
        "discern-git-mutation",
      ],
      lock: "acceptance-and-checkout",
      preview: "required",
      gitWriteAuthority: "boundary-plan",
    },
    operation,
    SYSTEM_SECURE_ENTROPY,
    undefined,
    false,
    wait,
  );
}

/** One short transactional phase of a landing: the common publication
 * boundary encloses shared publication and transition effects. Project commands,
 * resource cleanup, and capacity admission belong outside it. Reentrant while a phase is already held. */
export async function withLandingCommonPhase<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  return await withPolicyLock(
    cwd,
    { command: "accept" },
    {
      effects: [
        "discern-checkout-mutation",
        "discern-common-mutation",
        "discern-git-mutation",
      ],
      lock: "common",
      preview: "required",
      gitWriteAuthority: "boundary-plan",
    },
    operation,
    SYSTEM_SECURE_ENTROPY,
    undefined,
    true,
  );
}

/** Concurrent local publications share a FIFO; the OS lock still excludes other processes. */
const completionPublications = new Map<string, Promise<void>>();
const currentPublication = new AsyncLocalStorage<{
  readonly key: string;
  active: boolean;
  readonly children: Map<string, Promise<void>>;
}>();

/** Completion publications own only the short shared boundary. Cross-process
 * contention waits at most ten seconds before any callback effect runs. Return
 * publications use the same bounded wait after cancellation; ordinary operation
 * locks and invalid lock-order acquisitions remain non-blocking refusals.
 * The callback may reuse the common directory resolved by its locked write
 * preflight; absent a project preflight, it resolves storage itself. No
 * publication capability survives its callback. Independent publications share
 * the FIFO even when their enclosing operation already owns the common lock. */
export async function withCompletionPublication<T>(
  cwd: string,
  operation: (commonGitDirectory?: string) => Promise<T>,
): Promise<T> {
  const run = (): Promise<T> =>
    withPolicyLock(
      cwd,
      { command: "accept" },
      {
        effects: ["discern-common-mutation", "discern-git-mutation"],
        lock: "common",
        preview: "required",
        gitWriteAuthority: "boundary-plan",
      },
      operation,
      SYSTEM_SECURE_ENTROPY,
      undefined,
      true,
    );
  const held = currentOperationLocks();
  const spec = (await resolveLockSpecs(cwd, "common"))?.[0];
  const enclosing = currentPublication.getStore();
  if (
    spec === undefined ||
    (held?.boundaries.has("checkout") && held.completionExecution !== true &&
      !held.leases.has(spec.key))
  ) return await run();
  // Nested siblings serialize within their parent; they must not wait on the
  // parent's global slot while that parent is awaiting their completion.
  const queue = enclosing?.active === true && enclosing.key === spec.key
    ? enclosing.children
    : completionPublications;
  const previous = queue.get(spec.key);
  const finished = Promise.withResolvers<void>();
  queue.set(spec.key, finished.promise);
  try {
    await previous;
    // A preceding publication requires routing verification before replay.
    if (previous !== undefined) invalidateGitDiscovery("publication");
    const publication = {
      key: spec.key,
      active: true,
      children: new Map<string, Promise<void>>(),
    };
    try {
      return await currentPublication.run(publication, run);
    } finally {
      publication.active = false;
    }
  } finally {
    finished.resolve();
    if (queue.get(spec.key) === finished.promise) {
      queue.delete(spec.key);
    }
  }
}

/** Read-only, point-in-time observation; callers must acquire exclusion again before effects. */
export async function observeCompletionCheckout(cwd: string): Promise<{
  readonly ownership: "held" | "available" | "unknown";
  readonly reason: string;
}> {
  try {
    const specs = await resolveLockSpecs(cwd, "checkout");
    const spec = specs?.[0];
    if (spec === undefined) {
      return {
        ownership: "unknown",
        reason: "Native checkout exclusion cannot be resolved.",
      };
    }
    let file: FileLock;
    try {
      file = await FileLock.open(spec.path, { read: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      return {
        ownership: "available",
        reason: "No native checkout owner was observed.",
      };
    }
    try {
      const available = await file.tryAcquire();
      return available
        ? {
          ownership: "available",
          reason: "No native checkout owner was observed.",
        }
        : {
          ownership: "held",
          reason:
            "A native operation holds the checkout; its recorded claim does not identify the lock owner.",
        };
    } finally {
      file.close();
    }
  } catch (error) {
    return {
      ownership: "unknown",
      reason: `Checkout ownership could not be observed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

interface CompletionCheckoutScope {
  readonly key: string;
  active: boolean;
}
const completionCheckoutScope = new AsyncLocalStorage<
  CompletionCheckoutScope
>();

/** Native validation retains checkout exclusion and process-signal ownership
 * through child shutdown and short state publications. The scope keeps its
 * underlying OS lease until every owned effect settles. */
export async function withCompletionCheckout<T>(
  cwd: string,
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  return await withTrackedRun(
    externalSignal,
    (signal) =>
      withPolicyLock(cwd, { command: "done" }, {
        effects: ["discern-checkout-mutation", "project-command"],
        lock: "checkout",
        preview: "required",
        gitWriteAuthority: "opaque",
      }, async () => {
        const held = currentOperationLocks();
        if (held === undefined) {
          throw new Error("Completion checkout exclusion was not acquired.");
        }
        // A setup probe holds two checkout leases: its parent's and the
        // probe's. The scope binds the lease for exactly this directory;
        // another held checkout lease is never a substitute.
        const own = (await resolveLockSpecs(cwd, "checkout"))?.find((spec) =>
          spec.boundary === "checkout"
        );
        const checkout = own === undefined
          ? undefined
          : [...held.leases.values()].find((lease) =>
            lease.boundary === "checkout" && lease.key === own.key
          );
        if (checkout === undefined) {
          throw new Error(
            "Completion checkout lease for this directory is unavailable.",
          );
        }
        const scope = { key: checkout.key, active: true };
        try {
          return await completionCheckoutScope.run(scope, () =>
            runWithOperationLocks(
              { ...held, completionExecution: true },
              () =>
                operation(signal),
            ));
        } finally {
          scope.active = false;
        }
      }, SYSTEM_SECURE_ENTROPY),
  );
}

/** A setup probe retains its parent's checkout and its own lifecycle reservation,
 * with no common publication lease during setup, checks, or cleanup. */
export async function withSetupProbeCheckout<T>(
  parent: string,
  probe: string,
  operation: () => Promise<T>,
): Promise<T> {
  const parentSpecs = await resolveLockSpecs(parent, "checkout");
  const held = currentOperationLocks();
  if (
    parentSpecs === undefined ||
    parentSpecs.some((spec) => !held?.leases.has(spec.key))
  ) {
    throw refusal(
      { command: "setup done" },
      "A setup probe requires its parent operation's live checkout ownership.",
    );
  }
  const probeReservation = await worktreeLockSpec(probe);
  if (parentSpecs.some((spec) => spec.key === probeReservation.key)) {
    throw refusal(
      { command: "setup done" },
      "A setup probe must use a distinct checkout from its parent.",
    );
  }
  const parentCommon = (await resolveLockSpecs(parent, "common"))?.[0];
  const probeCommon = (await resolveLockSpecs(probe, "common"))?.[0];
  if (parentCommon === undefined || parentCommon.key !== probeCommon?.key) {
    throw refusal(
      { command: "setup done" },
      "A setup probe must belong to its parent's repository.",
    );
  }
  return await withWorktreeOwnership(
    probe,
    () => withCompletionCheckout(probe, operation),
  );
}

/** Run `operation` holding only the acceptance-serializer lease of the
 * current context. The landing walk uses this to move from the selected
 * effort's checkout to the next submission's: serialization stays with the
 * acceptance boundary, while each further landing acquires its own checkout
 * boundary non-blockingly — a busy follower refuses and stops the walk. */
export async function runWithAcceptanceLeaseOnly<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const held = currentOperationLocks();
  if (held === undefined) return await operation();
  const leases = new Map(
    [...held.leases].filter(([, lease]) => lease.boundary === "acceptance"),
  );
  return await runWithOperationLocks({
    leases,
    boundaries: new Set(
      [...held.boundaries].filter((boundary) => boundary === "acceptance"),
    ),
  }, operation);
}

/** A landing's freshly created integration worktree holds its own checkout
 * lease for the composed update and gate cores, under the already-held
 * acceptance serializer — so those cores reuse held leases instead of
 * deadlocking on a second acquisition, while the common publication
 * boundary stays free for sibling completions throughout the checks. */
export async function withIntegrationCheckout<T>(
  authorWorktree: string,
  integrationWorktree: string,
  operation: () => Promise<T>,
): Promise<T> {
  const parentSpecs = await resolveLockSpecs(
    authorWorktree,
    "acceptance-and-checkout",
  );
  const secondarySpecs = await resolveLockSpecs(
    integrationWorktree,
    "acceptance-and-checkout",
  );
  const serializer = parentSpecs?.find((spec) =>
    spec.boundary === "acceptance"
  );
  const checkout = secondarySpecs?.find((spec) => spec.boundary === "checkout");
  const held = currentOperationLocks();
  if (
    serializer === undefined || checkout === undefined ||
    held?.leases.has(serializer.key) !== true ||
    secondarySpecs?.find((spec) => spec.boundary === "acceptance")?.key !==
      serializer.key ||
    parentSpecs?.some((spec) => spec.key === checkout.key)
  ) {
    throw refusal(
      { command: "accept" },
      "A landing's integration worktree runs only under its own live acceptance serializer in the same repository.",
    );
  }
  return await withPolicyLock(
    integrationWorktree,
    { command: "accept" },
    {
      effects: ["discern-checkout-mutation", "project-command"],
      lock: "checkout",
      preview: "required",
      gitWriteAuthority: "opaque",
    },
    operation,
    SYSTEM_SECURE_ENTROPY,
    { serializer: serializer.key, checkout: checkout.key },
  );
}

/** Acquire the declared boundary and recheck exact Git-write preconditions around the effect. */
async function withPolicyLock<T>(
  cwd: string,
  invocation: OperationInvocation,
  policy: OperationEffectPolicy,
  operation: (commonGitDirectory?: string) => Promise<T>,
  entropy: SecureEntropy,
  secondaryCheckout?: {
    /** The held lease that legitimizes the second checkout: a setup's
     * common transaction, or a landing's acceptance serializer. */
    readonly serializer: string;
    readonly checkout: string;
  },
  waitForPublication = false,
  wait?: OperationLockWait,
  reservations?: LockSpec[],
): Promise<T> {
  if (policy.lock === "none") return await operation();
  if (policy.lock === "phased") {
    // The concrete publisher/executor owns exclusion. Preserve the invocation's write-access proof.
    const commonGitDirectory = await preflightOperationBoundary(
      cwd,
      invocation,
      policy,
      entropy,
    );
    return await operation(commonGitDirectory);
  }

  let specs = reservations ?? await resolveLockSpecs(cwd, policy.lock);
  if (specs === undefined) {
    const projectRoot = await findRoot(cwd);
    if (projectRoot === undefined && policy.lockWithoutProject !== true) {
      return await operation();
    }
    specs = await resolvePreRepositoryLockSpecs(
      projectRoot ?? cwd,
      policy.lock,
    );
  }

  const held = currentOperationLocks();
  const missing = specs.filter((spec) => !held?.leases.has(spec.key));
  if (missing.length === 0) {
    const commonGitDirectory = await preflightOperationBoundary(
      cwd,
      invocation,
      policy,
      entropy,
    );
    return await operation(commonGitDirectory);
  }

  const heldCheckout = held?.boundaries.has("checkout") === true;
  const acquiringCommon = missing.some((spec) => spec.boundary === "common");
  const acquiringCheckout = missing.some((spec) =>
    spec.boundary === "checkout"
  );
  if (
    heldCheckout && acquiringCommon && held?.completionExecution !== true &&
    held?.boundaries.has("acceptance") !== true &&
    held?.boundaries.has("lifecycle") !== true
  ) {
    throw refusal(
      invocation,
      "discern refused a nested operation that would acquire the common repository boundary after a checkout boundary. " +
        "This call made no change. Retry from the outer operation so it acquires common before checkout.",
    );
  }
  if (acquiringCommon) {
    const checkoutSpec = specs.find((spec) => spec.boundary === "checkout");
    const commonSpec = specs.find((spec) => spec.boundary === "common");
    const inheritedCheckout = checkoutSpec === undefined
      ? undefined
      : inheritedOperationLockLease(checkoutSpec.key, checkoutSpec.path);
    const inheritedCommon = commonSpec === undefined
      ? undefined
      : inheritedOperationLockLease(commonSpec.key, commonSpec.path);
    if (inheritedCheckout !== undefined && inheritedCommon === undefined) {
      throw refusal(
        invocation,
        "discern refused a child operation that would acquire the common repository boundary after its parent delegated only a checkout boundary. " +
          "This call made no change. Retry from an outer operation classified to acquire common before checkout.",
      );
    }
  }
  const serializedSecondary = secondaryCheckout !== undefined &&
    held?.leases.has(secondaryCheckout.serializer) === true &&
    missing.every((spec) =>
      spec.boundary === "worktree" ||
      (spec.boundary === "checkout" && spec.key === secondaryCheckout.checkout)
    );
  const reservedSecondary = specs.some((spec) =>
    spec.boundary === "worktree" && held?.worktrees?.has(spec.key)
  );
  if (
    heldCheckout && acquiringCheckout && !serializedSecondary &&
    !reservedSecondary
  ) {
    throw refusal(
      invocation,
      "discern refused a nested operation that would hold two checkout boundaries. " +
        "This call made no change. Retry each checkout operation independently.",
    );
  }

  const acquiredLocks: AcquiredLock[] = [];
  const acquiredLeases: OperationLockLease[] = [];
  try {
    for (const spec of missing) {
      const acquired = await acquireLock(
        invocation,
        cwd,
        spec,
        entropy,
        waitForPublication,
        spec.boundary === "acceptance" ? wait : undefined,
      );
      acquiredLocks.push(acquired);
      acquiredLeases.push(acquired.lease);
    }
    // Newly held exclusion rechecks administration. Short publications may
    // verify the routing witness; other operations require fresh Git.
    invalidateGitDiscovery(waitForPublication ? "publication" : "topology");
    const leases = new Map(held?.leases ?? []);
    const boundaries = new Set(held?.boundaries ?? []);
    for (const lease of acquiredLeases) {
      leases.set(lease.key, lease);
      boundaries.add(lease.boundary);
    }
    const next: HeldOperationLocks = {
      leases,
      boundaries,
      ...(held?.worktrees === undefined ? {} : { worktrees: held.worktrees }),
      ...(held?.completionExecution === true
        ? { completionExecution: true }
        : {}),
    };
    return await runWithOperationLocks(next, async () => {
      const commonGitDirectory = await preflightOperationBoundary(
        cwd,
        invocation,
        policy,
        entropy,
      );
      return await operation(commonGitDirectory);
    });
  } finally {
    await releaseLocks(acquiredLocks);
  }
}

/** Canonicalize existing ancestors so a reservation survives creation and removal. */
async function canonicalReservationPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw new OperationLockError({
        ok: false,
        verb: currentOperationOwner()?.command ?? "worktree",
        error: "precondition_failed",
        message:
          `discern could not inspect ${path} to establish operation ownership. ` +
          `The boundary was not acquired. Restore access and retry. ${
            error instanceof Error ? error.message : String(error)
          }`,
      }, { cause: error });
    }
    const absolute = resolve(path);
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(
      await canonicalReservationPath(parent),
      absolute.slice(parent.length + (parent.endsWith("/") ? 0 : 1)),
    );
  }
}

/** Resolve the stable path lease shared by writers and lifecycle owners. */
async function worktreeLockSpec(path: string): Promise<LockSpec> {
  return await hostLockSpec("worktree", await canonicalReservationPath(path));
}

/** Own a target from before registration through setup, validation, and removal.
 * Ordinary checkout writers acquire the same reservation before their admin lock. */
export async function withWorktreeOwnership<T>(
  path: string | readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  if (typeof path !== "string") {
    const [first, ...rest] = [...new Set(path)].sort();
    return first === undefined
      ? await run()
      : await withWorktreeOwnership(first, () =>
        withWorktreeOwnership(rest, run));
  }
  const spec = await worktreeLockSpec(path);
  return await withReservation(path, spec, async () => {
    const held = currentOperationLocks();
    if (held === undefined) {
      throw new Error("Worktree reservation was not acquired.");
    }
    return await runWithOperationLocks({
      ...held,
      completionExecution: true,
      worktrees: new Set([...(held.worktrees ?? []), spec.key]),
    }, run);
  });
}

/** External resource ownership spans the check, command, and ledger settlement.
 * The external identity, independent of a recycled Git key, is the subject. */
export async function withResourceOwnership<T>(
  directory: string,
  identity: string,
  run: () => Promise<T>,
): Promise<T> {
  const canonical = await canonicalReservationPath(directory);
  return await withReservation(
    directory,
    await hostLockSpec("resource", `${canonical}\0${identity}`),
    run,
  );
}

/** Apply the shared OS-lease lifetime to one explicitly selected subject. */
async function withReservation<T>(
  path: string,
  spec: LockSpec,
  run: () => Promise<T>,
): Promise<T> {
  return await withPolicyLock(
    path,
    { command: currentOperationOwner()?.command ?? "worktree" },
    {
      effects: ["external-setup"],
      lock: "checkout",
      preview: "required",
      gitWriteAuthority: "opaque",
    },
    run,
    SYSTEM_SECURE_ENTROPY,
    undefined,
    false,
    undefined,
    [spec],
  );
}
