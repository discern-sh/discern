import { assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { jobsInStage } from "../src/engine/gate/stages.ts";
import { planScopeGates } from "../src/engine/gate/plan.ts";
import { scopesForPaths } from "../src/engine/scopes/scopes.ts";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";

const CONFIG = parseConfigOrThrow(`
[map]
dir = "docs/discern/"

[jobs.prose]
stage = "check"
run = "vale \\"\${map.dir}\\""

[scopes.map]
paths = ["\${map.dir}"]

[scopes.preview]
paths = ["\${map.dir}"]
gate = "check \\"\${map.dir}\\""

[standards.prose]
direction = "down"
limit = 1
run = "measure \\"\${map.dir}\\""
per = { words = "\${map.dir}**" }
`);

Deno.test("every config surface that follows the map root expands [map].dir", () => {
  assertEquals(
    jobsInStage(CONFIG, "check")[0]?.command,
    'vale "docs/discern/"',
  );
  assertEquals(
    scopesForPaths(["docs/discern/README.md"], CONFIG),
    ["map", "preview"],
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
