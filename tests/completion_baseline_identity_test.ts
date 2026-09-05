/** Detached identity fails closed when durable ownership no longer agrees. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { frozenExecutionContext } from "../src/engine/execution/identity_context.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { completionId } from "./completion_fixtures.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("detached identity refuses conflicting owners and a changed frozen identity", async () => {
  await withTempDir(async (base) => {
    assertEquals(await frozenExecutionContext(base), undefined);
    const f = await environmentFixture(base);
    assertEquals(await frozenExecutionContext(f.path), undefined);
    const execution = await f.claim();
    const result = await f.executor.execute(execution, async () => {
      const current = await requireEnvironment(f.root, f.id);
      const directory = await gitAdminStatePath(f.root, "completionRecords");
      assert(directory !== undefined);
      const path = join(directory, "environment", `${f.id}.json`);
      const raw = await Deno.readTextFile(path);
      const second = completionId(999);
      const duplicate = join(directory, "environment", `${second}.json`);
      try {
        await Deno.writeTextFile(
          duplicate,
          JSON.stringify({ ...current.record, id: second }),
        );
        await assertRejects(
          () => frozenExecutionContext(f.path),
          Error,
          "conflicting execution ownership",
        );
      } finally {
        await Deno.remove(duplicate);
      }
      assert(current.record.data.ownership.kind === "borrowed");
      try {
        await Deno.writeTextFile(
          path,
          JSON.stringify({
            ...current.record,
            data: {
              ...current.record.data,
              ownership: {
                ...current.record.data.ownership,
                identity: {
                  ...current.record.data.ownership.identity,
                  seed: 999,
                },
              },
            },
          }),
        );
        await assertRejects(
          () => frozenExecutionContext(f.path),
          Error,
          "disagrees with its frozen execution intent",
        );
      } finally {
        await Deno.writeTextFile(path, raw);
      }
      assert(await frozenExecutionContext(f.path) !== undefined);
      return true;
    });
    assertEquals(result.validation, true, JSON.stringify(result));
    assertEquals(result.returned.kind, "restored", JSON.stringify(result));
  });
});
