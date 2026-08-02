/** Registry-rendered assertions for result-envelope hints (ADR 0172). */

import { assert } from "@std/assert";
import type { HintDef } from "../src/shared/hints.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";

export interface HintResult {
  readonly hints?: readonly string[] | undefined;
}

type MaybeParams<P> = P extends undefined ? [] : [params?: P];

/** The surface-specific assertion pair: expectations render each entry's
 * command references exactly as that surface's delivery boundary does. */
export interface HintAsserts {
  assertHasHint<P>(
    result: HintResult,
    def: HintDef<P>,
    ...params: MaybeParams<P>
  ): string;
  assertLacksHint<P>(
    result: HintResult,
    def: HintDef<P>,
    ...params: MaybeParams<P>
  ): void;
}

/** Build the pair for one surface's reference resolution. */
export function hintAssertsWithResolver(
  resolveText: (authored: string) => string,
): HintAsserts {
  /** Return the rendered. */
  function rendered<P>(def: HintDef<P>, params: readonly unknown[]): string {
    const value = params.length === 0 ? def.example : params[0] as P;
    return resolveText(def.template(value));
  }
  return {
    assertHasHint<P>(
      result: HintResult,
      def: HintDef<P>,
      ...params: MaybeParams<P>
    ): string {
      const expected = rendered(def, params);
      const hints = result.hints ?? [];
      assert(
        hints.indexOf(expected) !== -1,
        `expected hint ${JSON.stringify(def.id)} rendered as ${
          JSON.stringify(expected)
        }; got ${JSON.stringify(hints)}`,
      );
      return expected;
    },
    assertLacksHint<P>(
      result: HintResult,
      def: HintDef<P>,
      ...params: MaybeParams<P>
    ): void {
      const unwanted = rendered(def, params);
      const hints = result.hints ?? [];
      assert(
        hints.indexOf(unwanted) === -1,
        `did not expect hint ${JSON.stringify(def.id)} rendered as ${
          JSON.stringify(unwanted)
        }; got ${JSON.stringify(hints)}`,
      );
    },
  };
}

// The CLI pair — envelopes delivered by `fire` and the CLI boundary carry the
// CLI rendering, so these are the default asserts. MCP envelopes use the pair
// in `mcp_hint_asserts.ts`.
const cli = hintAssertsWithResolver(renderCommandRefsCli);

/** Assert that a result carries the registry entry rendered for this case. */
export const assertHasHint = cli.assertHasHint;

/** Assert that a result does not carry the registry entry for this case. */
export const assertLacksHint = cli.assertLacksHint;
