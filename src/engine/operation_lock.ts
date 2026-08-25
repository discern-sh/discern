/**
 * Shared exclusion capability for classified Discern operations.
 *
 * A common-repository lock is always acquired before a checkout lock. Nested
 * calls may reuse a lock already held by their async call chain, but may not
 * widen from checkout-only to common or acquire a second checkout. That rule,
 * plus non-blocking OS locks, prevents nested deadlock while preserving
 * parallelism across linked worktrees.
 */

import { dirname, join, resolve } from "@std/path";
import {
  operationEffectPolicy,
  type OperationInvocationFacts,
  type OperationLockBoundary,
} from "../shared/operation_effects.ts";
import { bestEffortFs, readTextIfExists } from "../shared/fs_presence.ts";
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

/** One classified operation invocation. */
export interface OperationInvocation extends OperationInvocationFacts {
  readonly command: string;
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
      return ["common", "checkout"];
  }
}

/** One stable refusal envelope for every lock-boundary failure. */
function refusal(command: string, message: string): OperationLockError {
  return new OperationLockError({
    ok: false,
    verb: command,
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
    const adminDirectory = dirname(dirname(anchor));
    specs.push(
      await hostLockSpec(concrete, `git-admin:${adminDirectory}`),
    );
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
  await file.syncData();
}

/** Restore inert file bytes, then close owned handles in reverse order. */
async function releaseLocks(locks: AcquiredLock[]): Promise<void> {
  for (const lock of locks.reverse()) {
    const file = lock.file;
    if (file === undefined) continue;
    try {
      await replaceLockRecord(file, lock.previousContents ?? new Uint8Array());
    } catch {
      // The OS lock remains the sole ownership authority. A stale lease record
      // after cleanup failure is inert once this handle closes.
    } finally {
      file.close();
    }
  }
}

/** Open and exclusively try-lock one inert host-temporary lock file. */
async function acquireLock(
  command: string,
  cwd: string,
  spec: LockSpec,
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
      command,
      `Discern could not open the ${boundaryName(spec.boundary)} for ${cwd}. ` +
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
      command,
      `Discern could not check the ${
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
      const record = await bestEffortFs(
        () => readTextIfExists(spec.path),
        {
          onFailure: undefined,
          reason:
            "A child-lock delegation that cannot read its live lock record must fail authentication.",
        },
      );
      const token = record?.match(/^discern-operation-lock-v1 ([^\n]+)\n?$/)
        ?.[1];
      const recordedToken = token === "" ? undefined : token;
      if (recordedToken === inherited.token) {
        file.close();
        return { lease: inherited };
      }
    }
    file.close();
    throw refusal(
      command,
      `Another Discern operation holds the ${
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
      command,
      `Discern could not read the ${boundaryName(spec.boundary)} for ${cwd}. ` +
        `This call made no change. Retry after the boundary is readable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  const lease: OperationLockLease = {
    boundary: spec.boundary,
    key: spec.key,
    path: spec.path,
    token: crypto.randomUUID(),
  };
  try {
    await replaceLockRecord(
      file,
      new TextEncoder().encode(
        `discern-operation-lock-v1 ${lease.token}\n`,
      ),
    );
  } catch (error) {
    try {
      await replaceLockRecord(file, previousContents);
    } catch {
      // The refusal still closes the OS authority; standing bytes never own it.
    }
    file.close();
    throw refusal(
      command,
      `Discern could not record the ${
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
 * Run one classified operation while holding its policy boundary.
 *
 * Lock files contain no owner claim. Only the operating-system lock on an open
 * handle establishes ownership; an orphaned path is inert and reusable.
 */
export async function withOperationLock<T>(
  cwd: string,
  invocation: OperationInvocation,
  operation: () => Promise<T>,
): Promise<T> {
  const policy = operationEffectPolicy(invocation.command, invocation);
  if (policy === undefined) {
    throw refusal(
      invocation.command,
      `Discern has no operation-effect policy for \`${invocation.command}\`. ` +
        "This call made no change. Retry after the command is classified.",
    );
  }
  if (policy.lock === "none") return await operation();

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
  if (missing.length === 0) return await operation();

  const heldCheckout = held?.boundaries.has("checkout") === true;
  const acquiringCommon = missing.some((spec) => spec.boundary === "common");
  const acquiringCheckout = missing.some((spec) =>
    spec.boundary === "checkout"
  );
  if (heldCheckout && acquiringCommon) {
    throw refusal(
      invocation.command,
      "Discern refused a nested operation that would acquire the common repository boundary after a checkout boundary. " +
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
        invocation.command,
        "Discern refused a child operation that would acquire the common repository boundary after its parent delegated only a checkout boundary. " +
          "This call made no change. Retry from an outer operation classified to acquire common before checkout.",
      );
    }
  }
  if (heldCheckout && acquiringCheckout) {
    throw refusal(
      invocation.command,
      "Discern refused a nested operation that would hold two checkout boundaries. " +
        "This call made no change. Retry each checkout operation independently.",
    );
  }

  const acquiredLocks: AcquiredLock[] = [];
  const acquiredLeases: OperationLockLease[] = [];
  try {
    for (const spec of missing) {
      const acquired = await acquireLock(invocation.command, cwd, spec);
      acquiredLocks.push(acquired);
      acquiredLeases.push(acquired.lease);
    }
    const leases = new Map(held?.leases ?? []);
    const boundaries = new Set(held?.boundaries ?? []);
    for (const lease of acquiredLeases) {
      leases.set(lease.key, lease);
      boundaries.add(lease.boundary);
    }
    const next: HeldOperationLocks = { leases, boundaries };
    return await runWithOperationLocks(next, operation);
  } finally {
    await releaseLocks(acquiredLocks);
  }
}
