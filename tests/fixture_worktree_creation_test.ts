/** Concurrent fixture constructors must not expose incomplete Git metadata. */
import { assertEquals, assertRejects } from "@std/assert";
import { withFixtureWorktreeCreation } from "./engine_helpers.ts";

Deno.test("fixture worktree creation serializes a repository, releases failures, and leaves other repositories independent", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: string[] = [];
  const first = withFixtureWorktreeCreation("repository-a", async () => {
    events.push("first");
    entered.resolve();
    await release.promise;
    throw new Error("fixture failed");
  });
  const failed = assertRejects(() => first, Error, "fixture failed");
  await entered.promise;
  const next = withFixtureWorktreeCreation("repository-a", () => {
    events.push("next");
    return Promise.resolve();
  });
  try {
    await withFixtureWorktreeCreation("repository-b", () => {
      events.push("independent");
      return Promise.resolve();
    });
    assertEquals(events, ["first", "independent"]);
  } finally {
    release.resolve();
    await failed;
    await next;
  }
  assertEquals(events, ["first", "independent", "next"]);
  await withFixtureWorktreeCreation("repository-a", () => Promise.resolve());
});
