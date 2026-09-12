/**
 * Shared exclusion and Git-write capability for classified discern operations.
 *
 * A common-repository lock is always acquired before a checkout lock. Nested
 * calls may reuse a lock already held by their async call chain, but may not
 * widen from checkout-only to common or acquire a second checkout. The explicit
 * setup probe alone adds its newly created checkout under the same common lock. That rule,
 * plus non-blocking OS locks, prevents nested deadlock while preserving
 * parallelism across linked worktrees. While the lock is held, every classified
 * discern-owned Git writer also proves its broad Git-admin boundary before its
 * command body runs; commands with exact effect plans supplement that probe.
 */

import { dirname, join, resolve } from "@std/path";
import { AsyncLocalStorage } from "../shared/module_loading.ts";
import { withTrackedRun } from "./jobs/interrupt.ts";
import { SYSTEM_CLOCK } from "../shared/clock.ts";
import { SYSTEM_SCHEDULER } from "../shared/scheduler.ts";
import { emitCompletionProgress } from "./completion/events.ts";
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
  type HeldOperationLocks,
  inheritedOperationLockLease,
  type OperationLockConcreteBoundary,
  type OperationLockLease,
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

  constructor(result: DiscernResult) {
    super(result.message ?? "The operation lock could not be acquired.");
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
  readonly file?: Deno.FsFile;
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
    case "common-and-checkout":
    case "phased":
      return ["common", "checkout"];
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
      concrete === "common" ? "resources" : "gateProof",
    );
    if (anchor === undefined) return undefined;
    const adminDirectory = await Deno.realPath(dirname(dirname(anchor)));
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
  return await Promise.all(
    concreteBoundaries(boundary).map((concrete) =>
      hostLockSpec(concrete, `project-root:${canonicalRoot}`)
    ),
  );
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
  file: Deno.FsFile,
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
      await replaceLockRecord(file, lock.previousContents ?? new Uint8Array());
    });
    file.close();
  }
}

/** Open and exclusively try-lock one inert host-temporary lock file. */
async function acquireLock(
  invocation: OperationInvocation,
  cwd: string,
  spec: LockSpec,
  entropy: SecureEntropy,
  waitForPublication: boolean,
): Promise<AcquiredLock> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(spec.path, {
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
    acquired = await file.tryLock(true);
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
      const token = record?.match(/^discern-operation-lock-v1 ([^\n]+)\n?$/)
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
      emitCompletionProgress({
        phase: "queue",
        state: "publication-wait",
        candidate_id: null,
        reason: "Waiting for another short repository publication to finish.",
        next: "This run continues once that publication finishes.",
      });
      const deadline = SYSTEM_CLOCK.monotonicNow() + 10_000;
      while (!acquired && SYSTEM_CLOCK.monotonicNow() < deadline) {
        await new Promise<void>((resolve) =>
          SYSTEM_SCHEDULER.scheduleTimeout(resolve, 25)
        );
        acquired = await file.tryLock(true);
      }
    }
  } catch (error) {
    file.close();
    throw error;
  }
  if (!acquired) {
    file.close();
    throw refusal(
      invocation,
      `Another discern operation holds the ${
        boundaryName(spec.boundary)
      } for ${cwd}. ` +
        "This call made no change. Retry after that operation finishes.",
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
  };
  try {
    await replaceLockRecord(
      file,
      new TextEncoder().encode(
        `discern-operation-lock-v1 ${lease.token}\n`,
      ),
    );
  } catch (error) {
    await bestEffort("operation-lock-acquire-rollback", async () => {
      await replaceLockRecord(file, previousContents);
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
 * Lock files contain no owner claim. Only the operating-system lock on an open
 * handle establishes ownership; an orphaned path is inert and reusable.
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

/** Version-one journal recovery holds exclusion for its whole transaction. */
export async function withAcceptanceRecoveryBoundary<T>(
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
      lock: "common-and-checkout",
      preview: "required",
      gitWriteAuthority: "boundary-plan",
    },
    operation,
    SYSTEM_SECURE_ENTROPY,
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
    let file: Deno.FsFile;
    try {
      file = await Deno.open(spec.path, { read: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      return {
        ownership: "available",
        reason: "No native checkout owner was observed.",
      };
    }
    try {
      const available = await file.tryLock(true);
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

/** A newly created setup probe runs under its parent's already-held common transaction.
 * The second checkout is acquired non-blockingly and cannot widen into another repository.
 */
export async function withSetupProbeCheckout<T>(
  parent: string,
  probe: string,
  operation: () => Promise<T>,
): Promise<T> {
  const parentSpecs = await resolveLockSpecs(parent, "common-and-checkout");
  const probeSpecs = await resolveLockSpecs(probe, "common-and-checkout");
  const common = parentSpecs?.find((spec) => spec.boundary === "common");
  const checkout = probeSpecs?.find((spec) => spec.boundary === "checkout");
  const held = currentOperationLocks();
  if (
    common === undefined || checkout === undefined ||
    parentSpecs?.some((spec) => !held?.leases.has(spec.key)) ||
    probeSpecs?.find((spec) => spec.boundary === "common")?.key !==
      common.key ||
    parentSpecs?.some((spec) => spec.key === checkout.key)
  ) {
    throw refusal(
      { command: "setup done" },
      "The setup probe requires its parent's live common and checkout transaction in the same repository.",
    );
  }
  return await withPolicyLock(
    probe,
    { command: "done" },
    {
      effects: ["discern-checkout-mutation", "project-command"],
      lock: "checkout",
      preview: "required",
      gitWriteAuthority: "opaque",
    },
    operation,
    SYSTEM_SECURE_ENTROPY,
    { common: common.key, checkout: checkout.key },
  );
}

/** Acquire the declared boundary and recheck exact Git-write preconditions around the effect. */
async function withPolicyLock<T>(
  cwd: string,
  invocation: OperationInvocation,
  policy: OperationEffectPolicy,
  operation: (commonGitDirectory?: string) => Promise<T>,
  entropy: SecureEntropy,
  setupProbe?: { readonly common: string; readonly checkout: string },
  waitForPublication = false,
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

  let specs = await resolveLockSpecs(cwd, policy.lock);
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
  if (heldCheckout && acquiringCommon && held?.completionExecution !== true) {
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
  const serializedProbe = setupProbe !== undefined &&
    held?.leases.has(setupProbe.common) === true &&
    missing.every((spec) =>
      spec.boundary === "checkout" && spec.key === setupProbe.checkout
    );
  if (heldCheckout && acquiringCheckout && !serializedProbe) {
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
