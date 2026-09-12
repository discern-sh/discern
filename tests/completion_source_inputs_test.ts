/** Source validation must not require preservation machinery for untouched local data. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import {
  observeCompletionRecords,
  observeValidationInputs,
} from "../src/engine/validation/runtime.ts";
import { observeCandidateInputs } from "../src/engine/validation/inputs.ts";

Deno.test("source standards and done tolerate unrelated ignored data and registered submodules", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
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
    const done = await runAgent(path, ["done", "--json"]);
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
