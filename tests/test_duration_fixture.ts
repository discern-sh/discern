/** Small valid duration-hint documents for runner and admission fixtures. */
import {
  decodeTestDurationHints,
  TEST_DURATION_HINTS_FORMAT,
  type TestDurationHints,
} from "../scripts/test_durations.ts";

/** One complete hint document whose recorded files and fields a case may override. */
export function durationHintsDocument(
  files: Readonly<Record<string, unknown>> = {
    "tests/a_test.ts": 1.5,
    "tests/b_test.ts": 0,
  },
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    format: TEST_DURATION_HINTS_FORMAT,
    units: "seconds",
    measure: "fixture seconds per file",
    source: {
      head: "a".repeat(40),
      invocation: "fixture-run",
      seed: 42,
      stdout_sha256: "b".repeat(64),
      recorded_at: "2026-09-10T16:49:56Z",
    },
    files,
    ...overrides,
  });
}

/** Decoded hints naming exact seconds per file. */
export function durationHints(
  files: Readonly<Record<string, number>>,
): TestDurationHints {
  return decodeTestDurationHints(durationHintsDocument(files));
}
