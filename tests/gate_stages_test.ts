import { assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { cmdsInStage, jobsInStage } from "../src/engine/gate/stages.ts";

const CFG = `
[capabilities]
format = "deno fmt"
lint = ["eslint .", "stylelint ."]
typecheck = "tsc --noEmit"
test = "vitest run"

[checks.selfcheck]
stage = "check"
run = "deno task selfcheck"

[checks.noop]
stage = "build"
run = ":"
`;

Deno.test("jobsInStage: capabilities by derived stage, with array expansion", () => {
  const c = parseConfigOrThrow(CFG);
  const check = jobsInStage(c, "check");
  assertEquals(check.map((j) => j.label), [
    "lint",
    "lint#2",
    "typecheck",
    "selfcheck",
  ]);
  assertEquals(check.find((j) => j.label === "lint")?.kind, "capability");
  assertEquals(check.find((j) => j.label === "selfcheck")?.kind, "check");
  assertEquals(jobsInStage(c, "fix").map((j) => j.label), ["format"]);
  assertEquals(jobsInStage(c, "test").map((j) => j.label), ["test"]);
});

Deno.test("jobsInStage: a ':' no-op check is skipped", () => {
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
