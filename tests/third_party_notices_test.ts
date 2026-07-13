/**
 * Third-party notices GUARD — ties the hand-maintained notices manifest
 * (`src/lib/third_party_notices.ts`) to the dependency reality it describes, so
 * the bundled notices can never silently drift from what the binary embeds.
 *
 * Three ties:
 *  1. DRIFT — the committed `THIRD_PARTY_NOTICES` equals the render, so editing
 *     the manifest without regenerating (`deno task codegen`) fails the gate.
 *  2. VERSIONS — every listed component's version matches what `deno.lock`
 *     resolves, so a dependency bump forces the notices (and any changed
 *     copyright year) to be refreshed.
 *  3. COVERAGE — every third-party package `src/` actually imports appears in the
 *     manifest, so adding a new dependency fails the gate until it is credited.
 *
 * When a tie fails, the fix is to update the manifest and run `deno task codegen`
 * — never to weaken the assertion.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  renderThirdPartyNotices,
  THIRD_PARTY_COMPONENTS,
} from "../src/lib/third_party_notices.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const manifestNames = new Set(THIRD_PARTY_COMPONENTS.map((c) => c.name));

Deno.test("committed THIRD_PARTY_NOTICES matches the manifest render", async () => {
  const committed = await Deno.readTextFile(
    join(repoRoot, "THIRD_PARTY_NOTICES"),
  );
  assertEquals(
    committed,
    renderThirdPartyNotices(),
    "THIRD_PARTY_NOTICES is stale — regenerate it with `deno task codegen` and commit the result",
  );
});

Deno.test("every embedded component's version matches deno.lock", async () => {
  const lock = JSON.parse(
    await Deno.readTextFile(join(repoRoot, "deno.lock")),
  ) as { jsr?: Record<string, unknown>; npm?: Record<string, unknown> };

  // name -> the set of versions deno.lock resolved for it (a package can appear
  // at more than one version across the workspace).
  const resolved = new Map<string, Set<string>>();
  const record = (key: string): void => {
    const bare = key.split("_")[0] ?? key; // drop the npm peer suffix
    const at = bare.lastIndexOf("@");
    if (at <= 0) return; // no version, or a leading-@ scope with no version
    const name = bare.slice(0, at);
    const version = bare.slice(at + 1);
    const set = resolved.get(name) ?? new Set<string>();
    set.add(version);
    resolved.set(name, set);
  };
  for (const key of Object.keys(lock.jsr ?? {})) record(key);
  for (const key of Object.keys(lock.npm ?? {})) record(key);

  for (const c of THIRD_PARTY_COMPONENTS) {
    const have = resolved.get(c.name);
    assert(
      have !== undefined,
      `${c.name} is in the notices manifest but is not resolved in deno.lock`,
    );
    assert(
      have.has(c.version),
      `${c.name}@${c.version} does not match deno.lock (resolved: ${
        [...have].join(", ")
      }) — update src/lib/third_party_notices.ts and run \`deno task codegen\``,
    );
  }
});

Deno.test("every third-party package imported by src/ is credited in the notices", async () => {
  // The dependency families whose packages are embedded and must be credited.
  const FAMILIES = ["@std/", "@cliffy/", "@zod/", "@modelcontextprotocol/"];
  const IMPORT_RE = /from\s*["']([^"']+)["']/g;

  const imported = new Set<string>();
  for await (const entry of walk(join(repoRoot, "src"))) {
    if (!entry.isFile || !entry.path.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(entry.path);
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec === undefined || !FAMILIES.some((f) => spec.startsWith(f))) {
        continue;
      }
      const [scope, name] = spec.split("/");
      if (scope === undefined || name === undefined) continue;
      imported.add(`${scope}/${name}`);
    }
  }

  assert(
    imported.size > 0,
    "no third-party imports found under src/ — the scan is broken, not the manifest",
  );
  for (const pkg of imported) {
    assert(
      manifestNames.has(pkg),
      `src/ imports "${pkg}" but it is missing from THIRD_PARTY_COMPONENTS — ` +
        "add it to src/lib/third_party_notices.ts and run `deno task codegen`",
    );
  }
});
