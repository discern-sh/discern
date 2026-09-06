/** Public checkpoint review belongs to the executed candidate and survives restoration. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import {
  assessCandidateReview,
  readCandidateReview,
} from "../src/engine/gate/candidate_review.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { candidateConfig } from "../src/engine/validation/candidate_observation.ts";

Deno.test("candidate checkpoint refusal runs no producer; retained judgments recheck after restoration", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
prepare = 'true'
restore = 'true'
reusable = true
capacity = 1
resources = []
ignored = ['executions']
inputs = ['**']
[checkpoints.review]
paths = ['source']
question = 'Does the source satisfy the requirement?'
`,
    );
    const source = await gitOut(path, "rev-parse", "HEAD");
    const first = await runAgent(path, ["done", "--json"]);
    assertEquals(first.code, 1, first.output);
    assert(first.output.includes("awaiting_declaration"), first.output);
    assertEquals(
      await Deno.stat(`${path}/executions`).then(() => true, () => false),
      false,
    );
    const ready = await runAgent(path, ["done", "--met", "review", "--json"]);
    assertEquals(ready.code, 0, ready.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    await Deno.writeTextFile(
      `${root}/discern.toml`,
      (await Deno.readTextFile(`${root}/discern.toml`)).replace(
        "Does the source satisfy the requirement?",
        "Does the composed source satisfy the tighter requirement?",
      ),
    );
    await git(root, "add", "discern.toml");
    await git(root, "commit", "-m", "Tighten predecessor judgment");
    const reopened = await runAgent(path, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assert(reopened.output.includes("tighter requirement"), reopened.output);
    assertEquals(await gitOut(path, "rev-parse", "HEAD"), source);
    assertEquals(
      await gitOut(path, "symbolic-ref", "HEAD"),
      "refs/heads/agent/public-done",
    );
    assertEquals(
      await Deno.readTextFile(`${path}/executions`),
      "t",
      "judgment refusal must not repeat measurements",
    );
    const composed = await runAgent(path, [
      "done",
      "--met",
      "review",
      "--json",
    ]);
    assertEquals(composed.code, 0, composed.output);
    assertEquals(await gitOut(path, "rev-parse", "HEAD"), source);
    const records = observedRecords(await observeQueue(root, "main"));
    const queue = records.find((record) => record.kind === "queue");
    assert(queue?.kind === "queue");
    const candidate = records.find((record) =>
      record.kind === "candidate" &&
      record.id === queue.data.entries[0]?.candidate_id
    );
    assert(candidate?.kind === "candidate");
    assert(candidate.data.head !== candidate.data.source.head);
    const proof = records.find((record) =>
      record.kind === "proof" && record.data.candidate_id === candidate.id
    );
    assert(proof?.kind === "proof");
    const review = await readCandidateReview(root, candidate.data, proof.data);
    const assessed = await assessCandidateReview(
      root,
      await candidateConfig(root, candidate.data.head),
      candidate.data,
      review,
    );
    assertEquals(assessed.blockers, []);
    assertEquals(assessed.decisions.judgments.map((item) => item.checkpoint), [
      "review",
    ]);
    await git(root, "worktree", "remove", path);
    assertEquals(
      await readCandidateReview(root, candidate.data, proof.data),
      review,
    );
  });
});

for (const failure of ["conflict", "merged-prepare"] as const) {
  Deno.test(`public composition ${failure} preserves source and classifies judgment separately from recovery`, async () => {
    await withTempDir(async (root) => {
      const path = await project(
        root,
        ["local"],
        `
[execution.local]
kind = 'borrowed'
prepare = 'test ! -f requires-prepare'
restore = 'true'
reusable = true
capacity = 1
resources = []
ignored = ['executions']
inputs = ['**']
`,
      );
      const source = await gitOut(path, "rev-parse", "HEAD");
      const branch = await gitOut(path, "symbolic-ref", "HEAD");
      const changed = failure === "conflict" ? "source" : "requires-prepare";
      await Deno.writeTextFile(`${root}/${changed}`, "predecessor\n");
      await git(root, "add", changed);
      await git(root, "commit", "-m", "Change expected predecessor");
      const done = await runAgent(path, ["done", "--json"]);
      assertEquals(done.code, 1, done.output);
      const parsed = decodeCliResult(done.stdout, "done");
      assert(parsed.data !== undefined && "completion" in parsed.data);
      assertEquals(parsed.data.proof, undefined);
      assertEquals(parsed.data.completion?.pending?.map((item) => item.kind), [
        failure === "conflict" ? "missing-judgment" : "recovery-incomplete",
      ]);
      assertEquals(await gitOut(path, "rev-parse", branch), source);
      assertEquals(
        await Deno.stat(`${path}/executions`).then(() => true, () => false),
        false,
      );
      const records = observedRecords(await observeQueue(root, "main"));
      assertEquals(
        records.filter((record) =>
          record.kind === "proof" || record.kind === "evidence"
        ),
        [],
      );
      if (failure === "conflict") {
        assertEquals(await gitOut(path, "rev-parse", "HEAD"), source);
        assertEquals(await gitOut(path, "symbolic-ref", "HEAD"), branch);
        assertEquals(await gitOut(path, "status", "--short"), "");
      } else {
        assert(done.output.includes("unfamiliar revision"), done.output);
        assertEquals(
          await Deno.readTextFile(`${path}/${changed}`),
          "predecessor\n",
        );
        assert(
          records.some((record) =>
            record.kind === "environment" &&
            record.data.state.kind === "recovery"
          ),
        );
      }
    });
  });
}
