import { project } from "./completion_public_fixture.ts";
/** Full public done admits complete candidate evidence; standalone diagnostics cannot. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  readProofPresentation,
  retainProofPresentation,
} from "../src/engine/gate/proof_presentation.ts";
import { artifactPath } from "../src/engine/completion/artifact_paths.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { completionRecordPath } from "../src/engine/completion/store.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { gitOut } from "./engine_helpers.ts";

/** Project recorded readings onto validated envelopes. */
async function observedRecords(root: string): Promise<CompletionRecord[]> {
  return (await observeCompletionRecords(root)).records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
}

Deno.test("E07 public done admits complete evidence and clean standalone remains diagnostic", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assert(
      result.data !== undefined && "completion" in result.data,
      done.output,
    );
    assertEquals(result.data.completion?.kind, "complete");
    assertEquals(result.data.producer_executions, { "jobs.test": 1 });
    // S07: the result names the producer that ran and why it could not reuse.
    assertEquals(
      result.data.producer_evidence?.map((entry) => [
        entry.producer,
        entry.use,
        entry.closure,
      ]),
      [["jobs.test", "executed", "declared"]],
    );
    assertStringIncludes(
      result.data.producer_evidence?.[0]?.reason ?? "",
      "no recorded evidence for test, coverage matched",
    );
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    const proof = await inspectGateProof(path);
    assertEquals(proof.status, "honored", JSON.stringify(proof));
    assert(proof.proof_data?.completion !== undefined);
    const gateProof = proof.proof_data;
    assertEquals(proof.proof_data.completion.validation.receipts.length, 2);
    const pointer = {
      candidate_id: proof.proof_data.completion.candidate_id,
      proof_id: proof.proof_data.completion.proof_id,
    };
    assertEquals(await readProofPresentation(root, pointer), proof.proof_data);
    const presentation = (await observedRecords(root))
      .find((record) => record.kind === "presentation");
    assert(presentation?.kind === "presentation");
    const storedPath = await artifactPath(
      root,
      presentation.data.artifact.attempt_id,
      presentation.data.artifact.path,
    );
    const original = await Deno.readTextFile(storedPath);
    await Deno.writeTextFile(storedPath, original + " ");
    await assertRejects(
      () => readProofPresentation(root, pointer),
      Error,
      "content check",
    );
    await Deno.writeTextFile(storedPath, original);
    await assertRejects(() =>
      readProofPresentation(root, {
        ...pointer,
        candidate_id: crypto.randomUUID(),
      })
    );
    await assertRejects(
      () =>
        retainProofPresentation(root, pointer, {
          ...gateProof,
          head: "0".repeat(12),
        }),
      Error,
      "differs",
    );
    assertEquals(await readProofPresentation(root, pointer), proof.proof_data);
    const recordPath = await completionRecordPath(root, presentation);
    assert(recordPath !== undefined);
    const recordBytes = await Deno.readTextFile(recordPath);
    // An unchanged committed tree is covered by its honored Proof marker.
    const reused = await runAgent(path, ["done", "--json"]);
    assertEquals(reused.code, 0, reused.output);
    const covered = decodeCliResult(reused.stdout, "done");
    assert(covered.data !== undefined && "gate_ran" in covered.data);
    assertEquals(covered.data.gate_ran, false, reused.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    // A fresh commit makes a new candidate, so the next run observes records.
    await Deno.writeTextFile(`${path}/second`, "authored\n");
    await git(path, "add", "second");
    await git(path, "commit", "-m", "Author a second file");
    const trunk = await gitOut(root, "rev-parse", "HEAD");
    for (
      const [raw, kind] of [
        [
          JSON.stringify({
            ...presentation,
            version: ON_DISK_FORMATS.completionRecord.version + 1,
          }),
          "record-incompatible",
        ],
        ["{", "record-corrupt"],
      ]
    ) {
      assert(raw !== undefined && kind !== undefined);
      await Deno.writeTextFile(recordPath, raw);
      const refused = await runAgent(path, ["done", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const refusal = decodeCliResult(refused.stdout, "done");
      assert(refusal.data !== undefined && "completion" in refusal.data);
      assertEquals(
        refusal.data.completion?.pending?.[0]?.kind,
        kind,
        refused.output,
      );
      assertEquals(await Deno.readTextFile(recordPath), raw);
      assertEquals(await gitOut(root, "rev-parse", "HEAD"), trunk);
      assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    }
    await Deno.writeTextFile(recordPath, recordBytes);
    const records = (await observeCompletionRecords(path)).records;
    const standalone = await runAgent(path, ["done", "--standalone", "--json"]);
    assertEquals(standalone.code, 0, standalone.output);
    const diagnostic = decodeCliResult(standalone.stdout, "done");
    assert(diagnostic.data !== undefined && "completion" in diagnostic.data);
    assertEquals(diagnostic.data.completion?.kind, "diagnostic");
    assertEquals(diagnostic.data.proof, undefined);
    assertEquals((await observeCompletionRecords(path)).records, records);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
  });
});

Deno.test("E09 public done releases an extractor while an unrelated check waits for it", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      `extract = 'touch extracted; cat'
[jobs.unrelated]
stage = 'check'
run = 'while ! test -f extracted; do sleep 0.02; done'
timeout = 8
`,
    );
    await Deno.writeTextFile(`${path}/.gitignore`, "extracted\n", {
      append: true,
    });
    await git(path, "add", ".gitignore");
    await git(path, "commit", "-m", "Ignore extraction signal");
    const result = await runAgent(path, ["done", "--json"]);
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
  });
});

Deno.test("E10 public done retries unchanged subjects across candidate edits", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      "",
      "printf t >> executions; test ! -f fail || exit 1; printf 'DISCERN_METRIC coverage 93\\n'",
      ["source"],
    );
    await Deno.writeTextFile(`${path}/.gitignore`, "fail\n", {
      append: true,
    });
    await git(path, "add", ".gitignore", "discern.toml");
    await git(path, "commit", "-m", "Declare deliberate rerun subject");
    await Deno.writeTextFile(`${path}/fail`, "fail this attempt");
    const red = await runAgent(path, ["done", "--json"]);
    assertEquals(red.code, 1, red.output);
    const failed = decodeCliResult(red.stdout, "done");
    assert(failed.data !== undefined && "completion" in failed.data);
    const blocked = failed.data.completion?.pending?.filter((item) =>
      item.kind === "validation-failed"
    );
    assert((blocked?.length ?? 0) > 1, red.output);
    const retryHints = (failed.hints ?? []).filter((hint) =>
      hint.includes("deliberate retry of the unchanged subject")
    );
    assertEquals(retryHints.length, 1, red.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    await Deno.remove(`${path}/fail`);
    // A refusal is read-only, so the unchanged and edited variants chain on
    // one candidate: refuse the untouched tree, then refuse again after an
    // edit outside the producer closure, then accept the deliberate rerun.
    const refused = await runAgent(path, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    await Deno.writeTextFile(
      `${path}/unrelated-note`,
      "An edit outside the declared producer closure.\n",
    );
    await git(path, "add", "unrelated-note");
    await git(path, "commit", "-m", "Add unrelated note");
    const edited = await runAgent(path, ["done", "--json"]);
    assertEquals(edited.code, 1, edited.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    const pending = decodeCliResult(edited.stdout, "done");
    const detail = JSON.stringify(pending.data);
    assert(
      detail.includes("coverage") && detail.includes("attempt") &&
        detail.includes("--rerun"),
      detail,
    );
    const rerun = await runAgent(path, ["done", "--rerun", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
    assertEquals((await inspectGateProof(path)).status, "honored");
  });
});

Deno.test("public completion keeps unexpected producer output out of evidence without a failed verdict", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      "",
      "printf scratch > 'unrelated output.ts'; printf 'DISCERN_METRIC coverage 93\\n'",
    );
    const result = await runAgent(path, ["done", "--json"]);
    assertEquals(result.code, 1, result.output);
    const decoded = decodeCliResult(result.stdout, "done");
    assert(
      decoded.data !== undefined && "completion" in decoded.data,
      result.output,
    );
    const pending = decoded.data.completion?.pending ?? [];
    assert(pending.length > 0, result.output);
    assert(
      pending.every((entry) => entry.kind !== "validation-failed"),
      result.output,
    );
    assertEquals(
      decoded.steps?.find((entry) => entry.label === "test")?.outcome,
      "ok",
    );
    assertEquals(decoded.data.producer_executions, { "jobs.test": 1 });
    const coverage = decoded.data.standards?.find((entry) =>
      entry.name === "coverage"
    );
    assertEquals(coverage?.measurement, "stale");
    assertEquals(coverage?.value, undefined);
    assertEquals(coverage?.verdict, undefined);
    assertEquals(
      await Deno.readTextFile(`${path}/unrelated output.ts`),
      "scratch",
    );
    assert(
      !(await Deno.readTextFile(`${path}/.gitignore`)).includes(
        "unrelated output.ts",
      ),
    );
    assertEquals((await inspectGateProof(path)).status, "missing");
    assert(
      !(await observeCompletionRecords(path)).records.some((entry) =>
        entry.selector.kind === "proof"
      ),
    );
  });
});
