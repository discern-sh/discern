/** Public configuration compiles to the canonical producer and requirement graph. */
import {
  type CustomJobConfig,
  type DiscernConfig,
  type ProducerDeclaration,
  ProducerDeclarationSchema,
  toCommandList,
} from "../../shared/config_schema.ts";
import {
  isKnownJob,
  jobStage,
  type Stage,
  STAGES,
} from "../../shared/capabilities.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { buildStandardPlan } from "../gate/standard_plan.ts";
import { GATE_TIMEOUT_KEY, type JobTimeout } from "../jobs/types.ts";
import {
  commands,
  type ObligationDeclaration,
  resolveProducerGraph,
} from "./catalog.ts";

export interface ConfiguredValidation {
  readonly producers: Readonly<Record<string, ProducerDeclaration>>;
  readonly obligations: readonly ObligationDeclaration[];
  readonly ordering: ReadonlyMap<string, readonly string[]>;
  readonly stages: ReadonlyMap<string, Stage | "scope_gates" | "standards">;
  readonly timeouts: ReadonlyMap<string, JobTimeout>;
}

/** Resolve source references before identities are computed, without interpreting shell code. */
function recipe(config: DiscernConfig, value: unknown): ProducerDeclaration {
  const parsed = ProducerDeclarationSchema.parse(value);
  return {
    ...parsed,
    timeout: parsed.timeout ?? config.gate.timeout,
    run: commands(parsed.run).map((command) =>
      expandSourcePathReferences(command, config)
    ),
    ...(parsed.inputs === undefined ? {} : {
      inputs: parsed.inputs.map((path) =>
        expandSourcePathReferences(path, config)
      ),
    }),
  };
}

/** Complete declared obligations and prerequisite stages share one execution authority. */
export async function configuredValidation(
  config: DiscernConfig,
  changedScopes: readonly string[],
  stageDependencies = true,
): Promise<ConfiguredValidation> {
  const producers: Record<string, ProducerDeclaration> = {};
  const obligations: ObligationDeclaration[] = [];
  const ordering = new Map<string, readonly string[]>();
  const stages = new Map<string, Stage | "scope_gates" | "standards">();
  const timeouts = new Map<string, JobTimeout>();
  const budget = (seconds: number | undefined, key: string): JobTimeout => ({
    seconds: seconds ?? config.gate.timeout,
    key: seconds === undefined ? GATE_TIMEOUT_KEY : key,
  });
  const add = async (
    selector: string,
    id: string,
    kind: "job" | "scope",
    run: ProducerDeclaration,
    stage: Stage | "scope_gates",
    contexts: readonly string[] | undefined,
    required: boolean,
  ): Promise<void> => {
    if (Object.hasOwn(producers, selector)) {
      throw new Error(`Producer selector collision: ${selector}`);
    }
    producers[selector] = run;
    stages.set(selector, stage);
    if (!required) return;
    for (const context of contexts ?? config.completion.required_contexts) {
      obligations.push({
        requirement: {
          id,
          kind,
          context,
          definition: await sha256Hex(JSON.stringify([selector, run])),
        },
        input: { producer: selector },
      });
    }
  };
  for (const [name, value] of Object.entries(config.jobs)) {
    const run = toCommandList(value);
    if (
      run.every((command) => command.trim() === "" || command.trim() === ":")
    ) continue;
    const table = typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
    timeouts.set(
      `jobs.${name}`,
      budget(table?.timeout, `[jobs.${name}].timeout`),
    );
    const stage = isKnownJob(name)
      ? jobStage(name)
      : (value as CustomJobConfig).stage;
    if (stage === undefined) {
      throw new Error(`Job ${name} has no execution stage.`);
    }
    await add(
      `jobs.${name}`,
      name,
      "job",
      recipe(config, {
        run,
        inputs: table?.inputs,
        needs: table?.needs,
        artifacts: table?.artifacts,
        environment: table?.environment,
        toolchain: table?.toolchain,
        timeout: table?.timeout,
      }),
      stage,
      table?.contexts,
      true,
    );
  }
  for (const group of resolveGeneratedGroups(config)) {
    timeouts.set(
      `jobs.discern-generated-${group.name}`,
      budget(group.timeout, `[generated.${group.name}].timeout`),
    );
    await add(
      `jobs.discern-generated-${group.name}`,
      `discern-generated-${group.name}`,
      "job",
      recipe(config, {
        run: group.run,
        ...(group.timeout === undefined ? {} : { timeout: group.timeout }),
      }),
      "build",
      undefined,
      true,
    );
  }
  for (const [name, scope] of Object.entries(config.scopes)) {
    if (scope.gate === undefined || toCommandList(scope.gate).length === 0) {
      continue;
    }
    timeouts.set(
      `scopes.${name}.gate`,
      budget(scope.timeout, `[scopes.${name}].timeout`),
    );
    await add(
      `scopes.${name}.gate`,
      name,
      "scope",
      recipe(config, {
        run: scope.gate,
        inputs: scope.inputs,
        needs: scope.needs,
        artifacts: scope.artifacts,
        environment: scope.environment,
        toolchain: scope.toolchain,
        timeout: scope.timeout,
      }),
      "scope_gates",
      scope.contexts,
      changedScopes.includes(name),
    );
  }
  const previous: string[] = [];
  for (const stage of stageDependencies ? STAGES : []) {
    const members = [...stages].filter(([, value]) => value === stage).map((
      [key],
    ) => key);
    for (const selector of members) {
      const node = producers[selector];
      if (node === undefined) throw new Error("Missing configured producer.");
      // Mutators serialize; checks and tests share the completed build prerequisites.
      const dependencies = stage === "fix"
        ? previous
        : previous.filter((key) =>
          stages.get(key) !== "check" && stages.get(key) !== "test"
        );
      ordering.set(selector, [...dependencies]);
      if (stage === "fix") previous.push(selector);
    }
    if (stage !== "fix") previous.push(...members);
  }
  for (const standard of buildStandardPlan(config).standards) {
    const spec = standard.spec;
    const selector = `standards.${standard.name}`;
    timeouts.set(
      selector,
      budget(spec.timeout, `[standards.${standard.name}].timeout`),
    );
    if (spec.run !== undefined) {
      producers[selector] = recipe(config, {
        run: spec.run,
        inputs: standard.inputs,
        needs: spec.needs,
        artifacts: spec.artifacts,
        environment: spec.environment,
        toolchain: spec.toolchain,
        timeout: spec.timeout,
      });
      stages.set(selector, "standards");
    }
    for (
      const context of spec.contexts ?? config.completion.required_contexts
    ) {
      const extraction = {
        ...(spec.extract === undefined ? {} : {
          extract: toCommandList(spec.extract).map((command) =>
            expandSourcePathReferences(command, config)
          ),
        }),
        ...(spec.artifact === undefined ? {} : { artifact: spec.artifact }),
      };
      obligations.push({
        requirement: {
          kind: "standard",
          id: standard.name,
          context,
          definition: await sha256Hex(
            JSON.stringify([spec, config.completion.required_contexts]),
          ),
        },
        input: spec.producer === undefined
          ? { run: producers[selector]?.run ?? [], ...extraction }
          : { producer: spec.producer, ...extraction },
        standard: {
          name: standard.name,
          metric: standard.metric,
          direction: standard.direction,
          limit: standard.limit,
          scale: standard.scale,
          ...(standard.per === undefined ? {} : { per: standard.per }),
        },
        ...(standard.inputs === undefined ? {} : { inputs: standard.inputs }),
      });
    }
  }
  if (stageDependencies) {
    const prerequisites = [...stages].filter(([, stage]) =>
      stage === "fix" || stage === "build"
    ).map(([selector]) => selector);
    for (const [selector, stage] of stages) {
      if (stage !== "scope_gates" && stage !== "standards") continue;
      const node = producers[selector];
      if (node !== undefined) ordering.set(selector, prerequisites);
    }
  }
  if (obligations.length === 0) {
    await add(
      "jobs.discern-preflight",
      "discern-preflight",
      "job",
      recipe(config, { run: ":" }),
      "check",
      undefined,
      true,
    );
  }
  resolveProducerGraph(producers, obligations);
  return { producers, obligations, stages, ordering, timeouts };
}
