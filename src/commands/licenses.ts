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
import type { z } from "@zod/zod";
import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { LicensesData } from "../shared/result_schemas.ts";
import type { FirstPartyLegalDocument } from "../shared/first_party_license_codegen.ts";
import { FIRST_PARTY_LICENSE_BUNDLE_B64 } from "../lib/first_party_license_bundle.ts";
import { THIRD_PARTY_BUNDLE_B64 } from "../lib/third_party_bundle.ts";
import {
  type FirstPartyLicenseBundle,
  firstPartyLicenseBundleSchema,
  type ThirdPartyLicenseBundle,
  thirdPartyLicenseBundleSchema,
} from "../shared/license_bundle_schemas.ts";
import { decodeJson } from "../shared/runtime_decode.ts";

/** Options for {@link runLicenses}. */
export interface LicensesOptions {
  readonly json: boolean;
  readonly noColor: boolean;
}

/** Inflate a generated base64-gzip bundle and parse its typed JSON payload. */
function decodeBundle<Schema extends z.ZodType>(
  encoded: string,
  schema: Schema,
  source: string,
): z.output<Schema> {
  return decodeJson(
    schema,
    new TextDecoder().decode(
      gunzipSync(
        Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
      ),
    ),
    source,
  );
}

let cachedThirdParty: ThirdPartyLicenseBundle | undefined;
/** Lazily decode the compile-graph-derived notices embedded in the binary. */
function thirdPartyBundle(): ThirdPartyLicenseBundle {
  // atob instead of @std/encoding keeps the decoder out of the compiled graph;
  // the binary_size standard holds the ceiling the extra module would break.
  cachedThirdParty ??= decodeBundle(
    THIRD_PARTY_BUNDLE_B64,
    thirdPartyLicenseBundleSchema,
    "embedded third-party license bundle",
  );
  return cachedThirdParty;
}

let cachedFirstParty: FirstPartyLicenseBundle | undefined;
/** Lazily decode discern's own legal documents embedded in the binary. */
function firstPartyBundle(): FirstPartyLicenseBundle {
  cachedFirstParty ??= decodeBundle(
    FIRST_PARTY_LICENSE_BUNDLE_B64,
    firstPartyLicenseBundleSchema,
    "embedded first-party license bundle",
  );
  return cachedFirstParty;
}

/** Copy an embedded legal document onto the stable public result contract. */
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

/** Concatenate first-party documents and third-party notices for terminal output. */
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
