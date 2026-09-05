/** Source consent is a declared procedure over exact sources, never descendant ancestry. */
import { AuthoritySchema, DecisionsSchema } from "../completion/authority.ts";
import type { Candidate } from "../completion/candidate.ts";
import type { SourceRevision } from "../completion/identity.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { z } from "@zod/zod";
import {
  type ClassifiedLandingPath,
  resolveLandingAuthority,
} from "../worktree/landing_authority.ts";
import { sameStandardLimitProposalSet } from "../gate/standard_proposal_state.ts";
import { sameSource } from "./model.ts";

export type SourceAuthority = z.infer<typeof AuthoritySchema>;
export type CandidateDecisions = z.infer<typeof DecisionsSchema>;
export type AuthorityRecord = Extract<CompletionRecord, { kind: "authority" }>;

/** Reobserved grant facts come from the authority adapter, not the authoring checkout's config. */
export interface SourceGrantFacts {
  readonly source: SourceRevision;
  readonly record_id: string;
  readonly policy: string;
  readonly current: boolean;
  readonly classifications: readonly ClassifiedLandingPath[];
  readonly granted_scopes: readonly string[];
  readonly defined_scopes: readonly string[];
}

/** Resolve current scope coverage from the existing authority matcher. */
function grantCovers(
  authority: SourceAuthority,
  facts: SourceGrantFacts,
): boolean {
  if (
    !facts.current || authority.source.record_id !== facts.record_id ||
    authority.policy !== facts.policy
  ) return false;
  if (authority.source.source !== "standing-grant") return true;
  const scopes = authority.source.scopes.filter((scope) =>
    facts.granted_scopes.includes(scope)
  );
  return resolveLandingAuthority({
    effortGranted: false,
    classifications: facts.classifications,
    grantedScopes: scopes,
    definedScopes: facts.defined_scopes,
  }).kind === "authorized";
}

/** Each predecessor is proven separately, including an incidental, independently authored prefix. */
export function resolveSourceAuthority(input: {
  readonly candidate: Candidate;
  readonly authority: AuthorityRecord;
  readonly facts: readonly SourceGrantFacts[];
  readonly predecessors: readonly {
    readonly candidate: Candidate;
    readonly authority: AuthorityRecord;
    readonly landed: boolean;
  }[];
}): CompletionBlocker | {
  readonly kind: "authorized";
  readonly authority_id: string;
} {
  const { candidate, authority } = input;
  const missing: SourceRevision[] = [];
  const verify = (
    subject: Candidate,
    record: AuthorityRecord,
    landed: boolean,
  ): void => {
    const source = subject.source;
    const approved = record.data.sources.some((item) =>
      sameSource(item, source)
    );
    const fact = input.facts.find((item) =>
      sameSource(item.source, source) &&
      item.record_id === record.data.source.record_id
    );
    const usable = record.data.state.kind === "granted" ||
      (landed && record.data.state.kind === "consumed");
    const covered = landed && record.data.state.kind === "consumed" ||
      (fact !== undefined && grantCovers(record.data, fact));
    if (
      !approved || !usable || !covered ||
      record.data.policy !== subject.policy ||
      record.data.composition_procedure !== subject.composition.procedure
    ) missing.push(source);
  };
  verify(candidate, authority, false);
  for (const predecessor of input.predecessors) {
    const record = predecessor.authority;
    if (
      record.id !== authority.id &&
      !authority.data.predecessor_authorities.includes(record.id)
    ) {
      missing.push(predecessor.candidate.source);
    }
    verify(predecessor.candidate, record, predecessor.landed);
  }
  for (const dependency of candidate.dependencies) {
    const predecessor = input.predecessors.find((item) =>
      sameSource(item.candidate.source, dependency)
    );
    if (predecessor === undefined) missing.push(dependency);
  }
  if (missing.length > 0) {
    return {
      kind: "missing-authority",
      sources: [
        ...new Map(missing.map((source) => [source.effort_id, source]))
          .values(),
      ],
    };
  }
  return { kind: "authorized", authority_id: authority.id };
}

/** Renew composition coverage without widening the original source decision. Caller publishes a new immutable subject. */
export function renewSourceAuthority(
  original: SourceAuthority,
  current: SourceGrantFacts,
  predecessorAuthorities: readonly string[],
): SourceAuthority | CompletionBlocker {
  if (
    original.state.kind !== "granted" || !current.current ||
    current.record_id !== original.source.record_id ||
    !original.sources.some((source) => sameSource(source, current.source))
  ) {
    return { kind: "missing-authority", sources: [current.source] };
  }
  const renewed = AuthoritySchema.parse({
    ...original,
    policy: current.policy,
    predecessor_authorities: [...predecessorAuthorities],
  });
  return grantCovers(renewed, current)
    ? renewed
    : { kind: "missing-authority", sources: [current.source] };
}

/** Decision order carries no authority; every tuple must match exactly. */
function sameSet(left: readonly unknown[], right: readonly unknown[]): boolean {
  const keys = (values: readonly unknown[]): string[] =>
    values.map((value) => JSON.stringify(value)).sort();
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

/** Changed checkpoint subjects, rationales, or proposal tuples need their own current decision. */
export function verifyCandidateDecisions(
  current: CandidateDecisions,
  authorized: CandidateDecisions,
): CompletionBlocker | undefined {
  const needed = DecisionsSchema.parse(current);
  const approved = DecisionsSchema.parse(authorized);
  const subjects: string[] = [];
  if (!sameSet(needed.judgments, approved.judgments)) {
    subjects.push("checkpoint-declarations");
  }
  if (!sameSet(needed.variances, approved.variances)) {
    subjects.push("checkpoint-variances");
  }
  if (!sameStandardLimitProposalSet(needed.proposals, approved.proposals)) {
    subjects.push("standard-proposals");
  }
  return subjects.length === 0
    ? undefined
    : { kind: "missing-judgment", subjects };
}
