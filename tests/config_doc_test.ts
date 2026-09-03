/**
 * Unit tests for the **discern config document** loader/validator
 * (`src/lib/config_doc.ts`) — the JSON shape behind `setup begin --config` and a
 * setup's declarative answers document.
 *
 * These pin the guard rails: refusing an unsupported major `version`, rejecting
 * non-object JSON, surfacing read/parse failures, and the per-section name and
 * shape validation in `applyConfigDoc` (unknown capability, bad check stage,
 * non-array scope paths, missing standard run, bad direction, and the
 * TOML-bare-key name rule). Expected error fragments are read from the source's
 * messages by hand.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  applyConfigDoc,
  assertSupportedVersion,
  CONFIG_DOC_FIELD_CONSUMERS,
  CONFIG_DOC_VERSION,
  configDocFillPaths,
  type DiscernConfigDoc,
  loadConfigDoc,
  mergeDocIntoFlags,
} from "../src/lib/config_doc.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  CONFIG_DOC_BOUNDED_SECTION_SCHEMAS,
  configDocSchema,
  parseConfig,
  parseConfigOrThrow,
  RECORD_ENTRY_SCHEMAS,
} from "../src/shared/config_schema.ts";
import { recordConfigPaths } from "../src/shared/config_codegen.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

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
      jobs: { lint: "deno lint" },
    };
    const path = await writeDoc(dir, doc);
    const loaded = await loadConfigDoc(path);
    assertEquals(loaded.name, "Demo");
    assertEquals(loaded.slug, "demo");
    assertEquals(loaded.jobs?.lint, "deno lint");
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
      `--config file \"${path}\" is not valid JSON`,
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
      `--config file \"${arr}\" is invalid: <root>`,
    );
    // A bare scalar is likewise refused.
    const scalar = join(dir, "scalar.json");
    await Deno.writeTextFile(scalar, "42");
    await assertRejectsErr(
      () => loadConfigDoc(scalar),
      `--config file \"${scalar}\" is invalid: <root>`,
    );
    // `null` parses to null — also not an object.
    const nul = join(dir, "null.json");
    await Deno.writeTextFile(nul, "null");
    await assertRejectsErr(
      () => loadConfigDoc(nul),
      `--config file \"${nul}\" is invalid: <root>`,
    );
  });
});

Deno.test("loadConfigDoc validates known fields at the source boundary", async () => {
  await withTempDir(async (dir) => {
    const path = await writeDoc(dir, {
      version: CONFIG_DOC_VERSION,
      branch_prefix: 42,
    });
    const error = await assertRejectsErr(
      () => loadConfigDoc(path),
      `--config file \"${path}\" is invalid`,
    );
    assert(error.message.includes("branch_prefix"));
  });
});

Deno.test("loadConfigDoc rejects unknown same-major fields at every depth", async () => {
  await withTempDir(async (dir) => {
    for (
      const unknown of [
        { future_root: { enabled: true } },
        { map: { dir: "project/guide/", future_layout: "wide" } },
        {
          scopes: {
            docs: { paths: ["docs/**"], future_selector: "changed" },
          },
        },
        { source_globs: ["src/**"] },
      ]
    ) {
      const path = await writeDoc(dir, {
        version: `${CONFIG_DOC_VERSION}.8`,
        ...unknown,
      });
      await assertRejectsErr(
        () => loadConfigDoc(path),
        `--config file \"${path}\" is invalid`,
      );
    }
  });
});

// ---- applyConfigDoc: happy path --------------------------------------------

Deno.test("applyConfigDoc writes map, jobs, scopes, generated groups and standards", () => {
  const ed = editor();
  applyConfigDoc(ed, {
    map: { dir: "docs/discern/" },
    jobs: {
      lint: "deno lint",
      test: ["deno test", "deno bench"], // array form: two commands
      selfcheck: { stage: "check", run: "make selfcheck", provides: "drift" },
    },
    scopes: {
      native: { paths: ["native/**"], gate: "make -C native check" },
      docs: { paths: ["docs/"], neutral: true },
    },
    generated: {
      reference: {
        paths: ["reference/**"],
        run: "tool write-reference",
        timeout: 120,
      },
    },
    standards: {
      coverage: {
        metric: "lines",
        direction: "down",
        limit: 80,
        run: "deno coverage",
      },
    },
  });
  const out = ed.toString();
  assert(out.includes('[map]\ndir = "docs/discern/"'));
  // Scalar and array known jobs.
  assert(out.includes('lint = "deno lint"'));
  assert(out.includes('["deno test", "deno bench"]'));
  // A custom job carries its stage, run and label — known jobs do not.
  assert(out.includes('stage = "check"'));
  assert(out.includes('run = "make selfcheck"'));
  assert(out.includes('provides = "drift"'));
  // A scope is a table with paths + folded-in gate, and a neutral flag.
  assert(out.includes('["native/**"]'));
  assert(out.includes('gate = "make -C native check"'));
  assert(out.includes("neutral = true"));
  // A generated group carries ownership, regeneration, and its time budget.
  assert(out.includes('["reference/**"]'));
  assert(out.includes('run = "tool write-reference"'));
  assert(out.includes("timeout = 120"));
  // A standard inlines its run.
  assert(out.includes('direction = "down"'));
  assert(out.includes("limit = 80"));
  assert(out.includes('run = "deno coverage"'));
});

Deno.test("applyConfigDoc writes TOML that re-parses to the intended config values", () => {
  const ed = editor();
  applyConfigDoc(ed, {
    map: { dir: "docs/discern/" },
    jobs: {
      lint: "deno lint --rules=\\d+",
      test: ["deno test", "echo trailing\\"],
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
    generated: {
      reference: {
        paths: ["reference\\win\\**", 'quote"/**', "unicode/é/**"],
        run: ["tool write-reference --filter=\\d+", "echo trailing\\"],
        timeout: 90,
      },
    },
    standards: {
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
  assertEquals(config.jobs.lint, "deno lint --rules=\\d+");
  assertEquals(config.jobs.test, ["deno test", "echo trailing\\"]);
  const quoted = config.jobs.quoted;
  assert(
    typeof quoted === "object" && quoted !== null && !Array.isArray(quoted),
  );
  assertEquals(quoted.run, 'grep "needle" src\\win\\**');
  assertEquals("provides" in quoted ? quoted.provides : undefined, "unicode-é");
  assertEquals(config.scopes.windows?.paths, [
    "src\\win\\**",
    'quote"/**',
    "unicode/é/**",
  ]);
  assertEquals(config.scopes.windows?.gate, ["echo \\d+", "echo trailing\\"]);
  assertEquals(config.generated.reference?.paths, [
    "reference\\win\\**",
    'quote"/**',
    "unicode/é/**",
  ]);
  assertEquals(config.generated.reference?.run, [
    "tool write-reference --filter=\\d+",
    "echo trailing\\",
  ]);
  assertEquals(config.generated.reference?.timeout, 90);
  assertEquals(config.standards.coverage?.run, "deno coverage --filter=\\d+");
});

const COMPLETE_RECORD_DOC = {
  jobs: {
    report: {
      stage: "check",
      run: ["tool report", "tool verify-report"],
      provides: "report integrity",
      timeout: 17,
    },
  },
  scopes: {
    application: {
      paths: ["src/**"],
      neutral: true,
      preview: ["tool preview", "tool preview-summary"],
      gate: "tool gate",
      timeout: 18,
    },
  },
  generated: {
    api: {
      paths: ["generated/**"],
      run: ["tool generate", "tool verify-generated"],
      linguist_generated: true,
      timeout: 19,
    },
  },
  standards: {
    density: {
      metric: "words",
      direction: "down",
      limit: 2.5,
      run: ["tool measure", "tool verify-measure"],
      per: { lines: ["src/**", "lib/**"] },
      scale: 1000,
      margin: 0.1,
      measure: "on-demand",
      inputs: ["src/**"],
      timeout: 20,
    },
  },
  checkpoints: {
    inline: {
      scope: "application",
      include_generated: true,
      exclude_paths: ["src/vendor/**"],
      unless_changed: ["docs/**"],
      kinds: ["added", "modified"],
      adds_matching: ["TODO"],
      removes_matching: ["FIXME"],
      new_directory: true,
      binary: false,
      min_changed_files: 2,
      min_changed_lines: 3,
      deletion_dominant: true,
      similar_new_file: true,
      min_commits: 2,
      when: "tool changed",
      mode: "advise",
      question: "Is this change coherent?",
      teach: "Keep one authority per fact.",
      reference: "project/map/README.md",
    },
    file: {
      paths: ["docs/**"],
      question_file: "docs/review.md",
    },
  },
  worktree: {
    resources: {
      database: {
        create: "tool database create",
        destroy: "tool database destroy",
        ensure: "tool database ensure",
        required: false,
        retries: 5,
        gc: false,
      },
    },
  },
} satisfies DiscernConfigDoc;

const RECORD_FAMILY_FIXTURES = {
  jobs: [COMPLETE_RECORD_DOC.jobs.report],
  scopes: [COMPLETE_RECORD_DOC.scopes.application],
  generated: [COMPLETE_RECORD_DOC.generated.api],
  standards: [COMPLETE_RECORD_DOC.standards.density],
  checkpoints: [
    COMPLETE_RECORD_DOC.checkpoints.inline,
    COMPLETE_RECORD_DOC.checkpoints.file,
  ],
  "worktree.resources": [COMPLETE_RECORD_DOC.worktree.resources.database],
} satisfies Record<
  keyof typeof RECORD_ENTRY_SCHEMAS,
  readonly Readonly<Record<string, unknown>>[]
>;

Deno.test("every named-record field round-trips through the setup document writer", () => {
  for (
    const family of Object.keys(RECORD_ENTRY_SCHEMAS) as Array<
      keyof typeof RECORD_ENTRY_SCHEMAS
    >
  ) {
    const exercised = new Set(
      RECORD_FAMILY_FIXTURES[family].flatMap((entry) => Object.keys(entry)),
    );
    assertEquals(
      [...exercised].toSorted(),
      Object.keys(RECORD_ENTRY_SCHEMAS[family].shape).toSorted(),
      `${family}: the fixture must exercise every schema field`,
    );
  }

  const ed = editor();
  const report = applyConfigDoc(ed, COMPLETE_RECORD_DOC);
  assertEquals(report.skipped, []);
  assertEquals(
    report.filled.toSorted(),
    configDocFillPaths(COMPLETE_RECORD_DOC).toSorted(),
  );
  const config = parseConfigOrThrow(ed.toString());
  assertEquals(config.jobs.report, COMPLETE_RECORD_DOC.jobs.report);
  assertEquals(
    config.scopes.application,
    COMPLETE_RECORD_DOC.scopes.application,
  );
  assertEquals(config.generated.api, COMPLETE_RECORD_DOC.generated.api);
  assertEquals(config.standards.density, COMPLETE_RECORD_DOC.standards.density);
  assertEquals(
    config.checkpoints.inline,
    COMPLETE_RECORD_DOC.checkpoints.inline,
  );
  assertEquals(config.checkpoints.file, COMPLETE_RECORD_DOC.checkpoints.file);
  assertEquals(
    config.worktree.resources.database,
    COMPLETE_RECORD_DOC.worktree.resources.database,
  );
});

Deno.test("applyConfigDoc materializes a bare built-in checkpoint table", () => {
  const ed = editor();
  const report = applyConfigDoc(ed, { checkpoints: { "map-focus": {} } });
  assertEquals(report, {
    filled: ["checkpoints.map-focus"],
    skipped: [],
  });
  assert(ed.toString().includes("[checkpoints.map-focus]"));
  assertEquals(parseConfigOrThrow(ed.toString()).checkpoints["map-focus"], {});
});

Deno.test("version 2 projects the exact bounded setup and worktree schemas", () => {
  assertEquals(CONFIG_DOC_VERSION, "2");
  assert(
    configDocSchema.shape.setup.unwrap() ===
      CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.setup,
  );
  assert(
    configDocSchema.shape.worktree.unwrap() ===
      CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.worktree,
  );
  for (const forbidden of ["project", "acceptance", "source_globs"]) {
    assert(!(forbidden in configDocSchema.shape), forbidden);
  }
  for (
    const flat of [
      "name",
      "slug",
      "branch_prefix",
      "brief",
      "agents",
    ]
  ) {
    assert(flat in configDocSchema.shape, flat);
  }

  const doc = {
    setup: { not_applicable: ["build"] },
    worktree: {
      root: "../worktrees",
      inherit_env: ["APP_KEY"],
      env_files: [".env.test"],
      port: true,
      ignored_file_drift: false,
      resources: {
        cache: {
          create: "tool cache create",
          destroy: "tool cache destroy",
          ensure: "tool cache ensure",
          required: false,
          retries: 3,
          gc: false,
        },
      },
      setup: {
        steps: ["tool seed"],
        ensure: ["tool converge"],
      },
    },
  } satisfies DiscernConfigDoc;
  const ed = editor();
  const report = applyConfigDoc(ed, doc);
  assertEquals(report.filled.toSorted(), configDocFillPaths(doc).toSorted());
  assertEquals(report.skipped, []);
  const config = parseConfigOrThrow(ed.toString());
  assertEquals(config.setup, doc.setup);
  assertEquals(config.worktree, doc.worktree);
});

Deno.test("every setup-document key declares its concrete consumer", () => {
  assertEquals(
    Object.keys(CONFIG_DOC_FIELD_CONSUMERS).toSorted(),
    Object.keys(configDocSchema.shape).toSorted(),
  );
  assertEquals(CONFIG_DOC_FIELD_CONSUMERS.$schema, "editor_schema");
  assertEquals(CONFIG_DOC_FIELD_CONSUMERS.version, "version_gate");
  const merged = mergeDocIntoFlags({}, {
    name: "Demo",
    slug: "demo",
    branch_prefix: "agent/",
    brief: "A demo.",
    agents: ["claude_code", "codex"],
    map: { dir: "docs/map/" },
  });
  assertEquals(merged, {
    name: "Demo",
    slug: "demo",
    branchPrefix: "agent/",
    brief: "A demo.",
    agents: "claude_code,codex",
    map: "docs/map/",
  });
  assertEquals(CONFIG_DOC_FIELD_CONSUMERS.map, "setup_input_and_config_fill");
  for (
    const section of [
      "jobs",
      "scopes",
      "generated",
      "standards",
      "checkpoints",
      "setup",
      "worktree",
    ] as const
  ) {
    assertEquals(CONFIG_DOC_FIELD_CONSUMERS[section], "config_fill");
  }
  assert(
    (configDocSchema.description ?? "").includes(
      "consumed only by `discern setup begin --config <file>`",
    ),
  );
  assert(!/\bpreset\b/i.test(configDocSchema.description ?? ""));
});

Deno.test("setup begin is the sole production config-document consumer", async () => {
  const files = await structuralGuardScope({
    guard: "tests/config_doc_test.ts#setup-document-consumer",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only production TypeScript can consume the setup document at runtime.",
      include: (rel) => rel.startsWith("src/"),
    },
  });
  const callers: string[] = [];
  for (const rel of files) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const match of text.matchAll(/\bloadConfigDoc\s*\(/g)) {
      const before = text.slice(Math.max(0, match.index - 32), match.index);
      if (!/function\s*$/.test(before)) callers.push(rel);
    }
  }
  assertEquals(callers, ["src/commands/setup.ts"]);
});

Deno.test("current product surfaces contain no source-glob setup input", async () => {
  const files = await structuralGuardScope({
    guard: "tests/config_doc_test.ts#removed-source-globs",
    universe: "authored-text",
    narrow: {
      reason:
        "Executable, generated, and current documentation surfaces define the live setup input contract; audit history does not.",
      include: (rel) =>
        rel.startsWith("src/") ||
        rel.startsWith("templates/") ||
        rel.startsWith("schema/") ||
        rel.startsWith("types/") ||
        rel.startsWith("project/manual/") ||
        (rel.startsWith("project/map/") && !rel.startsWith("project/map/_")),
    },
  });
  const forbidden =
    /sourceGlobs|source_globs|source-globs|scopes_web|Primary source globs/;
  const found: string[] = [];
  for (const rel of files) {
    if (forbidden.test(await Deno.readTextFile(join(REPO_ROOT, rel)))) {
      found.push(rel);
    }
  }
  assert(files.length > 100, "the current-surface scan must stay broad");
  assertEquals(found, []);
});

Deno.test("applyConfigDoc requires a standard's direction and defaults its metric", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        standards: {
          size: { limit: 500000, run: "measure-size" },
        },
      } as unknown as DiscernConfigDoc),
    Error,
    'standard "size": direction is required ("up" or "down")',
  );

  const ed = editor();
  applyConfigDoc(ed, {
    standards: {
      size: {
        direction: "down",
        limit: 500000,
        run: "measure-size",
      },
    },
  });
  const out = ed.toString();
  assert(out.includes('direction = "down"'));
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

// ---- applyConfigDoc: fill-if-absent (skipExisting) ---------------------------

/** A document exercising EVERY fill section the config-doc schema declares —
 * the fixture behind the class-level skip-existing guard below. */
const FULL_FILL_DOC: DiscernConfigDoc = {
  map: { dir: "docs/x/" },
  jobs: {
    lint: "deno lint",
    c1: { stage: "check", run: "run-c1" },
  },
  scopes: { s1: { paths: ["s1/**"] } },
  generated: {
    reference: { paths: ["reference/**"], run: "tool write-reference" },
  },
  standards: {
    r1: { direction: "up", limit: 1, run: "measure-r1" },
  },
  checkpoints: {
    k1: { paths: ["s1/**"], question: "The change is judged." },
  },
  setup: { not_applicable: ["build"] },
  worktree: {
    root: "../worktrees",
    resources: {
      r2: {
        create: "tool resource create",
        destroy: "tool resource destroy",
      },
    },
    setup: { steps: ["tool seed"] },
  },
};

/** The config-doc keys that are NOT discern.toml fills: install inputs and
 * document metadata, consumed by `mergeDocIntoFlags` / the loaders instead of
 * `applyConfigDoc`. A new schema key lands here or in FULL_FILL_DOC — the
 * forcing function below refuses anything unaccounted for. */
const NON_FILL_DOC_KEYS = new Set([
  "$schema",
  "version",
  "name",
  "slug",
  "branch_prefix",
  "brief",
  "agents",
]);

Deno.test("every fill section the config-doc schema declares is covered by the skip-existing guard", () => {
  // Driven off the schema (the single source of truth for the document shape):
  // a NEW fill section added to configDocSchema fails here until FULL_FILL_DOC
  // exercises it, which auto-enrols it in the never-overwrite test below.
  const fillKeys = Object.keys(configDocSchema.shape)
    .filter((k) => !NON_FILL_DOC_KEYS.has(k));
  for (const key of fillKeys) {
    assert(
      Object.hasOwn(FULL_FILL_DOC, key),
      `config-doc section "${key}" is missing from FULL_FILL_DOC — add it so skip-existing coverage includes it`,
    );
  }
  for (const key of Object.keys(FULL_FILL_DOC)) {
    assert(
      key in configDocSchema.shape,
      `FULL_FILL_DOC names "${key}", which the config-doc schema no longer declares`,
    );
  }
});

Deno.test("applyConfigDoc skipExisting never rewrites a present value, in ANY fill section", () => {
  // First pass fills a fresh config; a second pass over the same editor must
  // write nothing and report every path as kept — the whole class at once.
  const ed = editor();
  const first = applyConfigDoc(ed, FULL_FILL_DOC, { skipExisting: true });
  assertEquals(first.skipped, []);
  assert(first.filled.length > 0, "the first pass should fill every section");
  const after = ed.toString();

  const second = applyConfigDoc(ed, FULL_FILL_DOC, { skipExisting: true });
  assertEquals(ed.toString(), after, "a second pass must not rewrite anything");
  assertEquals(second.filled, []);
  assertEquals(second.skipped.toSorted(), first.filled.toSorted());
});

Deno.test("applyConfigDoc skipExisting keeps a user-authored value verbatim and reports it", () => {
  const ed = new TomlEditor(
    '[project]\nslug = "demo"\n\n[jobs]\n# the full suite, on purpose\ntest = "cargo test --workspace"\n',
  );
  const report = applyConfigDoc(
    ed,
    { jobs: { test: "cargo test" } },
    { skipExisting: true },
  );
  assertEquals(report.filled, []);
  assertEquals(report.skipped, ["jobs.test"]);
  const out = ed.toString();
  assert(out.includes('test = "cargo test --workspace"'));
  assert(out.includes("# the full suite, on purpose"));
  assert(!out.includes('test = "cargo test"\n'));
});

Deno.test("applyConfigDoc skipExisting still fills past a commented-out template hint", () => {
  // The scaffold ships known jobs commented out; a hint is not a value.
  const ed = new TomlEditor(
    '[project]\nslug = "demo"\n\n[jobs]\n# test = "npm test"\n',
  );
  const report = applyConfigDoc(
    ed,
    { jobs: { test: "pytest" } },
    { skipExisting: true },
  );
  assertEquals(report.filled, ["jobs.test"]);
  assert(ed.toString().includes('test = "pytest"'));
});

Deno.test("applyConfigDoc default mode still replaces (setup fills a fresh template)", () => {
  const ed = new TomlEditor('[map]\ndir = "docs"\n');
  const report = applyConfigDoc(ed, { map: { dir: "notes" } });
  assertEquals(report.filled, ["map.dir"]);
  assertEquals(report.skipped, []);
  assert(ed.toString().includes('dir = "notes"'));
});

// ---- applyConfigDoc: validation branches -----------------------------------

Deno.test("applyConfigDoc requires a table and stage for a custom name", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          jobs: { deploy: "deploy.sh" },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'custom job "deploy" must use the table form with stage and run',
  );
});

Deno.test("applyConfigDoc rejects a custom job with no stage or an unknown stage", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        { jobs: { x: { run: "y" } } } as unknown as DiscernConfigDoc,
      ),
    Error,
    'custom job "x": a stage is required',
  );
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          jobs: { x: { stage: "deploy", run: "y" } },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'custom job "x": unknown stage "deploy"',
  );
});

Deno.test("applyConfigDoc rejects a declared stage on a known job", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        jobs: { lint: { stage: "check", run: "other-lint ." } },
      }),
    Error,
    'known job "lint" derives stage "check" from its name; remove stage',
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

Deno.test("applyConfigDoc rejects malformed generated groups", () => {
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          generated: {
            reference: {
              paths: "reference/**" as unknown as string[],
              run: "tool reference",
            },
          },
        },
      ),
    Error,
    'generated group "reference": paths must be an array of globs',
  );
  for (const run of ["", []]) {
    assertThrows(
      () =>
        applyConfigDoc(editor(), {
          generated: {
            reference: { paths: ["reference/**"], run },
          },
        }),
      Error,
      'generated group "reference": run must contain at least one command',
    );
  }
});

Deno.test("applyConfigDoc rejects a standard with no run, and a bad direction", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        standards: {
          coverage: { direction: "up", limit: 1 } as unknown as {
            direction: "up";
            limit: number;
            run: string;
          },
        },
      }),
    Error,
    'standard "coverage": a run command is required',
  );
  assertThrows(
    () =>
      applyConfigDoc(
        editor(),
        {
          standards: {
            coverage: { direction: "sideways", limit: 1, run: "m" },
          },
        } as unknown as DiscernConfigDoc,
      ),
    Error,
    'standard "coverage": direction must be "up" or "down"',
  );
});

Deno.test("applyConfigDoc rejects a standard with no limit using the standard error style", () => {
  assertThrows(
    () =>
      applyConfigDoc(editor(), {
        standards: {
          coverage: { direction: "up", run: "measure" },
        },
      } as unknown as DiscernConfigDoc),
    Error,
    'standard "coverage": a limit is required',
  );
});

Deno.test("applyConfigDoc rejects a non-bare-key name in EVERY named-record section", () => {
  // Every named section funnels its <name> through the same NAME_RE guard
  // (assertName), and assertName runs first in each section loop — so a bad name
  // throws regardless of the rest of the spec. Derive the sections from the live
  // schema (recordConfigPaths) so a new open <name> table auto-enrols here.
  //
  const sections = recordConfigPaths();
  assert(
    sections.length >= 3,
    `expected at least checks/scopes/standards, got: ${sections.join(", ")}`,
  );

  for (const section of sections) {
    const doc = section === "worktree.resources"
      ? { worktree: { resources: { "bad name": {} } } }
      : { [section]: { "bad name": {} } };
    assertThrows(
      () =>
        applyConfigDoc(
          editor(),
          doc as unknown as DiscernConfigDoc,
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
): Promise<Error> {
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof Error, `expected a thrown Error; got ${thrown}`);
  assert(
    thrown.message.includes(fragment),
    `expected message to include "${fragment}"; got "${thrown.message}"`,
  );
  return thrown;
}
