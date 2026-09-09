/**
 * S02 and S06: the setup environment probe proves a declared return procedure
 * with a differing candidate, after a passing, a failing, and a cancelled
 * validation, while a committed generated artifact and ignored build output
 * share one directory. A declaration whose restore leaves declared output
 * changed fails the probe; Git cleanliness alone cannot pass it.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  PROBE_CANDIDATE_PATH,
  PROBE_OUTPUT_PATH,
  probeExecutionEnvironments,
} from "../src/engine/execution/probe.ts";
import { describeEnvironmentProbe } from "../src/shared/environment_probe.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";

/** A project whose build directory holds a committed manifest beside ignored output. */
async function project(
  root: string,
  restore: string,
  extra = "",
): Promise<string> {
  await scaffoldEngine(root, { agents: [] });
  // `prepare` regenerates the ignored output from the tracked manifest, so a
  // differing candidate changes it; `restore` is the procedure under test.
  await writeConfig(
    root,
    `[project]
slug = "probe"
agents = []
logbook = false
[jobs]
test = "true"
[execution.local]
kind = "borrowed"
prepare = "cat build/manifest.txt > build/output.bin; ls >> build/output.bin"
restore = ${JSON.stringify(restore)}
reusable = true
resources = []
ignored = ["build/output.bin"]
inputs = ["**"]
capacity = 1
${extra}`,
  );
  await Deno.mkdir(join(root, "build"));
  await Deno.writeTextFile(join(root, "build", "manifest.txt"), "v1\n");
  await Deno.writeTextFile(
    join(root, ".gitignore"),
    (await Deno.readTextFile(join(root, ".gitignore"))) +
      "\nbuild/output.bin\n",
  );
  await gitInit(root);
  const path = await addWorktree(root, "probe-copy");
  await Deno.writeTextFile(
    join(path, "build", "output.bin"),
    "source output\n",
  );
  return await Deno.realPath(path);
}

Deno.test("S06 the probe proves a declared environment after success, failure, and cancellation and returns mixed build state", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      "printf 'source output\\n' > build/output.bin",
    );
    const config = await loadConfig(path);
    const branch = await gitOut(path, "symbolic-ref", "HEAD");
    const head = await gitOut(path, "rev-parse", "HEAD");
    const report = await probeExecutionEnvironments(path, config);
    assertEquals(report.undeclared, []);
    assertEquals(report.proven, ["local"], JSON.stringify(report.outcomes));
    const outcome = report.outcomes[0];
    assert(outcome?.kind === "proven");
    assertEquals(outcome.exercised, ["success", "failure", "cancellation"]);
    assertEquals(outcome.source, { branch, head });
    // Source-ready: same branch and head, clean, committed artifact intact,
    // ignored output back to its source bytes, no probe files.
    assertEquals(await gitOut(path, "symbolic-ref", "HEAD"), branch);
    assertEquals(await gitOut(path, "rev-parse", "HEAD"), head);
    assertEquals(await gitOut(path, "status", "--porcelain"), "");
    assertEquals(
      await Deno.readTextFile(join(path, "build", "manifest.txt")),
      "v1\n",
    );
    assertEquals(
      await Deno.readTextFile(join(path, "build", "output.bin")),
      "source output\n",
    );
    for (const leftover of [PROBE_CANDIDATE_PATH, PROBE_OUTPUT_PATH]) {
      assertEquals(
        await Deno.stat(join(path, leftover)).catch(() => undefined),
        undefined,
      );
    }
    // The probe's enrollment is retired; its attempts are diagnostic and
    // finished with the outcome each exercise produced; no evidence exists.
    const records = observedRecords(await observeCompletionRecords(path));
    const environment = records.find((record) =>
      record.kind === "environment" && record.id === outcome.environment_id
    );
    assert(environment?.kind === "environment");
    assertEquals(environment.data.state.kind, "disposed");
    const attempts = records.filter((record) => record.kind === "attempt");
    assertEquals(
      attempts.map((record) =>
        record.kind === "attempt" && record.data.state.kind === "finished"
          ? [record.data.purpose, record.data.state.outcome]
          : ["unsettled"]
      ).sort(),
      [["diagnostic", "cancelled"], ["diagnostic", "failed"], [
        "diagnostic",
        "passed",
      ]],
    );
    assertEquals(records.filter((record) => record.kind === "evidence"), []);
    assertEquals(records.filter((record) => record.kind === "proof"), []);
    assertStringIncludes(
      describeEnvironmentProbe(report),
      "returned a throwaway copy to its exact source",
    );
  });
});

Deno.test("S06 a restore that leaves declared ignored output changed fails the probe even though Git is clean", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, "true");
    const config = await loadConfig(path);
    const head = await gitOut(path, "rev-parse", "HEAD");
    const report = await probeExecutionEnvironments(path, config);
    assertEquals(report.proven, []);
    const outcome = report.outcomes[0];
    assert(outcome?.kind === "failed", JSON.stringify(report));
    assertEquals(outcome.stage, "success");
    assertStringIncludes(outcome.detail, "build/output.bin (changed)");
    assertStringIncludes(
      outcome.detail,
      "declared restore left ignored output",
    );
    // Git-visible state did return; only the declared output did not.
    assertEquals(await gitOut(path, "rev-parse", "HEAD"), head);
    assertEquals(await gitOut(path, "status", "--porcelain"), "");
    assertStringIncludes(
      describeEnvironmentProbe(report),
      "validate and land in order",
    );
  });
});

Deno.test("a required context without a declaration is reported, not probed", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await writeConfig(
      root,
      '[project]\nslug = "plain"\nagents = []\nlogbook = false\n[jobs]\ntest = "true"\n',
    );
    await gitInit(root);
    const path = await addWorktree(root, "plain-copy");
    const report = await probeExecutionEnvironments(
      await Deno.realPath(path),
      await loadConfig(path),
    );
    assertEquals(report, { proven: [], undeclared: ["local"], outcomes: [] });
    assertEquals(
      observedRecords(await observeCompletionRecords(path)).filter((record) =>
        record.kind === "environment"
      ),
      [],
    );
  });
});

Deno.test("the probe refuses to start in a checkout with uncommitted changes", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, "true");
    await Deno.writeTextFile(join(path, "owner-note.txt"), "unrelated work\n");
    const report = await probeExecutionEnvironments(
      path,
      await loadConfig(path),
    );
    const outcome = report.outcomes[0];
    assert(outcome?.kind === "failed");
    assertEquals(outcome.stage, "enroll");
    assertStringIncludes(outcome.detail, "uncommitted changes");
    assertEquals(
      await Deno.readTextFile(join(path, "owner-note.txt")),
      "unrelated work\n",
    );
    await git(path, "status");
  });
});
