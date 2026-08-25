/** Contract tests for the validated Deno module-graph reader. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  decodeDenoInfo,
  localModule,
  parseDenoInfoJson,
} from "./module_graph.ts";

const COMMAND = "deno info --json fixture.ts";

Deno.test("the Deno-info decoder preserves code edges and erases type-only edges", () => {
  const decoded = decodeDenoInfo({
    modules: [{
      specifier: "file:///repo/src/main.ts",
      dependencies: [
        { specifier: "./types.ts", type: { specifier: "file:///types.ts" } },
        {
          specifier: "./runtime.ts",
          code: { specifier: "file:///repo/src/runtime.ts", span: {} },
        },
      ],
    }],
  }, COMMAND);

  assertEquals(decoded, {
    modules: [{
      specifier: "file:///repo/src/main.ts",
      dependencies: [
        {},
        { code: { specifier: "file:///repo/src/runtime.ts" } },
      ],
    }],
  });
});

Deno.test("the Deno-info decoder rejects every malformed consumed field", () => {
  const malformed: readonly unknown[] = [
    null,
    {},
    { modules: {} },
    { modules: [null] },
    { modules: [{}] },
    { modules: [{ specifier: 1 }] },
    { modules: [{ specifier: "file:///x.ts", dependencies: {} }] },
    { modules: [{ specifier: "file:///x.ts", dependencies: [null] }] },
    {
      modules: [{
        specifier: "file:///x.ts",
        dependencies: [{ code: null }],
      }],
    },
    {
      modules: [{
        specifier: "file:///x.ts",
        dependencies: [{ code: {} }],
      }],
    },
  ];

  for (const value of malformed) {
    const error = assertThrows(() => decodeDenoInfo(value, COMMAND));
    assert(error instanceof Error);
    assertEquals(
      error.message.startsWith(`${COMMAND} returned malformed JSON:`),
      true,
    );
    assertEquals(error.message.length <= 600, true);
  }
});

Deno.test("invalid Deno-info JSON fails with the bounded command name", () => {
  const error = assertThrows(() =>
    parseDenoInfoJson(`{"modules":[${"x".repeat(2_000)}`, COMMAND)
  );
  assert(error instanceof Error);
  assertEquals(
    error.message.startsWith(`${COMMAND} returned malformed JSON:`),
    true,
  );
  assertEquals(error.message.length <= 600, true);
});

Deno.test("local modules stay repository-relative and external paths stay out", () => {
  assertEquals(
    localModule("/repo", "file:///repo/src/main.ts"),
    "src/main.ts",
  );
  assertEquals(localModule("/repo", "file:///other/main.ts"), undefined);
  assertEquals(localModule("/repo", "https://example.test/main.ts"), undefined);
});
