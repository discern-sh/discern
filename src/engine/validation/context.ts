import type { EnvReader } from "../../shared/env.ts";
/** Context observations carry digests, never effective process secrets. */
import { z } from "@zod/zod";
import { sha256Hex } from "../../shared/sha256.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { jobEnvironment } from "../jobs/command.ts";
import { DigestSchema, RecordIdSchema } from "../completion/identity.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import { readArtifact } from "./artifacts.ts";
import type { ConfiguredValidation } from "./configuration.ts";
import type { ValidationConditions } from "./catalog.ts";

export const ContextFactsSchema = z.strictObject({
  version: z.literal(1),
  candidate_id: RecordIdSchema,
  context: z.string().min(1),
  seed: z.number().int(),
  identity: DigestSchema,
  environment_digests: z.record(z.string(), DigestSchema),
});

/** Platform and runtime facts belong to execution, independently of composition procedure. */
export async function currentValidationConditions(
  root: string,
  configured: ConfiguredValidation,
  context: string,
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
    context,
    seed,
    environment,
    identity: await sha256Hex(
      JSON.stringify([
        "completion-context-v1",
        context,
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

/** Each other lane supplies its own observed facts or remains explicitly unobserved. */
export async function candidateConditions(
  candidateId: string,
  configured: ConfiguredValidation,
  current: ValidationConditions | undefined,
  observation: CompletionObservation,
  root: string,
): Promise<ValidationConditions[]> {
  const result: ValidationConditions[] = current === undefined ? [] : [current];
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
  const contexts = [
    ...new Set(
      configured.obligations.map((obligation) =>
        obligation.requirement.context
      ),
    ),
  ];
  for (const context of contexts.filter((name) => name !== current?.context)) {
    let found: ValidationConditions | undefined;
    // A complete Proof can refer to unchanged-input receipts produced for an earlier
    // candidate. Their original context facts remain required; the reader supplies none.
    const evidence = records.flatMap((record) =>
      record.kind === "evidence" &&
        (record.data.candidate_id === candidateId ||
          referenced.has(record.id)) &&
        record.data.applicability.context === context
        ? [record.data]
        : []
    )
      .sort((a, b) => b.sequence - a.sequence);
    for (const record of evidence) {
      const artifact = record.artifacts.find((item) =>
        item.path === "context/facts.json"
      );
      if (artifact === undefined) continue;
      const facts = ContextFactsSchema.parse(
        JSON.parse(
          new TextDecoder().decode(await readArtifact(root, artifact)),
        ),
      );
      if (
        facts.candidate_id !== record.candidate_id ||
        facts.context !== context ||
        artifact.context !== context ||
        artifact.candidate_id !== record.candidate_id ||
        artifact.attempt_id !== record.attempt_id
      ) {
        throw new Error(
          "Context evidence names a substituted lane or candidate.",
        );
      }
      found = { ...facts, environment: {} };
      break;
    }
    result.push(
      found ??
        {
          context,
          seed: current?.seed ?? 0,
          environment: {},
          identity: await sha256Hex(`unobserved-context:${context}`),
        },
    );
  }
  return result;
}
