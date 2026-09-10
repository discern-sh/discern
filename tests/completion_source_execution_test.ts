import { observeValidationInputs } from "../src/engine/validation/runtime.ts";
import { observeCandidateInputs } from "../src/engine/validation/inputs.ts";
/** Source validation must not require preservation machinery for untouched local data. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";

Deno.test("source standards and done tolerate unrelated ignored data and registered submodules", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      "",
      "printf 'DISCERN_METRIC coverage 93\\n'",
      ["source"],
    );
    await Deno.writeTextFile(
      `${path}/.gitignore`,
      (await Deno.readTextFile(`${path}/.gitignore`)) + "\nlarge-private\n",
    );
    const data = await Deno.open(`${path}/large-private`, {
      createNew: true,
      write: true,
    });
    try {
      await data.truncate(1024 * 1024 * 1024 + 1);
    } finally {
      data.close();
    }
    await git(path, "add", ".gitignore");
    await git(path, "commit", "-m", "Ignore private data");
    const measured = await runAgent(path, ["standards", "--json"]);
    assertEquals(measured.code, 0, measured.output);
    await git(
      path,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${await gitOut(path, "rev-parse", "HEAD")},module`,
    );
    const moduleHead = await gitOut(path, "rev-parse", "HEAD");
    await git(path, "commit", "-m", "Register module");
    await git(
      path,
      "clone",
      "--quiet",
      "--no-checkout",
      path,
      `${path}/module`,
    );
    await git(`${path}/module`, "checkout", "--quiet", moduleHead);
    const done = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(
      (await Deno.stat(`${path}/large-private`)).size,
      1024 * 1024 * 1024 + 1,
    );
    assertEquals(
      await gitOut(path, "symbolic-ref", "HEAD"),
      "refs/heads/agent/public-done",
    );
    const requiredModule = { patterns: ["module/**"], toolchain: [] };
    await assertRejects(
      () => observeValidationInputs(path, [], requiredModule),
      Error,
      "regular file",
    );
    const head = await gitOut(path, "rev-parse", "HEAD");
    await assertRejects(
      () => observeCandidateInputs(path, head, [], requiredModule),
      Error,
      "supported complete Git blob",
    );
    const records = (await observeCompletionRecords(path)).records;
    assert(records.some(({ selector }) => selector.kind === "evidence"));
  });
});

Deno.test("declared borrowing leaves an identical source attached and skips restoration procedures", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
capacity = 1
resources = []
ignored = []
inputs = ['source']
reusable = true
prepare = 'exit 71'
restore = 'exit 72'
`,
      "git symbolic-ref HEAD; printf 'DISCERN_METRIC coverage 93\\n'",
      ["source"],
    );
    const done = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await gitOut(path, "symbolic-ref", "HEAD"),
      "refs/heads/agent/",
    );
  });
});

Deno.test("source return reads an already frozen recovery manifest in its original observation form", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "undeclared");
    const environment = await requireEnvironment(f.root, f.id);
    const frozen = await f.workspace.inspect(
      environment.record.data,
      null,
      "recovery",
    );
    const execution = await f.claim(
      f.plan({ ...f.candidate, head: f.source.head, tree: f.source.tree }),
    );
    await f.workspace.verifyReturned(execution, {
      action: "source-tip",
      declaration: null,
    }, frozen);
  });
});

Deno.test("a declared borrowed environment does not stop completion in the main checkout, which is released as source only", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await writeConfig(
      root,
      `[project]
slug = "main-declared"
agents = []
logbook = false
[jobs]
test = "printf 'DISCERN_METRIC coverage 93\\n'"
[standards.coverage]
producer = "jobs.test"
direction = "up"
limit = 90
[execution.local]
kind = "borrowed"
prepare = "true"
restore = "true"
reusable = true
resources = []
ignored = []
inputs = ["**"]
capacity = 1
`,
    );
    await gitInit(root);
    const done = await runAgent(root, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assert(result.data !== undefined && "completion" in result.data);
    assertEquals(result.data.completion?.kind, "complete");
    assertEquals(result.data.completion?.pending ?? [], []);
    const environments = observedRecords(await observeCompletionRecords(root))
      .filter((record) => record.kind === "environment");
    assertEquals(environments.length, 1);
    assert(environments[0]?.kind === "environment");
    assertEquals(environments[0].data.state.kind, "idle");
  });
});
