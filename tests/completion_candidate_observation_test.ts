/** Candidate observations retain exact binary/mode subjects and never adopt source checkout edits. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut, runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { observeCandidateInputs } from "../src/engine/validation/inputs.ts";
import {
  observeCompletionRecords,
  observeValidationInputs,
} from "../src/engine/validation/runtime.ts";
import { observeCandidateValidation } from "../src/engine/validation/candidate_observation.ts";

Deno.test("candidate and live input identities agree for complete binary and executable files", async () => {
  await withTempDir(async (root) => {
    await Deno.writeFile(
      `${root}/binary`,
      new Uint8Array([0, 255, 10, 128, 32]),
    );
    await Deno.writeTextFile(`${root}/script`, "#!/bin/sh\nprintf test\n");
    await Deno.chmod(`${root}/script`, 0o755);
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    const live = await observeValidationInputs(root);
    const candidate = await observeCandidateInputs(root, head);
    assertEquals(candidate, live);
    await Deno.writeTextFile(`${root}/binary`, "source moved\n");
    await Deno.chmod(`${root}/script`, 0o644);
    assertEquals(await observeCandidateInputs(root, head), candidate);
    assert(
      (await observeValidationInputs(root)).files.script?.digest !==
        candidate.files.script?.digest,
    );
    assertEquals(
      (await observeCandidateInputs(root, head, ["missing-toolchain"]))
        .complete,
      false,
    );
    await assertRejects(() => observeCandidateInputs(root, "HEAD"));
  });
});

Deno.test("read-only acceptance evaluator reuses real complete evidence after source checkout removal", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const records = (await observeCompletionRecords(root)).records.flatMap((
      { reading },
    ) => reading.kind === "recorded" ? [reading.record] : []);
    const record = records.find((item) => item.kind === "candidate");
    const proof = records.find((item) => item.kind === "proof");
    assert(record?.kind === "candidate" && proof?.kind === "proof");
    await git(root, "worktree", "remove", path);
    const observation = await observeCompletionRecords(root);
    const observed = await observeCandidateValidation({
      root,
      candidate_id: record.id,
      candidate: record.data,
      observation,
    });
    await observed.evaluator.observe(record.id);
    const plan = observed.evaluator.plan(
      observation,
      observed.demand,
      record.id,
    );
    assertEquals(plan.blockers, []);
    assertEquals(plan.producers, []);
    assertEquals(plan.reused.length, proof.data.requirements.length);
  });
});

Deno.test("live validation reads literal paths and link bytes with immutable input parity", async () => {
  await withTempDir(async (root) => {
    const name = Deno.build.os === "windows"
      ? "literal name"
      : "*literal*\nname";
    await Deno.writeTextFile(`${root}/${name}`, "source bytes\n");
    await Deno.symlink("unavailable-target", `${root}/link`, { type: "file" });
    await gitInit(root);
    const head = await gitOut(root, "rev-parse", "HEAD");
    const committed = await observeCandidateInputs(root, head);
    assertEquals(await observeValidationInputs(root), committed);
    await Deno.remove(`${root}/${name}`);
    const deleted = await observeValidationInputs(root);
    assertEquals(deleted.files[name], undefined);
    assertEquals(deleted.files.link, committed.files.link);
    assertEquals(deleted.complete, true);
    assertEquals((await observeValidationInputs(root, [name])).complete, false);
  });
});
