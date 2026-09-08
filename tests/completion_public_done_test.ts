import { project } from "./completion_public_fixture.ts";
/** Full public done admits complete candidate evidence; standalone diagnostics cannot. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  readProofPresentation,
  retainProofPresentation,
} from "../src/engine/gate/proof_presentation.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

Deno.test("E07 public done admits complete evidence and clean standalone remains diagnostic", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assert(
      result.data !== undefined && "completion" in result.data,
      done.output,
    );
    assertEquals(result.data.completion?.kind, "complete");
    assertEquals(result.data.producer_executions, { "jobs.test": 1 });
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
    const presentation = observedRecords(await observeCompletionRecords(root))
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

Deno.test("E13 public done rejects missing context and assembles separately executed contexts", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local", "remote"]);
    const local = await runAgent(path, ["done", "--json"]);
    assertEquals(local.code, 1, local.output);
    const incomplete = decodeCliResult(local.stdout, "done");
    assert(
      incomplete.data !== undefined && "completion" in incomplete.data,
      local.output,
    );
    assertEquals(incomplete.data.completion?.kind, "pending");
    assertEquals(incomplete.data.proof, undefined);
    assertEquals((await inspectGateProof(path)).status, "missing");
    const remote = await runAgent(path, [
      "done",
      "--context",
      "remote",
      "--json",
    ]);
    assertEquals(remote.code, 0, remote.output);
    const complete = decodeCliResult(remote.stdout, "done");
    assert(complete.data !== undefined && "completion" in complete.data);
    assertEquals(complete.data.completion?.kind, "complete");
    assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
  });
});

Deno.test("E09 public done releases an extractor while an unrelated check waits for it", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
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

for (const edit of [false, true]) {
  Deno.test(`E10 public done retries unchanged subjects across candidate edits: ${edit}`, async () => {
    await withTempDir(async (root) => {
      const path = await project(
        root,
        ["local"],
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
      assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
      await Deno.remove(`${path}/fail`);
      if (edit) {
        await Deno.writeTextFile(
          `${path}/unrelated-note`,
          "An edit outside the declared producer closure.\n",
        );
        await git(path, "add", "unrelated-note");
        await git(path, "commit", "-m", "Add unrelated note");
      }
      const refused = await runAgent(path, ["done", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
      if (edit) {
        const pending = decodeCliResult(refused.stdout, "done");
        const detail = JSON.stringify(pending.data);
        assert(
          detail.includes("coverage") && detail.includes("attempt") &&
            detail.includes("--rerun"),
          detail,
        );
      }
      const rerun = await runAgent(path, ["done", "--rerun", "--json"]);
      assertEquals(rerun.code, 0, rerun.output);
      assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
      assertEquals((await inspectGateProof(path)).status, "honored");
    });
  });
}

Deno.test("public completion names unexpected output and preserves it without Proof", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      "",
      "printf scratch > 'unrelated output.ts'; printf 'DISCERN_METRIC coverage 93\\n'",
    );
    const result = await runAgent(path, ["done", "--json"]);
    assertEquals(result.code, 1, result.output);
    const decoded = decodeCliResult(result.stdout, "done");
    const diagnostics = JSON.stringify(decoded.diagnostics);
    assert(diagnostics.includes("unrelated output.ts"), diagnostics);
    assert(diagnostics.includes("git status"), diagnostics);
    assert(
      decoded.diagnostics?.some((entry) =>
        entry.tool === "test" && entry.message.includes("unrelated output.ts")
      ),
      diagnostics,
    );
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

Deno.test("linked source-tip completion does not invoke temporary candidate procedures", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
reusable = true
capacity = 2
inputs = ['**']
ignored = ['executions']
resources = []
prepare = 'exit 71'
restore = 'exit 72'
`,
    );
    const done = await runAgent(path, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals((await inspectGateProof(path)).status, "honored");
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    const { loadConfig } = await import("../src/shared/config_schema.ts");
    const { declarationIdentity } = await import(
      "../src/engine/execution/subjects.ts"
    );
    const environments = observedRecords(await observeCompletionRecords(path))
      .filter((r) =>
        r.kind === "environment" && r.data.state.kind !== "disposed"
      );
    assertEquals(environments.length, 1);
    const environment = environments[0];
    assert(environment?.kind === "environment");
    assertEquals(
      environment.data.declaration,
      await declarationIdentity(
        (await loadConfig(path)).execution.local ?? null,
      ),
    );
    assert(
      environment.data.release.kind === "released" &&
        environment.data.release.retirement,
    );
  });
});
