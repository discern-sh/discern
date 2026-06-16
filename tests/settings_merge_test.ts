/**
 * The `.claude/settings.json` deep-merge — the rule that the kit never clobbers
 * a user's Claude settings. These tests pin: idempotent hook append (no dup on
 * re-run), permission-array union, existing-scalar preservation, and that a
 * brand-new settings file simply receives ours.
 *
 * Expected values are derived from the merge specification by hand, never from
 * running the merger.
 */

import { assertEquals } from "@std/assert";
import { mergeSettings } from "../src/lib/settings_merge.ts";

/** The kit's incoming settings, shaped like the real template. */
function incoming(): unknown {
  return {
    permissions: { deny: ["Read(./.env)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "./bin/agent worktree:ensure" }],
        },
      ],
    },
  };
}

Deno.test("merge into an empty/absent settings yields the kit's settings", () => {
  const result = mergeSettings({}, incoming());
  assertEquals(result, incoming());
});

Deno.test("merge is idempotent: re-merging adds no duplicate hook group", () => {
  const once = mergeSettings({}, incoming());
  const twice = mergeSettings(once, incoming());
  // The SessionStart command already exists, so the group is not appended again.
  assertEquals(
    (twice as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart.length,
    1,
  );
  assertEquals(twice, once);
});

Deno.test("merge appends a genuinely new hook group for the same event", () => {
  const existing = {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "user-own-hook" }] },
      ],
    },
  };
  const result = mergeSettings(existing, incoming()) as {
    hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
  };
  // The user's group is kept and ours is appended: two distinct groups.
  assertEquals(result.hooks.SessionStart.length, 2);
  assertEquals(result.hooks.SessionStart[0].hooks[0].command, "user-own-hook");
  assertEquals(
    result.hooks.SessionStart[1].hooks[0].command,
    "./bin/agent worktree:ensure",
  );
});

Deno.test("permissions.deny is unioned, not replaced", () => {
  const existing = { permissions: { deny: ["Read(./secret)"] } };
  const result = mergeSettings(existing, incoming()) as {
    permissions: { deny: string[] };
  };
  assertEquals(result.permissions.deny, ["Read(./secret)", "Read(./.env)"]);
});

Deno.test("permissions.deny union does not duplicate an already-present value", () => {
  const existing = { permissions: { deny: ["Read(./.env)"] } };
  const result = mergeSettings(existing, incoming()) as {
    permissions: { deny: string[] };
  };
  assertEquals(result.permissions.deny, ["Read(./.env)"]);
});

Deno.test("an existing top-level scalar is preserved (set-if-absent)", () => {
  const existing = { model: "opus", permissions: { deny: [] } };
  const withScalar = mergeSettings(existing, { model: "sonnet" }) as {
    model: string;
  };
  // Ours is set-if-absent: the user's existing model wins.
  assertEquals(withScalar.model, "opus");
});

Deno.test("a missing top-level scalar is taken from the kit", () => {
  const result = mergeSettings({}, { model: "sonnet" }) as { model: string };
  assertEquals(result.model, "sonnet");
});

Deno.test("nested objects merge set-if-absent on their leaves", () => {
  const existing = { env: { A: "keep" } };
  const result = mergeSettings(existing, {
    env: { A: "override", B: "add" },
  }) as {
    env: Record<string, string>;
  };
  assertEquals(result.env, { A: "keep", B: "add" });
});
