/**
 * In-process and child-process context for the operation-lock capability.
 *
 * A child receives only leases held by its parent. The lock file token links
 * that delegation to a currently held OS lock; an orphaned file or stale
 * environment value is never sufficient ownership evidence on its own.
 */

import { AsyncLocalStorage } from "./module_loading.ts";
import { z } from "@zod/zod";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import { decodeJson } from "./runtime_decode.ts";
import { readTextIfExists } from "./fs_presence.ts";

/** The one authority for concrete boundary names: the in-process type, the
 * delegation encoder, and the child-process decoder all derive from it, so a
 * new boundary cannot reach a child as an undecodable envelope. */
export const OPERATION_LOCK_CONCRETE_BOUNDARIES = [
  "acceptance",
  "lifecycle",
  "common",
  "checkout",
  "worktree",
  "resource",
] as const;

export type OperationLockConcreteBoundary =
  (typeof OPERATION_LOCK_CONCRETE_BOUNDARIES)[number];

/** One OS-backed lock lease that may be delegated to a child process. */
export interface OperationLockLease {
  readonly boundary: OperationLockConcreteBoundary;
  readonly key: string;
  readonly path: string;
  readonly token: string;
  readonly owner?: OperationOwner | undefined;
}

/** The operation locks held or delegated in one async call chain. */
export interface HeldOperationLocks {
  /** Native execution permits short common publications; ordinary and child nesting does not. */
  readonly completionExecution?: boolean;
  /** Explicit lifecycle reservations that authorize entering a created checkout. */
  readonly worktrees?: ReadonlySet<string>;
  readonly leases: ReadonlyMap<string, OperationLockLease>;
  readonly boundaries: ReadonlySet<OperationLockConcreteBoundary>;
}

interface DelegationEnvelope {
  readonly version: 1;
  readonly leases: readonly OperationLockLease[];
}

const OperationOwnerSchema = z.strictObject({
  id: z.string().min(1),
  command: z.string().min(1),
  path: z.string().min(1),
  started: z.string().min(1),
  handle: z.string().optional(),
});

/** Identity belongs to an invocation, never to the server process or latest run. */
export type OperationOwner = z.infer<typeof OperationOwnerSchema>;
const operationOwner = new AsyncLocalStorage<OperationOwner>();

/** Owner identity bound into every lease acquired by this invocation. */
export function currentOperationOwner(): OperationOwner | undefined {
  return operationOwner.getStore();
}

/** Bind the journal identity before acquiring execution leases. */
export async function runWithOperationOwner<T>(
  owner: OperationOwner,
  run: () => Promise<T>,
): Promise<T> {
  return await operationOwner.run(owner, run);
}

/** Decode the optional owner in a live lease record; old records remain valid. */
export function recordedOperationOwner(
  record: string | undefined,
): OperationOwner | { unavailable: string } {
  const line = record?.split("\n")[1];
  if (!line) {
    return { unavailable: "The holder did not record an operation identity." };
  }
  try {
    return decodeJson(OperationOwnerSchema, line, "operation lease owner");
  } catch (error) {
    return {
      unavailable: `The holder's identity could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

const OperationLockLeaseSchema = z.strictObject({
  boundary: z.enum(OPERATION_LOCK_CONCRETE_BOUNDARIES),
  key: z.string().min(1),
  path: z.string().min(1),
  token: z.string().min(1),
  owner: OperationOwnerSchema.optional(),
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
  return inheritedOperationLockLeases(env).find((lease) =>
    lease.key === key && lease.path === path
  );
}

/** Structurally valid delegation; consumers still authenticate the live OS lease. */
export function inheritedOperationLockLeases(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): readonly OperationLockLease[] {
  const raw = env.get(
    DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation,
  );
  if (raw === undefined) return [];
  let decoded: DelegationEnvelope;
  try {
    decoded = decodeJson(
      DelegationEnvelopeSchema,
      raw,
      DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation,
    );
  } catch {
    // discern-best-effort: operation-lock-delegation-decode-fallback
    return [];
  }
  return decoded.leases;
}

/** Read metadata only while the delegated token still names a held OS lease. */
export async function readLiveOperationLease(
  lease: OperationLockLease,
): Promise<{ readonly owner?: OperationOwner } | undefined> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(lease.path, { read: true, write: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  try {
    if (await file.tryLock(true)) return undefined;
    const record = await readTextIfExists(lease.path);
    if (record?.split("\n")[0] !== `discern-operation-lock-v1 ${lease.token}`) {
      return undefined;
    }
    const owner = recordedOperationOwner(record);
    return "unavailable" in owner ? {} : { owner };
  } finally {
    file.close();
  }
}
