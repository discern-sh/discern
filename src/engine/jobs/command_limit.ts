/**
 * The opt-in bound on how many of one gate run's commands run at once.
 *
 * A gate run normally starts every ready command together. On a machine with
 * too little memory for that, the commands slow one another until some overrun
 * their time limits. The concurrent-commands runtime override names how many
 * may run at a time; unset, no limit exists and nothing here is constructed.
 *
 * A free place goes to the command that asks for it. When commands are waiting,
 * the next free place goes to the one with the longest time limit, so the
 * command expected to run longest starts earliest and the shorter ones run
 * beside it. Equal limits keep the gate's declared order. A time limit starts
 * when its command starts, so waiting spends none of it.
 *
 * One limit belongs to one gate run. Runs in other processes are bounded
 * separately; `[gate].concurrent_test_runs` is the cross-checkout control.
 */

import type { EnvReader } from "../../shared/env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { EnvironmentValueError } from "../../shared/environment_value.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";

/** The runtime override that sets the limit. */
export const CONCURRENT_COMMANDS_VARIABLE =
  DISCERN_ENVIRONMENT_VARIABLES.gateConcurrentCommands;

/** Exact syntax the override accepts: a positive whole number. */
const POSITIVE_WHOLE_NUMBER = /^[1-9][0-9]*$/;

/** One command's claim on a place. */
export interface CommandTurn {
  /** The command's time limit in seconds; `0` or absent means it has none. */
  readonly budgetSeconds: number | undefined;
  /** The command's position in the gate's declared order. */
  readonly order: number;
  /** Aborting it abandons the wait. A command already running is unaffected. */
  readonly signal?: AbortSignal | undefined;
}

/** How many of one gate run's commands may run at once. */
export interface CommandLimit {
  /** The most commands this run starts at a time. */
  readonly limit: number;
  /** How many commands have waited for a place so far. */
  readonly waited: number;
  /**
   * Run `work` in a place, waiting for one when every place is taken. Rejects
   * with the signal's reason when the turn is abandoned while waiting; `work`
   * then never starts.
   */
  run<T>(turn: CommandTurn, work: () => Promise<T>): Promise<T>;
}

interface WaitingTurn {
  readonly turn: CommandTurn;
  readonly arrival: number;
  readonly admit: () => void;
  /** Stop listening for the turn's abandonment once it holds a place. */
  forget: () => void;
}

/** A command with no time limit is expected to outlast every bounded one. */
function expectedLength(turn: CommandTurn): number {
  return turn.budgetSeconds === undefined || turn.budgetSeconds === 0
    ? Number.POSITIVE_INFINITY
    : turn.budgetSeconds;
}

/** Longest time limit first, then declared order, then arrival. */
function startsBefore(a: WaitingTurn, b: WaitingTurn): boolean {
  const lengthA = expectedLength(a.turn);
  const lengthB = expectedLength(b.turn);
  if (lengthA !== lengthB) return lengthA > lengthB;
  if (a.turn.order !== b.turn.order) return a.turn.order < b.turn.order;
  return a.arrival < b.arrival;
}

/** Build a limit of `limit` places. */
export function createCommandLimit(limit: number): CommandLimit {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`a command limit needs at least one place: ${limit}`);
  }
  const waiting: WaitingTurn[] = [];
  let running = 0;
  let arrivals = 0;
  let waited = 0;
  const release = (): void => {
    running--;
    let next: WaitingTurn | undefined;
    for (const candidate of waiting) {
      if (next === undefined || startsBefore(candidate, next)) next = candidate;
    }
    if (next === undefined) return;
    waiting.splice(waiting.indexOf(next), 1);
    running++;
    next.forget();
    next.admit();
  };
  /** Resolve once the turn holds a place; reject if it is abandoned first. */
  const place = (turn: CommandTurn): Promise<void> => {
    if (running < limit) {
      running++;
      return Promise.resolve();
    }
    turn.signal?.throwIfAborted();
    waited++;
    const admitted = Promise.withResolvers<void>();
    const entry: WaitingTurn = {
      turn,
      arrival: arrivals++,
      admit: admitted.resolve,
      forget: (): void => {},
    };
    waiting.push(entry);
    const signal = turn.signal;
    if (signal !== undefined) {
      const abandon = (): void => {
        const index = waiting.indexOf(entry);
        if (index === -1) return;
        waiting.splice(index, 1);
        admitted.reject(signal.reason);
      };
      signal.addEventListener("abort", abandon, { once: true });
      entry.forget = (): void => signal.removeEventListener("abort", abandon);
    }
    return admitted.promise;
  };
  return {
    limit,
    get waited(): number {
      return waited;
    },
    async run<T>(turn: CommandTurn, work: () => Promise<T>): Promise<T> {
      await place(turn);
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}

/**
 * The limit the environment asks for, or undefined when it asks for none. An
 * unset or empty override asks for none. Any other value must be a positive
 * whole number: a value that only looks like a limit would otherwise leave the
 * run unbounded while its owner believes it is bounded.
 */
export function concurrentCommandsRequested(
  env: EnvReader = Deno.env,
): number | undefined {
  const value = env.get(CONCURRENT_COMMANDS_VARIABLE);
  if (value === undefined || value === "") return undefined;
  if (!POSITIVE_WHOLE_NUMBER.test(value)) {
    throw new EnvironmentValueError(
      CONCURRENT_COMMANDS_VARIABLE,
      value,
      `${CONCURRENT_COMMANDS_VARIABLE} is set to ${
        JSON.stringify(value)
      }, which is not a positive whole number, so no command ran. Set it to a number such as 2, or unset it to start every ready command at once.`,
    );
  }
  return Number.parseInt(value, 10);
}

/** The limit for one gate run, or undefined when the environment asks for none. */
export function commandLimitFromEnvironment(
  env: EnvReader = Deno.env,
): CommandLimit | undefined {
  const requested = concurrentCommandsRequested(env);
  return requested === undefined ? undefined : createCommandLimit(requested);
}

/**
 * The notice a result carries when the limit made a command wait, so a reader
 * of the result sees why the run's commands did not overlap.
 */
export function commandLimitHints(
  limit: CommandLimit | undefined,
): FiredHint[] {
  return limit === undefined || limit.waited === 0 ? [] : [
    fire(HINTS["gate-commands-waited"], {
      limit: limit.limit,
      waited: limit.waited,
    }),
  ];
}

/** Run `work` under the limit when one exists, or at once when none does. */
export function underCommandLimit<T>(
  limit: CommandLimit | undefined,
  turn: CommandTurn,
  work: () => Promise<T>,
): Promise<T> {
  return limit === undefined ? work() : limit.run(turn, work);
}
