import { assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { jobsInStage } from "../src/engine/gate/stages.ts";
import { planScopeGates } from "../src/engine/gate/plan.ts";
import { scopesForPaths } from "../src/engine/scopes/scopes.ts";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";

const CONFIG = parseConfigOrThrow(`
[docs]
dir = "docs/discern/"

[checks.prose]
stage = "check"
run = "vale \\"\${docs.dir}\\""

[scopes.docs]
paths = ["\${docs.dir}"]

[scopes.preview]
paths = ["\${docs.dir}"]
gate = "check \\"\${docs.dir}\\""

[standards.prose]
direction = "down"
limit = 1
run = "measure \\"\${docs.dir}\\""
per = { words = "\${docs.dir}**" }
`);

Deno.test("every config surface that follows the docs root expands [docs].dir", () => {
  assertEquals(
    jobsInStage(CONFIG, "check")[0]?.command,
    'vale "docs/discern/"',
  );
  assertEquals(
    scopesForPaths(["docs/discern/README.md"], CONFIG),
    ["docs", "preview"],
  );
  assertEquals(
    scopesForPaths(["docs/README.md"], CONFIG),
    [],
  );
  assertEquals(
    planScopeGates(CONFIG, ["preview"])[0]?.command,
    'check "docs/discern/"',
  );

  const standard = buildStandardPlan(CONFIG).standards[0];
  assertEquals(standard?.command, 'measure "docs/discern/"');
  assertEquals(standard?.per, {
    kind: "extent",
    measure: "words",
    globs: ["docs/discern/**"],
  });
});
