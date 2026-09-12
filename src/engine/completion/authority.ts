/** Recorded decisions are input to re-verification, never a substitute for it. */
import { z } from "@zod/zod";
import {
  AuthorizedVarianceSchema,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import { DigestSchema, NameSchema } from "./identity.ts";

export { ExceptionClaimSchema } from "./exception_claim.ts";

const JudgmentSchema = z.strictObject({
  checkpoint: NameSchema,
  subject: DigestSchema,
  declaration: DigestSchema,
});
/** Grants and machine evidence cannot supply these independently checked decisions. */
export const DecisionsSchema = z.strictObject({
  judgments: z.array(JudgmentSchema),
  variances: z.array(AuthorizedVarianceSchema),
  proposals: z.array(StandardLimitProposalSchema),
});
export type CandidateDecisions = z.infer<typeof DecisionsSchema>;

/** Settled decisions must equal their approved counterparts exactly. */
export function verifyCandidateDecisions(
  current: CandidateDecisions,
  authorized: CandidateDecisions,
):
  | { readonly kind: "missing-judgment"; readonly subjects: string[] }
  | undefined {
  const same = (left: readonly unknown[], right: readonly unknown[]): boolean =>
    left.length === right.length &&
    left.every((item, index) =>
      JSON.stringify(item) === JSON.stringify(right[index])
    );
  const sortedJson = (items: readonly unknown[]): unknown[] =>
    [...items].map((item) => JSON.stringify(item)).sort();
  if (
    !same(sortedJson(current.judgments), sortedJson(authorized.judgments)) ||
    !same(sortedJson(current.variances), sortedJson(authorized.variances)) ||
    !same(sortedJson(current.proposals), sortedJson(authorized.proposals))
  ) {
    return { kind: "missing-judgment", subjects: ["decisions-changed"] };
  }
  return undefined;
}
