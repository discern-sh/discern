/** Committed per-file duration hints rank explicit priority partitions; membership never depends on them. */
import { z } from "@zod/zod";
import { readTextIfExists } from "../src/shared/fs_presence.ts";

export const TEST_DURATION_HINTS_FORMAT = "discern-test-duration-hints/1";

/** Repository-relative location of the committed hint input. */
export const TEST_DURATION_HINTS_PATH = "scripts/test_duration_hints.json";

/** No recorded test body approaches this many seconds; the bound keeps every sum finite. */
const MAX_HINT_SECONDS = 1e9;

/** Lowercase hexadecimal identifiers of one exact length. */
function hex(length: number): z.ZodString {
  return z.string().regex(
    new RegExp(`^[0-9a-f]{${length}}$`),
    `${length} lowercase hexadecimal characters`,
  );
}

const TestDurationHintsSchema = z.object({
  format: z.literal(TEST_DURATION_HINTS_FORMAT),
  units: z.literal("seconds"),
  measure: z.string().min(1),
  source: z.object({
    head: hex(40),
    invocation: z.string().min(1),
    seed: z.number().int().nonnegative(),
    stdout_sha256: hex(64),
    recorded_at: z.string().regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
      "a UTC timestamp",
    ),
  }).strict(),
  files: z.record(
    z.string().min(1),
    z.number().finite().nonnegative().max(MAX_HINT_SECONDS),
  ).refine(
    (files) => Object.keys(files).length > 0,
    "at least one recorded file",
  ),
}).strict();

export interface TestDurationHints {
  /** The recorded source commit, abbreviated for admission log lines. */
  readonly source: string;
  readonly seconds: ReadonlyMap<string, number>;
  /** The estimate for an unrecorded file: the most expensive recorded file. */
  readonly fallbackSeconds: number;
}

/** Decode one hint document; a wrong format, field, or value is a TypeError. */
export function decodeTestDurationHints(text: string): TestDurationHints {
  const parsed = TestDurationHintsSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new TypeError(
      `Test duration hints are invalid at ${
        issue?.path.map(String).join(".") || "the document root"
      }: ${issue?.message ?? "unknown issue"}`,
    );
  }
  const seconds = new Map(Object.entries(parsed.data.files));
  return {
    source: parsed.data.source.head.slice(0, 12),
    seconds,
    fallbackSeconds: Math.max(...seconds.values()),
  };
}

/** Read the committed hints; an unavailable or invalid input keeps seeded admission and says why. */
export async function loadTestDurationHints(
  path: string,
): Promise<TestDurationHints | undefined> {
  try {
    const text = await readTextIfExists(path);
    if (text === undefined) throw new TypeError(`${path} is not present`);
    return decodeTestDurationHints(text);
  } catch (error) {
    console.error(
      `Test duration hints unavailable; priority partitions keep seeded admission: ${
        error instanceof Error
          ? error.message.slice(0, 300)
          : String(error).slice(0, 300)
      }`,
    );
    return undefined;
  }
}

/** Estimate a literal selection's cost: flags carry no files and an unrecorded file costs the fallback. */
export function selectionSeconds(
  selection: readonly string[],
  hints: TestDurationHints,
): number {
  let total = 0;
  for (const arg of selection) {
    if (arg.startsWith("-")) continue;
    total += hints.seconds.get(arg) ?? hints.fallbackSeconds;
  }
  return total;
}
