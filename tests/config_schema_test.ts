import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  AGENT_NAMES,
  ConfigParseError,
  ConfigValidationError,
  isSettableConfigPath,
  parseConfig,
  parseConfigOrThrow,
  toCommand,
  toCommandList,
} from "../src/shared/config_schema.ts";
import { KNOWN_CAPABILITIES, STAGES } from "../src/shared/capabilities.ts";
import { FEATURES } from "../src/shared/features.ts";
import { KNOWN_AGENTS } from "../src/lib/config.ts";

// ── defaults ───────────────────────────────────────────────────────────────────

Deno.test("an empty config validates to a fully-defaulted object", () => {
  const c = parseConfigOrThrow("");
  assertEquals(c.project.main_branch, "main");
  assertEquals(c.project.branch_prefix, "agent/");
  assertEquals(c.project.slug, "");
  assertEquals(c.project.gotchas_doc, "");
  assertEquals(c.skills.dir, "skills");
  assertEquals(c.recipes.dir, "recipes");
  assertEquals(c.guidance.sources, ["guidance.md"]);
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
});

Deno.test("features default ON; only a literal false disables one", () => {
  const allOn = parseConfigOrThrow("");
  for (const f of FEATURES) {
    assertEquals(allOn.features[f], true, `${f} should default on`);
  }
  const off = parseConfigOrThrow("[features]\ndocs = false\n");
  assertEquals(off.features.docs, false);
  assertEquals(off.features.worktrees, true); // others still on
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
  assert(isSettableConfigPath("features.docs"));
  assert(isSettableConfigPath("ratchets.coverage.limit")); // valid-but-incomplete OK
  assert(isSettableConfigPath("checks.x.stage"));
  assert(isSettableConfigPath("worktree.resources.db.create"));
  // Typos and unknown keys are not.
  assert(!isSettableConfigPath("project.frobnicate"));
  assert(!isSettableConfigPath("features.bogus"));
  assert(!isSettableConfigPath("capabilities.deploy")); // closed vocabulary
  assert(!isSettableConfigPath("nope.at.all"));
  assert(!isSettableConfigPath("ratchets.coverage.bogus"));
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
