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

Deno.test("jobsInStage: known jobs derive stage and arrays expand", () => {
  const c = parseConfigOrThrow(CFG);
  const check = jobsInStage(c, "check");
  assertEquals(check.map((j) => j.label), [
    "lint",
    "lint#2",
    "typecheck",
    "selfcheck",
  ]);
  assertEquals(check.find((j) => j.label === "lint")?.kind, "known");
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
