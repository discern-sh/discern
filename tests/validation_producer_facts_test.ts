/** Producer facts name shared producers, duplicated suites, and candidate-bound closures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  CANDIDATE_BOUND_REMEDY,
  producerFacts,
} from "../src/engine/validation/producer_facts.ts";

Deno.test("a standard reading the test producer is shared; producers without inputs stay candidate-bound", async () => {
  const facts = await producerFacts(parseConfigOrThrow(`
[jobs]
lint = "deno lint"
test = { run = "deno task coverage", inputs = ["src/**", "tests/**"] }
[standards.coverage]
producer = "jobs.test"
direction = "up"
limit = 90
`));
  assertEquals(facts.error, undefined);
  assertEquals(facts.standards, ["coverage"]);
  assertEquals(facts.shared, [{ producer: "test", standards: ["coverage"] }]);
  assertEquals(facts.duplicated, []);
  const test = facts.producers.find((producer) => producer.label === "test");
  assert(test !== undefined);
  assertEquals(test.closure, "declared");
  assertEquals(test.consumers, ["test", "coverage"]);
  assertEquals(facts.candidate_bound, ["lint"]);
  assertStringIncludes(CANDIDATE_BOUND_REMEDY, "`inputs`");
  assertStringIncludes(CANDIDATE_BOUND_REMEDY, "protected change");
});

Deno.test("a standard whose own run repeats the test command is a duplicated suite", async () => {
  const facts = await producerFacts(parseConfigOrThrow(`
[jobs]
test = "deno test"
[standards.coverage]
run = "deno test"
direction = "up"
limit = 90
`));
  assertEquals(facts.error, undefined);
  assertEquals(facts.shared, []);
  assertEquals(facts.duplicated.length, 1);
  assertEquals(facts.duplicated[0]?.commands, ["deno test"]);
  assertEquals(
    [...(facts.duplicated[0]?.producers ?? [])].sort(),
    ["standard:coverage", "test"],
  );
});

Deno.test("a standard naming a missing producer is reported as an unresolved graph, not a crash", async () => {
  const facts = await producerFacts(parseConfigOrThrow(`
[jobs]
test = "deno test"
[standards.coverage]
producer = "jobs.measure"
direction = "up"
limit = 90
`));
  assert(facts.error !== undefined);
  assertStringIncludes(facts.error, "missing producer");
  assertEquals(facts.producers, []);
  assertEquals(facts.standards, ["coverage"]);
});

Deno.test("scope gates and generated groups enter the producer inventory under their completion labels", async () => {
  const facts = await producerFacts(parseConfigOrThrow(`
[jobs]
test = "deno test"
[scopes.docs]
paths = ["docs/**"]
gate = "deno task docs-check"
inputs = ["docs/**"]
`));
  assertEquals(facts.error, undefined);
  const labels = facts.producers.map((producer) => producer.label).sort();
  assertEquals(labels, ["scope:docs", "test"]);
  assertEquals(facts.candidate_bound, ["test"]);
});
