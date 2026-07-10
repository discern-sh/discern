/**
 * Unit coverage for the NUL-record git decoders (`src/shared/git_paths.ts`) —
 * the single parser behind every `-z` invocation the
 * `tests/git_path_quoting_test.ts` guard enforces. The fixtures mirror real
 * `git status --porcelain=v1 -z` / `git diff --name-only -z` byte streams,
 * including the paths line-oriented output would have C-quoted.
 */

import { assertEquals } from "@std/assert";
import { parsePorcelainZ, splitNulRecords } from "../src/shared/git_paths.ts";

Deno.test("splitNulRecords: NUL-separated records, verbatim, empties dropped", () => {
  assertEquals(
    splitNulRecords('migrations/añadir.sql\0native/café.c\0quote"file.txt\0'),
    ["migrations/añadir.sql", "native/café.c", 'quote"file.txt'],
  );
  assertEquals(splitNulRecords(""), []);
  assertEquals(splitNulRecords("\0"), []);
  // No trimming: a path's own leading/trailing spaces survive.
  assertEquals(splitNulRecords(" spaced path \0"), [" spaced path "]);
});

Deno.test("parsePorcelainZ: plain entries keep status and verbatim path", () => {
  assertEquals(
    parsePorcelainZ(' M migrations/añadir.sql\0?? quote"file.txt\0'),
    [
      { status: " M", path: "migrations/añadir.sql" },
      { status: "??", path: 'quote"file.txt' },
    ],
  );
});

Deno.test("parsePorcelainZ: a rename's origin field is consumed, never an entry", () => {
  // -z renames are `XY <new>\0<orig>\0`: the origin must attach to its record,
  // not leak out as a phantom changed path (or inflate a dirty count).
  assertEquals(
    parsePorcelainZ("R  native/new café.c\0native/café.c\0 M other.ts\0"),
    [
      {
        status: "R ",
        path: "native/new café.c",
        origPath: "native/café.c",
      },
      { status: " M", path: "other.ts" },
    ],
  );
});

Deno.test("parsePorcelainZ: empty output and malformed records yield no entries", () => {
  assertEquals(parsePorcelainZ(""), []);
  assertEquals(parsePorcelainZ("\0"), []);
  assertEquals(parsePorcelainZ(" M \0"), []); // no path — never an entry
});
