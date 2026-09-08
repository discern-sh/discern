import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Enrollment and release are explicit actions, independent of fleet availability. */
import {
  type EnvironmentDeclaration,
  EnvironmentDeclarationSchema,
} from "../../shared/config_schema.ts";
import {
  environmentAvailability,
  EnvironmentSchema,
  type ExecutionEnvironment,
} from "../completion/environment.ts";
import type { CompletionRecord } from "../completion/records.ts";
import {
  type CompletionRecordReading,
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
  EnvironmentPlan,
  ValidationPlan,
} from "../completion/protocol.ts";
import type { Executor } from "../completion/identity.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import { registeredWorktreeRecord } from "../worktree/git.ts";
import {
  withCompletionCheckout,
  withCompletionPublication,
} from "../operation_lock.ts";
import { recoveryFor } from "./types.ts";
import type { ExecutionLifetime, ExecutionWorkspace } from "./types.ts";
import { declarationIdentity, releasedSubject } from "./subjects.ts";
import { enrolledEnvironments } from "./enrollment_read.ts";

type EnvironmentRecord = Extract<CompletionRecord, { kind: "environment" }>;
export type RecordedEnvironment = {
  readonly record: EnvironmentRecord;
  readonly stamp: string;
};

/** Environmental refusal supplies neither a failed producer nor missing authority. */
export function unavailable(reason: string): CompletionBlocker {
  return { kind: "environment-unavailable", reason };
}

/** Unknown or unreadable durable versions cannot become usable slots. */
export async function requireEnvironment(
  root: string,
  id: string,
): Promise<RecordedEnvironment> {
  const reading = await readCompletionRecord(root, { kind: "environment", id });
  if (reading.kind !== "recorded" || reading.record.kind !== "environment") {
    throw new Error(
      `Environment ${id} is ${reading.kind}; preserve its record and restore a readable supported version.`,
    );
  }
  return { record: reading.record, stamp: reading.stamp };
}

/** Capacity and mutation require complete canonical envelopes, not presence alone. */
async function enrollmentRecords(root: string): Promise<EnvironmentRecord[]> {
  const records: EnvironmentRecord[] = [];
  for (const environment of await enrolledEnvironments(root)) {
    records.push((await requireEnvironment(root, environment.id)).record);
  }
  return records;
}

/** Advance only the observed revision through the canonical record writer. */
export async function replaceEnvironment(
  root: string,
  current: RecordedEnvironment,
  data: ExecutionEnvironment,
  clock: Clock,
): Promise<RecordedEnvironment> {
  const record: EnvironmentRecord = {
    ...current.record,
    revision: current.record.revision + 1,
    data,
  };
  const written = await writeCompletionRecord(
    root,
    record,
    current.stamp,
    undefined,
    clock,
  );
  if (written.kind !== "written") {
    throw new Error(
      `Environment transition refused (${written.kind}); observe and replan without touching the checkout.`,
    );
  }
  return { record, stamp: written.stamp };
}

/** A supplied slot is new ownership, never a selected idle authoring worktree. */
export async function registerExecutionEnvironment(
  root: string,
  id: string,
  input: Pick<ExecutionEnvironment, "path" | "ownership">,
  declaration: EnvironmentDeclaration | null,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionRecordReading> {
  if (declaration !== null) EnvironmentDeclarationSchema.parse(declaration);
  if (
    declaration?.kind !== undefined && declaration.kind !== input.ownership.kind
  ) throw new Error("Declaration and environment ownership kinds disagree.");
  if (declaration === null && input.ownership.kind === "isolated") {
    throw new Error(
      "Isolation requires a preparation and disposal declaration.",
    );
  }
  const data = EnvironmentSchema.parse({
    ...input,
    declaration: await declarationIdentity(declaration),
    release: { kind: "held" },
    state: { kind: "idle" },
  });
  await withCompletionPublication(root, async () => {
    if (
      data.ownership.kind === "isolated" &&
      (await statIfExists(data.path) !== undefined ||
        await registeredWorktreeRecord(data.path, root) !== undefined)
    ) {
      throw new Error(
        "A new isolated environment requires an absent unregistered path; an existing checkout cannot be adopted.",
      );
    }
    if (
      data.ownership.kind === "isolated" &&
      data.ownership.disposable === declaration?.reusable
    ) {
      throw new Error(
        "Isolated disposal ownership must match the declared reuse policy.",
      );
    }
    const enrolled = await enrollmentRecords(root);
    if (
      enrolled.some((record) =>
        record.data.path === data.path && record.data.state.kind !== "disposed"
      )
    ) {
      throw new Error(
        "This path already belongs to an enrolled environment; observe that exact identity.",
      );
    }
    const capacity = declaration?.capacity ?? 1;
    if (
      data.ownership.kind === "isolated" &&
      enrolled.filter((record) =>
          record.data.ownership.kind === "isolated" &&
          record.data.state.kind !== "disposed"
        ).length >= capacity
    ) {
      throw new Error(
        "Declared environment capacity is occupied, including unfinished recovery. Reuse or dispose an existing owned slot.",
      );
    }
    const written = await writeCompletionRecord(
      root,
      {
        kind: "environment",
        version: ON_DISK_FORMATS.completionRecord.version,
        revision: 1,
        id,
        data,
      },
      null,
      undefined,
      clock,
    );
    if (written.kind !== "written") {
      throw new Error(
        `Environment enrollment refused (${written.kind}); observe the current record.`,
      );
    }
  });
  return await readCompletionRecord(root, { kind: "environment", id });
}

/** End a source-bound enrollment while leaving all authoring resources in place. */
export async function retireBorrowedEnrollment(
  root: string,
  id: string,
  expectedStamp: string,
  owner: Executor,
  lifetime: ExecutionLifetime,
  clock: Clock = SYSTEM_CLOCK,
): Promise<RecordedEnvironment> {
  return await withCompletionPublication(root, async () => {
    const current = await requireEnvironment(root, id);
    const environment = current.record.data;
    if (
      current.stamp !== expectedStamp ||
      environment.ownership.kind !== "borrowed" ||
      environment.ownership.source.effort_id !== owner.originating_effort
    ) {
      throw new Error(
        "Only the source owner can retire the exact borrowed enrollment. No checkout or resource was changed.",
      );
    }
    if (environment.state.kind === "disposed") return current;
    if (
      environment.state.kind !== "idle" ||
      !(await lifetime.inspect(environment.path)).quiescent
    ) {
      throw new Error(
        "The borrowed enrollment still owns execution or recovery; finish that return before retiring its enrollment.",
      );
    }
    return await replaceEnvironment(root, current, {
      ...environment,
      release: { kind: "held" },
      state: { kind: "disposed", at: clock.wallNow() },
    }, clock);
  });
}

/** Inspect the same occupied population used by atomic claim validation. */
export async function observeClaimCapacity(
  root: string,
  environment: ExecutionEnvironment,
  capacity: number,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionBlocker | null> {
  if (environment.ownership.kind !== "borrowed") return null;
  const sourceDeclaration = await declarationIdentity(null);
  const sourceExecution = environment.declaration === sourceDeclaration;
  const handles = new Set(
    Object.values(environment.ownership.identity.resources),
  );
  const active = (await enrollmentRecords(root)).filter((record) =>
    record.data.state.kind === "executing" ||
    record.data.state.kind === "recovery"
  );
  const sharesResources = (record: EnvironmentRecord): boolean =>
    record.data.path === environment.path ||
    (record.data.ownership.kind === "borrowed" &&
      Object.values(record.data.ownership.identity.resources).some((handle) =>
        handles.has(handle)
      ));
  const conflicts = active.filter(sharesResources);
  // Source execution owns its checkout and actual resources. Its demanded
  // producers acquire their real test capacity; it never occupies a temporary slot.
  const occupied = conflicts.length > 0
    ? conflicts
    : sourceExecution
    ? []
    : active.filter((record) =>
      record.data.ownership.kind === "borrowed" &&
      record.data.declaration !== sourceDeclaration
    );
  if (conflicts.length > 0) capacity = 1;
  if (occupied.length < capacity) return null;
  for (const record of occupied) {
    const state = record.data.state;
    if (state.kind === "recovery") {
      return {
        kind: "recovery-incomplete",
        record_id: record.id,
        recovery: state.recovery,
      };
    }
    if (
      state.kind === "executing" && state.claim.expires_at <= clock.wallNow()
    ) {
      return {
        kind: "recovery-incomplete",
        record_id: record.id,
        recovery: recoveryFor(
          state.phase,
          "An expired execution still occupies capacity. Recover its environment before starting another execution.",
          record.data.path,
          [],
        ),
      };
    }
  }
  const running = occupied.find((record) =>
    record.data.state.kind === "executing"
  )?.data.state;
  if (running?.kind !== "executing") {
    throw new Error("Occupied execution capacity has no owning attempt.");
  }
  return {
    kind: "waiting-for-operation",
    attempt_id: running.attempt_id,
    expires_at: running.claim.expires_at,
  };
}

/** Released borrowed slots consume capacity only while executing or in recovery. */
export async function verifyClaimCapacity(
  root: string,
  environment: ExecutionEnvironment,
  capacity: number,
): Promise<void> {
  if (await observeClaimCapacity(root, environment, capacity) !== null) {
    throw new Error(
      "Borrowed execution capacity is occupied, including incomplete recovery. Wait for an existing return before claiming another checkout.",
    );
  }
}

/** The owning completion adapter calls this after the source owner releases use. */
export async function releaseExecutionEnvironment(
  root: string,
  id: string,
  expectedStamp: string,
  owner: Executor,
  declaration: EnvironmentDeclaration | null,
  capabilities: {
    readonly lifetime: ExecutionLifetime;
    readonly workspace: ExecutionWorkspace;
  },
  options: {
    readonly retirement?: boolean;
    readonly signal?: AbortSignal;
    readonly clock?: Clock;
    readonly entropy?: SecureEntropy;
  } = {},
): Promise<RecordedEnvironment> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const observed = await requireEnvironment(root, id);
  return await withCompletionCheckout(
    await statIfExists(observed.record.data.path) === undefined
      ? root
      : observed.record.data.path,
    async (signal) => {
      const current = await requireEnvironment(root, id);
      const environment = current.record.data;
      if (
        current.stamp !== expectedStamp || environment.state.kind !== "idle"
      ) {
        throw new Error(
          "Environment changed or is not idle; observe and replan the release.",
        );
      }
      if (
        environment.ownership.kind === "borrowed"
          ? environment.ownership.source.effort_id !== owner.originating_effort
          : environment.ownership.owner_operation !== owner.operation_id
      ) {
        throw new Error(
          "Only the recorded source owner or isolated environment owner can release this environment.",
        );
      }
      if (environment.declaration !== await declarationIdentity(declaration)) {
        throw new Error(
          "The declaration changed; retain this environment's frozen contract and enroll the new source separately.",
        );
      }
      const use = await capabilities.lifetime.inspect(environment.path);
      if (!use.quiescent) {
        throw new Error(`Environment use is not quiescent: ${use.reason}`);
      }
      const snapshot = await capabilities.workspace.inspect(
        environment,
        declaration,
        options.retirement
          ? "release"
          : declaration === null
          ? "source"
          : "recovery",
        signal,
      );
      await capabilities.workspace.verify(environment, snapshot, signal);
      const subject = await releasedSubject(environment, snapshot);
      return await withCompletionPublication(root, async () => {
        const latest = await requireEnvironment(root, id);
        if (latest.stamp !== current.stamp) {
          throw new Error(
            "Environment ownership or revision changed during release observation; preserve the checkout and replan.",
          );
        }
        if (
          environment.release.kind === "released" &&
          environment.release.subject === subject &&
          environment.release.retirement === (options.retirement ?? false)
        ) return current;
        return await replaceEnvironment(root, current, {
          ...environment,
          release: {
            kind: "released",
            id: (options.entropy ?? SYSTEM_SECURE_ENTROPY).uuid(),
            at: clock.wallNow(),
            owner: owner.originating_effort,
            subject,
            retirement: options.retirement ?? false,
          },
        }, clock);
      });
    },
    options.signal,
  );
}

/** Project the recorded execution state before planning any release or reuse. */
export function environmentAvailabilityBlocker(
  environmentId: string,
  environment: ExecutionEnvironment,
  now: CompletionObservation["observed_at"],
): CompletionBlocker | null {
  const availability = environmentAvailability(
    environment,
    now,
  );
  if (availability.kind !== "available") {
    if (environment.state.kind === "recovery") {
      return {
        kind: "recovery-incomplete",
        record_id: environmentId,
        recovery: environment.state.recovery,
      };
    }
    if (
      environment.state.kind === "executing" &&
      availability.kind === "recovery-incomplete"
    ) {
      return {
        kind: "recovery-incomplete",
        record_id: environmentId,
        recovery: recoveryFor(
          environment.state.phase,
          `Attempt ${environment.state.attempt_id} expired. Observe this environment's current stamp and recover its recorded checkout and children before reuse.`,
          environment.path,
          [],
        ),
      };
    }
    if (
      environment.state.kind === "executing" &&
      availability.kind === "environment-unavailable"
    ) {
      return {
        kind: "waiting-for-operation",
        attempt_id: environment.state.attempt_id,
        expires_at: environment.state.claim.expires_at,
      };
    }
    return unavailable(
      `Environment ${environmentId} is ${availability.reason}; reconcile or explicitly release it before execution.`,
    );
  }
  return null;
}

/** One configured executor plans only its own explicitly enrolled slot. */
export function planEnvironment(
  environmentId: string,
  declaration: EnvironmentDeclaration | null,
  observation: CompletionObservation,
  validation: ValidationPlan,
): EnvironmentPlan | CompletionBlocker {
  const reading = observation.records.find(({ selector }) =>
    selector.kind === "environment" && selector.id === environmentId
  )?.reading;
  if (reading?.kind !== "recorded" || reading.record.kind !== "environment") {
    return unavailable(
      `Environment ${environmentId} has no readable enrollment and release.`,
    );
  }
  const environment = reading.record.data;
  const blocked = environmentAvailabilityBlocker(
    environmentId,
    environment,
    observation.observed_at,
  );
  if (blocked !== null) return blocked;
  const candidate = validation.candidate;
  if (
    validation.demand.kind === "diagnostic" &&
    (candidate.dependencies.length !== 0 ||
      JSON.stringify(validation.demand.source) !==
        JSON.stringify(candidate.source) ||
      validation.demand.base !== candidate.expected_predecessor.head)
  ) {
    return unavailable(
      "Standalone comparison must retain the same source and base; a recorded source dependency cannot be removed.",
    );
  }
  const base = {
    environment_id: environmentId,
    expected_stamp: reading.stamp,
    candidate_id: validation.candidate_id,
    validation,
  };
  if (declaration === null) {
    return candidate.head === candidate.source.head &&
        candidate.tree === candidate.source.tree
      ? { ...base, action: "source-tip", declaration: null }
      : unavailable(
        "No execution declaration permits temporary composition. Ordering remains available; the source owner can run the ordinary forward update and done path after trunk moves.",
      );
  }
  if (declaration.kind !== environment.ownership.kind) {
    return unavailable(
      "Environment ownership does not match the declared lifecycle.",
    );
  }
  return {
    ...base,
    declaration,
    action: environment.ownership.kind === "borrowed"
      ? "borrow"
      : reading.record.revision <= 2
      ? "provision"
      : "reuse",
  };
}
