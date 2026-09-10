/** Public invocations wait on another checkout without owning or failing its work. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git } from "./engine_helpers.ts";
import { withPublicCompletion } from "../src/engine/landing_queue/public_completion.ts";
import { withCompletionObserver } from "../src/engine/completion/events.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";

for (const stop of ["failure", "owner-cancel", "waiter-cancel"] as const) {
  Deno.test(`public completion capacity releases on ${stop}`, async () => {
    await withTempDir(async (root) => {
      const first = await project(root, ["local"]);
      const second = await addWorktree(root, "capacity-peer");
      await Deno.writeTextFile(`${second}/peer`, "independent source\n");
      await git(second, "add", "peer");
      await git(second, "commit", "-m", "Author independent peer");
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const waiting = Promise.withResolvers<void>();
      const owner = new AbortController();
      const waiter = new AbortController();
      let peerRuns = 0;
      const active = withPublicCompletion(first, {
        context: "local",
        mode: "strict",
        retainCheckout: true,
        signal: owner.signal,
      }, async () => {
        entered.resolve();
        await release.promise;
        return { value: "producer failed", passed: false };
      });
      await Promise.race([
        entered.promise,
        active.then((value) => {
          throw new Error(`Owner did not enter: ${JSON.stringify(value)}`);
        }),
      ]);
      let measuredWaits = 0;
      const peer = withCompletionObserver(
        (fact) => {
          if (
            fact.kind === "event" && fact.event.fact.kind === "timing" &&
            fact.event.fact.category === "capacity-wait"
          ) {
            assert(fact.event.fact.finished_at >= fact.event.fact.started_at);
            measuredWaits++;
          }
          if (
            fact.kind === "progress" && fact.progress.state === "capacity-wait"
          ) waiting.resolve();
        },
        () =>
          withPublicCompletion(second, {
            context: "local",
            mode: "strict",
            retainCheckout: true,
            signal: waiter.signal,
          }, () => {
            peerRuns++;
            return Promise.resolve({ value: "peer ran", passed: false });
          }),
      );
      try {
        await Promise.race([
          waiting.promise,
          peer.then((value) => {
            throw new Error(`Peer did not wait: ${JSON.stringify(value)}`);
          }),
        ]);
        assertEquals(peerRuns, 0);
        if (stop === "waiter-cancel") {
          waiter.abort();
          assertEquals((await peer).kind, "cancelled");
          assertEquals(peerRuns, 0);
        }
        if (stop === "owner-cancel") owner.abort();
        release.resolve();
        await active;
        const result = await peer;
        assert(measuredWaits > 0);
        if (stop !== "waiter-cancel") {
          assertEquals(result.kind, "completed", JSON.stringify(result));
          assertEquals(peerRuns, 1);
        }
        const records = observedRecords(await observeCompletionRecords(root));
        assert(
          records.filter((r) => r.kind === "environment").every((r) =>
            r.kind === "environment" && r.data.state.kind === "idle"
          ),
        );
        assertEquals(records.filter((r) => r.kind === "proof").length, 0);
      } finally {
        release.resolve();
        waiter.abort();
        await Promise.all([active, peer]);
      }
    });
  });
}
