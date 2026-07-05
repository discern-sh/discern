/**
 * Unit tests for the **discern config document** loader/validator
 * (`src/lib/config_doc.ts`) — the JSON shape behind `setup --config` and a
 * preset's `preset.json`.
 *
 * These pin the guard rails: refusing an unsupported major `version`, rejecting
 * non-object JSON, surfacing read/parse failures, and the per-section name and
 * shape validation in `applyConfigDoc` (unknown capability, bad check stage,
 * non-array scope paths, missing ratchet run, bad direction, and the
 * TOML-bare-key name rule). Expected error fragments are read from the source's
 * messages by hand.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  applyConfigDoc,
  assertSupportedVersion,
  CONFIG_DOC_VERSION,
  type DiscernConfigDoc,
  loadConfigDoc,
} from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { parseConfig } from "../src/shared/config_schema.ts";
import { recordConfigPaths } from "../src/shared/config_codegen.ts";
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
    () => assertSupportedVersion({ version: "3" }),
    Error,
    "unsupported config-document version",
  );
  // The message names both the offending and the understood version.
  assert(err.message.includes('"3"'));
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
    const doc: DiscernConfigDoc = {
      version: CONFIG_DOC_VERSION,
      name: "Demo",
      slug: "demo",
      agents: ["claude_code"],
      capabilities: { lint: "deno lint" },
    };
    const path = await writeDoc(dir, doc);
    const loaded = await loadConfigDoc(path);
    assertEquals(loaded.name, "Demo");
    assertEquals(loaded.slug, "demo");
    assertEquals(loaded.capabilities?.lint, "deno lint");
  });
});

Deno.test("loadConfigDoc refuses a document with an unsupported version", async () => {
  await withTempDir(async (dir) => {
    const path = await writeDoc(dir, { version: "3", name: "Future" });
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

Deno.test("applyConfigDoc writes docs, capabilities, checks, scopes and ratchets", () => {
  const ed = editor();
  applyConfigDoc(ed, {
    docs: { dir: "docs/discern/" },
    capabilities: {
      lint: "deno lint",
      test: ["deno test", "deno bench"], // array form: two commands
    },
    checks: {
      selfcheck: { stage: "check", run: "make selfcheck", provides: "drift" },
    },
    scopes: {
      native: { paths: ["native/**"], gate: "make -C native check" },
      docs: { paths: ["docs/"], neutral: true },
    },
    ratchets: {
      coverage: {
        metric: "lines",
        direction: "down",
        limit: 80,
        run: "deno coverage",
      },
    },
  });
  const out = ed.toString();
  assert(out.includes('[docs]\ndir = "docs/discern/"'));
  // A scalar capability and an array capability.
  assert(out.includes('lint = "deno lint"'));
  assert(out.includes('["deno test", "deno bench"]'));
  // A check carries its stage, run and label — but no capability does.
  assert(out.includes('stage = "check"'));
  assert(out.includes('run = "make selfcheck"'));
  assert(out.includes('provides = "drift"'));
  // A scope is a table with paths + folded-in gate, and a neutral flag.
  assert(out.includes('["native/**"]'));
  assert(out.includes('gate = "make -C native check"'));
  assert(out.includes("neutral = true"));
  // A ratchet inlines its run.
  assert(out.includes('direction = "down"'));
  assert(out.includes("limit = 80"));
  assert(out.includes('run = "deno coverage"'));
});

Deno.test("applyConfigDoc writes TOML that re-parses to the intended config values", () => {
  const ed = editor();
  applyConfigDoc(ed, {
    docs: { dir: "docs/discern/" },
    capabilities: {
      lint: "deno lint --rules=\\d+",
      test: ["deno test", "echo trailing\\"],
    },
    checks: {
      quoted: {
        stage: "check",
        run: 'grep "needle" src\\win\\**',
        provides: "unicode-é",
      },
    },
    scopes: {
      windows: {
        paths: ["src\\win\\**", 'quote"/**', "unicode/é/**"],
        gate: ["echo \\d+", "echo trailing\\"],
      },
    },
    ratchets: {
      coverage: {
        metric: "lines",
        direction: "down",
        limit: 80,
        run: "deno coverage --filter=\\d+",
      },
    },
  });

  const { config, issues } = parseConfig(ed.toString());

  assertEquals(issues, []);
  assert(config !== undefined);
  assertEquals(config.capabilities.lint, "deno lint --rules=\\d+");
  assertEquals(config.capabilities.test, ["deno test", "echo trailing\\"]);
  assertEquals(config.checks.quoted?.run, 'grep "needle" src\\win\\**');
  assertEquals(config.checks.quoted?.provides, "unicode-é");
  assertEquals(config.scopes.windows?.paths, [
    "src\\win\\**",
    'quote"/**',
    "unicode/é/**",
  ]);
  assertEquals(config.scopes.windows?.gate, ["echo \\d+", "echo trailing\\"]);
  assertEquals(config.ratchets.coverage?.run, "deno coverage --filter=\\d+");
});

Deno.test("applyConfigDoc defaults a ratchet's direction and metric", () => {
  const ed = editor();
  // No direction → "up"; no metric → the ratchet name.
  applyConfigDoc(ed, {
    ratchets: { size: { limit: 500000, run: "measure-size" } },
  });
  const out = ed.toString();
  assert(out.includes('direction = "up"'));
  assert(out.includes('metric = "size"'));
  assert(out.includes("limit = 500000"));
  assert(out.includes('run = "measure-size"'));
});

Deno.test("applyConfigDoc on an empty document leaves the config untouched", () => {
  const ed = editor();
  const before = ed.toString();
  applyConfigDoc(ed, {});
  assertEquals(ed.toString(), before);
});

// ---- applyConfigDoc: validation branches -----------------------------------

Deno.test("applyConfigDoc rejects an unknown capability name", () => {
  // Deliberately malformed: a capability key outside the closed vocabulary. The
  // schema-derived type forbids it, so the test casts past it to exercise the
  // runtime guard's author-friendly message.
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          capabilities: { deploy: "deploy.sh" },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'unknown capability "deploy"',
  );
});

Deno.test("applyConfigDoc rejects a check with no stage or an unknown stage", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        { checks: { x: { run: "y" } } } as unknown as DiscernConfigDoc,
      ),
    Error,
    'check "x": a stage is required',
  );
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          checks: { x: { stage: "deploy", run: "y" } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'check "x": unknown stage "deploy"',
  );
});

Deno.test("applyConfigDoc rejects a non-array scope paths value", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        // A string where an array of globs is required.
        { scopes: { web: { paths: "src/**" as unknown as string[] } } },
      ),
    Error,
    'scope "web": paths must be an array of globs',
  );
});

Deno.test("applyConfigDoc rejects a ratchet with no run, and a bad direction", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        ratchets: {
          coverage: { limit: 1 } as unknown as {
            limit: number;
            run: string;
          },
        },
      }),
    Error,
    'ratchet "coverage": a run command is required',
  );
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          ratchets: { coverage: { direction: "sideways", limit: 1, run: "m" } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'ratchet "coverage": direction must be "up" or "down"',
  );
});

Deno.test("applyConfigDoc rejects a ratchet with no limit using the ratchet error style", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        ratchets: { coverage: { run: "measure" } },
      } as unknown as DiscernConfigDoc),
    Error,
    'ratchet "coverage": a limit is required',
  );
});

Deno.test("applyConfigDoc rejects a non-bare-key name in EVERY named-record section", () => {
  // Every named section funnels its <name> through the same NAME_RE guard
  // (assertName), and assertName runs first in each section loop — so a bad name
  // throws regardless of the rest of the spec. Derive the sections from the live
  // schema (recordConfigPaths) so a new open <name> table auto-enrols here.
  //
  // worktree.resources is a record table too, but applyConfigDoc doesn't own it (its
  // name is validated on the `config set-resource` path); an explicit, self-checking
  // exception rather than a silent omission.
  const APPLY_DOC_EXEMPT = new Set(["worktree.resources"]);
  const all = recordConfigPaths();
  for (const p of APPLY_DOC_EXEMPT) {
    assert(
      all.includes(p),
      `APPLY_DOC_EXEMPT lists "${p}", which is no longer a record section`,
    );
  }
  const sections = all.filter((p) => !APPLY_DOC_EXEMPT.has(p));
  assert(
    sections.length >= 3,
    `expected at least checks/scopes/ratchets, got: ${sections.join(", ")}`,
  );

  for (const section of sections) {
    assertThrows(
      () =>
        applyConfigDoc(
          editor(),
          { [section]: { "bad name": {} } } as unknown as DiscernConfigDoc,
        ),
      Error,
      "name must be letters, digits", // the shared NAME_RE message, kind-agnostic
      `${section}: a non-bare-key name must be rejected`,
    );
  }
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
