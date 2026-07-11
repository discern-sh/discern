import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  AGENT_NAMES,
  ConfigParseError,
  ConfigValidationError,
  configWriteIssues,
  isSettableConfigPath,
  NAME_RE,
  parseConfig,
  parseConfigOrThrow,
  RECORD_ENTRY_SCHEMAS,
  settableConfigValueKind,
  toCommand,
  toCommandList,
} from "../src/shared/config_schema.ts";
import { KNOWN_CAPABILITIES, STAGES } from "../src/shared/capabilities.ts";
import { KNOWN_AGENTS } from "../src/lib/config.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

// ── defaults ───────────────────────────────────────────────────────────────────

Deno.test("an empty config validates to a fully-defaulted object", () => {
  const c = parseConfigOrThrow("");
  assertEquals(c.project.main_branch, "main");
  assertEquals(c.project.branch_prefix, "agent/");
  assertEquals(c.project.slug, "");
  assertEquals(c.project.gotchas_doc, "");
  // The path defaults are the registry's (ADR 0102) — asserted against it, so
  // the schema can never drift from the one source of truth.
  assertEquals(c.skills.dir, SOURCE_PATHS.skills.defaultPath);
  assertEquals(c.docs.dir, SOURCE_PATHS.docs.defaultPath);
  assertEquals(c.recipes.dir, SOURCE_PATHS.recipes.defaultPath);
  assertEquals(c.guidance.sources, [SOURCE_PATHS.guidance.defaultPath]);
  assertEquals(c.project.todo, SOURCE_PATHS.todo.defaultPath);
  assertEquals(c.guidance.agents, []);
  assertEquals(c.meta.bootstrapped, false);
  // records default to empty
  assertEquals(c.capabilities, {});
  assertEquals(c.checks, {});
  assertEquals(c.scopes, {});
  assertEquals(c.ratchets, {});
  assertEquals(c.worktree.resources, {});
  assertEquals(c.worktree.setup.steps, []);
  assertEquals(c.worktree.inherit_env, []);
  assertEquals(c.worktree.ignored_file_drift, true);
});

Deno.test("a config still carrying [features] is rejected with the upgrade hint", () => {
  // The toggles were retired (ADR 0101); a pre-16 config that still carries the
  // section gets a dead-config message pointing at the migration, never a bare
  // "unknown section".
  const { config, issues } = parseConfig("[features]\ndocs = false\n");
  assertEquals(config, undefined);
  assertEquals(issues.length, 1);
  assert(issues[0]?.message.includes("discern upgrade"), issues[0]?.message);
  assert(issues[0]?.message.includes("[features]"), issues[0]?.message);
});

Deno.test("a config still carrying [worktree].enabled is rejected with the upgrade hint", () => {
  const { config, issues } = parseConfig("[worktree]\nenabled = true\n");
  assertEquals(config, undefined);
  assertEquals(issues.length, 1);
  assert(issues[0]?.message.includes("discern upgrade"), issues[0]?.message);
});

Deno.test("gate.fail_fast defaults ON; gate.stream defaults OFF", () => {
  const c = parseConfigOrThrow("");
  assertEquals(c.gate.fail_fast, true);
  assertEquals(c.gate.stream, false);
  const off = parseConfigOrThrow("[gate]\nfail_fast = false\n");
  assertEquals(off.gate.fail_fast, false);
});

Deno.test("worktree resource defaults: required/gc default true, retries 0, commands empty", () => {
  const c = parseConfigOrThrow(
    `[worktree.resources.db]\ncreate = "make-db"\n`,
  );
  const db = c.worktree.resources.db;
  assert(db !== undefined);
  assertEquals(db.create, "make-db");
  assertEquals(db.destroy, "");
  assertEquals(db.ensure, "");
  assertEquals(db.required, true);
  assertEquals(db.gc, true);
  assertEquals(db.retries, 0);
});

Deno.test("ratchet direction defaults up; metric is optional (falls back to name at read)", () => {
  const c = parseConfigOrThrow(
    `[ratchets.coverage]\nlimit = 80\nrun = "cov"\n`,
  );
  const r = c.ratchets.coverage;
  assert(r !== undefined);
  assertEquals(r.direction, "up");
  assertEquals(r.metric, undefined);
  assertEquals(r.limit, 80);
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
  assertThrows(() => parseConfig("oops = [[["), ConfigParseError);
});

Deno.test("parseConfig collects schema issues without throwing", () => {
  const { config, issues } = parseConfig(
    `[capabilities]\nfrobnicate = "x"\n`,
  );
  assertEquals(config, undefined);
  assert(issues.length >= 1);
  assert(issues.some((i) => i.path === "capabilities"));
  // the capability hint points at the known set + [checks]
  assert(issues.some((i) => /known capability|\[checks/.test(i.message)));
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
  assert(issues.some((i) => /unknown section|bogus/.test(i.message)));
});

Deno.test("strict: a dead [worktree.db] adapter is rejected with an upgrade hint", () => {
  const { issues } = parseConfig(`[worktree.db]\nclone = "x"\n`);
  assert(
    issues.some((i) =>
      i.path === "worktree" && /dead config|upgrade/.test(i.message)
    ),
  );
});

Deno.test("strict: a leftover [features].mcp is rejected with the section-level upgrade hint", () => {
  // The whole [features] section is dead config now (ADR 0101) — an old config
  // carrying any of it (mcp included) must not crash cryptically; it gets the
  // friendly "run discern upgrade" nudge, and the 15→16 migration drops it.
  const { issues } = parseConfig(`[features]\nmcp = true\n`);
  assert(
    issues.some((i) => /dead config \[features\]|upgrade/.test(i.message)),
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
  assert(isSettableConfigPath("gate.fail_fast"));
  assert(isSettableConfigPath("docs.dir"));
  assert(isSettableConfigPath("ratchets.coverage.limit")); // valid-but-incomplete OK
  assert(isSettableConfigPath("checks.x.stage"));
  assert(isSettableConfigPath("worktree.resources.db.create"));
  // Typos and unknown keys are not.
  assert(!isSettableConfigPath("project.frobnicate"));
  assert(!isSettableConfigPath("features.docs")); // the retired toggles (ADR 0101)
  assert(!isSettableConfigPath("worktree.enabled")); // retired with them
  assert(!isSettableConfigPath("capabilities.deploy")); // closed vocabulary
  assert(!isSettableConfigPath("nope.at.all"));
  assert(!isSettableConfigPath("ratchets.coverage.bogus"));
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
  assertEquals(settableConfigValueKind("gate.timeout"), { kind: "number" });
  assertEquals(settableConfigValueKind("gate.stream"), { kind: "boolean" });
  assertEquals(settableConfigValueKind("guidance.agents"), {
    kind: "string-array",
  });
  assertEquals(settableConfigValueKind("worktree.setup.steps"), {
    kind: "string-array",
  });
  // Enum-typed strings carry their closed vocabulary, straight from the schema
  // constants — never a hand-copied list.
  assertEquals(settableConfigValueKind("checks.x.stage"), {
    kind: "string",
    values: [...STAGES],
  });
  assertEquals(settableConfigValueKind("ratchets.x.direction"), {
    kind: "string",
    values: ["up", "down"],
  });
  // Unions have no single required type.
  assertEquals(settableConfigValueKind("capabilities.test"), { kind: "mixed" });
  assertEquals(settableConfigValueKind("ratchets.x.per"), { kind: "mixed" });
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
  // a [ratchets.<n>] / [scopes.<n>] entry are the documented allowance.
  assertEquals(configWriteIssues(`[ratchets.cov]\nlimit = 80\n`), []);
  assertEquals(configWriteIssues(`[scopes.docs]\nneutral = true\n`), []);
  // A key PRESENT with the wrong shape blocks.
  const wrongType = configWriteIssues(`[guidance]\nagents = "claude_code"\n`);
  assert(
    wrongType.some((i) => i.path === "guidance.agents"),
    JSON.stringify(wrongType),
  );
  const wrongEnum = configWriteIssues(
    `[checks.x]\nstage = "bogus"\nrun = "y"\n`,
  );
  assert(
    wrongEnum.some((i) => i.path === "checks.x.stage"),
    JSON.stringify(wrongEnum),
  );
  // Anything wrong OUTSIDE a record entry is never excused: the allowance is
  // scoped to the record families, nothing else.
  const badRoot = configWriteIssues(`[features]\ndocs = true\n`);
  assert(badRoot.length > 0, "an unknown section must block");
  // Unparseable TOML blocks with the syntax hint.
  const syntax = configWriteIssues(`[ratchets.cov]\nlimit = .5\n`);
  assert(
    syntax.some((i) => i.message.includes("syntax error")),
    JSON.stringify(syntax),
  );
});

Deno.test("[docs].dir round-trips and rejects paths outside the project", () => {
  const custom = parseConfigOrThrow(
    `[docs]\ndir = "docs/discern/"\n`,
  );
  assertEquals(custom.docs.dir, "docs/discern/");

  const absolute = parseConfig(`[docs]\ndir = "/tmp/docs"\n`);
  assert(
    absolute.issues.some((issue) => issue.path === "docs.dir"),
    JSON.stringify(absolute.issues),
  );
  const escaping = parseConfig(`[docs]\ndir = "../docs"\n`);
  assert(
    escaping.issues.some((issue) => issue.path === "docs.dir"),
    JSON.stringify(escaping.issues),
  );
});

Deno.test("a bad check stage and a bad ratchet direction are rejected", () => {
  const badStage = parseConfig(
    `[checks.x]\nstage = "lint"\nrun = "y"\n`,
  );
  assert(badStage.issues.some((i) => i.path.startsWith("checks.x.stage")));
  const badDir = parseConfig(
    `[ratchets.r]\ndirection = "sideways"\nlimit = 1\nrun = "y"\n`,
  );
  assert(badDir.issues.some((i) => i.path.startsWith("ratchets.r.direction")));
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

Deno.test("every known capability is accepted; an unknown one is rejected", () => {
  for (const name of Object.keys(KNOWN_CAPABILITIES)) {
    const { issues } = parseConfig(`[capabilities]\n${name} = "x"\n`);
    assertEquals(issues, [], `capability "${name}" should be accepted`);
  }
  assert(parseConfig(`[capabilities]\nnope = "x"\n`).issues.length > 0);
});

Deno.test("a [checks.<name>] sharing a wired capability's name is rejected (job labels must be unique)", () => {
  // The class guard: the gate keys every job result by its LABEL, and a
  // capability job and a [checks.<name>] job both carry their bare name — a
  // shared name silently overwrites one job's result with the other's,
  // destroying the genuine failure's diagnostics. Driven off KNOWN_CAPABILITIES
  // (the label vocabulary's single source of truth) so a new capability
  // auto-enrols in the collision rule.
  for (const [name, stage] of Object.entries(KNOWN_CAPABILITIES)) {
    // Colliding pair — rejected, at the check's path, with the label rationale.
    // The check's stage doesn't matter: finish fuses check∥test into one group,
    // and the result map spans every stage, so ANY shared name collides.
    const { config, issues } = parseConfig(
      `[capabilities]\n${name} = "x"\n[checks.${name}]\nstage = "${stage}"\nrun = "y"\n`,
    );
    assertEquals(config, undefined, `[checks.${name}] must be rejected`);
    const issue = issues.find((i) => i.path === `checks.${name}`);
    assert(issue !== undefined, JSON.stringify(issues));
    assert(issue.message.includes("label"), issue.message);
    assert(issue.message.includes(`[capabilities].${name}`), issue.message);

    // The same check WITHOUT the capability stays legal (doctor nudges it as
    // capability-shaped, but it produces a unique label — no collision).
    const alone = parseConfig(
      `[checks.${name}]\nstage = "${stage}"\nrun = "y"\n`,
    );
    assertEquals(alone.issues, [], `[checks.${name}] alone should be accepted`);
  }
  // A custom-named check beside a full capability set is untouched.
  const custom = parseConfig(
    `[capabilities]\ntest = "x"\n[checks.selfcheck]\nstage = "check"\nrun = "y"\n`,
  );
  assertEquals(custom.issues, []);
});

Deno.test("every gate stage is accepted as a check stage", () => {
  for (const stage of STAGES) {
    const { issues } = parseConfig(
      `[checks.c]\nstage = "${stage}"\nrun = "x"\n`,
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
