/** Contract-validating stdout decoder controls. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { z } from "@zod/zod";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

Deno.test("decodeCliResult returns the registered schema's inferred envelope", () => {
  const result = decodeCliResult(
    '{"ok":true,"verb":"skills list","data":{"skills":[]}}',
    "skills list",
  );

  assertResultDataKey(result, "skills");
  const skills: readonly unknown[] = result.data.skills;
  assertEquals(skills, []);
  assertEquals(result.ok, true);
});

Deno.test("assertResultDataKey rejects the shared config-issue alternative", () => {
  const result = decodeCliResult(
    '{"ok":false,"verb":"skills list","data":{"issues":[]}}',
    "skills list",
  );

  assertThrows(
    () => assertResultDataKey(result, "skills"),
    Error,
    "required key skills",
  );
});

Deno.test("assertResultDataKey makes a declared optional key present", () => {
  const result: {
    data?: { mode?: string } | { issues: readonly unknown[] };
  } = { data: { mode: "preview" } };

  assertResultDataKey(result, "mode");
  const mode: string | undefined = result.data.mode;
  assertEquals(mode, "preview");
});

Deno.test("decodeCliResult names the command, Zod issues, and bounded stdout on failure", () => {
  const tail = "must-not-escape-the-bounded-excerpt";
  const stdout = JSON.stringify({
    ok: true,
    verb: "prepare",
    unexpected: `${"x".repeat(800)}${tail}`,
  });

  const error = assertThrows(
    () => decodeCliResult(stdout, "prepare"),
    Error,
  );
  assertStringIncludes(error.message, 'command "prepare"');
  assertStringIncludes(error.message, "Zod issues:");
  assertStringIncludes(error.message, "stdout excerpt:");
  assert(!error.message.includes(tail), error.message);
});

Deno.test("decodeCliResult contextualizes malformed JSON before schema validation", () => {
  const error = assertThrows(
    () => decodeCliResult('{"ok":', "prepare"),
    Error,
  );

  assertStringIncludes(error.message, 'command "prepare"');
  assertStringIncludes(error.message, "invalid JSON");
  assertStringIncludes(error.message, 'stdout excerpt: "{\\"ok\\":"');
});

Deno.test("decodeCliResult contextualizes an unregistered runtime command", () => {
  const command: string = "future verb";
  const error = assertThrows(
    () => decodeCliResult("{}", command),
    Error,
  );

  assertStringIncludes(error.message, 'command "future verb"');
  assertStringIncludes(error.message, "no registered CLI JSON result contract");
});

Deno.test("decodeWith validates non-envelope JSON and infers its output", () => {
  const fixtureSchema = z.strictObject({ count: z.number().int() });
  const fixture = decodeWith(fixtureSchema, '{"count":3}');

  const count: number = fixture.count;
  assertEquals(count, 3);
  assertThrows(
    () => decodeWith(fixtureSchema, '{"count":"three"}'),
    Error,
    "Zod issues",
  );
});
