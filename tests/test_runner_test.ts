import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
import { fromFileUrl, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { testCommandArgs } from "../scripts/run_tests.ts";
import { decodeWith } from "./decode_cli_result.ts";

const DenoTasksSchema = z.object({
  tasks: z.record(z.string(), z.string()).optional(),
});

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test("the repository admits parallel suites without partitioning Deno workers", async () => {
  const parsed = parseToml(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  );
  const gate = parsed.gate;
  assert(
    typeof gate === "object" && gate !== null && !Array.isArray(gate),
    "discern.toml must carry a [gate] table",
  );
  const cap = (gate as Record<string, unknown>).concurrent_test_runs;
  assert(
    typeof cap === "number" && cap >= 2,
    "the self-hosting suite must not serialize whole test runs",
  );

  const deno = decodeWith(
    DenoTasksSchema,
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  );
  const task = deno.tasks?.test ?? "";
  assertStringIncludes(task, "discern queue --");
  assertStringIncludes(task, "scripts/run_tests.ts");

  const source = await Deno.readTextFile(
    join(REPO_ROOT, "scripts/run_tests.ts"),
  );
  assert(
    !source.includes("DENO_JOBS"),
    "the whole-suite admission cap must not rewrite Deno's internal worker count",
  );
  assert(
    !source.includes("hardwareConcurrency"),
    "the repository runner must not derive a static worker allocation",
  );

  const forwarded = ["--filter", "probe"];
  const args = testCommandArgs(forwarded);
  assert(args.includes("--parallel"), "Deno test files must run in parallel");
  assertEquals(args.slice(-forwarded.length), forwarded);
});
