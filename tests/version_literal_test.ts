/**
 * Guard against duplicating the package version in source. `deno.json` is the
 * single source; code imports `KIT_VERSION` from `src/lib/version.ts`.
 */

import { assert } from "@std/assert";
import { join, relative } from "@std/path";
import { KIT_VERSION } from "../src/lib/version.ts";

const REPO = new URL("../", import.meta.url).pathname;
const SRC = new URL("../src/", import.meta.url).pathname;

async function* tsFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* tsFiles(path);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

Deno.test("src does not hardcode the current package semver outside version.ts", async () => {
  const offenders: string[] = [];
  for await (const path of tsFiles(SRC)) {
    const rel = relative(REPO, path);
    // version.ts is the single source of discern's own version. The third-party
    // notices manifest legitimately lists external dependency versions (one of
    // which — json-schema-traverse@1.0.0 — currently coincides with discern's
    // own), so it is a manifest of OTHER software's versions, not a hardcode of
    // discern's.
    if (
      rel === "src/lib/version.ts" ||
      rel === "src/lib/third_party_notices.ts"
    ) {
      continue;
    }
    const text = await Deno.readTextFile(path);
    for (
      const quote of [
        `"${KIT_VERSION}"`,
        `'${KIT_VERSION}'`,
        `\`${KIT_VERSION}\``,
      ]
    ) {
      if (text.includes(quote)) {
        offenders.push(rel);
        break;
      }
    }
  }
  assert(
    offenders.length === 0,
    `source files must import KIT_VERSION instead of hardcoding ${KIT_VERSION}: ${
      offenders.join(", ")
    }`,
  );
});
