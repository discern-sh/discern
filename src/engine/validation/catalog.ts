/** Resolve declarations once before demand or effects. No shell inspection infers inputs. */
import { type Candidate, CandidateSchema } from "../completion/candidate.ts";
import {
  planStandardInput,
  type ProducerDeclaration,
  ProducerDeclarationSchema,
  ProducerSelectorSchema,
  type StandardInput,
  type StandardInputPlan,
} from "../../shared/config_schema.ts";
import {
  ApplicabilitySchema,
  applicabilitySubject,
  type ComponentEvidence,
  type Requirement,
  RequirementSchema,
} from "../completion/evidence.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import type { StandardDefinition } from "./metrics.ts";

/** One configured obligation; requirement definitions include all protected fields. */
export interface ObligationDeclaration {
  readonly requirement: Requirement;
  readonly input: StandardInput;
  readonly standard?: StandardDefinition;
  /** Extractor inputs augment the producer's closure; omission binds extraction to HEAD. */
  readonly inputs?: readonly string[];
}

/** A complete observed file universe, including declared nontracked identity files. */
export interface ValidationInputs {
  readonly files: Readonly<
    Record<
      string,
      {
        readonly digest: string;
        readonly bytes: number;
        readonly lines: number;
        readonly words: number;
      }
    >
  >;
  /** False means enumeration or an applicable identity could not be established. */
  readonly complete: boolean;
}
export interface ValidationConditions {
  readonly context: string;
  readonly seed: number;
  /** Effective child environment, after runner overrides. Never persisted in evidence. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Caller-defined execution contract, including resources and runtime identity. */
  readonly identity: string;
  /** Remote contexts retain only per-value digests from their producing invocation. */
  readonly environment_digests?: Readonly<Record<string, string>>;
}
export interface ResolvedProducer {
  readonly selector: string;
  readonly recipe: ProducerDeclaration;
  readonly dependencies: readonly string[];
}
export interface ResolvedObligation {
  readonly requirement: Requirement;
  readonly input: StandardInputPlan;
  readonly producer: string;
  readonly standard: StandardDefinition | null;
  readonly extent: number | null;
  readonly applicability: ComponentEvidence["applicability"];
  readonly subject: string;
}
export interface ValidationSnapshot {
  readonly ordering?: ReadonlyMap<string, readonly string[]>;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly requirements: readonly Requirement[];
  readonly producers: ReadonlyMap<string, ResolvedProducer>;
  readonly obligations: readonly ResolvedObligation[];
  readonly conditions: readonly ValidationConditions[];
}

/** Key one exact obligation, context and protected definition. */
export function requirementKey(requirement: Requirement): string {
  return JSON.stringify([
    requirement.kind,
    requirement.id,
    requirement.context,
    requirement.definition,
  ]);
}

/** Canonical requirement-set identity used before candidate publication. */
export async function requirementSetIdentity(
  requirements: readonly Requirement[],
): Promise<string> {
  const keys = requirements.map((r) =>
    requirementKey(RequirementSchema.parse(r))
  ).sort();
  const obligations = requirements.map((r) =>
    JSON.stringify([r.kind, r.id, r.context])
  );
  if (keys.length === 0 || new Set(obligations).size !== keys.length) {
    throw new Error(
      "requirements must contain one definition per obligation and context",
    );
  }
  return await sha256Hex(JSON.stringify(keys));
}

/** Normalize aliases and reject cycles, even in currently undemanded declarations. */
export function resolveProducerGraph(
  declarations: Readonly<Record<string, ProducerDeclaration>>,
  obligations: readonly ObligationDeclaration[],
): {
  readonly producers: ReadonlyMap<string, ResolvedProducer>;
  readonly inputs: readonly StandardInputPlan[];
  readonly selectors: readonly string[];
} {
  const recipes = new Map<string, ProducerDeclaration>();
  for (const [selector, recipe] of Object.entries(declarations)) {
    recipes.set(
      ProducerSelectorSchema.parse(selector),
      ProducerDeclarationSchema.parse(recipe),
    );
  }
  const inputs = obligations.map((o) => planStandardInput(o.input));
  const aliases = new Map<string, string>();
  for (let index = 0; index < obligations.length; index++) {
    const obligation = obligations[index];
    const input = inputs[index];
    if (obligation === undefined || input === undefined) {
      throw new Error("missing obligation input");
    }
    if (obligation.requirement.kind !== "standard") continue;
    const selector = `standards.${obligation.requirement.id}`;
    const producer = input.producer;
    if (producer.kind === "inline") {
      const existing = recipes.get(selector);
      if (
        existing !== undefined &&
        JSON.stringify(commands(existing.run)) !== JSON.stringify(producer.run)
      ) {
        throw new Error(`ambiguous producer '${selector}'`);
      }
      recipes.set(
        selector,
        existing ??
          ProducerDeclarationSchema.parse({
            run: [...producer.run],
            ...(obligation.inputs === undefined
              ? {}
              : { inputs: [...obligation.inputs] }),
          }),
      );
    } else {
      if (
        recipes.has(selector) ||
        (aliases.has(selector) && aliases.get(selector) !== producer.selector)
      ) throw new Error(`ambiguous producer '${selector}'`);
      aliases.set(selector, producer.selector);
    }
  }
  const resolve = (
    selector: string,
    seen: ReadonlySet<string> = new Set(),
  ): string => {
    ProducerSelectorSchema.parse(selector);
    if (seen.has(selector)) {
      throw new Error(`producer dependency cycle at '${selector}'`);
    }
    const alias = aliases.get(selector);
    if (alias !== undefined) {
      return resolve(alias, new Set([...seen, selector]));
    }
    if (!recipes.has(selector)) {
      throw new Error(`missing producer '${selector}'`);
    }
    return selector;
  };
  const producers = new Map<string, ResolvedProducer>();
  for (const [selector, recipe] of recipes) {
    producers.set(selector, {
      selector,
      recipe,
      dependencies: recipe.needs.map((need) => resolve(need)),
    });
  }
  const visit = (selector: string, trail: ReadonlySet<string>): void => {
    if (trail.has(selector)) {
      throw new Error(`producer dependency cycle at '${selector}'`);
    }
    for (const dependency of producers.get(selector)?.dependencies ?? []) {
      visit(dependency, new Set([...trail, selector]));
    }
  };
  for (const selector of aliases.keys()) resolve(selector);
  for (const selector of producers.keys()) visit(selector, new Set());
  const artifactOwners = new Map<string, string>();
  for (const producer of producers.values()) {
    const identity = JSON.stringify({
      ...producer.recipe,
      run: commands(producer.recipe.run),
      needs: producer.dependencies,
    });
    for (const path of producer.recipe.artifacts) {
      const owner = artifactOwners.get(path);
      if (owner !== undefined && owner !== identity) {
        throw new Error(`ambiguous artifact producer for '${path}'`);
      }
      artifactOwners.set(path, identity);
    }
  }
  const selectors = obligations.map((obligation, index) => {
    const input = inputs[index];
    if (input === undefined) throw new Error("missing obligation input");
    const selector = resolve(
      input.producer.kind === "inline"
        ? `standards.${obligation.requirement.id}`
        : input.producer.selector,
    );
    if (
      input.extraction?.input.kind === "artifact" &&
      !recipes.get(selector)?.artifacts.includes(input.extraction.input.path)
    ) {
      throw new Error(`undeclared artifact for '${selector}'`);
    }
    return selector;
  });
  return { producers, inputs, selectors };
}

/** Normalize command spelling without changing the producer operation. */
export function commands(run: ProducerDeclaration["run"]): readonly string[] {
  return typeof run === "string" ? [run] : run;
}

/** Select a deterministic file set from the complete observed input universe. */
function selectedFiles(
  inputs: ValidationInputs,
  patterns: readonly string[],
): [string, ValidationInputs["files"][string]][] {
  return Object.entries(inputs.files).filter(([path]) =>
    patterns.some((pattern) => pathMatchesPattern(path, pattern))
  ).sort(([a], [b]) => a.localeCompare(b));
}

/** Freeze applicability from the complete candidate input closure, never change-path scope. */
export async function prepareValidationSnapshot(source: {
  readonly ordering?: ReadonlyMap<string, readonly string[]>;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly producers: Readonly<Record<string, ProducerDeclaration>>;
  readonly obligations: readonly ObligationDeclaration[];
  /** Omitted for complete observation; partial observations cannot assemble Proof. */
  readonly observedRequirements?: readonly Requirement[];
  readonly inputs: ValidationInputs;
  readonly conditions: readonly ValidationConditions[];
}): Promise<ValidationSnapshot> {
  const input = structuredClone(source);
  const candidate = CandidateSchema.parse(input.candidate);
  RecordIdSchema.parse(input.candidate_id);
  const requirements = input.obligations.map((o) =>
    RequirementSchema.parse(o.requirement)
  );
  for (const declaration of input.obligations) {
    const standard = declaration.standard;
    if (
      standard !== undefined &&
      (!Number.isFinite(standard.limit) || !Number.isFinite(standard.scale) ||
        standard.scale <= 0 || standard.metric === "")
    ) {
      throw new Error(
        "standard definitions require a finite limit and a positive finite scale",
      );
    }
  }
  if (
    await requirementSetIdentity(requirements) !== candidate.requirement_set
  ) {
    throw new Error(
      "candidate requirement set differs from validation declarations",
    );
  }
  const graph = resolveProducerGraph(input.producers, input.obligations);
  const conditions = new Map(input.conditions.map((c) => [c.context, c]));
  if (conditions.size !== input.conditions.length) {
    throw new Error("duplicate context conditions");
  }
  const obligations: ResolvedObligation[] = [];
  for (let index = 0; index < input.obligations.length; index++) {
    const declaration = input.obligations[index];
    const normalized = graph.inputs[index];
    const selector = graph.selectors[index];
    if (
      declaration === undefined || normalized === undefined ||
      selector === undefined
    ) throw new Error("incomplete declaration");
    if (
      input.observedRequirements !== undefined &&
      !input.observedRequirements.some((requirement) =>
        requirementKey(requirement) === requirementKey(declaration.requirement)
      )
    ) continue;
    const condition = conditions.get(declaration.requirement.context);
    if (condition === undefined) {
      throw new Error(
        `missing conditions for '${declaration.requirement.context}'`,
      );
    }
    if (
      (declaration.requirement.kind === "standard") !==
        (declaration.standard !== undefined)
    ) throw new Error("standard obligations require a metric definition");
    const closure = new Map<string, ResolvedProducer>();
    const collect = (key: string): void => {
      const node = graph.producers.get(key);
      if (node === undefined) throw new Error(`missing producer '${key}'`);
      if (closure.has(key)) return;
      closure.set(key, node);
      node.dependencies.forEach(collect);
    };
    collect(selector);
    const nodes = [...closure.values()].sort((a, b) =>
      a.selector.localeCompare(b.selector)
    );
    const patterns = [
      ...nodes.flatMap((n) => n.recipe.inputs ?? []),
      ...(declaration.inputs ?? []),
    ];
    const toolchain = [...new Set(nodes.flatMap((n) => n.recipe.toolchain))]
      .sort();
    const environment = [...new Set(nodes.flatMap((n) => n.recipe.environment))]
      .sort();
    const per = declaration.standard?.per;
    const denominator = per?.kind === "extent"
      ? selectedFiles(input.inputs, per.globs)
      : [];
    const extent = per?.kind !== "extent"
      ? null
      : denominator.reduce((sum, [, file]) =>
        sum + (per.measure === "files" ? 1 : file[per.measure]), 0);
    const complete = input.inputs.complete && nodes.every((n) =>
      n.recipe.inputs !== undefined
    ) &&
      (normalized.extraction === null || declaration.inputs !== undefined) &&
      toolchain.every((path) => Object.hasOwn(input.inputs.files, path));
    const applicability = ApplicabilitySchema.parse({
      producer: selector,
      context: condition.context,
      policy: candidate.policy,
      protected_definitions: await sha256Hex(
        JSON.stringify([
          declaration.requirement,
          declaration.standard ?? null,
          normalized,
          patterns,
          per ?? null,
        ]),
      ),
      command: await sha256Hex(
        JSON.stringify(
          nodes.map((
            n,
          ) => [n.selector, { ...n.recipe, run: commands(n.recipe.run) }]),
        ),
      ),
      extractor: await sha256Hex(JSON.stringify(normalized.extraction)),
      inputs: await sha256Hex(
        JSON.stringify(selectedFiles(input.inputs, patterns)),
      ),
      denominator_inputs: await sha256Hex(
        JSON.stringify([per ?? null, denominator]),
      ),
      toolchain: await sha256Hex(
        JSON.stringify(
          toolchain.map((path) => [path, input.inputs.files[path] ?? null]),
        ),
      ),
      environment: await sha256Hex(
        JSON.stringify([
          condition.identity,
          await Promise.all(
            environment.map(async (
              name,
            ) => [
              name,
              condition.environment_digests?.[name] ??
                await sha256Hex(
                  JSON.stringify(condition.environment[name] ?? null),
                ),
            ]),
          ),
        ]),
      ),
      seed: condition.seed,
      closure: complete
        ? {
          kind: "declared",
          declaration: await sha256Hex(JSON.stringify(patterns)),
        }
        : { kind: "candidate", head: candidate.head },
    });
    obligations.push({
      requirement: declaration.requirement,
      input: normalized,
      producer: selector,
      standard: declaration.standard ?? null,
      extent,
      applicability,
      subject: await applicabilitySubject(applicability),
    });
  }
  return {
    candidate_id: input.candidate_id,
    candidate,
    requirements,
    producers: graph.producers,
    ...(input.ordering === undefined ? {} : { ordering: input.ordering }),
    obligations,
    conditions: structuredClone(input.conditions),
  };
}
