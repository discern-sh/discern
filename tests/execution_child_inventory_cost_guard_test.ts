/** The child inventory resolves artifact storage once per inspection, not once per receipt. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { completionId } from "./completion_producers_fixtures.ts";
import { inspectExecutionChildren } from "../src/engine/execution/lifetime.ts";
import { saveExecutionChildReceipt } from "../src/engine/execution/artifacts.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Count every native command launch until `restore` runs; each wrapper still launches. */
function countCommandLaunches(): {
  launches: () => number;
  restore: () => void;
} {
  const proto = Deno.Command.prototype;
  const original = {
    output: proto.output,
    outputSync: proto.outputSync,
    spawn: proto.spawn,
  };
  let launches = 0;
  proto.output = function (this: Deno.Command): Promise<Deno.CommandOutput> {
    launches++;
    return original.output.call(this);
  };
  proto.outputSync = function (this: Deno.Command): Deno.CommandOutput {
    launches++;
    return original.outputSync.call(this);
  };
  proto.spawn = function (this: Deno.Command): Deno.ChildProcess {
    launches++;
    return original.spawn.call(this);
  };
  return {
    launches: (): number => launches,
    restore: (): void => {
      proto.output = original.output;
      proto.outputSync = original.outputSync;
      proto.spawn = original.spawn;
    },
  };
}

interface ChildSubject {
  readonly attempt_id: string;
  readonly candidate_id: string;
  readonly context: string;
}

/** One attempt subject whose ids derive from a fixture base number. */
function subject(base: number): ChildSubject {
  return {
    attempt_id: completionId(base),
    candidate_id: completionId(base + 1),
    context: "local",
  };
}

/** Record one enrollment and `count` settled children through the real publisher. */
async function recordSettledChildren(
  root: string,
  who: ChildSubject,
  count: number,
  base: number,
): Promise<void> {
  const token = completionId(base);
  await saveExecutionChildReceipt(root, who, { kind: "enrolled", key: token });
  for (let index = 0; index < count; index++) {
    const key = completionId(base + 1 + index);
    await saveExecutionChildReceipt(root, who, { kind: "planned", key, token });
    await saveExecutionChildReceipt(root, who, {
      kind: "started",
      key,
      pid: 4_000_000 + index,
      isolated: true,
    });
    await saveExecutionChildReceipt(root, who, { kind: "settled", key });
  }
}

/** A minimal project whose common Git administration can hold receipts. */
async function inventoryFixture(root: string): Promise<void> {
  await Deno.writeTextFile(
    join(root, "discern.toml"),
    "[project]\nslug = 'inventory-fixture'\n",
  );
  await gitInit(root);
}

Deno.test("child inventory launches the same commands for two and for eight settled children", async () => {
  await withTempDir(async (root) => {
    await inventoryFixture(root);
    const small = subject(800);
    const large = subject(820);
    await recordSettledChildren(root, small, 2, 802);
    await recordSettledChildren(root, large, 8, 822);
    const counter = countCommandLaunches();
    try {
      const smallBefore = counter.launches();
      const smallResult = await inspectExecutionChildren(
        root,
        small.attempt_id,
      );
      const smallLaunches = counter.launches() - smallBefore;
      const largeBefore = counter.launches();
      const largeResult = await inspectExecutionChildren(
        root,
        large.attempt_id,
      );
      const largeLaunches = counter.launches() - largeBefore;
      assert(smallResult.quiescent, smallResult.reason);
      assert(largeResult.quiescent, largeResult.reason);
      assertEquals(
        largeLaunches,
        smallLaunches,
        `Storage discovery must not scale with receipts: ${smallLaunches} launches for two children, ${largeLaunches} for eight`,
      );
      assert(
        smallLaunches <= 3,
        `One inspection resolves storage once; observed ${smallLaunches} launches`,
      );
    } finally {
      counter.restore();
    }
  });
});

Deno.test("child inventory still reads every receipt after scoping discovery", async () => {
  await withTempDir(async (root) => {
    await inventoryFixture(root);
    const live = subject(840);
    const token = completionId(842);
    await saveExecutionChildReceipt(root, live, {
      kind: "enrolled",
      key: token,
    });
    await saveExecutionChildReceipt(root, live, {
      kind: "planned",
      key: completionId(843),
      token,
    });
    await saveExecutionChildReceipt(root, live, {
      kind: "started",
      key: completionId(843),
      pid: Deno.pid,
      isolated: false,
    });
    const unsettled = await inspectExecutionChildren(root, live.attempt_id);
    assertEquals(unsettled.quiescent, false);
    assertStringIncludes(unsettled.reason, "Preserve the checkout");

    const orphan = subject(860);
    await saveExecutionChildReceipt(root, orphan, {
      kind: "planned",
      key: completionId(863),
      token: completionId(862),
    });
    const unenrolled = await inspectExecutionChildren(root, orphan.attempt_id);
    assertEquals(unenrolled.quiescent, false);
    assertStringIncludes(unenrolled.reason, "inventory is unavailable");
  });
});
