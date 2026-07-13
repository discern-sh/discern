/**
 * `discern licenses` — print the third-party software notices for the components
 * bundled into this binary.
 *
 * The notices are compiled in (see `src/lib/third_party_notices.ts`), so the verb
 * needs no project, no config, and no network: it renders the same text on any
 * install. Human mode prints the notices to stdout; `--json` emits the shared
 * {@link DiscernResult} envelope with the structured component list.
 */

import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import {
  renderThirdPartyNotices,
  THIRD_PARTY_COMPONENTS,
  type ThirdPartyComponent,
} from "../lib/third_party_notices.ts";

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
    data: { components: THIRD_PARTY_COMPONENTS },
  };
}

/** Run `discern licenses`; returns the process exit code. */
export function runLicenses(options: LicensesOptions): number {
  const log = new Logger({ json: options.json, noColor: options.noColor });
  if (options.json) {
    log.result(licensesResult());
  } else {
    log.line(renderThirdPartyNotices());
  }
  return 0;
}
