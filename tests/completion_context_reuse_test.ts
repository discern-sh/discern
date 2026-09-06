/** Reuse preserves the exact executor facts referenced by complete evidence. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { candidateConditions } from "../src/engine/validation/context.ts";
import { configuredValidation } from "../src/engine/validation/configuration.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { withTempDir } from "./helpers.ts";
import { runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";

Deno.test("a reused receipt supplies only its original candidate, attempt and context facts", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const observation = await observeCompletionRecords(root);
    const proof = observation.records.find(({ reading }) =>
      reading.kind === "recorded" && reading.record.kind === "proof"
    );
    assert(
      proof?.reading.kind === "recorded" &&
        proof.reading.record.kind === "proof",
    );
    const original = proof.reading.record.data.candidate_id;
    const configured = await configuredValidation(await loadConfig(path), []);
    const expected = await candidateConditions(
      original,
      configured,
      undefined,
      observation,
      root,
    );
    const descendant = crypto.randomUUID();
    proof.reading.record.data.candidate_id = descendant;
    assertEquals(
      await candidateConditions(
        descendant,
        configured,
        undefined,
        observation,
        root,
      ),
      expected,
    );
    for (const field of ["candidate_id", "attempt_id", "context"] as const) {
      const changed = structuredClone(observation);
      for (const { reading } of changed.records) {
        if (reading.kind !== "recorded" || reading.record.kind !== "evidence") {
          continue;
        }
        for (const artifact of reading.record.data.artifacts) {
          if (artifact.path === "context/facts.json") {
            artifact[field] = field === "context"
              ? "other-context"
              : crypto.randomUUID();
          }
        }
      }
      await assertRejects(
        () =>
          candidateConditions(descendant, configured, undefined, changed, root),
        Error,
      );
    }
    proof.reading.record.data.receipts = [];
    assert(
      (await candidateConditions(
        descendant,
        configured,
        undefined,
        observation,
        root,
      ))[0]?.identity !== expected[0]?.identity,
      "an unreferenced origin cannot supply a descendant context",
    );
  });
});
