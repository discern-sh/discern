/** Behavioral contract for the named, side-effect-only best-effort capability. */

import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  bestEffort,
  type BestEffortBoundaryId,
  bestEffortSync,
} from "../src/shared/best_effort.ts";

const ASYNC_UNOBSERVABLE = "acceptance-transaction-temp-cleanup";
const ASYNC_REPORTED = "lifecycle-ready-sentinel-write";
const SYNC_UNOBSERVABLE = "terminal-interaction-frame-newline";

Deno.test("bestEffort capabilities return only void and contain effect failures", async () => {
  assertEquals(
    await bestEffort(
      ASYNC_UNOBSERVABLE,
      () => Promise.reject(new Error("secondary async failure")),
    ),
    undefined,
  );
  assertEquals(
    bestEffortSync(SYNC_UNOBSERVABLE, () => {
      throw new Error("secondary sync failure");
    }),
    undefined,
  );
});

Deno.test("a detached bestEffort call cannot produce an unhandled rejection", async () => {
  let effectRan = false;
  void bestEffort(ASYNC_UNOBSERVABLE, () => {
    effectRan = true;
    return Promise.reject(new Error("detached secondary failure"));
  });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(effectRan, true);
});

Deno.test("reporting receives the effect error and its own failure is contained", async () => {
  const effectError = new Error("effect failed");
  let reported: unknown;
  assertEquals(
    await bestEffort(
      ASYNC_REPORTED,
      () => Promise.reject(effectError),
      (error) => {
        reported = error;
        throw new Error("reporter failed too");
      },
    ),
    undefined,
  );
  assertStrictEquals(reported, effectError);
});

Deno.test("secondary cleanup and reporting failures preserve the primary error", async () => {
  const primary = new Error("primary failure");
  let caught: unknown;
  try {
    try {
      throw primary;
    } finally {
      await bestEffort(
        ASYNC_REPORTED,
        () => Promise.reject(new Error("cleanup failure")),
        () => {
          throw new Error("cleanup report failure");
        },
      );
    }
  } catch (error) {
    caught = error;
  }
  assertStrictEquals(caught, primary);
});

Deno.test("unknown IDs, wrong shapes, and reporter mismatches fail before effects", () => {
  let ran = false;
  assertThrows(
    () =>
      bestEffort(
        "unknown-boundary" as BestEffortBoundaryId,
        () => {
          ran = true;
          return Promise.resolve();
        },
      ),
    TypeError,
    "unknown best-effort boundary",
  );
  assertThrows(
    () =>
      bestEffortSync(ASYNC_UNOBSERVABLE, () => {
        ran = true;
      }),
    TypeError,
    "is async, not sync",
  );
  assertThrows(
    () =>
      bestEffort(ASYNC_UNOBSERVABLE, () => {
        ran = true;
        return Promise.resolve();
      }, () => {}),
    TypeError,
    "cannot accept a reporter",
  );
  assertEquals(ran, false);
});
