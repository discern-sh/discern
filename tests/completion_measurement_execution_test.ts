/** A scalar demand observes and admits only its own producer closure, retaining durable receipts. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";
import { git, runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { measureDeclaredStandards } from "../src/engine/validation/measurement.ts";
import { makeOut } from "../src/engine/output.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { withCompletionObserver } from "../src/engine/completion/events.ts";

Deno.test("measurements retain receipts and account only for executing producer graphs", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[standards.magnitude]
run = "printf 'DISCERN_METRIC magnitude 1\\n'"
inputs = ['source']
direction = 'down'
limit = 2
`,
      "exit 79",
      ["unrelated"],
    );
    let acquired = 0;
    const capacity = {
      out: makeOut(false, { quiet: true }),
      slots: {
        cap: 1,
        waitedMs: undefined,
        waits: [],
        acquire: () => {
          acquired++;
          return Promise.resolve(undefined);
        },
      },
    };
    let slotTimings = 0;
    const measured = await withCompletionObserver((fact) => {
      if (
        fact.kind === "event" && fact.event.fact.kind === "timing" &&
        fact.event.fact.category === "capacity-wait"
      ) slotTimings++;
    }, () =>
      measureDeclaredStandards(
        path,
        ["magnitude"],
        "standards",
        undefined,
        capacity,
      ));
    assertEquals(slotTimings, 1);
    assert("outcome" in measured, JSON.stringify(measured));
    assertEquals(measured.outcome.blockers, []);
    assertEquals(measured.producer_executions, { "standards.magnitude": 1 });
    assertEquals(acquired, 1);
    assert(
      (await observeCompletionRecords(path)).records.some(({ reading }) =>
        reading.kind === "recorded" && reading.record.kind === "evidence" &&
        reading.record.data.applicability.producer === "standards.magnitude"
      ),
    );
    // A different declared demand still pays for its actual test producer.
    const tested = await measureDeclaredStandards(
      path,
      ["coverage"],
      "standards",
      undefined,
      capacity,
    );
    assert("outcome" in tested, JSON.stringify(tested));
    assertEquals(acquired, 2);
    assertEquals(tested.producer_executions, { "jobs.test": 1 });
    assert(tested.outcome.blockers.length > 0);
    await Deno.writeTextFile(
      `${path}/discern.toml`,
      (await Deno.readTextFile(`${path}/discern.toml`)) + `
[jobs.lint]
run = 'exit 81'
inputs = ['unrelated']
toolchain = ['unrelated-toolchain']
`,
    );
    await Deno.writeTextFile(
      `${path}/.gitignore`,
      (await Deno.readTextFile(`${path}/.gitignore`)) +
        "\nunrelated-toolchain\n",
    );
    const unrelated = await Deno.open(`${path}/unrelated-toolchain`, {
      createNew: true,
      write: true,
    });
    try {
      await unrelated.truncate(17 * 1024 * 1024);
    } finally {
      unrelated.close();
    }
    await git(path, "add", "discern.toml", ".gitignore");
    await git(path, "commit", "-m", "Declare an unrelated toolchain");
    const proposed = await measureDeclaredStandards(
      path,
      ["magnitude"],
      "proposal",
      undefined,
      capacity,
    );
    assert("outcome" in proposed, JSON.stringify(proposed));
    assertEquals(proposed.outcome.blockers, []);
    assertEquals(acquired, 2);
    await Deno.writeTextFile(
      `${path}/discern.toml`,
      (await Deno.readTextFile(`${path}/discern.toml`)).replace(
        "inputs = ['source']",
        "inputs = ['source']\ntoolchain = ['unrelated-toolchain']",
      ),
    );
    await git(path, "add", "discern.toml");
    await git(path, "commit", "-m", "Require the oversized input explicitly");
    const failed = await runAgent(path, [
      "standards",
      "propose",
      "magnitude",
      "--reason",
      "Preserve the exact measurement failure before proposing a limit.",
      "--json",
    ]);
    const failure = decodeCliResult(failed.stdout, "standards propose");
    assertEquals(failed.code, 1, failed.output);
    assertStringIncludes(failure.message ?? "", "byte bound");
    assert(!(failure.message ?? "").includes("did not yield a numeric metric"));
  });
});
