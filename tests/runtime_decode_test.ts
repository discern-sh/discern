import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { z } from "@zod/zod";
import { decodeJson, decodeUnknown } from "../src/shared/runtime_decode.ts";

const fixtureSchema = z.object({
  rows: z.array(z.object({ name: z.string() })),
});

Deno.test("decodeJson returns only schema-validated data", () => {
  assertEquals(
    decodeJson(fixtureSchema, '{"rows":[{"name":"ready"}]}', "fixture.json"),
    { rows: [{ name: "ready" }] },
  );
});

Deno.test("runtime decoders name syntax and schema sources", () => {
  const syntax = assertThrows(
    () => decodeJson(fixtureSchema, "{", "broken report"),
    Error,
  );
  assertStringIncludes(syntax.message, "broken report is not valid JSON");

  const shape = assertThrows(
    () => decodeUnknown(fixtureSchema, { rows: [{ name: 7 }] }, "tool output"),
    Error,
  );
  assertStringIncludes(shape.message, "tool output is invalid");
  assertStringIncludes(shape.message, "rows.0.name");
});

Deno.test("runtime decoder errors cap issue detail", () => {
  const manyRows = {
    rows: Array.from({ length: 20 }, (_, index) => ({ name: index })),
  };
  const error = assertThrows(
    () => decodeUnknown(fixtureSchema, manyRows, "large response"),
    Error,
  );
  assertStringIncludes(error.message, "15 more issues");
  assertEquals(error.message.length < 1200, true);
});
