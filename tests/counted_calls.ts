/** Local call budgets for observations whose necessary work is fixed. */
import { AsyncLocalStorage } from "async_hooks";
import { assert, assertEquals } from "@std/assert";

interface CallBudget {
  calls: number;
  readonly expected: () => number;
}

interface CountedCalls<Args extends unknown[], Result> {
  readonly run: (...args: Args) => Result;
  readonly expectCalls: <T>(
    expected: number | (() => number),
    body: () => Promise<T>,
  ) => Promise<T>;
}

/**
 * Keep the callable's signature and real effects. Each asynchronous observation
 * owns its count; nested observations also count toward their enclosing budget.
 * Excess calls fail before repeating the work. A failing body keeps its error.
 * See project/map/80-development/test-execution-review.md before changing a budget.
 */
export function countedCalls<Args extends unknown[], Result>(
  invoke: (...args: Args) => Result,
): CountedCalls<Args, Result> {
  const active = new AsyncLocalStorage<readonly CallBudget[]>();
  return {
    run: (...args: Args): Result => {
      const budgets = active.getStore() ?? [];
      for (const budget of budgets) {
        assert(
          budget.calls + 1 <= budget.expected(),
          `${invoke.name}: extra execution in a fixed-work observation; reuse its result or review the distinct state in project/map/80-development/test-execution-review.md`,
        );
      }
      for (const budget of budgets) budget.calls++;
      return invoke(...args);
    },
    expectCalls: async <T>(
      expected: number | (() => number),
      body: () => Promise<T>,
    ): Promise<T> => {
      const budget = {
        calls: 0,
        expected: typeof expected === "number" ? () => expected : expected,
      };
      const result = await active.run(
        [...(active.getStore() ?? []), budget],
        body,
      );
      assertEquals(
        budget.calls,
        budget.expected(),
        `${invoke.name}: fixed-work observation must exercise every required call`,
      );
      return result;
    },
  };
}
