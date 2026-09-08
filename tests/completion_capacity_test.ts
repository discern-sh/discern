/** Capacity waiting distinguishes live ownership from recovery without modifying either. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import {
  observeClaimCapacity,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";

Deno.test("capacity observations distinguish live, expired, recovering and returned execution", async () => {
  await withTempDir(async (root) => {
    const f = await environmentFixture(root);
    const released = (await requireEnvironment(f.root, f.id)).record.data;
    assertEquals(
      await observeClaimCapacity(f.root, released, 1, f.clock),
      null,
    );
    const claimed = await f.claim();
    const active = await requireEnvironment(f.root, f.id);
    assert(active.record.data.state.kind === "executing");
    assertEquals(await observeClaimCapacity(f.root, released, 1, f.clock), {
      kind: "waiting-for-operation",
      attempt_id: active.record.data.state.attempt_id,
      expires_at: active.record.data.state.claim.expires_at,
    });
    assertEquals(
      await observeClaimCapacity(f.root, released, 2, f.clock),
      await observeClaimCapacity(f.root, released, 1, f.clock),
      "spare capacity cannot bypass the same checkout's ownership",
    );
    assert(released.ownership.kind === "borrowed");
    const otherPath = { ...released, path: `${f.path}-independent` };
    assertEquals(
      await observeClaimCapacity(f.root, otherPath, 2, f.clock),
      await observeClaimCapacity(f.root, released, 1, f.clock),
      "a distinct checkout still excludes a shared resource handle",
    );
    assertEquals(
      await observeClaimCapacity(
        f.root,
        {
          ...otherPath,
          ownership: {
            ...released.ownership,
            identity: { ...released.ownership.identity, resources: {} },
          },
        },
        2,
        f.clock,
      ),
      null,
      "a distinct checkout with independent resources can use spare capacity",
    );
    const expired = await observeClaimCapacity(f.root, released, 1, {
      ...f.clock,
      wallNow: () =>
        active.record.data.state.kind === "executing"
          ? active.record.data.state.claim.expires_at
          : 0,
    });
    assertEquals(expired?.kind, "recovery-incomplete");
    assertEquals((await requireEnvironment(f.root, f.id)).stamp, active.stamp);
    const returned = await f.executor.execute(claimed, () => {
      f.lifetime.children = true;
      return Promise.resolve(true);
    });
    assertEquals(returned.returned.kind, "recovery-incomplete");
    const recovering = await requireEnvironment(f.root, f.id);
    assert(recovering.record.data.state.kind === "recovery");
    assertEquals(await observeClaimCapacity(f.root, released, 1, f.clock), {
      kind: "recovery-incomplete",
      record_id: f.id,
      recovery: recovering.record.data.state.recovery,
    });
    assertEquals(
      (await requireEnvironment(f.root, f.id)).stamp,
      recovering.stamp,
    );
    f.lifetime.children = false;
    assertEquals(
      (await f.executor.recover(f.id, recovering.stamp, f.actor)).kind,
      "restored",
    );
    assertEquals(
      await observeClaimCapacity(f.root, released, 1, f.clock),
      null,
    );
  });
});
