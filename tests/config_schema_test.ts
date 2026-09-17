import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { z } from "@zod/zod";
import {
  AGENT_NAMES,
  configDocRuntimeSchema,
  ConfigParseError,
  configSchema,
  configSchemaIssues,
  ConfigValidationError,
  configWriteIssues,
  DEFAULT_AGENTS,
  EXTENTS,
  isSettableConfigPath,
  NAME_RE,
  parseConfig,
  parseConfigOrThrow,
  parseGoverningConfig,
  projectDisplayName,
  RECORD_ENTRY_SCHEMAS,
  resolveConfiguredAgents,
  settableConfigValueKind,
  toCommand,
  toCommandList,
} from "../src/shared/config_schema.ts";
import {
  DEAD_CONFIG_POSITIONS,
  deadConfigPosition,
  RETIRED_CONFIG_KEY_REDIRECTS,
} from "../src/shared/vocabulary.ts";
import {
  KNOWN_JOBS,
  SLUG_PATTERN,
  STAGES,
} from "../src/shared/capabilities.ts";
import { KNOWN_AGENTS } from "../src/lib/config.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";

// ── defaults ───────────────────────────────────────────────────────────────────

Deno.test("an empty config validates to a fully-defaulted object", () => {
  const c = parseConfigOrThrow("");
  assertEquals(c.repository.trunk, "main");
  assertEquals(c.repository.branch_prefix, "agent/");
  assertEquals(c.repository.ensure, []);
  assertEquals(c.project.name, "");
  assertEquals(c.project.slug, "");
  assertEquals(c.project.gotchas_doc, "");
  // The path defaults are the registry's (ADR 0102) — asserted against it, so
  // the schema can never drift from the one source of truth.
  assertEquals(c.skills.dir, SOURCE_PATHS.skills.defaultPath);
  assertEquals(c.map.dir, SOURCE_PATHS.map.defaultPath);
  assertEquals(c.scripts.dir, SOURCE_PATHS.scripts.defaultPath);
  assertEquals(c.instructions.sources, [SOURCE_PATHS.instructions.defaultPath]);
  assertEquals(c.project.todo, SOURCE_PATHS.todo.defaultPath);
  // `agents` is OPTIONAL (no default): an absent key stays undefined so the
  // resolver can tell "unset" (→ default pair) from an explicit `[]` (→ no agents).
  assertEquals(c.project.agents, undefined);
  assertEquals(c.meta.bootstrapped, false);
  // records default to empty
  assertEquals(c.jobs, {});
  assertEquals(c.scopes, {});
  assertEquals(c.generated, {});
  assertEquals(c.acceptance.pre_authorized, []);
  assertEquals(c.standards, {});
  assertEquals(c.worktree.resources, {});
  assertEquals(c.worktree.setup.steps, []);
  assertEquals(c.worktree.setup.ensure, []);
  assertEquals(c.worktree.root, "");
  assertEquals(c.worktree.inherit_env, []);
  assertEquals(c.worktree.env_files, [".env", ".env.local"]);
  assertEquals(c.worktree.track_ignored_drift, true);
  assertEquals(c.worktree.export_port, false);
  assertEquals(c.coupling.report_in_gate, true);
});

Deno.test("an [mcp] table is not part of project config", () => {
  const result = parseConfig("[mcp]\nalways_load = true\n");
  assertEquals(result.config, undefined);
  assert(result.issues.some((issue) => issue.path === "mcp"));
});

Deno.test("projectDisplayName: [project].name, else the slug verbatim, else a neutral stand-in", () => {
  const named = parseConfigOrThrow(
    '[project]\nname = "ListOfListsOfLists"\nslug = "listoflistsoflists"\n',
  );
  assertEquals(projectDisplayName(named), "ListOfListsOfLists");
  // The slug is never re-cased into a fabricated title.
  const slugOnly = parseConfigOrThrow('[project]\nslug = "my-app"\n');
  assertEquals(projectDisplayName(slugOnly), "my-app");
  // Whitespace-only display text and the canonical empty slug count as unset.
  const blank = parseConfigOrThrow('[project]\nname = " "\nslug = ""\n');
  assertEquals(projectDisplayName(blank), "this project");
  assertEquals(projectDisplayName(parseConfigOrThrow("")), "this project");
});

Deno.test("live and setup-document slugs share the canonical slug rule", () => {
  const valid = ["a", "my-app", "2048"];
  const invalid = ["Bad", "bad slug", "-leading", "under_score"];
  assert(parseConfig('[project]\nslug = ""\n').config);
  assert(configDocRuntimeSchema.safeParse({}).success);
  assertEquals(configDocRuntimeSchema.safeParse({ slug: "" }).success, false);
  for (const slug of valid) {
    assert(SLUG_PATTERN.test(slug));
    assert(parseConfig(`[project]\nslug = ${JSON.stringify(slug)}\n`).config);
    assert(configDocRuntimeSchema.safeParse({ slug }).success);
  }
  for (const slug of invalid) {
    assert(!SLUG_PATTERN.test(slug));
    const live = parseConfig(`[project]\nslug = ${JSON.stringify(slug)}\n`);
    assertEquals(live.config, undefined);
    assert(
      live.issues.some((issue) =>
        issue.path === "project.slug" && issue.message.includes("slug must be")
      ),
      JSON.stringify(live.issues),
    );
    assertEquals(configDocRuntimeSchema.safeParse({ slug }).success, false);
  }
});

Deno.test("completed installs require explicit valid schema metadata", () => {
  assert(parseConfig("[meta]\nbootstrapped = false\n").config);
  const missing = parseConfig("[meta]\nbootstrapped = true\n");
  assertEquals(missing.config, undefined);
  assert(
    missing.issues.some((issue) => issue.path === "meta.schema_version"),
    JSON.stringify(missing.issues),
  );
  for (const value of ["0", "1.5", '"one"']) {
    const invalid = parseConfig(`[meta]\nschema_version = ${value}\n`);
    assertEquals(invalid.config, undefined, value);
    assert(
      invalid.issues.some((issue) => issue.path === "meta.schema_version"),
      `${value}: ${JSON.stringify(invalid.issues)}`,
    );
  }
  const complete = parseConfigOrThrow(
    `[meta]\nschema_version = ${SCHEMA_VERSION}\nbootstrapped = true\nsetup_completion = "proven"\n`,
  );
  assertEquals(complete.meta.setup_completion, "proven");
  assertEquals(
    parseConfig('[meta]\nsetup_completion = "unknown"\n').config,
    undefined,
  );
});

Deno.test("config-only setup applicability has no assurance alias", () => {
  assertEquals(
    parseConfigOrThrow('[setup]\nnot_applicable = ["build"]\n').setup
      .not_applicable,
    ["build"],
  );
  const retired = parseConfig('[assurance]\nnot_applicable = ["build"]\n');
  assertEquals(retired.config, undefined);
  assert(
    retired.issues.some((issue) =>
      issue.kind === "unknown_root_section" && issue.path === "assurance"
    ),
    JSON.stringify(retired.issues),
  );
});

Deno.test("launch numeric bounds reject fractions and out-of-range values", () => {
  for (const value of ["0", "5"]) {
    assert(
      parseConfig(`[worktree.resources.db]\nretries = ${value}\n`).config,
      value,
    );
  }
  for (const value of ["-1", "2.5", "6"]) {
    assertEquals(
      parseConfig(`[worktree.resources.db]\nretries = ${value}\n`).config,
      undefined,
      value,
    );
  }
  for (const value of ["0", "600"]) {
    assert(parseConfig(`[gate]\ntimeout = ${value}\n`).config, value);
  }
  for (const value of ["-1", "0.5"]) {
    assertEquals(
      parseConfig(`[gate]\ntimeout = ${value}\n`).config,
      undefined,
      value,
    );
  }
});

Deno.test("Proof-note mode is exactly local or fetch, and both load", () => {
  for (const mode of ["local", "fetch"]) {
    assertEquals(
      parseConfigOrThrow(`[repository]\nproof_notes = "${mode}"\n`)
        .repository.proof_notes,
      mode,
    );
  }
  assertEquals(
    parseConfig('[repository]\nproof_notes = "off"\n').config,
    undefined,
  );
});

Deno.test("repository owns the trunk, branch prefix, and shared convergence commands", () => {
  const config = parseConfigOrThrow([
    "[repository]",
    'trunk = "stable"',
    'branch_prefix = "change/"',
    'ensure = ["npm install", "make generated"]',
    "",
  ].join("\n"));
  assertEquals(config.repository, {
    trunk: "stable",
    branch_prefix: "change/",
    proof_notes: "local",
    ensure: ["npm install", "make generated"],
  });
});

Deno.test("current configs reject settings whose section home moved", () => {
  // The class: keys living under a section that is not their canonical home —
  // repository policy moved out of [project], and `agents` is project identity,
  // not a [instructions] setting. No epitaph row and no fallback: no public install
  // ever wrote these, so plain unknown-key rejection is the whole contract
  // (the public-baseline reset's reasoning).
  const moved = [
    ["project", "main_branch"],
    ["project", "branch_prefix"],
    ["instructions", "agents"],
  ] as const;
  for (const [section, key] of moved) {
    const { config, issues } = parseConfig(
      `[${section}]\n${key} = "legacy"\n`,
    );
    assertEquals(config, undefined);
    assert(
      issues.some((issue) => issue.path === `${section}.${key}`),
      JSON.stringify(issues),
    );
  }
});

Deno.test("every retired top-level key is redirected to its successor", () => {
  // Driven off the redirect table itself: a newly retired key enrols by being
  // added there. Doubles as a collision guard — if a retired name is ever
  // reintroduced as a live key, its config parses and this fails.
  for (
    const [retired, successor] of Object.entries(RETIRED_CONFIG_KEY_REDIRECTS)
  ) {
    const { config, issues } = parseConfig(`[${retired}.entry]\nvalue = 1\n`);
    assertEquals(config, undefined, `[${retired}] should be rejected`);
    assertEquals(issues.length, 1, JSON.stringify(issues));
    assertEquals(issues[0]?.path, retired);
    const message = issues[0]?.message ?? "";
    assertStringIncludes(message, `[${successor}]`);
    assert(
      !/(?:upgrade|renam|retir|became)/i.test(message),
      `current config recovery must describe only the current contract: ${message}`,
    );
  }
});

Deno.test("every registered dead config position refuses its exact section with the registered recovery", () => {
  assert(
    DEAD_CONFIG_POSITIONS.length > 0,
    "rows exist only while an actual migration needs a targeted refusal",
  );
  for (const position of DEAD_CONFIG_POSITIONS) {
    assertEquals(position.path, "", "launch dead positions are root sections");
    const key = position.key;
    assert(key !== undefined, "a root dead position names its key");
    const parsed = parseConfig(position.example);
    assertEquals(parsed.config, undefined, key);
    const issue = parsed.issues.find((entry) =>
      entry.path === key || entry.path.startsWith(`${key}.`)
    );
    assert(issue !== undefined, JSON.stringify(parsed.issues));
    assertEquals(issue.message, position.message(key));
    assert(
      !/(?:upgrade|renam|became)/i.test(issue.message),
      `dead-position recovery must describe only the current contract: ${issue.message}`,
    );
  }
});

Deno.test("a governing document carrying every registered dead section still governs through its valid remainder", () => {
  // The class guard for config retirements: a committed trunk config written
  // before a retirement must keep governing standards and checkpoints, while
  // the same text stays loudly refused as a live project config. Driven off
  // the registry, so a future dead position enrols automatically.
  const document = [
    'project.name = "governed"',
    "[standards.sample]",
    'direction = "down"',
    "limit = 5",
    'run = "echo 5"',
    ...DEAD_CONFIG_POSITIONS.map((position) => position.example),
  ].join("\n");
  assertEquals(parseConfig(document).config, undefined, "live parse refuses");
  const governed = parseGoverningConfig(document).config;
  assert(governed !== undefined, "the governing parse reads the remainder");
  assertEquals(governed.project.name, "governed");
  assertEquals(governed.standards["sample"]?.limit, 5);
});

Deno.test("governing reads strip and report every unrecognized key while live reads stay strict", () => {
  const document = [
    "future_root = true",
    "",
    "[worktree]",
    "future_toggle = true",
    "",
    "[worktree.resources.db]",
    'create = "true"',
    'future_attribute = "value"',
    "",
    "[scopes.docs]",
    'paths = ["docs/**"]',
    'future_attribute = "value"',
    "",
  ].join("\n");

  assertEquals(parseConfig(document).config, undefined, "live parse refuses");
  const governed = parseGoverningConfig(document);
  assert(governed.config !== undefined, JSON.stringify(governed.issues));
  assertEquals([...governed.ignoredKeyPaths].sort(), [
    "future_root",
    "scopes.docs.future_attribute",
    "worktree.future_toggle",
    "worktree.resources.db.future_attribute",
  ]);
  assertEquals(governed.config.scopes.docs?.paths, ["docs/**"]);
  assertEquals(governed.config.worktree.resources.db?.create, "true");
});

Deno.test("a governing path-key redirect preserves checkpoint selectors and generated ownership", () => {
  const document = (mapKey: string): string =>
    [
      "[map]",
      `${mapKey} = "project/map"`,
      "",
      "[instructions]",
      'sources = ["${map.dir}instructions/*.md"]',
      "",
      "[scopes.docs]",
      'paths = ["${map.dir}docs/**"]',
      "",
      "[generated.reference]",
      'paths = ["${map.dir}generated/**"]',
      'run = "true"',
      "",
      "[checkpoints.instruction-economy]",
      "",
      "[checkpoints.docs-review]",
      'scope = "docs"',
      'question = "Review the governed map."',
      "",
    ].join("\n");
  const current = parseGoverningConfig(document("dir"));
  const redirected = parseGoverningConfig(
    document("old_dir"),
    (path) => path === "map.old_dir" ? "map.dir" : undefined,
  );
  assert(current.config !== undefined, JSON.stringify(current.issues));
  assert(redirected.config !== undefined, JSON.stringify(redirected.issues));
  assertEquals(redirected.ignoredKeyPaths, []);
  assertEquals(
    resolveCheckpoints(redirected.config),
    resolveCheckpoints(current.config),
  );
  assertEquals(
    resolveGeneratedGroups(redirected.config),
    resolveGeneratedGroups(current.config),
  );
});

Deno.test("dead-position matching: keyed rows win over a same-path wildcard, in table order", () => {
  // Synthetic control for the matcher the schema translator uses, proving the
  // semantics a future row will inherit without touching the shipped table.
  const table = [
    { path: "area", key: "old", message: (): string => "keyed", example: "" },
    { path: "area", message: (): string => "wildcard", example: "" },
    { path: "", key: "gone", message: (): string => "root", example: "" },
  ];
  assertEquals(
    deadConfigPosition("area", ["old"], table)?.message(""),
    "keyed",
  );
  assertEquals(
    deadConfigPosition("area", ["anything"], table)?.message(""),
    "wildcard",
  );
  assertEquals(deadConfigPosition("", ["gone"], table)?.message(""), "root");
  assertEquals(deadConfigPosition("", ["other"], table), undefined);
  assertEquals(deadConfigPosition("elsewhere", ["old"], table), undefined);
});

Deno.test("gate.fail_fast defaults ON; gate.stream_output defaults OFF", () => {
  const c = parseConfigOrThrow("");
  assertEquals(c.gate.fail_fast, true);
  assertEquals(c.gate.stream_output, false);
  assertEquals(c.gate.concurrent_test_runs, 1);
  const off = parseConfigOrThrow("[gate]\nfail_fast = false\n");
  assertEquals(off.gate.fail_fast, false);
  assertEquals(
    parseConfigOrThrow("[gate]\nconcurrent_test_runs = 0\n").gate
      .concurrent_test_runs,
    0,
  );
});

Deno.test("worktree resource defaults: required/prunable default true, retries 0, commands empty", () => {
  const c = parseConfigOrThrow(
    `[worktree.resources.db]\ncreate = "make-db"\n`,
  );
  const db = c.worktree.resources.db;
  assert(db !== undefined);
  assertEquals(db.create, "make-db");
  assertEquals(db.destroy, "");
  assertEquals(db.ensure, "");
  assertEquals(db.required, true);
  assertEquals(db.prunable, true);
  assertEquals(db.retries, 0);
});

Deno.test("resolveConfiguredAgents: unset means the default pair, explicit [] means no agents", () => {
  // The class: an empty collection conflated with an absent one (B43). `[project]
  // agents` is optional so the two are DISTINCT states, and the resolver must read
  // them differently — otherwise "emit for no agents" cannot be expressed and the
  // generated reference misdocuments the default. Default expectations are driven
  // off DEFAULT_AGENTS (its single source of truth), never a hand-copied pair.

  // Unset (no key at all, and a [project] with no agents key) → default pair.
  assertEquals(resolveConfiguredAgents(parseConfigOrThrow("")), [
    ...DEFAULT_AGENTS,
  ]);
  assertEquals(
    resolveConfiguredAgents(
      parseConfigOrThrow('[project]\nslug = "demo"\n'),
    ),
    [...DEFAULT_AGENTS],
  );

  // Explicit empty list → emit for NO agents (the reading the old default made
  // impossible). This is the one deliberate semantic change (documented on the key).
  assertEquals(
    resolveConfiguredAgents(parseConfigOrThrow("[project]\nagents = []\n")),
    [],
  );

  // A non-empty explicit list is honored verbatim, in order.
  assertEquals(
    resolveConfiguredAgents(
      parseConfigOrThrow('[project]\nagents = ["gemini"]\n'),
    ),
    ["gemini"],
  );

  // Provider names validate against the AGENT_NAMES catalogue — one authority.
  // A typo'd name is a load-time rejection, never a silently ignored provider.
  const typo = parseConfig('[project]\nagents = ["claud_code"]\n');
  assertEquals(typo.config, undefined);
  assert(
    typo.issues.some((issue) => issue.path.startsWith("project.agents")),
    JSON.stringify(typo.issues),
  );
});

Deno.test("every standard requires a direction; metric remains optional", () => {
  const missing = parseConfig(
    `[standards.coverage]\nlimit = 80\nrun = "cov"\n`,
  );
  assertEquals(missing.config, undefined);
  assert(
    missing.issues.some((issue) =>
      issue.path === "standards.coverage.direction"
    ),
    JSON.stringify(missing.issues),
  );

  const c = parseConfigOrThrow(
    `[standards.coverage]\ndirection = "up"\nlimit = 80\nrun = "cov"\n`,
  );
  const r = c.standards.coverage;
  assert(r !== undefined);
  assertEquals(r.direction, "up");
  assertEquals(r.metric, undefined);
  assertEquals(r.limit, 80);
});

Deno.test("a standard margin cannot be negative (a negative margin pins a failing limit)", () => {
  // The class' schema half (B31): a negative margin makes `standards --pin` compute
  // a limit the just-measured value fails (a floor pinned above / a ceiling below
  // the measurement). Refuse it at load — margin is headroom, never a tightening —
  // so the bad state is unrepresentable. Zero and positive margins stay valid.
  const bad = parseConfig(
    `[standards.cov]\ndirection = "up"\nlimit = 80\nrun = "x"\nmargin = -5\n`,
  );
  assertEquals(bad.config, undefined);
  assert(
    bad.issues.some((i) => i.path === "standards.cov.margin"),
    JSON.stringify(bad.issues),
  );
  for (const margin of ["0", "0.5", "5", "100000"]) {
    assertEquals(
      parseConfig(
        `[standards.cov]\ndirection = "up"\nlimit = 80\nrun = "x"\nmargin = ${margin}\n`,
      )
        .issues,
      [],
      `margin ${margin} must validate`,
    );
  }
});

Deno.test("[acceptance].pre_authorized accepts defined scopes and rejects every unknown entry", () => {
  const configured = parseConfigOrThrow(
    [
      "[scopes.map]",
      'paths = ["docs/**"]',
      "",
      "[scopes.release]",
      'paths = ["release/**"]',
      "",
      "[acceptance]",
      'pre_authorized = ["map", "release"]',
      "",
    ].join("\n"),
  );
  assertEquals(configured.acceptance.pre_authorized, ["map", "release"]);

  const missing = parseConfig(
    [
      "[scopes.map]",
      'paths = ["docs/**"]',
      "",
      "[acceptance]",
      'pre_authorized = ["ghost", "map", "other"]',
      "",
    ].join("\n"),
  );
  assertEquals(missing.config, undefined);
  assertEquals(
    missing.issues.map((issue) => issue.path),
    ["acceptance.pre_authorized.0", "acceptance.pre_authorized.2"],
  );
  for (const issue of missing.issues) {
    assertStringIncludes(issue.message, "defined scopes: map");
  }
});

Deno.test("config writes cannot create a standing grant for an undefined scope", () => {
  const issues = configWriteIssues(
    '[acceptance]\npre_authorized = ["ghost"]\n',
  );
  assertEquals(issues.length, 1);
  assertEquals(issues[0]?.path, "acceptance.pre_authorized.0");
  assertStringIncludes(issues[0]?.message ?? "", "defined scopes: (none)");
});

Deno.test("a standard `per` extent with an empty pathspec array is refused (never measures the whole repo)", () => {
  // The class: a config shape that VALIDATES but then selects nothing/everything
  // contrary to intent (B42). An empty pathspec list would reach `git ls-files --`
  // with zero pathspecs — which git reads as "every tracked file" — silently making
  // the denominator the whole repo. Refused at the schema, so no consumer can be
  // handed a `[]` extent. Iterated over EXTENTS (the single source of truth for the
  // measure set) so a new extent auto-enrols in the guard.
  for (const extent of EXTENTS) {
    const { config, issues } = parseConfig(
      `[standards.d]\ndirection = "down"\nlimit = 5\nrun = "x"\nper = { ${extent} = [] }\n`,
    );
    assertEquals(config, undefined, `empty ${extent} array must be refused`);
    assert(
      issues.some((i) => i.path === `standards.d.per.${extent}`),
      `empty ${extent} array must fail at standards.d.per.${extent}: ${
        JSON.stringify(issues)
      }`,
    );
    // A non-empty list (and a bare string) stay valid — the guard refuses only [].
    assertEquals(
      parseConfig(
        `[standards.d]\ndirection = "down"\nlimit = 5\nrun = "x"\nper = { ${extent} = ["a"] }\n`,
      ).issues,
      [],
      `one-pathspec ${extent} must validate`,
    );
    assertEquals(
      parseConfig(
        `[standards.d]\ndirection = "down"\nlimit = 5\nrun = "x"\nper = { ${extent} = "a" }\n`,
      ).issues,
      [],
      `string ${extent} must validate`,
    );
  }
});

// ── command-list normalisation ───────────────────────────────────────────────────

Deno.test("toCommandList: scalar → one item, list passes through, empties/: dropped", () => {
  assertEquals(toCommandList("a"), ["a"]);
  assertEquals(toCommandList(["a", "b"]), ["a", "b"]);
  assertEquals(toCommandList(["a", "", ":", "b"]), ["a", "b"]);
  assertEquals(toCommandList(undefined), []);
  assertEquals(toCommandList(":"), []);
});

Deno.test("toCommand joins a list with && and is empty when nothing real remains", () => {
  assertEquals(toCommand(["a", "b"]), "a && b");
  assertEquals(toCommand("a"), "a");
  assertEquals(toCommand([":", ""]), "");
  assertEquals(toCommand(undefined), "");
});

// ── parse / issues split ───────────────────────────────────────────────────────

Deno.test("parseConfig throws ConfigParseError on a TOML syntax error", () => {
  const error = assertThrows(
    () => parseConfig("oops = [[["),
    ConfigParseError,
  );
  assert(error.cause instanceof Error);
});

Deno.test("parseConfig rejects unknown-job shorthand with the custom table fix", () => {
  const { config, issues } = parseConfig(
    `[jobs]\nfrobnicate = "x"\n`,
  );
  assertEquals(config, undefined);
  const issue = issues.find((i) => i.path === "jobs.frobnicate");
  assert(issue !== undefined, JSON.stringify(issues));
  assertStringIncludes(issue.message, "table form");
  assertStringIncludes(issue.message, "stage");
});

Deno.test("parseConfigOrThrow throws a ConfigValidationError carrying the issues", () => {
  const err = assertThrows(
    () => parseConfigOrThrow(`[gate]\nfail_fast = "yes"\n`),
    ConfigValidationError,
  ) as ConfigValidationError;
  assert(err.issues.length >= 1);
  // path-qualified, one issue per line
  assert(err.message.includes("gate.fail_fast"));
  assert(err.message.startsWith("discern.toml is invalid"));
});

Deno.test("strict: an unknown top-level section is rejected", () => {
  const { issues } = parseConfig(`[bogus]\nk = 1\n`);
  assertEquals(issues, [{
    kind: "unknown_root_section",
    path: "bogus",
    message:
      "the running discern process does not recognize the root section [bogus].",
  }]);
});

Deno.test("every canonical root section auto-enrols in stale-reader classification", () => {
  // The defect class is a stale strict root schema encountering a section a newer
  // build added. Derive every synthetic future sibling from the live root schema:
  // adding a root section therefore adds a case here without a hand-maintained list.
  const canonical = Object.entries(configSchema.shape);
  assert(canonical.length > 0, "the canonical config has no root sections");
  const current = parseConfigOrThrow("") as unknown as Record<string, unknown>;
  for (const [section] of canonical) {
    const staleSchema = z.strictObject(Object.fromEntries(
      canonical.filter(([name]) => name !== section),
    ));
    const issues = configSchemaIssues(
      { [section]: current[section] },
      staleSchema,
    );
    assertEquals(issues, [{
      kind: "unknown_root_section",
      path: section,
      message:
        `the running discern process does not recognize the root section [${section}].`,
    }]);
  }
});

Deno.test("strict: a prerelease [worktree.db] adapter table is rejected", () => {
  // No epitaph: the dead-position table starts empty (no public install ever
  // held the prerelease layouts), so plain strict unknown-key rejection is the
  // whole contract for these positions.
  const { issues } = parseConfig(`[worktree.db]\nclone = "x"\n`);
  assert(
    issues.some((i) =>
      i.path === "worktree.db" && /unknown key/.test(i.message)
    ),
  );
});

Deno.test("strict: a prerelease [features] section is rejected", () => {
  // The subsystem toggles were retired (every subsystem is core, ADR 0101);
  // the section rejects as an unknown section, with no epitaph row.
  const { issues } = parseConfig(`[features]\nmcp = true\n`);
  assert(
    issues.some((i) =>
      i.kind === "unknown_root_section" && i.path === "features"
    ),
    JSON.stringify(issues),
  );
});

Deno.test("a quoted boolean gets a tailored hint, not the raw Zod message", () => {
  const { issues } = parseConfig(`[gate]\nfail_fast = "false"\n`);
  const issue = issues.find((i) => i.path === "gate.fail_fast");
  assert(issue !== undefined);
  assert(/bare `true` or `false`/.test(issue.message), issue?.message);
});

Deno.test("isSettableConfigPath: known leaf/record paths yes, typos no", () => {
  // Known scalar leaves and record paths are settable.
  assert(isSettableConfigPath("project.slug"));
  assert(isSettableConfigPath("repository.trunk"));
  assert(isSettableConfigPath("repository.branch_prefix"));
  assert(isSettableConfigPath("repository.ensure"));
  assert(isSettableConfigPath("gate.fail_fast"));
  assert(isSettableConfigPath("map.dir"));
  assert(isSettableConfigPath("standards.coverage.limit")); // valid-but-incomplete OK
  assert(isSettableConfigPath("jobs.x.stage"));
  assert(isSettableConfigPath("worktree.resources.db.create"));
  // Typos and unknown keys are not.
  assert(!isSettableConfigPath("project.frobnicate"));
  assert(!isSettableConfigPath("features.docs")); // the retired toggles (ADR 0101)
  assert(!isSettableConfigPath("worktree.enabled")); // retired with them
  assert(!isSettableConfigPath("jobs.bad name.stage"));
  assert(!isSettableConfigPath("nope.at.all"));
  assert(!isSettableConfigPath("standards.coverage.bogus"));
});

Deno.test("isSettableConfigPath refuses every record-key <name> the runtime validator refuses", () => {
  // The class: the settable-path walker must enforce record-key legality exactly
  // as the runtime `z.record` key schema does — otherwise `config set` writes a
  // `[<family>.<bad name>]` header the next load rejects (B41). Driven off two
  // single sources of truth: RECORD_ENTRY_SCHEMAS (every record family, so a new
  // one auto-enrols) and NAME_RE (the one key pattern). For each family we build a
  // header with an illegal name and assert BOTH oracles agree it is refused — the
  // walker (isSettableConfigPath) and the runtime validator (configWriteIssues).
  const illegalNames = ["bad name", "a/b", "a.b", "für", "a:b", "a+b", ""];
  const legalNames = ["ok", "cov-1", "a_b", "X9"];
  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    // A representative leaf key for this family, read from its schema shape (not a
    // hand-copied name) so the guard follows the schema.
    const leafKey = Object.keys(schema.shape)[0];
    assert(leafKey !== undefined, `${family} has no keys`);
    for (const name of legalNames) {
      assert(NAME_RE.test(name)); // sanity: these are legal by the one pattern
      assert(
        isSettableConfigPath(`${family}.${name}.${leafKey}`),
        `${family}.${name}.${leafKey} should be settable (legal name)`,
      );
    }
    for (const name of illegalNames) {
      assert(!NAME_RE.test(name)); // sanity: these violate the one pattern
      const path = `${family}.${name}.${leafKey}`;
      assert(
        !isSettableConfigPath(path),
        `${path} must NOT be settable — the runtime validator refuses this key`,
      );
      // The runtime validator refuses the equivalent header too: the walker and
      // the loader agree, which is the whole point (no accept-then-reject gap).
      const header = `[${family}."${name}"]\n${leafKey} = "x"\n`;
      const issues = configWriteIssues(header);
      assert(
        issues.length > 0,
        `runtime validator must refuse ${header} (parity with the walker)`,
      );
    }
  }
});

Deno.test("settableConfigValueKind reads the schema's type at a path", () => {
  assertEquals(settableConfigValueKind("project.slug"), { kind: "string" });
  assertEquals(settableConfigValueKind("repository.trunk"), { kind: "string" });
  assertEquals(settableConfigValueKind("repository.ensure"), {
    kind: "string-array",
  });
  assertEquals(settableConfigValueKind("gate.timeout"), { kind: "number" });
  assertEquals(settableConfigValueKind("gate.stream_output"), {
    kind: "boolean",
  });
  assertEquals(settableConfigValueKind("project.agents"), {
    kind: "string-array",
  });
  assertEquals(settableConfigValueKind("worktree.setup.steps"), {
    kind: "string-array",
  });
  // Enum-typed strings carry their closed vocabulary, straight from the schema
  // constants — never a hand-copied list.
  assertEquals(settableConfigValueKind("jobs.x.stage"), {
    kind: "string",
    values: [...STAGES],
  });
  assertEquals(settableConfigValueKind("standards.x.direction"), {
    kind: "string",
    values: ["up", "down"],
  });
  // Unions have no single required type.
  assertEquals(settableConfigValueKind("jobs.test"), { kind: "mixed" });
  assertEquals(settableConfigValueKind("standards.x.per"), { kind: "mixed" });
  // Section paths are tables, not keys.
  assertEquals(settableConfigValueKind("worktree.setup"), { kind: "table" });
  assertEquals(settableConfigValueKind("worktree.resources.db"), {
    kind: "table",
  });
  // Unknown paths stay unknown.
  assertEquals(settableConfigValueKind("project.frobnicate"), undefined);
});

Deno.test("configWriteIssues blocks wrong shapes but excuses an in-progress record entry", () => {
  // A clean config writes.
  assertEquals(configWriteIssues(`[project]\nslug = "demo"\n`), []);
  // Incremental record construction writes: required keys still MISSING inside
  // a [standards.<n>] / [scopes.<n>] entry are the documented allowance.
  assertEquals(configWriteIssues(`[standards.cov]\nlimit = 80\n`), []);
  assertEquals(configWriteIssues(`[scopes.map]\nneutral = true\n`), []);
  // A key PRESENT with the wrong shape blocks.
  const wrongType = configWriteIssues(`[project]\nagents = "claude_code"\n`);
  assert(
    wrongType.some((i) => i.path === "project.agents"),
    JSON.stringify(wrongType),
  );
  const wrongEnum = configWriteIssues(
    `[jobs.x]\nstage = "bogus"\nrun = "y"\n`,
  );
  assert(
    wrongEnum.some((i) => i.path === "jobs.x.stage"),
    JSON.stringify(wrongEnum),
  );
  // Anything wrong OUTSIDE a record entry is never excused: the allowance is
  // scoped to the record families, nothing else.
  const badRoot = configWriteIssues(`[features]\ndocs = true\n`);
  assert(badRoot.length > 0, "an unknown section must block");
  // Unparseable TOML blocks with the syntax hint.
  const syntax = configWriteIssues(`[standards.cov]\nlimit = .5\n`);
  assert(
    syntax.some((i) => i.message.includes("syntax error")),
    JSON.stringify(syntax),
  );
});

Deno.test("[map].dir round-trips and rejects paths outside the project", () => {
  const custom = parseConfigOrThrow(
    `[map]\ndir = "docs/discern/"\n`,
  );
  assertEquals(custom.map.dir, "docs/discern/");

  const absolute = parseConfig(`[map]\ndir = "/tmp/docs"\n`);
  assert(
    absolute.issues.some((issue) => issue.path === "map.dir"),
    JSON.stringify(absolute.issues),
  );
  const escaping = parseConfig(`[map]\ndir = "../docs"\n`);
  assert(
    escaping.issues.some((issue) => issue.path === "map.dir"),
    JSON.stringify(escaping.issues),
  );
});

Deno.test("write-capable config paths normalize harmless aliases", () => {
  const config = parseConfigOrThrow(`
[project]
todo = "././TODO.md"

[instructions]
sources = ["././instructions.md", "./docs/**/*.md"]

[skills]
dir = "././playbooks/"

[map]
dir = "././docs/map"

[scripts]
dir = "tools/"

[worktree]
env_files = ["././runtime", "config/secrets"]
`);

  assertEquals(config.project.todo, "TODO.md");
  assertEquals(config.instructions.sources, [
    "instructions.md",
    "./docs/**/*.md",
  ]);
  assertEquals(config.skills.dir, "playbooks");
  assertEquals(config.map.dir, "docs/map/");
  assertEquals(config.scripts.dir, "tools");
  assertEquals(config.worktree.env_files, ["runtime", "config/secrets"]);
});

Deno.test("write-capable config paths keep every safety refusal", () => {
  const unsafe = [
    "",
    " ../outside",
    "../outside",
    "/tmp/outside",
    "C:/outside",
    "~/outside",
    "nested\\outside",
    "nested//outside",
    "nested/./outside",
    "nested/../outside",
    "nested/.git/config",
    "nested/<outside>",
    "nested/CON.txt",
    "nested/trailing.",
    "cafe\u0301.md",
    "nested/\u0001outside",
  ];
  for (const value of unsafe) {
    const parsed = parseConfig(
      `[project]\ntodo = ${JSON.stringify(value)}\n`,
    );
    assert(
      parsed.issues.some((issue) => issue.path === "project.todo"),
      `${JSON.stringify(value)} unexpectedly passed: ${JSON.stringify(parsed)}`,
    );
  }

  for (
    const [text, path] of [
      [
        '[instructions]\nsources = ["../instructions.md"]\n',
        "instructions.sources.0",
      ],
      ['[skills]\ndir = "nested/.git/skills"\n', "skills.dir"],
      ['[scripts]\ndir = "tools//local"\n', "scripts.dir"],
      ['[worktree]\nenv_files = ["../runtime"]\n', "worktree.env_files.0"],
    ] as const
  ) {
    const parsed = parseConfig(text);
    assert(
      parsed.issues.some((issue) => issue.path === path),
      `${path} unexpectedly passed: ${JSON.stringify(parsed)}`,
    );
  }
});

Deno.test("[worktree].env_files is unique after path normalization", () => {
  for (
    const values of [
      ["runtime", "runtime"],
      ["runtime", "./runtime"],
      ["runtime", "././runtime"],
      ["runtime", "RUNTIME"],
    ]
  ) {
    const parsed = parseConfig(
      `[worktree]\nenv_files = ${JSON.stringify(values)}\n`,
    );
    assert(
      parsed.issues.some((issue) => issue.path === "worktree.env_files"),
      `${JSON.stringify(values)} unexpectedly passed: ${
        JSON.stringify(parsed)
      }`,
    );
  }
});

Deno.test("a bad custom-job stage and a bad standard direction are rejected", () => {
  const badStage = parseConfig(
    `[jobs.x]\nstage = "lint"\nrun = "y"\n`,
  );
  assert(badStage.issues.some((i) => i.path.startsWith("jobs.x.stage")));
  const badDir = parseConfig(
    `[standards.r]\ndirection = "sideways"\nlimit = 1\nrun = "y"\n`,
  );
  assert(badDir.issues.some((i) => i.path.startsWith("standards.r.direction")));
});

Deno.test("the repo's own discern.toml validates with zero issues", async () => {
  const text = await Deno.readTextFile(
    new URL("../discern.toml", import.meta.url),
  );
  const { config, issues } = parseConfig(text);
  assertEquals(issues, []);
  assert(config !== undefined);
});

// ── SSOT guards: the closed vocabularies and the schema agree ────────────────────

Deno.test("every known job derives its stage and forbids a declared one", () => {
  for (const name of Object.keys(KNOWN_JOBS)) {
    const { issues } = parseConfig(`[jobs]\n${name} = "x"\n`);
    assertEquals(issues, [], `known job "${name}" should be accepted`);
    const declared = parseConfig(
      `[jobs.${name}]\nstage = "${
        KNOWN_JOBS[name as keyof typeof KNOWN_JOBS]
      }"\nrun = "x"\n`,
    );
    const issue = declared.issues.find((i) => i.path === `jobs.${name}.stage`);
    assert(issue !== undefined, JSON.stringify(declared.issues));
    assertStringIncludes(issue.message, "derives stage");
  }
});

Deno.test("every gate stage is accepted for a custom job", () => {
  for (const stage of STAGES) {
    const { issues } = parseConfig(
      `[jobs.c]\nstage = "${stage}"\nrun = "x"\n`,
    );
    assertEquals(issues, [], `stage "${stage}" should be accepted`);
  }
});

Deno.test("the document agent enum matches the installer's known agents", () => {
  assertEquals([...AGENT_NAMES].sort(), [...KNOWN_AGENTS].sort());
  // and includes gemini — the historical staleness bug in the JSON Schema.
  assert((AGENT_NAMES as readonly string[]).includes("gemini"));
});

Deno.test("[worktree.setup].ensure parses and defaults to [] (additive, backward-compatible)", () => {
  // Absent → both buckets default to empty, so a config with only `steps` (or
  // neither) behaves exactly as before the key existed.
  const { config } = parseConfig("");
  assertEquals(config?.worktree.setup.steps, []);
  assertEquals(config?.worktree.setup.ensure, []);
  // A config carrying only the old `steps` key still validates and leaves `ensure`
  // at its default.
  const { config: legacy, issues: legacyIssues } = parseConfig(
    '[worktree.setup]\nsteps = ["a"]\n',
  );
  assertEquals(legacyIssues, []);
  assertEquals(legacy?.worktree.setup.ensure, []);
  // Both buckets parse, in order.
  const { config: both, issues } = parseConfig(
    '[worktree.setup]\nsteps = ["a"]\nensure = ["b", "c"]\n',
  );
  assertEquals(issues, []);
  assertEquals(both?.worktree.setup.steps, ["a"]);
  assertEquals(both?.worktree.setup.ensure, ["b", "c"]);
});

Deno.test("a standard's measure key is refused with the current contract and the shared-producer route", () => {
  const { config, issues } = parseConfig(
    '[standards.coverage]\nmeasure = "on-demand"\ndirection = "up"\nlimit = 90\nrun = "true"\n',
  );
  assertEquals(config, undefined);
  const issue = issues.find((entry) =>
    entry.path === "standards.coverage.measure"
  );
  assert(issue !== undefined, JSON.stringify(issues));
  assertStringIncludes(issue.message, "measured on every `discern done`");
  assertStringIncludes(issue.message, 'producer = "jobs.<name>"');
  assert(
    !/(?:upgrade|renam|retir|became)/i.test(issue.message),
    `current config recovery must describe only the current contract: ${issue.message}`,
  );
});
