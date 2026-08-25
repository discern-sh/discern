/** The full site contract holds through a real loopback HTTP server. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const SITE_SMOKE_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  base: z.string(),
  observations: z.array(z.string()),
  failures: z.array(z.string()),
});

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
  const result = decodeWith(SITE_SMOKE_RESULT_SCHEMA, stdout);
  assertEquals(result.ok, true);
  assertEquals(result.failures, []);
  assertStringIncludes(
    result.observations.join("\n"),
    "instructions pages in cross-surface parity",
  );
});
