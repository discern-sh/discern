/**
 * `discern licenses` — print the third-party software notices for the
 * components bundled into this binary.
 *
 * The committed notices travel inside the binary as a generated, compressed
 * bundle (`src/lib/third_party_bundle.ts`), so the verb needs no project, no
 * config, and no network: every install prints exactly the notices it was
 * built with. The bundle and the human-readable `THIRD_PARTY_NOTICES` are
 * generated from the same compile-graph render — see
 * `src/shared/third_party_codegen.ts`.
 */

import { gunzipSync } from "zlib";
import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { ThirdPartyComponent } from "../lib/third_party_types.ts";
import { THIRD_PARTY_BUNDLE_B64 } from "../lib/third_party_bundle.ts";

/** Options for {@link runLicenses}. */
export interface LicensesOptions {
  readonly json: boolean;
  readonly noColor: boolean;
}

/** The `--json` payload: the structured list of embedded components. */
export interface LicensesData {
  readonly components: readonly ThirdPartyComponent[];
}

interface Bundle {
  readonly notices: string;
  readonly components: readonly ThirdPartyComponent[];
}

let cached: Bundle | undefined;
function bundle(): Bundle {
  // atob instead of @std/encoding keeps the decoder out of the compiled graph;
  // the binary_size standard holds the ceiling the extra module would break.
  cached ??= JSON.parse(
    new TextDecoder().decode(
      gunzipSync(
        Uint8Array.from(atob(THIRD_PARTY_BUNDLE_B64), (c) => c.charCodeAt(0)),
      ),
    ),
  ) as Bundle;
  return cached;
}

/** Build the `licenses` result envelope (the shared core for CLI + `--json`). */
export function licensesResult(): DiscernResult<LicensesData> {
  return {
    ok: true,
    verb: "licenses",
    data: { components: bundle().components },
  };
}

/** Run `discern licenses`; returns the process exit code. */
export function runLicenses(options: LicensesOptions): number {
  const log = new Logger({ json: options.json, noColor: options.noColor });
  if (options.json) {
    log.result(licensesResult());
  } else {
    log.line(bundle().notices);
  }
  return 0;
}
