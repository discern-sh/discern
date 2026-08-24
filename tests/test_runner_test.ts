import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  configuredConcurrentTestRuns,
  testWorkerCount,
  testWorkerEnvironment,
} from "../scripts/run_tests.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test("the repository admits parallel suites and partitions their Deno workers", async () => {
  const cap = configuredConcurrentTestRuns(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  );
  assert(cap >= 2, "the self-hosting suite must not serialize whole test runs");
  assertEquals(testWorkerEnvironment(18, cap, undefined), {
    DENO_JOBS: String(testWorkerCount(18, cap)),
  });

  const deno = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  ) as { tasks?: Record<string, string> };
  const task = deno.tasks?.test ?? "";
  assertStringIncludes(task, "discern queue --");
  assertStringIncludes(task, "scripts/run_tests.ts");
});

Deno.test("test worker allocation stays positive on small and uncapped hosts", () => {
  assertEquals(testWorkerCount(18, 2), 9);
  assertEquals(testWorkerCount(1, 2), 1);
  assertEquals(testWorkerCount(8, 0), 8);
  assertEquals(testWorkerCount(8, 3), 2);
  assertEquals(testWorkerEnvironment(18, 2, undefined), { DENO_JOBS: "9" });
  assertEquals(testWorkerEnvironment(18, 2, "4"), {});
});
