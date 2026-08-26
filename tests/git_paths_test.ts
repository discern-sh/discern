/**
 * Unit coverage for the NUL-record git decoders (`src/shared/git_paths.ts`) —
 * the single parser behind every `-z` invocation the
 * `tests/git_path_quoting_test.ts` guard enforces. The fixtures mirror real
 * `git status --porcelain=v1 -z` / `git diff --name-only -z` byte streams,
 * including the paths line-oriented output would have C-quoted.
 */

import { assertEquals } from "@std/assert";
import {
  parseCheckAttrZ,
  parsePorcelainZ,
  parseScopedGitConfigValueZ,
  splitNulRecords,
} from "../src/shared/git_paths.ts";

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

Deno.test("parseCheckAttrZ: NUL triples preserve spaces and newlines and distinguish every Git value", () => {
  assertEquals(
    parseCheckAttrZ(
      "generated/space file.txt\0merge\0discern-generated\0" +
        "generated/line\nbreak.txt\0merge\0unset\0" +
        "generated/plain.txt\0merge\0unspecified\0" +
        "generated/set.txt\0merge\0set\0",
    ),
    [
      {
        path: "generated/space file.txt",
        attribute: "merge",
        value: "discern-generated",
      },
      {
        path: "generated/line\nbreak.txt",
        attribute: "merge",
        value: "unset",
      },
      {
        path: "generated/plain.txt",
        attribute: "merge",
        value: "unspecified",
      },
      { path: "generated/set.txt", attribute: "merge", value: "set" },
    ],
  );
  assertEquals(parseCheckAttrZ("path\0merge\0value"), undefined);
  assertEquals(parseCheckAttrZ("path\0merge\0\0"), [
    { path: "path", attribute: "merge", value: "" },
  ]);
  assertEquals(parseCheckAttrZ("\0merge\0value\0"), undefined);
});

Deno.test("parseScopedGitConfigValueZ: effective config retains scope, origin, and value", () => {
  assertEquals(
    parseScopedGitConfigValueZ(
      "worktree\0file:/repo/.git/worktrees/topic/config.worktree\0true\0",
    ),
    {
      scope: "worktree",
      origin: "file:/repo/.git/worktrees/topic/config.worktree",
      value: "true",
    },
  );
  assertEquals(
    parseScopedGitConfigValueZ("local\0file:/repo/.git/config\0\0"),
    { scope: "local", origin: "file:/repo/.git/config", value: "" },
  );
  assertEquals(parseScopedGitConfigValueZ("local\0origin\0true"), undefined);
});
