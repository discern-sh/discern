/** Registry-rendered assertions for result-envelope hints (ADR 0172). */

import { assert } from "@std/assert";
import type { HintDef } from "../src/shared/hints.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";

export interface HintResult {
  readonly hints?: readonly string[] | undefined;
}

type MaybeParams<P> = P extends undefined ? [] : [params?: P];

function rendered<P>(def: HintDef<P>, params: readonly unknown[]): string {
  const value = params.length === 0 ? def.example : params[0] as P;
  // Envelopes carry the CLI rendering (`fire` resolves it), so the expected
  // text resolves the template's command references the same way.
  return renderCommandRefsCli(def.template(value));
}

/** Assert that a result carries the registry entry rendered for this case. */
export function assertHasHint<P>(
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
}

/** Assert that a result does not carry the registry entry for this case. */
export function assertLacksHint<P>(
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
}
