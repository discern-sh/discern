import { assert, assertEquals } from "@std/assert";
import {
  boundMergeAttempt,
  MERGE_ATTEMPT_LIMIT,
  MERGE_PATH_BYTES_LIMIT,
  MERGE_PATH_LIMIT,
} from "../src/shared/merge_observation.ts";
import {
  observeMergeAttempt,
  takeMergeActivity,
} from "../src/shared/result_capture.ts";
import { verbEventSchema } from "../src/engine/logbook/schema.ts";
import { mergeAttempt, verb } from "./patterns_event_fixtures.ts";

Deno.test("merge observation bounds disclose missing paths and preserve unusual Git filenames", () => {
  const invalid = ["", "/absolute", "../parent", "a/../b", "a/./b", "nul\0"];
  const unusual = [
    "spaces here.md",
    "line\nbreak.md",
    "back`tick.txt",
    "😀.md",
  ];
  const input = mergeAttempt(1, {
    conflicts: [...invalid, ...unusual].map((path) => ({
      path,
      generated: false,
    })),
  });
  const bounded = boundMergeAttempt(input);
  assertEquals(bounded.conflicts.map((entry) => entry.path), unusual);
  assertEquals(bounded.paths_omitted, invalid.length);
  const many = boundMergeAttempt(mergeAttempt(2, {
    conflicts: Array.from({ length: MERGE_PATH_LIMIT + 5 }, (_, i) => ({
      path: `p/${i}`,
      generated: false,
    })),
  }));
  assertEquals(many.conflicts.length, MERGE_PATH_LIMIT);
  assertEquals(many.paths_omitted, 5);
  const large = boundMergeAttempt(mergeAttempt(3, {
    conflicts: Array.from({ length: 50 }, (_, i) => ({
      path: `${i}${"😀".repeat(1000)}`,
      generated: false,
    })),
  }));
  const bytes = large.conflicts.reduce(
    (sum, entry) => sum + new TextEncoder().encode(entry.path).length,
    0,
  );
  assert(bytes <= MERGE_PATH_BYTES_LIMIT);
  assert(large.paths_omitted > 0);
  assertEquals(
    boundMergeAttempt(mergeAttempt(4, { head: "unavailable" })).head,
    null,
  );
});

Deno.test("merge accumulator bounds, empty observations, and drains are explicit", () => {
  takeMergeActivity();
  observeMergeAttempt();
  assertEquals(takeMergeActivity(), { version: 1, attempts: [], omitted: 0 });
  for (let i = 0; i < MERGE_ATTEMPT_LIMIT + 2; i++) {
    observeMergeAttempt(mergeAttempt(i));
  }
  const captured = takeMergeActivity();
  assertEquals(captured?.attempts.length, MERGE_ATTEMPT_LIMIT);
  assertEquals(captured?.omitted, 2);
  assertEquals(takeMergeActivity(), undefined);
  observeMergeAttempt(mergeAttempt(1, { effort: "" }));
  assertEquals(takeMergeActivity()?.omitted, 1);
});

Deno.test("legacy and unknown merge evidence preserve the containing logbook event", () => {
  assertEquals(verbEventSchema.parse(verb({})).merges, undefined);
  const future = {
    ...verb({}),
    merges: { version: 42, attempts: [], omitted: 0 },
  };
  assertEquals(verbEventSchema.parse(future).merges, undefined);
});
