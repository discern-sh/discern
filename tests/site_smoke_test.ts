/** The full site contract holds through a real loopback HTTP server. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import type { SiteSmokeResult } from "../scripts/site_smoke.ts";

Deno.test("production smoke crawls the real running artifact", async () => {
  const root = fromFileUrl(new URL("../", import.meta.url));
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-net=127.0.0.1",
      "scripts/site_smoke.ts",
      "--self-host",
    ],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assert(output.success, `${stderr}\n${stdout}`);
  const result = JSON.parse(stdout) as SiteSmokeResult;
  assertEquals(result.ok, true);
  assertEquals(result.failures, []);
  assertStringIncludes(
    result.observations.join("\n"),
    "instructions pages in cross-surface parity",
  );
});
