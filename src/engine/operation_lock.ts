/**
 * Shared exclusion capability for classified Discern operations.
 *
 * A common-repository lock is always acquired before a checkout lock. Nested
 * calls may reuse a lock already held by their async call chain, but may not
 * widen from checkout-only to common or acquire a second checkout. That rule,
 * plus non-blocking OS locks, prevents nested deadlock while preserving
 * parallelism across linked worktrees.
 */

import { tmpdir } from "node:os";
import { dirname, join, resolve } from "@std/path";
import {
  operationEffectPolicy,
  type OperationInvocationFacts,
  type OperationLockBoundary,
} from "../shared/operation_effects.ts";
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
  readonly lease: OperationLockLease;
}

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
    const stateKey = concrete === "common"
      ? "operationCommonLock"
      : "operationCheckoutLock";
    const path = await gitAdminStatePath(cwd, stateKey);
    if (path === undefined) return undefined;
    specs.push({ boundary: concrete, key: `${concrete}:${path}`, path });
  }
  return specs;
}

/**
 * Stable exclusion for an operation that is intentionally valid before Git
 * exists. The path hash leaves no project footprint, while every process on
 * the host resolves the same checkout root to the same OS lock.
 */
async function resolvePreRepositoryLockSpecs(
  cwd: string,
  boundary: OperationLockBoundary,
): Promise<LockSpec[]> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await Deno.realPath(cwd);
  } catch {
    canonicalRoot = resolve(cwd);
  }
  const rootId = await sha256Hex(canonicalRoot);
  return concreteBoundaries(boundary).map((concrete) => ({
    boundary: concrete,
    key: `pre-repository:${concrete}:${rootId}`,
    path: join(
      tmpdir(),
      "discern-operation-locks",
      `${rootId}-${concrete}.lock`,
    ),
  }));
}

/** Close every acquired handle in reverse order. */
function releaseLocks(files: Deno.FsFile[]): void {
  for (const file of files.reverse()) file.close();
}

/** Open and exclusively try-lock one inert Git-admin lock file. */
async function acquireLock(
  command: string,
  cwd: string,
  spec: LockSpec,
): Promise<AcquiredLock> {
  try {
    await Deno.mkdir(dirname(spec.path), { recursive: true });
  } catch (error) {
    throw refusal(
      command,
      `Discern could not prepare the ${
        boundaryName(spec.boundary)
      } for ${cwd}. ` +
        `This call made no change. Retry after the boundary is writable. ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
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
    const inherited = await inheritedOperationLockLease(spec.key, spec.path);
    if (inherited !== undefined) {
      let recordedToken: string | undefined;
      try {
        const record = await Deno.readTextFile(spec.path);
        const token = record.match(/^discern-operation-lock-v1 ([^\n]+)\n?$/)
          ?.[1];
        recordedToken = token === "" ? undefined : token;
      } catch {
        // A delegation is valid only when the live locked file authenticates it.
      }
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
  const lease: OperationLockLease = {
    boundary: spec.boundary,
    key: spec.key,
    path: spec.path,
    token: crypto.randomUUID(),
  };
  try {
    await file.truncate(0);
    await file.seek(0, Deno.SeekMode.Start);
    await file.write(
      new TextEncoder().encode(
        `discern-operation-lock-v1 ${lease.token}\n`,
      ),
    );
    await file.syncData();
  } catch (error) {
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
  return { file, lease };
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
  if (specs === undefined && policy.allowWithoutRepository === true) {
    specs = await resolvePreRepositoryLockSpecs(cwd, policy.lock);
  }
  if (specs === undefined) {
    throw refusal(
      invocation.command,
      `Git could not resolve Discern's ${policy.lock} operation boundary for ${cwd}. ` +
        "This call made no change. Retry after running the command inside the intended repository checkout.",
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
      : await inheritedOperationLockLease(
        checkoutSpec.key,
        checkoutSpec.path,
      );
    const inheritedCommon = commonSpec === undefined
      ? undefined
      : await inheritedOperationLockLease(commonSpec.key, commonSpec.path);
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

  const files: Deno.FsFile[] = [];
  const acquiredLeases: OperationLockLease[] = [];
  try {
    for (const spec of missing) {
      const acquired = await acquireLock(invocation.command, cwd, spec);
      if (acquired.file !== undefined) files.push(acquired.file);
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
    releaseLocks(files);
  }
}
