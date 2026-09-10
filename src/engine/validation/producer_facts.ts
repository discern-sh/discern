/**
 * What the configured producers establish — one derivation shared by setup and
 * doctor.
 *
 * A producer is any configured command whose output validation consumes: a
 * `[jobs]` entry, a scope gate, or a standard's own `run`. The producer graph in
 * `configuration.ts` and `catalog.ts` is the authority for how they resolve; this
 * module reads that graph once and answers the questions a configuration agent
 * or an owner asks before trusting the gate:
 *  - which standards share a producer with the test stage instead of running a
 *    second suite;
 *  - which producers run the same command twice under different names;
 *  - which producers have no declared `inputs`, so their evidence is bound to the
 *    exact commit and produced again for every candidate.
 * Nothing here judges a project. It reports facts with their remedy and leaves
 * the decision to the reader.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { commands, resolveProducerGraph } from "./catalog.ts";
import { configuredValidation } from "./configuration.ts";
import { producerLabel } from "./public_run.ts";

/** One configured producer as setup and doctor describe it. */
export interface ProducerFact {
  readonly selector: string;
  /** The label completion results use for this producer. */
  readonly label: string;
  readonly commands: readonly string[];
  /** `declared` when `inputs` names a complete closure; otherwise evidence stays
   * bound to the exact candidate. */
  readonly closure: "declared" | "candidate-bound";
  /** Requirement ids that consume this producer's output. */
  readonly consumers: readonly string[];
}

export interface ProducerFacts {
  readonly producers: readonly ProducerFact[];
  /** Configured standards, whatever produces their readings. */
  readonly standards: readonly string[];
  /** Standards that read another producer's output instead of running their own. */
  readonly shared: readonly {
    readonly producer: string;
    readonly standards: readonly string[];
  }[];
  /** Producers whose commands are identical to another producer's: the same
   * work would run twice under different names. */
  readonly duplicated: readonly {
    readonly commands: readonly string[];
    readonly producers: readonly string[];
  }[];
  /** Producer labels with no declared input closure. */
  readonly candidate_bound: readonly string[];
  /** The producer graph could not be resolved; validation would refuse. */
  readonly error?: string;
}

/** Resolve the configured producer graph and describe what it establishes. */
export async function producerFacts(
  config: DiscernConfig,
): Promise<ProducerFacts> {
  const standards = Object.keys(config.standards);
  try {
    const configured = await configuredValidation(
      config,
      Object.keys(config.scopes),
    );
    const graph = resolveProducerGraph(
      configured.producers,
      configured.obligations,
    );
    const consumers = new Map<string, string[]>();
    configured.obligations.forEach((obligation, index) => {
      const producer = graph.selectors[index];
      if (producer === undefined) return;
      const list = consumers.get(producer) ?? [];
      if (!list.includes(obligation.requirement.id)) {
        list.push(obligation.requirement.id);
      }
      consumers.set(producer, list);
    });
    const producers = [...graph.producers.values()].map(
      (node): ProducerFact => ({
        selector: node.selector,
        label: producerLabel(node.selector),
        commands: commands(node.recipe.run),
        closure: node.recipe.inputs === undefined
          ? "candidate-bound"
          : "declared",
        consumers: consumers.get(node.selector) ?? [],
      }),
    );
    const shared = producers.flatMap((producer) => {
      const consuming = producer.consumers.filter((id) =>
        standards.includes(id) &&
        producer.selector !== `standards.${id}`
      );
      return consuming.length === 0
        ? []
        : [{ producer: producer.label, standards: consuming }];
    });
    const byCommands = new Map<
      string,
      { commands: readonly string[]; producers: string[] }
    >();
    for (const producer of producers) {
      const key = JSON.stringify(producer.commands);
      const group = byCommands.get(key) ??
        { commands: producer.commands, producers: [] };
      group.producers.push(producer.label);
      byCommands.set(key, group);
    }
    const duplicated = [...byCommands.values()].filter((group) =>
      group.producers.length > 1
    );
    return {
      producers,
      standards,
      shared,
      duplicated,
      candidate_bound: producers.filter((producer) =>
        producer.closure === "candidate-bound"
      ).map((producer) => producer.label),
    };
  } catch (error) {
    return {
      producers: [],
      standards,
      shared: [],
      duplicated: [],
      candidate_bound: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The one remedy for a candidate-bound producer, worded for setup and doctor alike. */
export const CANDIDATE_BOUND_REMEDY =
  "Declare `inputs` (the paths it reads, as globs) on a producer whose evidence should be reused when nothing it reads changed. Without a closure, its evidence is produced again for every commit. Narrowing an existing closure is a protected change the gate checks against the trunk.";
