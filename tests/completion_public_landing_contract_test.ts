/** Release, preview and apply must preserve one source and its applicable evidence. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { synchronizeQueueAuthorities } from "../src/engine/landing_queue/public_authority.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { requireQueue } from "../src/engine/landing_queue/repository.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { completionId } from "./completion_fixtures.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { releasedValidationEnvironment } from "../src/engine/execution/public_environment.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";

Deno.test("declared composition after trunk movement preserves source consent through release and continuation from main", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
capacity = 1
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`,
    );
    const done = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(done.code, 0, done.output);
    await Deno.writeTextFile(`${root}/other`, "new trunk\n");
    await git(root, "add", "other");
    await git(root, "commit", "-m", "Advance independent trunk");
    const pending = await runAgent(path, ["accept", "--confirmed", "--json"]);
    assertEquals(pending.code, 1, pending.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    const released = await runAgent(path, [
      "done",
      "--release-checkout",
      "--json",
    ]);
    assertEquals(released.code, 0, released.output);
    const before = observedRecords(await observeQueue(root, "main"));
    const preview = await runAgent(root, [
      "accept",
      "--target",
      path,
      "--dry-run",
      "--json",
    ]);
    const plan = decodeCliResult(preview.stdout, "accept");
    assert(plan.data !== undefined && "queue" in plan.data, preview.output);
    assert(plan.data.continuation?.includes("public-done"), preview.output);
    assert(!plan.data.continuation?.includes(path), preview.output);
    assertEquals(
      plan.data.queue?.[0]?.planned_action,
      "compose",
      preview.output,
    );
    assert(
      plan.data.pending?.some((item) => item.kind === "missing-evidence"),
      preview.output,
    );
    assertEquals(observedRecords(await observeQueue(root, "main")), before);
    const accepted = await runAgent(root, [
      "accept",
      "--target",
      "public-done",
      "--json",
    ]);
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(await Deno.readTextFile(`${root}/source`), "authored\n");
    assertEquals(await Deno.readTextFile(`${root}/other`), "new trunk\n");
    const after = observedRecords(await observeQueue(root, "main"));
    assertEquals(
      after.filter((record) => record.kind === "evidence").length,
      before.filter((record) => record.kind === "evidence").length + 2,
      "changed candidate inputs require one new shared producer, with one job and one standard receipt",
    );
  });
});

for (const configured of [false, true]) {
  for (const reordered of [false, true]) {
    Deno.test(`public released ${configured ? "configured" : "native"} source ${reordered ? "after restored predecessor" : "without queue changes"} follows its ready acceptance preview without producers`, async () => {
      await withTempDir(async (root) => {
        const path = await project(
          root,
          ["local"],
          configured
            ? `
[execution.local]
kind = 'borrowed'
capacity = 1
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`
            : "",
        );
        const source = await gitOut(path, "rev-parse", "HEAD");
        if (reordered) {
          const peer = await addWorktree(root, "independent");
          await Deno.writeTextFile(`${peer}/other`, "independent\n");
          await git(peer, "add", "other");
          await git(peer, "commit", "-m", "Author independent change");
          const proven = await runAgent(peer, [
            "done",
            "--retain-checkout",
            "--json",
          ]);
          assertEquals(proven.code, 0, proven.output);
          await grantEffort(
            peer,
            "agent/independent",
            wallTimeIso(SYSTEM_CLOCK.wallNow()),
          );
        }
        const green = await runAgent(path, [
          "done",
          "--retain-checkout",
          "--json",
        ]);
        assertEquals(green.code, 0, green.output);
        if (reordered) {
          await grantEffort(
            path,
            "agent/public-done",
            wallTimeIso(SYSTEM_CLOCK.wallNow()),
          );
          await synchronizeQueueAuthorities(root, "main");
          const queue = await requireQueue(root);
          const reorderedQueue = await mutateQueue({
            root,
            trunk: "main",
            expected_stamp: queue.stamp,
            mutation: {
              kind: "reprioritize",
              decision: {
                id: completionId(990),
                expected: ["independent", "public-done"],
                order: ["public-done", "independent"],
              },
            },
          });
          assertEquals(reorderedQueue.kind, "changed");
        }
        const released = await runAgent(path, [
          "done",
          "--release-checkout",
          "--json",
        ]);
        assertEquals(released.code, 0, released.output);
        const records = observedRecords(await observeQueue(root, "main"));
        const preview = await runAgent(path, [
          "accept",
          "--dry-run",
          "--confirmed",
          "--json",
        ]);
        assertEquals(preview.code, 0, preview.output);
        const plan = decodeCliResult(preview.stdout, "accept");
        assert(
          plan.data !== undefined && "pending" in plan.data,
          preview.output,
        );
        assertEquals(plan.data.pending, [], preview.output);
        assertEquals(
          observedRecords(await observeQueue(root, "main")),
          records,
        );
        const accepted = await runAgent(path, [
          "accept",
          "--confirmed",
          "--json",
        ]);
        assertEquals(accepted.code, 0, accepted.output);
        assertEquals(await gitOut(root, "rev-parse", "main"), source);
        const after = observedRecords(await observeQueue(root, "main"));
        assertEquals(
          after.filter((record) => record.kind === "evidence").length,
          records.filter((record) => record.kind === "evidence").length,
          "ownership-only release and acceptance preserve applicable producer evidence",
        );
        assert(
          after.some((record) =>
            record.kind === "landing" && record.data.outcome.kind === "landed"
          ),
        );
      });
    });
  }
}

Deno.test("released environment selection reports changed predicates as blockers and leaves release intact", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[execution.local]
kind = 'borrowed'
capacity = 1
reusable = true
inputs = ['discern.toml']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`,
    );
    const green = await runAgent(path, ["done", "--json"]);
    assertEquals(green.code, 0, green.output);
    const observation = await observeQueue(root, "main");
    const reading = observation.records.find(({ reading }) =>
      reading.kind === "recorded" && reading.record.kind === "environment" &&
      reading.record.data.state.kind !== "disposed"
    )?.reading;
    assert(
      reading?.kind === "recorded" && reading.record.kind === "environment",
    );
    assert(reading.record.data.ownership.kind === "borrowed");
    const source = reading.record.data.ownership.source;
    const config = await loadConfig(path);
    const declaration = config.execution.local;
    assert(declaration !== undefined);
    const released = {
      environment_id: reading.record.id,
      expected_stamp: reading.stamp,
    };
    const valid = await releasedValidationEnvironment(
      path,
      config,
      source,
      declaration,
      released,
    );
    assert(!("kind" in valid));
    for (
      const [label, target, selectedSource, selectedDeclaration, selection] of [
        ["stamp", path, source, declaration, {
          ...released,
          expected_stamp: "changed",
        }],
        ["path", root, source, declaration, released],
        [
          "source",
          path,
          { ...source, head: "a".repeat(40) },
          declaration,
          released,
        ],
        ["declaration", path, source, null, released],
        ["missing", path, source, declaration, {
          ...released,
          environment_id: completionId(999),
        }],
      ] as const
    ) {
      const refusal = await releasedValidationEnvironment(
        target,
        config,
        selectedSource,
        selectedDeclaration,
        selection,
      );
      assert(
        "kind" in refusal && refusal.kind === "environment-unavailable",
        label,
      );
      assertEquals(
        observedRecords(await observeQueue(root, "main")),
        observedRecords(observation),
        label,
      );
    }
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
  });
});

Deno.test("standing scope permission alone does not insert unrelated work ahead of an acceptance request", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[scopes.article]
paths = ['note']
[acceptance]
pre_authorized = ['article']
`,
    );
    const peer = await addWorktree(root, "unrequested");
    await Deno.writeTextFile(`${peer}/note`, "independent article\n");
    await git(peer, "add", "note");
    await git(peer, "commit", "-m", "Author article");
    const peerGreen = await runAgent(peer, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(peerGreen.code, 0, peerGreen.output);
    const green = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(green.code, 0, green.output);
    const before = observedRecords(await observeQueue(root, "main"));
    const preview = await runAgent(path, [
      "accept",
      "--dry-run",
      "--confirmed",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(observedRecords(await observeQueue(root, "main")), before);
    const accepted = await runAgent(path, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(
      await gitOut(root, "rev-parse", "main"),
      await gitOut(path, "rev-parse", "HEAD"),
    );
    const queue = await requireQueue(root);
    const unrequested = queue.record.data.entries.find((entry) =>
      entry.source.effort_id === "unrequested"
    );
    assertEquals(unrequested?.authority_id, null);
    assertEquals(unrequested?.eligible_order, null);
    assertEquals(await Deno.readTextFile(`${peer}/executions`), "t");
  });
});
