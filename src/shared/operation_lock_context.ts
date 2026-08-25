/**
 * In-process and child-process context for the operation-lock capability.
 *
 * A child receives only leases held by its parent. The lock file token links
 * that delegation to a currently held OS lock; an orphaned file or stale
 * environment value is never sufficient ownership evidence on its own.
 */

import { AsyncLocalStorage } from "async_hooks";
import { z } from "@zod/zod";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import { decodeJson } from "./runtime_decode.ts";

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

const OperationLockLeaseSchema = z.strictObject({
  boundary: z.enum(["common", "checkout"]),
  key: z.string().min(1),
  path: z.string().min(1),
  token: z.string().min(1),
});
const DelegationEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  leases: z.array(OperationLockLeaseSchema),
});

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

/**
 * Find a structurally valid inherited lease for an exact resolved lock.
 * Authentication against the live OS-locked file remains the lock owner's job.
 */
export function inheritedOperationLockLease(
  key: string,
  path: string,
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): OperationLockLease | undefined {
  const raw = env.get(
    DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation,
  );
  if (raw === undefined) return undefined;
  let decoded: DelegationEnvelope;
  try {
    decoded = decodeJson(
      DelegationEnvelopeSchema,
      raw,
      DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation,
    );
  } catch {
    return undefined;
  }
  for (const lease of decoded.leases) {
    if (lease?.key === key && lease.path === path) return lease;
  }
  return undefined;
}
