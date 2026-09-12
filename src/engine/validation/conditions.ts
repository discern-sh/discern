import type { EnvReader } from "../../shared/env.ts";
/** Condition observations carry digests, never effective process secrets. */
import { z } from "@zod/zod";
import { sha256Hex } from "../../shared/sha256.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { jobEnvironment } from "../jobs/command.ts";
import { DigestSchema, RecordIdSchema } from "../completion/identity.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import { readArtifact } from "./artifacts.ts";
import type { ConfiguredValidation } from "./configuration.ts";
import type { ValidationConditions } from "./catalog.ts";

/** The retained artifact naming the conditions an attempt validated under. */
export const CONDITION_FACTS_ARTIFACT = "conditions/facts.json";

export const ConditionFactsSchema = z.strictObject({
  version: z.literal(1),
  candidate_id: RecordIdSchema,
  seed: z.number().int(),
  identity: DigestSchema,
  environment_digests: z.record(z.string(), DigestSchema),
});

/** Platform and runtime facts belong to the validating process, never to the source. */
export async function currentValidationConditions(
  root: string,
  configured: ConfiguredValidation,
  seed: number,
  overrides: Readonly<Record<string, string>>,
  inherited: EnvReader = Deno.env,
): Promise<ValidationConditions> {
  const effective = await jobEnvironment(root, overrides);
  const names = [
    ...new Set(
      Object.values(configured.producers).flatMap((recipe) =>
        recipe.environment
      ),
    ),
  ].sort();
  const environment = Object.fromEntries(
    names.map((name) => [name, effective[name] ?? inherited.get(name)]),
  );
  return {
    seed,
    environment,
    identity: await sha256Hex(
      JSON.stringify([
        "completion-conditions-v1",
        DISCERN_VERSION,
        Deno.version,
        Deno.build,
      ]),
    ),
    environment_digests: Object.fromEntries(
      await Promise.all(
        Object.entries(environment).map(async (
          [name, value],
        ) => [name, await sha256Hex(JSON.stringify(value ?? null))]),
      ),
    ),
  };
}

/**
 * The conditions a candidate's evidence was produced under. A process that
 * observed its own conditions uses them; a reader of another process's work
 * takes the retained facts, or states that none were observed.
 */
export async function candidateConditions(
  candidateId: string,
  current: ValidationConditions | undefined,
  observation: CompletionObservation,
  root: string,
): Promise<ValidationConditions[]> {
  if (current !== undefined) return [current];
  const records = observation.records.flatMap(({ reading }) =>
    reading.kind === "recorded" ? [reading.record] : []
  );
  const proof =
    records.filter((record) =>
      record.kind === "proof" && record.data.candidate_id === candidateId
    )
      .sort((a, b) =>
        a.kind === "proof" && b.kind === "proof"
          ? b.data.assembled_at - a.data.assembled_at
          : 0
      )[0];
  const referenced = new Set(
    proof?.kind === "proof"
      ? proof.data.receipts.map((receipt) => receipt.evidence_id)
      : [],
  );
  // A complete Proof can refer to unchanged-input receipts produced for an
  // earlier candidate. Their original condition facts remain required; the
  // reader supplies none.
  const evidence = records.flatMap((record) =>
    record.kind === "evidence" &&
      (record.data.candidate_id === candidateId || referenced.has(record.id))
      ? [record.data]
      : []
  )
    .sort((a, b) => b.sequence - a.sequence);
  for (const record of evidence) {
    const artifact = record.artifacts.find((item) =>
      item.path === CONDITION_FACTS_ARTIFACT
    );
    if (artifact === undefined) continue;
    const facts = ConditionFactsSchema.parse(
      JSON.parse(
        new TextDecoder().decode(await readArtifact(root, artifact)),
      ),
    );
    if (
      facts.candidate_id !== record.candidate_id ||
      artifact.candidate_id !== record.candidate_id ||
      artifact.attempt_id !== record.attempt_id
    ) {
      throw new Error("Condition evidence names a substituted candidate.");
    }
    return [{ ...facts, environment: {} }];
  }
  return [{
    seed: 0,
    environment: {},
    identity: await sha256Hex("unobserved-conditions"),
  }];
}
