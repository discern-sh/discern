import { assert, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import {
  decodeTestDurationHints,
  loadTestDurationHints,
  selectionSeconds,
  TEST_DURATION_HINTS_PATH,
} from "../scripts/test_durations.ts";
import {
  durationHints,
  durationHintsDocument,
} from "./test_duration_fixture.ts";
import { withTempDir } from "./temp_dir.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Run one operation while collecting what it reports on standard error. */
async function reported<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...parts: unknown[]) =>
    lines.push(parts.map(String).join(" "));
  try {
    return { value: await operation(), lines };
  } finally {
    console.error = original;
  }
}

Deno.test("the committed duration hints decode with recorded provenance, sorted literal test paths, and bounded values", async () => {
  const text = await Deno.readTextFile(
    join(REPO_ROOT, TEST_DURATION_HINTS_PATH),
  );
  const hints = decodeTestDurationHints(text);
  const raw = decodeWith(
    z.object({
      source: z.object({ head: z.string() }),
      files: z.record(z.string(), z.number()),
    }),
    text,
  );
  const keys = Object.keys(raw.files);
  assert(keys.length > 0);
  assertEquals(keys, [...keys].sort(), "stable diffs need sorted entries");
  for (const key of keys) {
    assert(
      /^tests\/[A-Za-z0-9_.-]+\.ts$/.test(key),
      `literal test path: ${key}`,
    );
  }
  assertEquals(hints.seconds.size, keys.length);
  assertEquals(hints.fallbackSeconds, Math.max(...hints.seconds.values()));
  assert(hints.fallbackSeconds > 0, "the fallback charges real recorded work");
  assertEquals(hints.source, raw.source.head.slice(0, 12));
});

Deno.test("invalid or unavailable hints keep seeded admission and explain why", async () => {
  for (
    const [label, text, at] of [
      [
        "format",
        durationHintsDocument(undefined, {
          format: "discern-test-duration-hints/2",
        }),
        "format",
      ],
      [
        "units",
        durationHintsDocument(undefined, { units: "milliseconds" }),
        "units",
      ],
      [
        "unknown field",
        durationHintsDocument(undefined, { trainer: true }),
        "the document root",
      ],
      [
        "source",
        durationHintsDocument(undefined, { source: { head: "short" } }),
        "source",
      ],
      [
        "negative",
        durationHintsDocument({ "tests/a_test.ts": -1 }),
        "files.tests/a_test.ts",
      ],
      [
        "text value",
        durationHintsDocument({ "tests/a_test.ts": "1" }),
        "files.tests/a_test.ts",
      ],
      [
        "unbounded",
        durationHintsDocument({ "tests/a_test.ts": 1e10 }),
        "files.tests/a_test.ts",
      ],
      ["empty", durationHintsDocument({}), "files"],
    ] as const
  ) {
    const error = assertThrows(
      () => decodeTestDurationHints(text),
      TypeError,
      `invalid at ${at}`,
      label,
    );
    assert(error.message.length < 400, label);
  }
  assertThrows(() => decodeTestDurationHints("{"), SyntaxError);
  await withTempDir(async (dir) => {
    const missing = await reported(() =>
      loadTestDurationHints(join(dir, "absent.json"))
    );
    assertEquals(missing.value, undefined);
    assertEquals(missing.lines.length, 1);
    assert(missing.lines[0]?.includes("keep seeded admission"));
    assert(missing.lines[0]?.includes("not present"));
    const invalid = join(dir, "invalid.json");
    await Deno.writeTextFile(invalid, durationHintsDocument({}));
    const rejected = await reported(() => loadTestDurationHints(invalid));
    assertEquals(rejected.value, undefined);
    assert(rejected.lines[0]?.includes("invalid at files"));
    const valid = join(dir, "valid.json");
    await Deno.writeTextFile(valid, durationHintsDocument());
    const loaded = await reported(() => loadTestDurationHints(valid));
    assertEquals(loaded.lines, []);
    assertEquals(loaded.value?.seconds.get("tests/a_test.ts"), 1.5);
    assertEquals(loaded.value?.fallbackSeconds, 1.5);
  });
});

Deno.test("selection cost sums recorded parents, ignores flags, and charges unrecorded files the fallback", () => {
  const hints = durationHints({
    "tests/a_test.ts": 2.5,
    "tests/b_test.ts": 10,
  });
  assertEquals(
    selectionSeconds(["--permit-no-files", "tests/a_test.ts"], hints),
    2.5,
  );
  assertEquals(
    selectionSeconds(
      ["--permit-no-files", "tests/a_test.ts", "tests/b_test.ts"],
      hints,
    ),
    12.5,
  );
  assertEquals(
    selectionSeconds(["--permit-no-files", "tests/new_test.ts"], hints),
    10,
    "an unrecorded file costs the most expensive recorded file, never zero",
  );
  assertEquals(
    selectionSeconds(
      ["--shard=1/3", "--permit-no-files", "--ignore=tests/a_test.ts"],
      hints,
    ),
    0,
    "flags carry no files",
  );
});
