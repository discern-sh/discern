/** The shared fleet fan-out has a fixed concurrency bound and preserves source order. */
import { assertEquals, assertRejects } from "@std/assert";
import {
  FLEET_OBSERVATION_CONCURRENCY,
  observeFleet,
} from "../src/shared/fleet_observation.ts";

Deno.test("fleet observation bounds every collection size and retains source order", async () => {
  for (const size of [0, 1, FLEET_OBSERVATION_CONCURRENCY * 3]) {
    const release = Promise.withResolvers<void>();
    let running = 0;
    let peak = 0;
    const source = Array.from({ length: size }, (_, i) => i);
    const result = observeFleet(source, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await release.promise;
      running--;
      return item * 2;
    });
    assertEquals(running, Math.min(size, FLEET_OBSERVATION_CONCURRENCY));
    release.resolve();
    assertEquals(await result, source.map((item) => item * 2));
    assertEquals(peak, Math.min(size, FLEET_OBSERVATION_CONCURRENCY));
  }
});
Deno.test("fleet observation exposes a failed member instead of projecting an empty collection", async () => {
  await assertRejects(
    () =>
      observeFleet(
        ["first", "unreadable"],
        (item) =>
          item === "unreadable"
            ? Promise.reject(new Error("Unavailable"))
            : Promise.resolve(item),
      ),
    Error,
    "Unavailable",
  );
});
