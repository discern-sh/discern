/** The ordinary gate runs on Linux and macOS. */

import { assert, assertStringIncludes } from "@std/assert";

const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const gateSource = await Deno.readTextFile(GATE);

function job(source: string, name: string, next: string): string {
  const start = source.indexOf(`  ${name}:`);
  const end = source.indexOf(`  ${next}:`, start + 1);
  assert(start >= 0, `${name} job exists`);
  assert(end > start, `${next} job follows ${name}`);
  return source.slice(start, end);
}

Deno.test("the ordinary gate runs in full on native macOS", () => {
  const macos = job(gateSource, "macos", "standards");
  assertStringIncludes(macos, "runs-on: macos-15");
  assertStringIncludes(macos, "vale_${VALE_VERSION}_macOS_arm64.tar.gz");
  assertStringIncludes(macos, "run: deno task dev done");
  assertStringIncludes(macos, "run: git diff --exit-code");
});
