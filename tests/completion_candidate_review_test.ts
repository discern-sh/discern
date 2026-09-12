/** Public checkpoint review belongs to the proven candidate and survives checkout removal. */
import { assert, assertEquals } from "@std/assert";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import {
  assessCandidateReview,
  readCandidateReview,
} from "../src/engine/gate/candidate_review.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { candidateConfig } from "../src/engine/validation/candidate_observation.ts";

Deno.test("candidate checkpoint refusal runs no producer; retained judgments recheck after a definition change", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      `
[checkpoints.review]
paths = ['source']
question = 'Does the source satisfy the requirement?'
`,
    );
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
    // The trunk's committed policy defines the questions; tighten it there and
    // bring the branch up to date so the retained judgment is rechecked.
    await Deno.writeTextFile(
      `${root}/discern.toml`,
      (await Deno.readTextFile(`${root}/discern.toml`)).replace(
        "Does the source satisfy the requirement?",
        "Does the composed source satisfy the tighter requirement?",
      ),
    );
    await git(root, "add", "discern.toml");
    await git(root, "commit", "-m", "Tighten the review question");
    await git(path, "merge", "-q", "main");
    const reopened = await runAgent(path, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assert(reopened.output.includes("tighter requirement"), reopened.output);
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
    const head = await gitOut(path, "rev-parse", "HEAD");
    const records = (await observeCompletionRecords(root)).records.flatMap((
      { reading },
    ) => reading.kind === "recorded" ? [reading.record] : []);
    const candidate = records.find((record) =>
      record.kind === "candidate" && record.data.head === head
    );
    assert(candidate?.kind === "candidate");
    assertEquals(
      candidate.data.head,
      candidateAuthor(candidate.data).head,
      "a candidate is its source tip",
    );
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
