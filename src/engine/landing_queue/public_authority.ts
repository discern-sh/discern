import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { predecessorChain } from "./assessment.ts";
import { gitValue } from "./composition.ts";
/** Adapt current desk or standing grants to exact queue source authority, without granting new consent. */
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import type { SourceRevision } from "../completion/identity.ts";
import { AuthoritySchema } from "../completion/authority.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import {
  inspectLandingAuthority,
  type LandingAuthorityResolution,
} from "../worktree/landing_authority.ts";
import { inspectEffortGrantSubject } from "../worktree/effort_grant_subject.ts";
import { worktreePathForBranch } from "../worktree/git.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import type { SourceAuthority, SourceGrantFacts } from "./authority.ts";
import { orderedEntries, sameSource } from "./model.ts";
import {
  observedRecords,
  observeQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import { mutateQueue, planQueueMutation } from "./mutations.ts";
import { predecessorPolicyIdentity } from "./policy.ts";

export interface ObservedSourceGrant {
  readonly path: string;
  readonly source: SourceRevision;
  readonly procedure: string;
  readonly consent: SourceAuthority["source"];
  readonly approved_at: number;
  readonly facts: SourceGrantFacts;
}

export interface ObservedSourceAuthority {
  readonly path: string;
  readonly authority: LandingAuthorityResolution;
  readonly grant?: ObservedSourceGrant;
}

/** Locate the positively identified effort even when edits have invalidated its authority. */
export async function registeredSourcePath(
  root: string,
  source: SourceRevision,
): Promise<string | undefined> {
  const path = await worktreePathForBranch(
    root,
    source.branch.slice("refs/heads/".length),
  );
  return path !== undefined &&
      (await resolveIdentity(path, path)).id === source.effort_id
    ? path
    : undefined;
}

/** Only the exact registered source checkout may supply its desk marker or scope coverage. */
export async function observeSourceAuthority(
  root: string,
  trunk: string,
  source: SourceRevision,
  policy: string,
  previous?: SourceAuthority,
  conversation?: SourceRevision,
): Promise<ObservedSourceAuthority | undefined> {
  const path = await registeredSourcePath(root, source);
  if (path === undefined) return undefined;
  const pin = await pinValidatedTree(path);
  if (!pin.clean || pin.head !== source.head) return undefined;
  const subject = await inspectEffortGrantSubject(
    path,
    source.branch.slice("refs/heads/".length),
  );
  if (!sameSource(subject.source, source)) return undefined;
  const standing = await inspectLandingAuthority(path, trunk, {
    includeScopeEvidence: true,
  });
  const effort = standing.effortGrant;
  const explicit = conversation !== undefined &&
    sameSource(conversation, source);
  const reading = { path, authority: standing };
  if (
    standing.kind === "conversation-required" &&
    standing.blockingReason !== undefined
  ) return reading;
  const retainedConversation = previous?.source.source === "conversation" &&
    previous.state.kind === "granted" &&
    previous.composition_procedure === subject.composition_procedure &&
    previous.sources.some((entry) => sameSource(entry, source));
  const sourceKind = explicit || retainedConversation
    ? "conversation"
    : standing.kind === "authorized"
    ? standing.consent.source
    : undefined;
  if (sourceKind === undefined) return reading;
  const matching = previous?.source.source === sourceKind &&
    previous.state.kind === "granted" &&
    previous.sources.some((entry) => sameSource(entry, source));
  const recordId = sourceKind === "effort-grant"
    ? effort?.id
    : matching
    ? previous.source.record_id
    : SYSTEM_SECURE_ENTROPY.uuid();
  if (recordId === undefined) return reading;
  const scopes =
    sourceKind === "standing-grant" && standing.kind === "authorized"
      ? [...(standing.consent.scopes ?? [])]
      : [];
  return {
    ...reading,
    grant: {
      path,
      source,
      procedure: subject.composition_procedure,
      consent: { source: sourceKind, record_id: recordId, scopes },
      approved_at: sourceKind === "effort-grant" && effort !== undefined
        ? Date.parse(effort.granted_at)
        : matching
        ? previous.approved_at
        : SYSTEM_CLOCK.wallNow(),
      facts: {
        source,
        policy,
        record_id: recordId,
        current: true,
        classifications: standing.classifications,
        granted_scopes: scopes,
        defined_scopes: scopes,
      },
    },
  };
}

/** Grant publication consumes the same observation used by independent judgment readers. */
export async function observeSourceGrant(
  ...args: Parameters<typeof observeSourceAuthority>
): Promise<ObservedSourceGrant | undefined> {
  return (await observeSourceAuthority(...args))?.grant;
}

/** Observe authority without enrolling incidental standing grants or writing consent. */
async function queueAuthorityPlan(
  root: string,
  trunk: string,
  conversation?: SourceRevision,
  requested?: string,
): Promise<{
  observation: CompletionObservation;
  queue: Awaited<ReturnType<typeof requireQueue>>;
  revoked: string[];
  observed: {
    grant: ObservedSourceGrant;
    authority: SourceAuthority;
    id: string;
    existing: boolean;
  }[];
}> {
  const observation = await observeQueue(root, trunk);
  const records = observedRecords(observation);
  const revoked: string[] = [];
  const queue = await requireQueue(root);
  const authorities = new Map(
    queue.record.data.entries.flatMap((entry) =>
      entry.authority_id === null
        ? []
        : [[entry.source.effort_id, entry.authority_id] as const]
    ),
  );
  const observed: {
    grant: ObservedSourceGrant;
    authority: SourceAuthority;
    id: string;
    existing: boolean;
  }[] = [];
  for (const entry of orderedEntries(queue.record.data)) {
    const previous = records.find((record) =>
      record.kind === "authority" && record.id === entry.authority_id
    );
    const candidate = records.find((record) =>
      record.kind === "candidate" && record.id === entry.candidate_id
    );
    const policy = candidate?.kind === "candidate"
      ? candidate.data.policy
      : await predecessorPolicyIdentity(root, observation.trunk);
    const grant = await observeSourceGrant(
      root,
      trunk,
      entry.source,
      policy,
      previous?.kind === "authority" ? previous.data : undefined,
      conversation,
    );
    if (
      entry.revoked_grant !== undefined &&
      !(conversation !== undefined && sameSource(conversation, entry.source)) &&
      (grant?.consent.source !== "effort-grant" ||
        grant.consent.record_id === entry.revoked_grant)
    ) continue;
    if (grant === undefined) {
      if (entry.authority_id !== null) revoked.push(entry.source.effort_id);
      continue;
    }
    if (
      candidate?.kind === "candidate" &&
      candidate.data.composition.procedure !== grant.procedure
    ) continue;
    if (
      grant.consent.source === "standing-grant" &&
      entry.authority_id === null &&
      entry.source.effort_id !== requested
    ) continue;
    const currentRecords = records.map((record) =>
      record.kind === "queue"
        ? {
          ...record,
          data: {
            ...record.data,
            entries: record.data.entries.map((entry) => ({
              ...entry,
              authority_id: authorities.get(entry.source.effort_id) ?? null,
            })),
          },
        }
        : record
    );
    const predecessors = candidate?.kind === "candidate"
      ? predecessorChain(candidate.data, currentRecords).chain.map((entry) =>
        entry.authority.id
      )
      : [];
    const authority = AuthoritySchema.parse({
      source: grant.consent,
      approved_at: grant.approved_at,
      sources: [entry.source],
      composition_procedure: grant.procedure,
      policy,
      predecessor_authorities: predecessors,
      state: { kind: "granted" },
    });
    const existing = previous?.kind === "authority" &&
      JSON.stringify(previous.data) === JSON.stringify(authority);
    const id = existing ? previous.id : SYSTEM_SECURE_ENTROPY.uuid();
    authorities.set(entry.source.effort_id, id);
    if (!existing) {
      records.push({
        kind: "authority",
        version: ON_DISK_FORMATS.completionRecord.version,
        id,
        revision: 1,
        data: authority,
      });
    }
    observed.push({ grant, authority, id, existing });
  }
  return {
    observation,
    queue,
    revoked,
    observed: observed.sort((a, b) =>
      a.grant.approved_at - b.grant.approved_at
    ),
  };
}

/** Preview the same authority mutations that an active invocation publishes. */
export async function previewQueueAuthorities(
  root: string,
  trunk: string,
  conversation?: SourceRevision,
  requested?: string,
): Promise<CompletionObservation> {
  const observation = await observeQueue(root, trunk);
  if (!observedRecords(observation).some((record) => record.kind === "queue")) {
    return observation;
  }
  const plan = await queueAuthorityPlan(root, trunk, conversation, requested);
  const records = observedRecords(plan.observation);
  let queue = plan.queue.record.data;
  const apply = (mutation: Parameters<typeof planQueueMutation>[3]): void => {
    const next = planQueueMutation(
      queue,
      records,
      plan.observation.trunk,
      mutation,
    );
    if (next.kind === "changed") queue = next.queue;
  };
  if (queue.trunk !== plan.observation.trunk) apply({ kind: "trunk-moved" });
  for (const effort of plan.revoked) {
    apply({ kind: "authority-revoked", effort });
  }
  for (const item of plan.observed) {
    if (!item.existing) {
      records.push({
        kind: "authority",
        version: ON_DISK_FORMATS.completionRecord.version,
        id: item.id,
        revision: 1,
        data: item.authority,
      });
    }
    apply({
      kind: "approve",
      batch: item.grant.consent.record_id,
      approvals: new Map([[item.grant.source.effort_id, item.id]]),
    });
  }
  return {
    ...plan.observation,
    records: [
      ...plan.observation.records.map((item) =>
        item.reading.kind === "recorded" && item.reading.record.kind === "queue"
          ? {
            ...item,
            reading: {
              ...item.reading,
              record: { ...item.reading.record, data: queue },
            },
          }
          : item
      ),
      ...records.filter((record) =>
        !plan.observation.records.some((item) =>
          item.selector.kind === record.kind && item.selector.id === record.id
        )
      )
        .map((record) => ({
          selector: { kind: record.kind, id: record.id },
          reading: { kind: "recorded" as const, record, stamp: "preview" },
        })),
    ],
  };
}

/** Publish only authority already verified for exact sources, under optimistic exclusion. */
export async function synchronizeQueueAuthorities(
  root: string,
  trunk: string,
  conversation?: SourceRevision,
  requested?: string,
): Promise<void> {
  const { observation, queue, revoked, observed } = await queueAuthorityPlan(
    root,
    trunk,
    conversation,
    requested,
  );
  await withQueueLock(root, async () => {
    if (
      (await requireQueue(root)).stamp !== queue.stamp ||
      await gitValue(root, ["rev-parse", `${trunk}^{commit}`]) !==
        observation.trunk
    ) return;
    for (const effort of revoked) {
      const current = await requireQueue(root);
      const changed = await mutateQueue({
        root,
        trunk,
        expected_stamp: current.stamp,
        mutation: { kind: "authority-revoked", effort },
      });
      if (changed.kind !== "changed") {
        throw new Error(
          "Authority revocation needs queue recovery before another prefix can advance.",
        );
      }
    }
    for (
      const item of observed.sort((a, b) =>
        a.grant.approved_at - b.grant.approved_at
      )
    ) {
      const pin = await pinValidatedTree(item.grant.path);
      if (!pin.clean || pin.head !== item.grant.source.head) continue;
      if (item.grant.consent.source === "effort-grant") {
        const current =
          (await inspectLandingAuthority(item.grant.path, trunk)).effortGrant;
        if (
          current === undefined ||
          current.id !== item.grant.consent.record_id ||
          current.composition_procedure !== item.grant.procedure ||
          !sameSource(current.source, item.grant.source)
        ) continue;
      }
      if (!item.existing) {
        const written = await writeCompletionRecord(root, {
          kind: "authority",
          version: ON_DISK_FORMATS.completionRecord.version,
          id: item.id,
          revision: 1,
          data: item.authority,
        }, null);
        if (written.kind !== "written") {
          throw new Error(
            `Source authority binding ${written.kind}; re-observe the queue.`,
          );
        }
      }
      const currentQueue = await requireQueue(root);
      const entry = currentQueue.record.data.entries.find((entry) =>
        sameSource(entry.source, item.grant.source)
      );
      if (entry?.authority_id === item.id && entry.eligible_order !== null) {
        continue;
      }
      const changed = await mutateQueue({
        root,
        trunk,
        expected_stamp: currentQueue.stamp,
        mutation: {
          kind: "approve",
          batch: item.grant.consent.record_id,
          approvals: new Map([[item.grant.source.effort_id, item.id]]),
        },
      });
      if (changed.kind !== "changed" && changed.kind !== "missing-authority") {
        throw new Error(
          "The source approval changed while queue eligibility was being recorded.",
        );
      }
    }
  });
}
