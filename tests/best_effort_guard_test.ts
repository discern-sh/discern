/** Behavioral controls for exact best-effort registry enrollment. */

import { assertEquals, assertThrows } from "@std/assert";
import type { BestEffortBoundary } from "../src/shared/best_effort.ts";
import {
  bestEffortFindings,
  type BestEffortSource,
  bestEffortSources,
  measureBestEffortBoundaries,
} from "./best_effort_guard.ts";

/** Build one complete synthetic registry entry. */
function boundary(
  overrides: Partial<BestEffortBoundary> = {},
): BestEffortBoundary {
  return {
    path: "src/future_cleanup.ts",
    enclosingFunction: "settleFutureCleanup",
    operation: "remove one secondary future cleanup artifact",
    kind: "capability",
    shape: "async",
    observability: { kind: "unobservable" },
    reason:
      "The future cleanup artifact cannot change the already decided primary result.",
    ...overrides,
  };
}

/** One synthetic authored production module. */
function source(text: string): BestEffortSource[] {
  return [{ path: "src/future_cleanup.ts", source: text }];
}

Deno.test("capability calls and entries bind in both directions", () => {
  const sources = source(`
import { bestEffort } from "./shared/best_effort.ts";
export async function settleFutureCleanup(): Promise<void> {
  await bestEffort("future-artifact-cleanup", async () => {
    await Deno.remove("artifact");
  });
}
`);
  assertEquals(
    bestEffortFindings(sources, {
      "future-artifact-cleanup": boundary(),
    }),
    [],
  );
  assertEquals(
    measureBestEffortBoundaries(sources, {
      "future-artifact-cleanup": boundary(),
    }),
    1,
  );
});

Deno.test("unknown calls, stale entries, and duplicate IDs fail enrollment", () => {
  const unknown = source(`
import { bestEffort } from "./shared/best_effort.ts";
export async function settleFutureCleanup(): Promise<void> {
  await bestEffort("unknown-cleanup", async () => { await cleanup(); });
}
`);
  assertEquals(
    bestEffortFindings(unknown, {}).some((finding) =>
      finding.includes("calls unknown best-effort boundary 'unknown-cleanup'")
    ),
    true,
  );
  assertThrows(
    () =>
      measureBestEffortBoundaries([], {
        "future-artifact-cleanup": boundary(),
      }),
    Error,
    "has no live capability call",
  );
  const duplicate = source(`
import { bestEffort } from "./shared/best_effort.ts";
export async function settleFutureCleanup(): Promise<void> {
  await bestEffort("future-artifact-cleanup", async () => { await first(); });
  await bestEffort("future-artifact-cleanup", async () => { await second(); });
}
`);
  assertEquals(
    bestEffortFindings(duplicate, {
      "future-artifact-cleanup": boundary(),
    }).some((finding) => finding.includes("has 2 live sites")),
    true,
  );
});

Deno.test("generic wrapper callbacks and value-producing legacy wrappers fail", () => {
  const findings = bestEffortFindings(
    source(`
import { bestEffort } from "./shared/best_effort.ts";
import { bestEffortFs } from "./shared/fs_presence.ts";
export async function settleFutureCleanup(effect: () => Promise<void>): Promise<void> {
  await bestEffort("future-artifact-cleanup", async () => { await effect(); });
  await bestEffortFs(async () => await read(), { onFailure: undefined, reason: "legacy" });
}
`),
    {
      "future-artifact-cleanup": boundary(),
    },
  );
  assertEquals(
    findings.some((finding) => finding.includes("forwards callback parameter")),
    true,
  );
  assertEquals(
    findings.some((finding) =>
      finding.includes("calls value-producing bestEffortFs")
    ),
    true,
  );
});

Deno.test("direct exceptions bind one marker to one exact registry entry", () => {
  const sources = source(`
export function settleFutureCleanup(): undefined {
  try { parse(); } catch {
    // discern-best-effort: future-parse-fallback
    return undefined;
  }
}
`);
  assertEquals(
    bestEffortFindings(sources, {
      "future-parse-fallback": boundary({
        operation: "interpret one optional future record parse as unavailable",
        kind: "direct",
        shape: "sync",
      }),
    }),
    [],
  );
});

Deno.test("the live best-effort registry and population match exactly", async () => {
  assertEquals(bestEffortFindings(await bestEffortSources()), []);
});
