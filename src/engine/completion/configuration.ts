/** Internal cutover declarations. The live config schema does not import these. */
import { z } from "@zod/zod";
import { ArtifactPathSchema } from "./evidence.ts";
import { NameSchema } from "./identity.ts";

const CommandsSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);
export const ProducerSelectorSchema = z.string().regex(
  /^(?:jobs\.[A-Za-z0-9_-]+|scopes\.[A-Za-z0-9_-]+\.gate|standards\.[A-Za-z0-9_-]+)$/u,
);

/** A process recipe, including every declared process-affecting input. */
export const ProducerDeclarationSchema = z.strictObject({
  run: CommandsSchema,
  inputs: z.array(z.string().min(1)).min(1).optional(),
  needs: z.array(ProducerSelectorSchema).default([]),
  artifacts: z.array(ArtifactPathSchema).default([]),
  environment: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)).default(
    [],
  ),
  toolchain: z.array(ArtifactPathSchema).default([]),
  timeout: z.number().nonnegative().optional(),
});
export type ProducerDeclaration = z.infer<typeof ProducerDeclarationSchema>;

/** `run` always produces. `extract` always consumes captured output or an artifact. */
export const StandardInputSchema = z.union([
  z.strictObject({
    run: CommandsSchema,
    extract: CommandsSchema.optional(),
    artifact: ArtifactPathSchema.optional(),
  }),
  z.strictObject({
    producer: ProducerSelectorSchema,
    extract: CommandsSchema.optional(),
    artifact: ArtifactPathSchema.optional(),
  }),
]).refine(
  (source) => source.artifact === undefined || source.extract !== undefined,
  "artifact consumption requires an extract operation",
);
export type StandardInput = z.infer<typeof StandardInputSchema>;

export interface StandardInputPlan {
  readonly producer: {
    readonly kind: "inline";
    readonly run: readonly string[];
  } | { readonly kind: "reference"; readonly selector: string };
  readonly extraction: {
    readonly run: readonly string[];
    readonly input: { readonly kind: "output" } | {
      readonly kind: "artifact";
      readonly path: string;
    };
  } | null;
}

/** Pure normalization retains the semantic operation independently of selection. */
export function planStandardInput(input: StandardInput): StandardInputPlan {
  const source = StandardInputSchema.parse(input);
  return {
    producer: "run" in source
      ? {
        kind: "inline",
        run: typeof source.run === "string" ? [source.run] : source.run,
      }
      : { kind: "reference", selector: source.producer },
    extraction: source.extract === undefined ? null : {
      run: typeof source.extract === "string"
        ? [source.extract]
        : source.extract,
      input: source.artifact === undefined
        ? { kind: "output" }
        : { kind: "artifact", path: source.artifact },
    },
  };
}

/** Frozen spelling for [completion]; concurrency and lookahead are separate limits. */
export const CompletionPolicySchema = z.strictObject({
  required_contexts: z.array(NameSchema).min(1).default(["local"]),
  concurrency: z.number().int().positive().default(1),
  lookahead: z.number().int().nonnegative().default(0),
}).refine(
  (policy) =>
    new Set(policy.required_contexts).size === policy.required_contexts.length,
  "required contexts must be distinct",
);
export type CompletionPolicy = z.infer<typeof CompletionPolicySchema>;

/** Frozen spelling for [execution.<name>]; 2B establishes executable eligibility. */
export const EnvironmentDeclarationSchema = z.strictObject({
  kind: z.enum(["borrowed", "isolated"]),
  prepare: CommandsSchema,
  restore: CommandsSchema.optional(),
  reset: CommandsSchema.optional(),
  dispose: CommandsSchema.optional(),
  reusable: z.boolean(),
  resources: z.array(NameSchema),
  ignored: z.array(z.string().min(1)),
  inputs: z.array(z.string().min(1)).min(1),
  capacity: z.number().int().positive(),
}).refine(
  (environment) =>
    environment.kind === "borrowed"
      ? environment.restore !== undefined
      : environment.dispose !== undefined &&
        (!environment.reusable || environment.reset !== undefined),
  "borrowing requires restore; isolation requires disposal and reusable isolation requires reset",
);
export type EnvironmentDeclaration = z.infer<
  typeof EnvironmentDeclarationSchema
>;
