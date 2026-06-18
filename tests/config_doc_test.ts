/**
 * Unit tests for the **icculus config document** loader/validator
 * (`src/lib/config_doc.ts`) — the JSON shape behind `init --config` and an
 * adapter's `adapter.json`.
 *
 * These pin the guard rails: refusing an unsupported major `version`, rejecting
 * non-object JSON, surfacing read/parse failures, and the per-section name and
 * shape validation in `applyConfigDoc` (bad slot phase, non-array scope value,
 * bad ratchet direction, and the TOML-bare-key name rule for every section).
 * Expected error fragments are read from the source's messages by hand.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  applyConfigDoc,
  assertSupportedVersion,
  CONFIG_DOC_VERSION,
  type IcculusConfigDoc,
  loadConfigDoc,
} from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { withTempDir } from "./helpers.ts";

/** A fresh editor over a minimal `[project]` config for apply-side tests. */
function editor(): TomlEditor {
  return new TomlEditor('[project]\nslug = "demo"\n');
}

/** Write `doc` as JSON to a temp file and return its path. */
async function writeDoc(dir: string, doc: unknown): Promise<string> {
  const path = join(dir, "doc.json");
  await Deno.writeTextFile(path, JSON.stringify(doc));
  return path;
}

// ---- assertSupportedVersion ------------------------------------------------

Deno.test("assertSupportedVersion accepts an absent, matching, or minor-bumped version", () => {
  // Absent → assumed current.
  assertSupportedVersion({});
  // Exact major as a string and as a number.
  assertSupportedVersion({ version: CONFIG_DOC_VERSION });
  assertSupportedVersion({ version: Number(CONFIG_DOC_VERSION) });
  // A minor within the same major is fine (only the major is compared).
  assertSupportedVersion({ version: `${CONFIG_DOC_VERSION}.7` });
});

Deno.test("assertSupportedVersion refuses an unknown major version", () => {
  const err = assertThrows(
    () => assertSupportedVersion({ version: "2" }),
    Error,
    "unsupported config-document version",
  );
  // The message names both the offending and the understood version.
  assert(err.message.includes('"2"'));
  assert(err.message.includes(`version ${CONFIG_DOC_VERSION}`));
});

Deno.test("assertSupportedVersion refuses a too-new numeric major", () => {
  assertThrows(
    () => assertSupportedVersion({ version: 99 }),
    Error,
    "unsupported config-document version",
  );
});

// ---- loadConfigDoc ---------------------------------------------------------

Deno.test("loadConfigDoc reads and returns a valid document", async () => {
  await withTempDir(async (dir) => {
    const doc: IcculusConfigDoc = {
      version: CONFIG_DOC_VERSION,
      name: "Demo",
      slug: "demo",
      agents: ["claude_code"],
      slots: { lint: { phase: "check", run: "deno lint" } },
    };
    const path = await writeDoc(dir, doc);
    const loaded = await loadConfigDoc(path);
    assertEquals(loaded.name, "Demo");
    assertEquals(loaded.slug, "demo");
    assertEquals(loaded.slots?.lint.run, "deno lint");
  });
});

Deno.test("loadConfigDoc refuses a document with an unsupported version", async () => {
  await withTempDir(async (dir) => {
    const path = await writeDoc(dir, { version: "2", name: "Future" });
    await assertRejectsErr(
      () => loadConfigDoc(path),
      "unsupported config-document version",
    );
  });
});

Deno.test("loadConfigDoc reports a missing --config file", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "absent.json");
    await assertRejectsErr(
      () => loadConfigDoc(missing),
      `could not read --config file "${missing}"`,
    );
  });
});

Deno.test("loadConfigDoc reports invalid JSON", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "bad.json");
    await Deno.writeTextFile(path, "{ not json ]");
    await assertRejectsErr(
      () => loadConfigDoc(path),
      "--config file is not valid JSON",
    );
  });
});

Deno.test("loadConfigDoc rejects a non-object top-level JSON value", async () => {
  await withTempDir(async (dir) => {
    // A JSON array parses fine but is not the object shape the document needs.
    const arr = join(dir, "arr.json");
    await Deno.writeTextFile(arr, "[1, 2, 3]");
    await assertRejectsErr(
      () => loadConfigDoc(arr),
      "--config file must be a JSON object",
    );
    // A bare scalar is likewise refused.
    const scalar = join(dir, "scalar.json");
    await Deno.writeTextFile(scalar, "42");
    await assertRejectsErr(
      () => loadConfigDoc(scalar),
      "--config file must be a JSON object",
    );
    // `null` parses to null — also not an object.
    const nul = join(dir, "null.json");
    await Deno.writeTextFile(nul, "null");
    await assertRejectsErr(
      () => loadConfigDoc(nul),
      "--config file must be a JSON object",
    );
  });
});

// ---- applyConfigDoc: happy path --------------------------------------------

Deno.test("applyConfigDoc writes slots, scopes, side gates and ratchets", () => {
  const ed = editor();
  applyConfigDoc(ed, {
    slots: {
      lint: { phase: "check", run: "deno lint" },
      cov: { run: "deno coverage" }, // measurement slot — no phase
    },
    scopes: { web: ["src/**", "app/**"] },
    side_gates: { web: "deno test" },
    ratchets: {
      coverage: { metric: "lines", direction: "down", limit: 80, slot: "cov" },
    },
  });
  const out = ed.toString();
  assert(out.includes('phase = "check"'));
  assert(out.includes('run = "deno lint"'));
  assert(out.includes('["src/**", "app/**"]'));
  assert(out.includes('direction = "down"'));
  assert(out.includes("limit = 80"));
  assert(out.includes('slot = "cov"'));
});

Deno.test("applyConfigDoc defaults a ratchet's direction and metric", () => {
  const ed = editor();
  // No direction → "up"; no metric → the ratchet name.
  applyConfigDoc(ed, { ratchets: { size: { limit: "500000" } } });
  const out = ed.toString();
  assert(out.includes('direction = "up"'));
  assert(out.includes('metric = "size"'));
  assert(out.includes("limit = 500000"));
});

Deno.test("applyConfigDoc on an empty document leaves the config untouched", () => {
  const ed = editor();
  const before = ed.toString();
  applyConfigDoc(ed, {});
  assertEquals(ed.toString(), before);
});

// ---- applyConfigDoc: validation branches -----------------------------------

Deno.test("applyConfigDoc rejects an unknown slot phase", () => {
  assertThrows(
    () => applyConfigDoc(editor(), { slots: { lint: { phase: "deploy" } } }),
    Error,
    'slot "lint": unknown phase "deploy"',
  );
});

Deno.test("applyConfigDoc rejects a non-array scope value", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        // A string where an array of globs is required.
        { scopes: { web: "src/**" as unknown as string[] } },
      ),
    Error,
    'scope "web": value must be an array of globs',
  );
});

Deno.test("applyConfigDoc rejects a bad ratchet direction", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        ratchets: { coverage: { direction: "sideways", limit: 1 } },
      }),
    Error,
    'ratchet "coverage": direction must be "up" or "down"',
  );
});

Deno.test("applyConfigDoc rejects names that are not TOML bare keys", () => {
  // Each section funnels its name through the same NAME_RE guard.
  assertThrows(
    () => applyConfigDoc(editor(), { slots: { "bad name": { run: "x" } } }),
    Error,
    "slot name must be letters, digits",
  );
  assertThrows(
    () => applyConfigDoc(editor(), { scopes: { "bad.scope": ["x"] } }),
    Error,
    "scope name must be letters, digits",
  );
  assertThrows(
    () => applyConfigDoc(editor(), { side_gates: { "bad/scope": "cmd" } }),
    Error,
    "side gate name must be letters, digits",
  );
  assertThrows(
    () => applyConfigDoc(editor(), { ratchets: { "bad name": { limit: 1 } } }),
    Error,
    "ratchet name must be letters, digits",
  );
});

/**
 * Assert an async thunk rejects with an Error whose message contains `fragment`.
 * (`@std/assert`'s `assertRejects` message-matching is awkward across versions,
 * so match the fragment explicitly.)
 */
async function assertRejectsErr(
  fn: () => Promise<unknown>,
  fragment: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof Error, `expected a thrown Error; got ${thrown}`);
  assert(
    (thrown as Error).message.includes(fragment),
    `expected message to include "${fragment}"; got "${
      (thrown as Error).message
    }"`,
  );
}
