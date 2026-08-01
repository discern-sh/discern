/**
 * `discern licenses` — print discern's licenses, notices, and the third-party
 * software notices for the components bundled into this binary.
 *
 * Both legal packages travel inside the binary as generated, compressed
 * bundles, so the verb needs no project, config, or network. The first-party
 * bundle comes byte-for-byte from LICENSE, NOTICE, and the project-payload
 * license; the third-party bundle derives from the compile graph.
 */

import { gunzipSync } from "zlib";
import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { LicensesData } from "../shared/result_schemas.ts";
import type { ThirdPartyComponent } from "../lib/third_party_types.ts";
import type { FirstPartyLegalDocument } from "../shared/first_party_license_codegen.ts";
import { FIRST_PARTY_LICENSE_BUNDLE_B64 } from "../lib/first_party_license_bundle.ts";
import { THIRD_PARTY_BUNDLE_B64 } from "../lib/third_party_bundle.ts";

/** Options for {@link runLicenses}. */
export interface LicensesOptions {
  readonly json: boolean;
  readonly noColor: boolean;
}

interface ThirdPartyBundle {
  readonly notices: string;
  readonly components: readonly ThirdPartyComponent[];
}

interface FirstPartyBundle {
  readonly documents: readonly FirstPartyLegalDocument[];
}

function decodeBundle<T>(encoded: string): T {
  return JSON.parse(
    new TextDecoder().decode(
      gunzipSync(
        Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
      ),
    ),
  ) as T;
}

let cachedThirdParty: ThirdPartyBundle | undefined;
function thirdPartyBundle(): ThirdPartyBundle {
  // atob instead of @std/encoding keeps the decoder out of the compiled graph;
  // the binary_size standard holds the ceiling the extra module would break.
  cachedThirdParty ??= decodeBundle<ThirdPartyBundle>(THIRD_PARTY_BUNDLE_B64);
  return cachedThirdParty;
}

let cachedFirstParty: FirstPartyBundle | undefined;
function firstPartyBundle(): FirstPartyBundle {
  cachedFirstParty ??= decodeBundle<FirstPartyBundle>(
    FIRST_PARTY_LICENSE_BUNDLE_B64,
  );
  return cachedFirstParty;
}

function publicDocument(
  document: FirstPartyLegalDocument,
): LicensesData["documents"][number] {
  return {
    key: document.key,
    kind: document.kind,
    identifier: document.identifier,
    title: document.title,
    path: document.path,
    text: document.text,
  };
}

const RULE = "-".repeat(78);

function humanReport(): string {
  const lines = [
    "discern - Licenses and Notices",
    "=".repeat(78),
    "",
  ];
  for (const document of firstPartyBundle().documents) {
    lines.push(
      RULE,
      `${document.title} — ${document.identifier}`,
      RULE,
      "",
      `Source in discern's distribution: ${document.path}`,
      "",
      document.text.trimEnd(),
      "",
    );
  }
  lines.push(thirdPartyBundle().notices.trimEnd());
  return lines.join("\n") + "\n";
}

/** Build the `licenses` result envelope (the shared core for CLI + `--json`). */
export function licensesResult(): DiscernResult<LicensesData> {
  return {
    ok: true,
    verb: "licenses",
    data: {
      documents: firstPartyBundle().documents.map(publicDocument),
      components: [...thirdPartyBundle().components],
    },
  };
}

/** Run `discern licenses`; returns the process exit code. */
export function runLicenses(options: LicensesOptions): number {
  const log = new Logger({ json: options.json, noColor: options.noColor });
  if (options.json) {
    log.result(licensesResult());
  } else {
    log.line(humanReport());
  }
  return 0;
}
