/**
 * `discern licenses` verb behavior — the shared core returns the first-party
 * legal documents and component list, `--json` emits one result envelope, and
 * human mode prints the complete legal report. Both paths exit 0.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { licensesResult, runLicenses } from "../src/commands/licenses.ts";
import { FIRST_PARTY_LEGAL_DOCUMENTS } from "../src/shared/license_registry.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

/** Run `fn` with console.log captured, restoring it afterwards. */
function capture(fn: () => number): { code: number; lines: string[] } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const code = fn();
    return { code, lines };
  } finally {
    console.log = original;
  }
}

Deno.test("licensesResult returns the embedded legal documents and components", () => {
  const result = licensesResult();
  assert(result.ok);
  assertEquals(result.verb, "licenses");
  assert(result.data !== undefined);
  assertEquals(
    result.data.documents.map((document) => document.key),
    FIRST_PARTY_LEGAL_DOCUMENTS.map((document) => document.key),
  );
  for (const declaration of FIRST_PARTY_LEGAL_DOCUMENTS) {
    const document = result.data.documents.find((entry) =>
      entry.key === declaration.key
    );
    assert(document !== undefined, `${declaration.key} is missing`);
    assertStringIncludes(document.text, declaration.smokeMarker);
  }
  assert(result.data.components.length > 0);
  for (const c of result.data.components) {
    assert(
      c.name.length > 0 && c.version.length > 0 && c.license.length > 0,
      `component ${c.name} is missing a field`,
    );
  }
});

Deno.test("runLicenses --json emits a single parseable DiscernResult and exits 0", () => {
  const { code, lines } = capture(() =>
    runLicenses({ json: true, noColor: true })
  );
  assertEquals(code, 0);
  assertEquals(lines.length, 1, "JSON mode must print exactly one line");
  const parsed = decodeCliResult(lines[0] ?? "", "licenses");
  assertEquals(parsed.ok, true);
  assertEquals(parsed.verb, "licenses");
});

Deno.test("runLicenses human mode prints every legal document and exits 0", () => {
  const { code, lines } = capture(() =>
    runLicenses({ json: false, noColor: true })
  );
  assertEquals(code, 0);
  const out = lines.join("\n");
  assertStringIncludes(out, "discern - Licenses and Notices");
  for (const declaration of FIRST_PARTY_LEGAL_DOCUMENTS) {
    assertStringIncludes(out, declaration.smokeMarker);
  }
  assertStringIncludes(out, "Third-Party Software Notices");
  assertStringIncludes(out, "MIT License");
});
