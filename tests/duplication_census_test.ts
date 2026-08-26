/** Qualification suite for maximal, deterministic duplication findings. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  duplicateCloneDiagnostic,
  duplicationCensus,
  type DuplicationSource,
} from "../scripts/duplication_census_lib.ts";
import pollUntilGateSlots from "./fixtures/duplication/poll_until_gate_slots.ts";
import pollUntilMcp from "./fixtures/duplication/poll_until_mcp.ts";
import pollUntilQueue from "./fixtures/duplication/poll_until_queue.ts";

interface RoutineNames {
  readonly fn: string;
  readonly input: string;
  readonly limit: string;
  readonly started: string;
  readonly seen: string;
  readonly index: string;
  readonly value: string;
  readonly error: string;
}

const PRIMARY_NAMES: RoutineNames = {
  fn: "resolveCandidate",
  input: "candidate",
  limit: "attempts",
  started: "startedAt",
  seen: "seenCounts",
  index: "attempt",
  value: "resolved",
  error: "error",
};

const RENAMED_NAMES: RoutineNames = {
  fn: "chooseResult",
  input: "subject",
  limit: "maximum",
  started: "began",
  seen: "visits",
  index: "cursor",
  value: "answer",
  error: "failure",
};

const routine = (
  names: RoutineNames,
  comparison = ">",
  minimum = "3",
): string => `
export async function ${names.fn}(
  ${names.input}: string,
  ${names.limit}: number,
): Promise<string> {
  const ${names.started} = Date.now();
  const ${names.seen} = new Map<string, number>();
  try {
    for (let ${names.index} = 0; ${names.index} < ${names.limit}; ${names.index}++) {
      if (${names.seen}.has(${names.input})) {
        ${names.seen}.set(
          ${names.input},
          (${names.seen}.get(${names.input}) ?? 0) + 1,
        );
        continue;
      }
      const ${names.value} = await Promise.resolve(
        String(${names.input}) + String(${names.index}),
      );
      if (${names.value}.length ${comparison} ${minimum}) {
        ${names.seen}.set(${names.input}, ${names.index});
        return JSON.stringify({
          value: ${names.value},
          elapsed: Date.now() - ${names.started},
        });
      }
    }
    throw new Error("candidate did not resolve");
  } catch (${names.error}) {
    console.error(${names.error});
    return String(${names.error});
  } finally {
    await Promise.resolve(${names.seen}.clear());
  }
}
`;

const enclosingRoutine = (names: RoutineNames, outerName: string): string => {
  const nested = routine(names).replace(
    "export async function",
    "async function",
  );
  return `
export async function ${outerName}(
  raw: string,
  attempts: number,
): Promise<string> {
  const prepared = raw.trim();
  ${nested}
  const selected = await ${names.fn}(prepared, attempts);
  return selected.toUpperCase();
}
`;
};

const source = (path: string, text: string): DuplicationSource => ({
  path,
  text,
});

Deno.test("duplication census detects the three former pollUntil routines as one group", async () => {
  const sources = [
    source("tests/engine_gate_slots_test.ts", pollUntilGateSlots),
    source("tests/engine_mcp_test.ts", pollUntilMcp),
    source("tests/engine_queue_test.ts", pollUntilQueue),
  ];

  const census = await duplicationCensus(sources);

  assertEquals(census.duplicateCloneGroups, 1);
  assertEquals(census.groups[0]?.occurrences.map((item) => item.path), [
    "tests/engine_gate_slots_test.ts",
    "tests/engine_mcp_test.ts",
    "tests/engine_queue_test.ts",
  ]);
  assertEquals(census.groups[0]?.duplicateLineContribution, 18);
});

Deno.test("duplication census collapses copied routines instead of counting windows", async () => {
  const sources = [
    source("alpha/first.ts", routine(PRIMARY_NAMES)),
    source("beta/second.ts", routine(RENAMED_NAMES)),
    source(
      "gamma/third.ts",
      routine({
        ...RENAMED_NAMES,
        fn: "selectOutput",
        input: "entry",
      }),
    ),
  ];

  const census = await duplicationCensus(sources);
  const reversed = await duplicationCensus([...sources].reverse());

  assertEquals(census, reversed);
  assertEquals(census.duplicateCloneGroups, 1);
  const group = census.groups[0];
  assert(group !== undefined);
  assertEquals(group.occurrences.length, 3);
  assertEquals(
    group.duplicateLineContribution,
    group.normalizedLineCount * 2,
  );
  const diagnostic = duplicateCloneDiagnostic(group);
  assertStringIncludes(diagnostic, group.fingerprint);
  assertStringIncludes(diagnostic, "alpha/first.ts:2:1-");
  assertStringIncludes(diagnostic, "gamma/third.ts:2:1-");
});

Deno.test("duplication census prefers a maximal outer clone to overlapping nested clones", async () => {
  const census = await duplicationCensus([
    source("one.ts", enclosingRoutine(PRIMARY_NAMES, "runPrimary")),
    source("two.ts", enclosingRoutine(RENAMED_NAMES, "runRenamed")),
  ]);

  assertEquals(census.duplicateCloneGroups, 1);
  assertEquals(census.groups[0]?.occurrences.length, 2);
  assert((census.groups[0]?.normalizedLineCount ?? 0) > 20);
});

Deno.test("identifier, comment, formatting, and literal changes keep clone identity", async () => {
  const original = source("one.ts", routine(PRIMARY_NAMES));
  const renamed = source("two.ts", routine(RENAMED_NAMES));
  const baseline = await duplicationCensus([original, renamed]);
  const reformatted = source(
    "two.ts",
    `// layout is not clone identity\n${routine(RENAMED_NAMES, ">", "900")}`
      .replace("  try {", "  /* semantic routine begins */\n  try{"),
  );

  const changed = await duplicationCensus([original, reformatted]);

  assertEquals(changed.duplicateCloneGroups, baseline.duplicateCloneGroups);
  assertEquals(changed.duplicatedLines, baseline.duplicatedLines);
  assertEquals(
    changed.groups[0]?.fingerprint,
    baseline.groups[0]?.fingerprint,
  );
  assertEquals(
    changed.groups[0]?.normalizedTokenCount,
    baseline.groups[0]?.normalizedTokenCount,
  );
  assertEquals(changed.groups[0]?.occurrences.length, 2);
});

Deno.test("a small operator edit stays one maximal clone group", async () => {
  const baseline = await duplicationCensus([
    source("one.ts", routine(PRIMARY_NAMES)),
    source("two.ts", routine(RENAMED_NAMES)),
  ]);
  const census = await duplicationCensus([
    source("one.ts", routine(PRIMARY_NAMES)),
    source("two.ts", routine(RENAMED_NAMES, ">=")),
  ]);

  assertEquals(census.duplicateCloneGroups, 1);
  assertEquals(census.groups[0]?.occurrences.length, 2);
  assertEquals(census.duplicatedLines, baseline.duplicatedLines);
});

Deno.test("duplication census reports disjoint same-file occurrences once", async () => {
  const census = await duplicationCensus([
    source(
      "same.ts",
      `${routine(PRIMARY_NAMES)}\n${routine(RENAMED_NAMES)}`,
    ),
  ]);

  assertEquals(census.duplicateCloneGroups, 1);
  const occurrences = census.groups[0]?.occurrences;
  assertEquals(occurrences?.length, 2);
  assertEquals(occurrences?.map((item) => item.path), ["same.ts", "same.ts"]);
  assert((occurrences?.[0]?.endLine ?? 0) < (occurrences?.[1]?.startLine ?? 0));
});

Deno.test("duplication census ignores imports, generated mirrors, and registry tables", async () => {
  const imports = Array.from(
    { length: 16 },
    (_, index) => `import { value${index} } from "./module${index}.ts";`,
  ).join("\n");
  const registry = (name: string): string => `
interface Entry { readonly id: string; readonly enabled: boolean; }
export const ${name} = [
  { id: "alpha", enabled: true },
  { id: "beta", enabled: false },
  { id: "gamma", enabled: true },
  { id: "delta", enabled: false },
] as const satisfies readonly Entry[];
`;
  const generatedRoutine = routine(PRIMARY_NAMES);

  const census = await duplicationCensus([
    source("imports-a.ts", imports),
    source("imports-b.ts", imports),
    source("registry-a.ts", registry("FIRST_REGISTRY")),
    source("registry-b.ts", registry("SECOND_REGISTRY")),
    { path: "generated-a.ts", text: generatedRoutine, generated: true },
    { path: "generated-b.ts", text: generatedRoutine, generated: true },
    source("authored.ts", generatedRoutine),
  ]);

  assertEquals(census, {
    groups: [],
    duplicateCloneGroups: 0,
    duplicatedLines: 0,
  });
});

Deno.test("duplication census leaves independent clean controls alone", async () => {
  const census = await duplicationCensus([
    source(
      "parse.ts",
      `export function parseName(value: string): string {
        return value.trim().toLowerCase();
      }`,
    ),
    source(
      "measure.ts",
      `export function measure(values: readonly number[]): number {
        const total = values.reduce((sum, value) => sum + value, 0);
        return values.length === 0 ? 0 : total / values.length;
      }`,
    ),
  ]);

  assertEquals(census.duplicateCloneGroups, 0);
});
