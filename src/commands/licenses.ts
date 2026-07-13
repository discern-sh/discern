/**
 * `discern licenses` — print the third-party software notices for the
 * components bundled into this binary.
 *
 * The committed `THIRD_PARTY_NOTICES` document and component list are embedded
 * at compile time (raw imports), so the verb needs no project, no config, and
 * no network: every install prints exactly the notices it was built with. Both
 * artifacts are generated from the compile graph — see
 * `src/shared/third_party_codegen.ts`.
 */

import NOTICES_TEXT from "../../THIRD_PARTY_NOTICES" with { type: "text" };
import COMPONENTS from "../lib/third_party_components.json" with {
  type: "json",
};
import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { ThirdPartyComponent } from "../lib/third_party_types.ts";

/** Options for {@link runLicenses}. */
export interface LicensesOptions {
  readonly json: boolean;
  readonly noColor: boolean;
}

/** The `--json` payload: the structured list of embedded components. */
export interface LicensesData {
  readonly components: readonly ThirdPartyComponent[];
}

/** Build the `licenses` result envelope (the shared core for CLI + `--json`). */
export function licensesResult(): DiscernResult<LicensesData> {
  return {
    ok: true,
    verb: "licenses",
    data: { components: COMPONENTS },
  };
}

/** Run `discern licenses`; returns the process exit code. */
export function runLicenses(options: LicensesOptions): number {
  const log = new Logger({ json: options.json, noColor: options.noColor });
  if (options.json) {
    log.result(licensesResult());
  } else {
    log.line(NOTICES_TEXT);
  }
  return 0;
}
