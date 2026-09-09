/**
 * How the configured limits combine — one pure derivation from `discern.toml`.
 *
 * Three settings bound different work and may legitimately differ:
 *  - `[completion].concurrency` bounds live candidate executions across the
 *    queue, with one slot reserved for the head effort whenever a later effort
 *    asks (`workCapacity` in the landing queue enforces it, and this module
 *    reads the same `nonHeadWorkSlots`);
 *  - `[gate].concurrent_test_runs` bounds test-stage runs on this host; excess
 *    runs wait for a slot rather than being refused (`test_run_slots.ts`);
 *  - `[execution.<context>].capacity` bounds temporary candidate installations
 *    in a declared environment; ordinary source-tip execution never occupies
 *    one (`observeClaimCapacity` in the execution registry).
 * `[completion].lookahead` separately bounds how far past the next authorized
 * effort speculation may reach. A positive lookahead does nothing on its own:
 * speculation also needs a declared environment for every required context,
 * proved by `discern setup done` for the declaration as it stands, and a spare
 * non-head slot.
 *
 * Setup and doctor read these facts so both explain the same combined effect.
 * The derivation describes configuration plus the recorded proofs a caller
 * supplies; observed occupancy, reservations, and recovery come from the
 * completion records at run time.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { nonHeadWorkSlots } from "../landing_queue/claims.ts";

/** One declared execution environment as it bears on capacity. */
export interface DeclaredEnvironmentCapacity {
  readonly context: string;
  readonly capacity: number;
  /** Whether `context` is one of `[completion].required_contexts`; a declaration
   * for another name is never selected by completion. */
  readonly required: boolean;
}

/** Whether speculative validation can run at all, and what bounds it. */
export type SpeculationFacts =
  | { readonly kind: "off" }
  | {
    /** Positive lookahead with no environment declared for a required context. */
    readonly kind: "undeclared";
    readonly lookahead: number;
    readonly contexts: readonly string[];
  }
  | {
    /** Declared for every required context, but a declaration has not been
     * proved by `discern setup done` as it currently stands. */
    readonly kind: "unproven";
    readonly lookahead: number;
    readonly contexts: readonly string[];
  }
  | {
    /** Declared and requested, but the head reservation leaves no slot. */
    readonly kind: "no-slot";
    readonly lookahead: number;
    readonly binding: "completion.concurrency" | "execution.capacity";
  }
  | {
    readonly kind: "available";
    /** Positions past the next authorized effort that may validate early. */
    readonly depth: number;
    /** Speculative executions that can run at once. */
    readonly slots: number;
    readonly binding: "completion.concurrency" | "execution.capacity";
  };

/** How many of a requested number of simultaneous `done` runs can overlap. */
export interface OverlapFacts {
  readonly requested: number;
  /** Executions that can hold a queue slot at once. */
  readonly executions: number;
  /** Test stages that can run at once among those executions. */
  readonly test_stages: number;
  /** The setting that stops the requested number overlapping fully, if any. */
  readonly binding:
    | "completion.concurrency"
    | "gate.concurrent_test_runs"
    | null;
}

export interface CompletionCapacityFacts {
  readonly concurrency: number;
  readonly lookahead: number;
  /** `[gate].concurrent_test_runs`; 0 means uncapped. */
  readonly test_runs: number;
  readonly required_contexts: readonly string[];
  readonly environments: readonly DeclaredEnvironmentCapacity[];
  readonly overlap: OverlapFacts;
  readonly speculation: SpeculationFacts;
}

/**
 * Derive the combined effect of the configured limits for `requested`
 * simultaneous runs. `proven` names the required contexts whose declaration
 * setup has proved (or that need no rehearsal); omit it to describe the
 * configuration alone.
 */
export function completionCapacityFacts(
  config: DiscernConfig,
  requested = 2,
  proven?: readonly string[],
): CompletionCapacityFacts {
  const { concurrency, lookahead, required_contexts } = config.completion;
  const test_runs = config.gate.concurrent_test_runs;
  const queueSlots = nonHeadWorkSlots(config.completion);
  const environments = Object.entries(config.execution).map(
    ([context, declaration]): DeclaredEnvironmentCapacity => ({
      context,
      capacity: declaration.capacity,
      required: required_contexts.includes(context),
    }),
  );
  const executions = Math.min(requested, concurrency);
  const test_stages = test_runs === 0
    ? executions
    : Math.min(executions, test_runs);
  const binding: OverlapFacts["binding"] = executions < requested
    ? "completion.concurrency"
    : test_stages < requested
    ? "gate.concurrent_test_runs"
    : null;
  return {
    concurrency,
    lookahead,
    test_runs,
    required_contexts,
    environments,
    overlap: { requested, executions, test_stages, binding },
    speculation: speculationFacts(
      lookahead,
      queueSlots,
      required_contexts,
      environments,
      proven,
    ),
  };
}

/** Speculation needs lookahead, a proved declaration per required context, and a spare non-head slot. */
function speculationFacts(
  lookahead: number,
  queueSlots: number,
  requiredContexts: readonly string[],
  environments: readonly DeclaredEnvironmentCapacity[],
  proven: readonly string[] | undefined,
): SpeculationFacts {
  if (lookahead === 0) return { kind: "off" };
  const declared = new Set(
    environments.filter((entry) => entry.required).map((entry) =>
      entry.context
    ),
  );
  const missing = requiredContexts.filter((context) => !declared.has(context));
  if (missing.length > 0) {
    return { kind: "undeclared", lookahead, contexts: missing };
  }
  // The head effort keeps its reserved slot; every other slot may speculate.
  // Each speculative execution also installs a candidate in a declared
  // environment.
  const environmentSlots = Math.min(
    ...environments.filter((entry) => entry.required).map((entry) =>
      entry.capacity
    ),
  );
  const binding = queueSlots <= environmentSlots
    ? "completion.concurrency"
    : "execution.capacity";
  const slots = Math.min(queueSlots, environmentSlots);
  if (slots <= 0) return { kind: "no-slot", lookahead, binding };
  // Configuration permits it; the declaration must also have been rehearsed.
  if (proven !== undefined) {
    const unproven = requiredContexts.filter((context) =>
      !proven.includes(context)
    );
    if (unproven.length > 0) {
      return { kind: "unproven", lookahead, contexts: unproven };
    }
  }
  return { kind: "available", depth: lookahead, slots, binding };
}

/** Plain sentences setup and doctor both print for one derivation. */
export function describeCompletionCapacity(
  facts: CompletionCapacityFacts,
): string[] {
  const lines: string[] = [];
  const runs = (count: number): string =>
    `${count} \`done\` run${count === 1 ? "" : "s"}`;
  const overlap = facts.overlap;
  lines.push(
    overlap.binding === null
      ? `${
        runs(overlap.requested)
      } can validate at the same time: each holds one of ${facts.concurrency} queue slots (\`completion.concurrency\`) and ${
        facts.test_runs === 0
          ? "test stages are uncapped"
          : `up to ${facts.test_runs} test stage${
            facts.test_runs === 1 ? "" : "s"
          } run at once (\`gate.concurrent_test_runs\`)`
      }.`
      : overlap.binding === "completion.concurrency"
      ? `Of ${
        runs(overlap.requested)
      } started together, ${overlap.executions} can validate at once and the rest wait for a queue slot: \`completion.concurrency = ${facts.concurrency}\` is the limit that binds.`
      : `${
        runs(overlap.requested)
      } can hold queue slots at once, but only ${overlap.test_stages} test stage${
        overlap.test_stages === 1 ? "" : "s"
      } run at a time and the rest queue: \`gate.concurrent_test_runs = ${facts.test_runs}\` is the limit that binds.`,
  );
  lines.push(describeSpeculation(facts));
  return lines;
}

/** One sentence saying whether early validation runs here, and if not, what stops it. */
function describeSpeculation(facts: CompletionCapacityFacts): string {
  const speculation = facts.speculation;
  switch (speculation.kind) {
    case "off":
      return "Efforts validate and land in order; no effort is validated early against unlanded work (`completion.lookahead = 0`).";
    case "undeclared":
      return `\`completion.lookahead = ${speculation.lookahead}\` asks to validate efforts early, but no \`[execution.${
        speculation.contexts.join("]` or `[execution.")
      }]\` declaration says how a checkout is prepared and restored, so early validation is not operational. Efforts still validate and land in order.`;
    case "unproven":
      return `\`completion.lookahead = ${speculation.lookahead}\` asks to validate efforts early, but the environment declared for ${
        speculation.contexts.map((context) => `\`${context}\``).join(", ")
      } has not been proven by \`discern setup done\` as it currently stands, so early validation is not operational. Efforts still validate and land in order.`;
    case "no-slot":
      return speculation.binding === "completion.concurrency"
        ? `\`completion.lookahead = ${speculation.lookahead}\` asks to validate efforts early, but \`completion.concurrency = ${facts.concurrency}\` leaves no slot beyond the one reserved for the next effort to land. Raise concurrency to 2 or more, or set lookahead to 0.`
        : `\`completion.lookahead = ${speculation.lookahead}\` asks to validate efforts early, but a declared environment has no spare capacity for a temporary candidate. Raise its \`capacity\`, or set lookahead to 0.`;
    case "available":
      return `Up to ${speculation.depth} effort${
        speculation.depth === 1 ? "" : "s"
      } past the next one to land can be validated early, ${speculation.slots} at a time (bounded by \`${speculation.binding}\`), once their owners release their checkouts.`;
  }
}
