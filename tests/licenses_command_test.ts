/**
 * `discern licenses` verb behaviour — the shared core returns the component list,
 * `--json` emits exactly one DiscernResult envelope, and human mode prints the
 * notices document. Both paths exit 0.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { licensesResult, runLicenses } from "../src/commands/licenses.ts";

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

Deno.test("licensesResult returns the embedded component list", () => {
  const result = licensesResult();
  assert(result.ok);
  assertEquals(result.verb, "licenses");
  assert(result.data !== undefined);
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
  const parsed = JSON.parse(lines[0] ?? "") as { ok: boolean; verb: string };
  assertEquals(parsed.ok, true);
  assertEquals(parsed.verb, "licenses");
});

Deno.test("runLicenses human mode prints the notices document and exits 0", () => {
  const { code, lines } = capture(() =>
    runLicenses({ json: false, noColor: true })
  );
  assertEquals(code, 0);
  const out = lines.join("\n");
  assertStringIncludes(out, "Third-Party Software Notices");
  assertStringIncludes(out, "MIT License");
});
