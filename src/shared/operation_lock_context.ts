/**
 * In-process and child-process context for the operation-lock capability.
 *
 * A child receives only leases held by its parent. The lock file token links
 * that delegation to a currently held OS lock; an orphaned file or stale
 * environment value is never sufficient ownership evidence on its own.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";

export type OperationLockConcreteBoundary = "common" | "checkout";

/** One OS-backed lock lease that may be delegated to a child process. */
export interface OperationLockLease {
  readonly boundary: OperationLockConcreteBoundary;
  readonly key: string;
  readonly path: string;
  readonly token: string;
}

/** The operation locks held or delegated in one async call chain. */
export interface HeldOperationLocks {
  readonly leases: ReadonlyMap<string, OperationLockLease>;
  readonly boundaries: ReadonlySet<OperationLockConcreteBoundary>;
}

interface DelegationEnvelope {
  readonly version: 1;
  readonly leases: readonly OperationLockLease[];
}

const HELD_LOCKS = new AsyncLocalStorage<HeldOperationLocks>();

/** Current call-chain leases, if this process is inside an operation boundary. */
export function currentOperationLocks(): HeldOperationLocks | undefined {
  return HELD_LOCKS.getStore();
}

/** Run one callback with the supplied lock leases available to nested work. */
export async function runWithOperationLocks<T>(
  locks: HeldOperationLocks,
  operation: () => Promise<T>,
): Promise<T> {
  return await HELD_LOCKS.run(locks, operation);
}

/** Environment overlay that delegates current leases to a child process. */
export function operationLockChildEnv(): Record<string, string> {
  const held = currentOperationLocks();
  if (held === undefined || held.leases.size === 0) return {};
  const envelope: DelegationEnvelope = {
    version: 1,
    leases: [...held.leases.values()].sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
  };
  return {
    [DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation]: JSON.stringify(
      envelope,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeLease(value: unknown): OperationLockLease | undefined {
  if (!isRecord(value)) return undefined;
  const boundary = value.boundary;
  const key = value.key;
  const path = value.path;
  const token = value.token;
  if (
    (boundary !== "common" && boundary !== "checkout") ||
    typeof key !== "string" || key === "" ||
    typeof path !== "string" || path === "" ||
    typeof token !== "string" || token === ""
  ) return undefined;
  return { boundary, key, path, token };
}

/**
 * Find a structurally valid inherited lease for an exact resolved lock.
 * Authentication against the live OS-locked file remains the lock owner's job.
 */
export async function inheritedOperationLockLease(
  key: string,
  path: string,
): Promise<OperationLockLease | undefined> {
  const raw = Deno.env.get(
    DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation,
  );
  if (raw === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = await new Response(raw).json();
  } catch {
    return undefined;
  }
  if (!isRecord(decoded) || decoded.version !== 1) return undefined;
  const values = decoded.leases;
  if (!Array.isArray(values)) return undefined;
  for (const value of values) {
    const lease = decodeLease(value);
    if (lease?.key === key && lease.path === path) return lease;
  }
  return undefined;
}
