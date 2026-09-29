import { assertCases } from "./assert_cases.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import { withTempDir } from "./helpers.ts";
import { runCapturedCommands } from "../src/engine/jobs/captured.ts";
import { assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { cmdsInStage, jobsInStage } from "../src/engine/gate/stages.ts";

const CFG = `
[jobs]
format = "deno fmt"
lint = ["eslint .", "stylelint ."]
typecheck = "tsc --noEmit"
test = "vitest run"

[jobs.selfcheck]
stage = "check"
run = "deno task selfcheck"

[jobs.noop]
stage = "build"
run = ":"
`;

Deno.test("jobsInStage: known jobs derive stage and arrays stay one ordered recipe", () => {
  const c = parseConfigOrThrow(CFG);
  const check = jobsInStage(c, "check");
  assertEquals(check.map((j) => j.label), [
    "lint",
    "typecheck",
    "selfcheck",
  ]);
  assertEquals(check.find((j) => j.label === "lint")?.kind, "known");
  assertEquals(
    check.find((j) => j.label === "lint")?.command,
    "eslint . && stylelint .",
  );
  assertEquals(check.find((j) => j.label === "selfcheck")?.kind, "custom");
  assertEquals(jobsInStage(c, "fix").map((j) => j.label), ["format"]);
  assertEquals(jobsInStage(c, "test").map((j) => j.label), ["test"]);
});

Deno.test("jobsInStage: a ':' no-op custom job is skipped", () => {
  const c = parseConfigOrThrow(CFG);
  assertEquals(jobsInStage(c, "build"), []);
});

Deno.test("cmdsInStage joins with && and is ':' when empty", () => {
  const c = parseConfigOrThrow(CFG);
  assertEquals(
    cmdsInStage(c, "check"),
    "eslint . && stylelint . && tsc --noEmit && deno task selfcheck",
  );
  assertEquals(cmdsInStage(c, "build"), ":");
});

Deno.test("every known job emits the same ordered recipe, which stops on its first failure", async () => {
  const commands = [
    "printf a >> order",
    "test $(cat order) = a && printf b >> order",
    "exit 17",
    "printf forbidden >> order",
  ];
  const recipe = commands.join(" && ");
  assertCases(
    Object.entries(KNOWN_JOBS),
    ([name]) => `known ${name} preserves its stage and recipe`,
    ([name, stage]) => {
      const config = parseConfigOrThrow(
        `[jobs]\n${name} = ${JSON.stringify(commands)}\n`,
      );
      const jobs = jobsInStage(config, stage);
      assertEquals(jobs.length, 1);
      const job = jobs[0];
      if (job === undefined) throw new Error("Missing known-job recipe");
      assertEquals(job.label, name);
      assertEquals(job.command, recipe);
    },
  );
  await withTempDir(async (root) => {
    const result = await runCapturedCommands({
      root,
      label: "known-job-recipe",
      commands: [recipe],
      timeout: 10,
      signal: new AbortController().signal,
      environment: {},
    });
    assertEquals(result.result.code, 17);
    assertEquals(await Deno.readTextFile(`${root}/order`), "ab");
  });
});
