/** Protected producer meaning is resolved through the execution graph, including aliases. */
import {
  type DiscernConfig,
  type ProducerDeclaration,
  toCommandList,
} from "../../shared/config_schema.ts";
import { configuredValidation } from "./configuration.ts";
import { resolveProducerGraph } from "./catalog.ts";

/** Selector names and time budgets do not change the captured measurement. */
export interface ProtectedProducerDefinition {
  readonly run: readonly string[];
  readonly inputs?: readonly string[];
  readonly artifacts: readonly string[];
  readonly environment: readonly string[];
  readonly toolchain: readonly string[];
  readonly needs: readonly ProtectedProducerDefinition[];
}

/** Resolve each standard's complete dependency recipe without a second catalog. */
export async function protectedStandardProducers(
  config: DiscernConfig,
): Promise<ReadonlyMap<string, ProtectedProducerDefinition>> {
  const configured = await configuredValidation(
    config,
    Object.keys(config.scopes),
    false,
  );
  const graph = resolveProducerGraph(
    configured.producers,
    configured.obligations,
  );
  const definitions = new Map<string, ProtectedProducerDefinition>();
  const project = (selector: string): ProtectedProducerDefinition => {
    const cached = definitions.get(selector);
    if (cached !== undefined) return cached;
    const node = graph.producers.get(selector);
    if (node === undefined) {
      throw new Error(`Missing protected producer '${selector}'.`);
    }
    const { run, inputs, artifacts, environment, toolchain, timeout, needs } =
      node.recipe;
    // Exhaustiveness: new recipe fields need an explicit protection decision here.
    const enrolled: Record<keyof ProducerDeclaration, unknown> = {
      run,
      inputs,
      artifacts,
      environment,
      toolchain,
      timeout,
      needs,
    };
    void enrolled;
    const definition: ProtectedProducerDefinition = {
      run: toCommandList(run),
      ...(inputs === undefined ? {} : { inputs }),
      artifacts,
      environment,
      toolchain,
      needs: node.dependencies.map(project),
    };
    definitions.set(selector, definition);
    return definition;
  };
  const standards = new Map<string, ProtectedProducerDefinition>();
  configured.obligations.forEach((obligation, index) => {
    if (obligation.requirement.kind !== "standard") return;
    const selector = graph.selectors[index];
    if (selector === undefined) {
      throw new Error("Missing protected standard selector.");
    }
    standards.set(obligation.requirement.id, project(selector));
  });
  return standards;
}

/** Adding observed identities strengthens applicability; removing one would weaken it. */
export function retainsFacts(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return before.every((value) => after.includes(value));
}

/** Omitted inputs require a fresh candidate-bound run. Declared closures may only widen. */
export function retainsInputClosure(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): boolean {
  return after === undefined ||
    (before !== undefined && retainsFacts(before, after));
}

/** Recursively compare dependency meaning without granting aliases independent authority. */
export function retainsProducerDefinition(
  before: ProtectedProducerDefinition,
  after: ProtectedProducerDefinition,
): boolean {
  return JSON.stringify(before.run) === JSON.stringify(after.run) &&
    JSON.stringify(before.artifacts) === JSON.stringify(after.artifacts) &&
    retainsInputClosure(before.inputs, after.inputs) &&
    retainsFacts(before.environment, after.environment) &&
    retainsFacts(before.toolchain, after.toolchain) &&
    before.needs.length === after.needs.length &&
    before.needs.every((node, index) => {
      const next = after.needs[index];
      return next !== undefined && retainsProducerDefinition(node, next);
    });
}
