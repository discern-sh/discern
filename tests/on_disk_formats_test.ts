/** Guards for the complete local durable-format registry. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { GIT_ADMIN_STATE_KEYS } from "../src/shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  inspectOnDiskVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
  type OnDiskFormatKey,
  UNVERSIONED_GIT_ADMIN_STATE,
} from "../src/shared/on_disk_formats.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

const FORMAT_KEYS = Object.keys(ON_DISK_FORMATS) as OnDiskFormatKey[];
const JsonObjectFixtureSchema = z.record(z.string(), z.unknown());

Deno.test("every local durable format has one complete unique contract", async () => {
  const ids = new Set<string>();
  for (const key of FORMAT_KEYS) {
    const format = ON_DISK_FORMATS[key];
    assert(/^[a-z][a-z0-9-]*$/u.test(format.id), format.id);
    assert(!ids.has(format.id), `duplicate on-disk format id ${format.id}`);
    ids.add(format.id);
    assert(Number.isInteger(format.version) && format.version > 0, format.id);
    assert(format.reader.trim() !== "", `${format.id} needs a reader`);
    if (format.reader.startsWith("src/")) {
      const readerPath = format.reader.split("#", 1)[0];
      assert(readerPath !== undefined);
      assert(
        (await Deno.stat(join(REPO_ROOT, readerPath))).isFile,
        `${format.id} reader does not exist: ${readerPath}`,
      );
    }
    assert(format.writers.length > 0, `${format.id} needs a writer`);
    for (const writer of format.writers) {
      assert(
        (await Deno.stat(join(REPO_ROOT, writer))).isFile,
        `${format.id} writer does not exist: ${writer}`,
      );
    }
    if (format.location.kind === "git-admin") {
      assert(format.location.keys.length > 0, `${format.id} has no location`);
    } else {
      assert(
        format.location.ref.startsWith("refs/"),
        `${format.id} has an invalid note ref`,
      );
    }
  }
});

Deno.test("every Git-admin coordinate is a versioned format or a reasoned non-format", () => {
  const claimed = new Set<string>(
    FORMAT_KEYS.flatMap((key) => {
      const location = ON_DISK_FORMATS[key].location;
      return location.kind === "git-admin" ? location.keys : [];
    }),
  );
  const exempt = new Set<string>(Object.keys(UNVERSIONED_GIT_ADMIN_STATE));
  assertEquals(
    GIT_ADMIN_STATE_KEYS.filter((key) => !claimed.has(key) && !exempt.has(key)),
    [],
    "register the durable format or explain why the coordinate is not a document",
  );
  assertEquals(
    GIT_ADMIN_STATE_KEYS.filter((key) => claimed.has(key) && exempt.has(key)),
    [],
    "a coordinate cannot be both a versioned format and a non-format",
  );
  for (const [key, reason] of Object.entries(UNVERSIONED_GIT_ADMIN_STATE)) {
    assert(reason.trim().length >= 20, `${key} needs a precise exemption`);
  }
});

Deno.test("the registry classifies every forward version and names recovery", () => {
  for (const key of FORMAT_KEYS) {
    const format = ON_DISK_FORMATS[key];
    assertEquals(inspectOnDiskVersion(key, format.version), {
      status: "current",
    });
    assertEquals(inspectOnDiskVersion(key, format.version + 1), {
      status: "newer",
      found: format.version + 1,
    });
    const message = newerOnDiskFormatMessage(key, format.version + 1);
    assertStringIncludes(message, format.id);
    assertStringIncludes(message, "written by a newer discern");
    assertStringIncludes(message, "Update discern");
  }
});

/** Render the smallest record that carries one format's future version. */
function futureVersionFixture(key: OnDiskFormatKey): string {
  const format = ON_DISK_FORMATS[key];
  const future = format.version + 1;
  if (format.versionField === "header") {
    return `discern crash report format ${future}\n`;
  }
  if (format.versionField === "payloadType") {
    return JSON.stringify({
      payloadType:
        `https://discern.sh/schema/v${future}/discern-proof-note.schema.json#proof-note`,
    });
  }
  return JSON.stringify({ [format.versionField]: future });
}

Deno.test("every registered format recognizes its future version from disk", async () => {
  await withTempDir(async (dir) => {
    for (const key of FORMAT_KEYS) {
      const format = ON_DISK_FORMATS[key];
      const path = join(dir, `${key}.record`);
      await Deno.writeTextFile(path, futureVersionFixture(key));
      const raw = await Deno.readTextFile(path);
      const value = format.versionField === "header"
        ? raw
        : decodeWith(JsonObjectFixtureSchema, raw);
      assertEquals(inspectOnDiskRecordVersion(key, value), {
        status: "newer",
        found: format.version + 1,
      });
      assert(
        format.newerVersionPolicy === "refuse" ||
          format.newerVersionPolicy === "observe",
        `${format.id} needs a forward-version policy`,
      );
    }
  });
});

Deno.test("every format writer consumes its registry version", async () => {
  const offenders: string[] = [];
  for (const key of FORMAT_KEYS) {
    const format = ON_DISK_FORMATS[key];
    const sources = await Promise.all(
      format.writers.map((writer) =>
        Deno.readTextFile(join(REPO_ROOT, writer))
      ),
    );
    if (
      !sources.some((source) =>
        source.includes(`ON_DISK_FORMATS.${key}.version`)
      )
    ) {
      offenders.push(format.id);
    }
  }
  assertEquals(
    offenders,
    [],
    "every durable writer must consume its ON_DISK_FORMATS version",
  );
});

/** The source patterns that silently fork a local format version. */
const INLINE_FORMAT_VERSION =
  /\b(?:schema_version\s*:\s*[0-9]+|(?:schema|version)\s*:\s*z\.literal\(\s*[0-9]+)/gu;

Deno.test("authored TypeScript does not inline a durable format version", async () => {
  const writerFiles = new Set<string>(
    FORMAT_KEYS.flatMap((key) => ON_DISK_FORMATS[key].writers),
  );
  const files = await structuralGuardScope({
    guard: "tests/on_disk_formats_test.ts#inline-format-versions",
    universe: "authored-ts",
    narrow: {
      reason:
        "durable format versions are emitted only by registered writer modules",
      include: (file) => writerFiles.has(file),
    },
  }, REPO_ROOT);
  const offenders: string[] = [];
  for (const file of files) {
    if (file === "src/shared/on_disk_formats.ts") continue;
    const source = await Deno.readTextFile(join(REPO_ROOT, file));
    for (const match of source.matchAll(INLINE_FORMAT_VERSION)) {
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${file}:${line}:${match[0]}`);
    }
  }
  assertEquals(
    offenders,
    [],
    "route durable schema versions through ON_DISK_FORMATS",
  );
});
