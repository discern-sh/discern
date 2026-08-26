/** Structural and census guards for production process output and exit. */

import { assert, assertEquals } from "@std/assert";
import {
  directProcessSitesInSource,
  processExitBoundaryFindings,
  processOutputBoundaryFindings,
  productionProcessBoundaryFiles,
  validateProcessBoundaries,
} from "../scripts/process_boundaries.ts";
import {
  PROCESS_EXIT_BOUNDARIES,
  PROCESS_OUTPUT_BOUNDARIES,
  type ProcessExitBoundary,
  processExitBoundaryCount,
  type ProcessOutputBoundary,
  processOutputBoundaryCount,
} from "../src/shared/process_boundaries.ts";

Deno.test("every console and Deno stream output primitive enters the detector", () => {
  const sites = directProcessSitesInSource(`
export async function plantedOutput(bytes: Uint8Array): Promise<void> {
  console.log("log");
  console.error("error");
  await Deno.stdout.write(bytes);
  Deno.stdout.writeSync(bytes);
  await Deno.stderr.write(bytes);
  Deno.stderr.writeSync(bytes);
}
`);
  assertEquals(
    sites.output.map((site) => [site.operation, site.channel]),
    [
      ["console.log", "stdout"],
      ["console.error", "stderr"],
      ["Deno.stdout.write", "stdout"],
      ["Deno.stdout.writeSync", "stdout"],
      ["Deno.stderr.write", "stderr"],
      ["Deno.stderr.writeSync", "stderr"],
    ],
  );
  assertEquals(sites.exits, []);
});

Deno.test("console, stream, and exit aliases cannot bypass the detector", () => {
  const sites = directProcessSitesInSource(`
export function aliases(bytes: Uint8Array): void {
  const diagnostics = console;
  const { warn: report } = diagnostics;
  const out = Deno.stdout;
  const { writeSync: writeError } = Deno.stderr;
  const terminate = Deno.exit;
  report("warning");
  out.writeSync(bytes);
  writeError(bytes);
  terminate(7);
}
`);
  assertEquals(
    sites.output.map((site) => site.operation),
    [
      "console.warn",
      "Deno.stdout.writeSync",
      "Deno.stderr.writeSync",
    ],
  );
  assertEquals(sites.exits.map((site) => site.operation), ["Deno.exit"]);
});

Deno.test("an unregistered library write or exit fails independently", () => {
  const sites = directProcessSitesInSource(
    `
export function library(bytes: Uint8Array): void {
  Deno.stdout.writeSync(bytes);
  Deno.exit(1);
}
`,
    "src/future_library.ts",
  );
  assertEquals(processOutputBoundaryFindings(sites.output, {}), [
    "unregistered process output at src/future_library.ts:3:3 inside library (Deno.stdout.writeSync)",
  ]);
  assertEquals(processExitBoundaryFindings(sites.exits, {}), [
    "unregistered process exit at src/future_library.ts:4:3 inside library",
  ]);
});

Deno.test("exact crash and signal exits pass while a stale record fails", () => {
  const sites = directProcessSitesInSource(
    `
export function terminateCrash(): never {
  Deno.exit(70);
}
export function reraiseInterrupt(): never {
  Deno.exit(130);
}
`,
    "src/main.ts",
  );
  const registered = {
    "crash-frame-failure": PROCESS_EXIT_BOUNDARIES["crash-frame-failure"],
    "signal-reraise-fallback": {
      ...PROCESS_EXIT_BOUNDARIES["signal-reraise-fallback"],
      path: "src/main.ts",
    },
  } satisfies Readonly<Record<string, ProcessExitBoundary>>;
  assertEquals(processExitBoundaryFindings(sites.exits, registered), []);

  const stale = {
    ...registered,
    "stale-future-exit": {
      path: "src/future.ts",
      enclosingFunction: "future",
      operation: "Deno.exit",
      exitPurpose: "terminate one planted future process path",
      reason: "this record deliberately has no matching source call",
    },
  } satisfies Readonly<Record<string, ProcessExitBoundary>>;
  assertEquals(processExitBoundaryFindings(sites.exits, stale), [
    "stale process exit boundary 'stale-future-exit'",
  ]);
});

Deno.test("a stale output record fails without hiding an unknown site", () => {
  const sites = directProcessSitesInSource(
    `
export function future(): void {
  console.info("future");
}
`,
    "src/future.ts",
  );
  const registered = {
    "stale-output": {
      path: "src/gone.ts",
      enclosingFunction: "gone",
      operation: "console.log",
      channel: "stdout",
      purpose: "emit one planted stale output line",
      reason: "this record deliberately has no matching source call",
    },
  } satisfies Readonly<Record<string, ProcessOutputBoundary>>;
  assertEquals(processOutputBoundaryFindings(sites.output, registered), [
    "stale process output boundary 'stale-output'",
    "unregistered process output at src/future.ts:3:3 inside future (console.info)",
  ]);
});

Deno.test("live process boundary registries bind every src call exactly", async () => {
  const files = await productionProcessBoundaryFiles();
  assert(files.length > 0);
  assert(files.every((path) => path.startsWith("src/")));
  assert(!files.some((path) => path.startsWith("scripts/")));

  const sites = await validateProcessBoundaries();
  assertEquals(sites.output.length, processOutputBoundaryCount());
  assertEquals(sites.exits.length, processExitBoundaryCount());
  assertEquals(
    processOutputBoundaryCount(),
    Object.keys(PROCESS_OUTPUT_BOUNDARIES).length,
  );
  assertEquals(
    processExitBoundaryCount(),
    Object.keys(PROCESS_EXIT_BOUNDARIES).length,
  );
});
