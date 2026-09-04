/**
 * The `.claude/settings.json` deep-merge — the rule that the kit never clobbers
 * a user's Claude settings. These tests pin: idempotent hook append (no dup on
 * re-run), permission-array union, existing-scalar preservation, and that a
 * brand-new settings file simply receives ours.
 *
 * Expected values are derived from the merge specification by hand, never from
 * running the merger.
 */

import { assertEquals, assertExists, assertNotStrictEquals } from "@std/assert";
import { z } from "@zod/zod";
import {
  type JsonHookSeedMergePolicy,
  mergeJsonHookSettingsText,
  mergeSettings,
} from "../src/lib/settings_merge.ts";
import { decodeWith } from "./decode_cli_result.ts";

const FlatHookSettingsSchema = z.object({
  hooks: z.object({
    sessionStart: z.array(
      z.object({
        command: z.string().optional(),
        type: z.string().optional(),
        bash: z.string().optional(),
        timeout: z.number().optional(),
        timeoutSec: z.number().optional(),
      }).refine((entry) =>
        entry.command !== undefined || entry.bash !== undefined
      ),
    ),
  }),
});

/** The kit's incoming settings, shaped like the real template. */
function incoming(): unknown {
  return {
    permissions: { deny: ["Read(./.env)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "./agent worktree ensure" }],
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
  const userGroup = result.hooks.SessionStart[0];
  assertExists(userGroup);
  const userHook = userGroup.hooks[0];
  assertExists(userHook);
  assertEquals(userHook.command, "user-own-hook");
  const ourGroup = result.hooks.SessionStart[1];
  assertExists(ourGroup);
  const ourHook = ourGroup.hooks[0];
  assertExists(ourHook);
  assertEquals(ourHook.command, "./agent worktree ensure");
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

Deno.test("a non-object incoming yields a clone of the existing object", () => {
  // An invalid kit payload must never corrupt the user's settings: a non-object
  // incoming returns the existing object unchanged (cloned, not the same ref).
  const existing = { model: "opus", permissions: { deny: ["Read(./.env)"] } };
  const result = mergeSettings(existing, "not-an-object");
  assertEquals(result, existing);
  assertNotStrictEquals(result, existing);
});

Deno.test("a non-object incoming with a non-object existing yields an empty object", () => {
  // Both sides invalid → start from {} rather than throwing.
  assertEquals(mergeSettings(null, 42), {});
  assertEquals(mergeSettings("x", undefined), {});
});

Deno.test("a malformed hook group is appended rather than deduped", () => {
  // commandsInGroup returns [] for a non-object group or one whose `hooks` is not
  // an array, so such a group has no commands to match on and is always kept.
  const existing = {
    hooks: { SessionStart: ["not-an-object", { hooks: "not-an-array" }] },
  };
  const result = mergeSettings(existing, {
    hooks: { SessionStart: [{ notHooks: true }] },
  }) as { hooks: { SessionStart: unknown[] } };
  // Two malformed existing groups + one command-less incoming group, all kept.
  assertEquals(result.hooks.SessionStart.length, 3);
  assertEquals(result.hooks.SessionStart[2], { notHooks: true });
});

Deno.test("a non-array hook event is set-if-absent (absent → taken)", () => {
  // mergeHooks treats a non-array event value defensively like a scalar: when the
  // event key is absent from existing, the kit's value is taken.
  const result = mergeSettings({ hooks: {} }, {
    hooks: { someScalarEvent: "value" },
  }) as { hooks: Record<string, unknown> };
  assertEquals(result.hooks.someScalarEvent, "value");
});

Deno.test("a non-array hook event is set-if-absent (present → kept)", () => {
  // When the event key already exists, the kit's non-array value is ignored.
  const result = mergeSettings(
    { hooks: { someScalarEvent: "mine" } },
    { hooks: { someScalarEvent: "theirs" } },
  ) as { hooks: Record<string, unknown> };
  assertEquals(result.hooks.someScalarEvent, "mine");
});

Deno.test("a non-array permissions value falls through to set-if-absent merge", () => {
  // The union branch only fires when the INCOMING value is an array; otherwise
  // (a non-permission key, or a permission key whose incoming value is a scalar)
  // the value goes through mergeValue (set-if-absent).
  const existing = { permissions: { defaultMode: "ask", allow: "mine" } };
  const result = mergeSettings(existing, {
    permissions: {
      defaultMode: "acceptEdits", // existing scalar wins (set-if-absent)
      allow: "theirs", // incoming is non-array → mergeValue keeps existing
      additionalDirectories: ["/tmp"], // absent non-permission key → taken
    },
  }) as { permissions: Record<string, unknown> };
  assertEquals(result.permissions.defaultMode, "ask");
  assertEquals(result.permissions.allow, "mine");
  assertEquals(result.permissions.additionalDirectories, ["/tmp"]);
});

Deno.test("provider hook merge replaces stale flat command payloads and stays idempotent", () => {
  const cursorPolicy: JsonHookSeedMergePolicy = {
    commandPlacement: "group",
    commandKey: "command",
  };
  const staleCursor = JSON.stringify({
    version: 1,
    hooks: { sessionStart: [{ command: "discern worktree ensure" }] },
  });
  const cursor = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{ command: "discern worktree ensure", timeout: 600 }],
    },
  });
  const once = mergeJsonHookSettingsText(staleCursor, cursor, cursorPolicy);
  const twice = mergeJsonHookSettingsText(once, cursor, cursorPolicy);
  assertEquals(twice, once); // byte-stable across a re-seed
  const cursorHooks = decodeWith(FlatHookSettingsSchema, twice).hooks
    .sessionStart;
  assertEquals(cursorHooks.length, 1);
  assertEquals(cursorHooks[0]?.timeout, 600);

  const copilotPolicy: JsonHookSeedMergePolicy = {
    commandPlacement: "group",
    commandKey: "bash",
  };
  const staleCopilot = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{
        type: "command",
        bash: "discern worktree ensure",
        timeoutSec: 30,
      }],
    },
  });
  const copilot = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [{
        type: "command",
        bash: "discern worktree ensure",
        timeoutSec: 600,
      }],
    },
  });
  const c1 = mergeJsonHookSettingsText(
    staleCopilot,
    copilot,
    copilotPolicy,
  );
  const c2 = mergeJsonHookSettingsText(c1, copilot, copilotPolicy);
  assertEquals(c2, c1);
  const copilotHooks = decodeWith(FlatHookSettingsSchema, c2).hooks
    .sessionStart;
  assertEquals(copilotHooks.length, 1);
  assertEquals(copilotHooks[0]?.timeoutSec, 600);
});

Deno.test("provider hook merge preserves a user's distinct flat hook group", () => {
  const existing = JSON.stringify({
    hooks: { sessionStart: [{ command: "my-own-hook" }] },
  });
  const incoming = JSON.stringify({
    version: 1,
    hooks: { sessionStart: [{ command: "discern worktree ensure" }] },
  });
  const merged = decodeWith(
    FlatHookSettingsSchema,
    mergeJsonHookSettingsText(existing, incoming, {
      commandPlacement: "group",
      commandKey: "command",
    }),
  );
  // Both remain because only the registry-owned command is replaced.
  assertEquals(merged.hooks.sessionStart.length, 2);
  assertEquals(merged.hooks.sessionStart[0]?.command, "my-own-hook");
  assertEquals(
    merged.hooks.sessionStart[1]?.command,
    "discern worktree ensure",
  );

  const canonicalThenForeign = JSON.stringify({
    version: 1,
    hooks: {
      sessionStart: [
        { command: "discern worktree ensure" },
        { command: "my-own-hook" },
      ],
    },
  });
  const stable = decodeWith(
    FlatHookSettingsSchema,
    mergeJsonHookSettingsText(canonicalThenForeign, incoming, {
      commandPlacement: "group",
      commandKey: "command",
    }),
  );
  assertEquals(stable.hooks.sessionStart.map((group) => group.command), [
    "discern worktree ensure",
    "my-own-hook",
  ]);
});

Deno.test("provider hook merge updates nested matcher and timeout while preserving a mixed group's foreign hook", () => {
  const existing = JSON.stringify({
    hooksConfig: { enabled: true },
    hooks: {
      SessionStart: [{
        matcher: "startup",
        hooks: [
          { type: "command", command: "discern worktree ensure" },
          { type: "command", command: "user-own-hook", user: true },
        ],
      }],
    },
    userSetting: true,
  });
  const incoming = JSON.stringify({
    hooks: {
      SessionStart: ["startup", "resume"].map((matcher) => ({
        matcher,
        hooks: [{
          type: "command",
          command: "discern worktree ensure",
          timeout: 600000,
        }],
      })),
    },
  });
  const schema = z.object({
    hooksConfig: z.object({ enabled: z.boolean() }).optional(),
    userSetting: z.boolean(),
    hooks: z.object({
      SessionStart: z.array(
        z.object({
          matcher: z.string(),
          hooks: z.array(
            z.object({
              command: z.string(),
              timeout: z.number().optional(),
              user: z.boolean().optional(),
            }).passthrough(),
          ),
        }).passthrough(),
      ),
    }),
  }).passthrough();
  const policy: JsonHookSeedMergePolicy = {
    commandPlacement: "nested",
    commandKey: "command",
    retiredRootValues: { hooksConfig: { enabled: true } },
  };
  const merged = decodeWith(
    schema,
    mergeJsonHookSettingsText(existing, incoming, policy),
  );
  assertEquals(merged.userSetting, true);
  assertEquals(merged.hooksConfig, undefined);
  assertEquals(merged.hooks.SessionStart, [{
    matcher: "startup",
    hooks: [{
      type: "command",
      command: "discern worktree ensure",
      timeout: 600000,
    }],
  }, {
    matcher: "resume",
    hooks: [{
      type: "command",
      command: "discern worktree ensure",
      timeout: 600000,
    }],
  }, {
    matcher: "startup",
    hooks: [{ type: "command", command: "user-own-hook", user: true }],
  }]);
});

Deno.test("permissions.allow unions and a non-permission key recurses as an object", () => {
  // The known array key unions; a sibling object-valued key recurses set-if-absent.
  const existing = {
    permissions: { allow: ["Bash(ls)"], extra: { keep: 1 } },
  };
  const result = mergeSettings(existing, {
    permissions: { allow: ["Bash(pwd)"], extra: { keep: 2, add: 3 } },
  }) as {
    permissions: { allow: string[]; extra: Record<string, number> };
  };
  assertEquals(result.permissions.allow, ["Bash(ls)", "Bash(pwd)"]);
  assertEquals(result.permissions.extra, { keep: 1, add: 3 });
});
