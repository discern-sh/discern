/**
 * Engine coverage for the read-only phases of the staged setup handshake (ADR 0075):
 * the 3-state WELCOME (`discern setup` / bare `discern`), the `verify` PREFLIGHT, the
 * `setup done` reactivation handoff, and `begin`'s provenance recording. Driven through
 * the real CLI from the genuinely un-set-up state — the state ADR 0065 warned the suite
 * never exercised — so the read-only-until-`begin` invariant and the funnel are proven
 * where they are real, not asserted in prose.
 *
 * The scaffold/brief behaviour of `begin` and the `done` validator live in
 * engine_setup_test.ts; this file owns the welcome + verify surfaces.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";

/** A git work tree with a file but NO discern.toml — the fresh-install entry point. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
}

// ── the welcome ────────────────────────────────────────────────────────────────

Deno.test("the fresh welcome dual-addresses both readers and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);
    // Both readers are addressed — robust where detecting them is not (ADR 0075).
    assertStringIncludes(r.stdout, "FOR HUMANS");
    assertStringIncludes(r.stdout, "FOR CODING AGENTS");
    // The agent is funnelled into the preflight, not handed the brief.
    assertStringIncludes(r.stdout, "discern setup verify");
    // Read-only: the welcome scaffolds nothing.
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "the welcome must write nothing — scaffolding belongs to `begin`",
    );
  });
});

Deno.test("the fresh welcome --json carries phase=fresh and the verify funnel", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup", "--json"]);
    assertEquals(r.code, 0, r.output);
    const d = JSON.parse(r.stdout).data;
    assertEquals(d.phase, "fresh");
    assertEquals(d.complete, false);
    assertStringIncludes(d.next_action, "verify");
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "the welcome --json must also write nothing",
    );
  });
});

Deno.test("the in-progress welcome shows derived progress and funnels to done", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin"]); // lay the marker-carrying skeletons

    const human = await runAgent(dir, ["setup"]);
    assertStringIncludes(human.stdout, "IN PROGRESS");
    assertStringIncludes(human.stdout, "discern setup done");

    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
    assertEquals(d.phase, "in_progress");
    // Derived progress: the docs markers still pending and the (all-unset) capabilities.
    assert(
      Array.isArray(d.progress.pending_markers) &&
        d.progress.pending_markers.length > 0,
      `expected pending markers: ${JSON.stringify(d.progress)}`,
    );
    assertEquals(d.progress.capabilities.length, 5);
    assert(
      d.progress.capabilities.every((c: { wired: boolean }) => !c.wired),
      "no capability is wired yet on a fresh scaffold",
    );
  });
});

Deno.test("bare `discern setup` reports already-set-up once recorded (phase done)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped by default
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
    assertEquals(d.phase, "done");
    assertEquals(d.complete, true);
  });
});

// ── the verify preflight ─────────────────────────────────────────────────────

Deno.test("verify reports grounded findings and the consent checklist, writing nothing", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    ).data;
    assertEquals(d.phase, "fresh");
    assertEquals(d.findings.git.repo, true);
    assertEquals(d.findings.docs.exists, false);
    assert(typeof d.findings.worktree_path === "string");
    // The fixed three-item consent checklist, and the funnel to begin.
    const ids = d.confirm_with_human.map((c: { id: string }) => c.id);
    assertEquals(sortedStr(ids), ["model", "ready", "worktree"]);
    assertStringIncludes(d.next_action, "begin");
    // Read-only: verify scaffolds nothing.
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "verify must write nothing (the verify|begin read-only boundary)",
    );
  });
});

Deno.test("verify funnels begin with --model so the configuring model is recorded as provenance", async () => {
  // A cold run never recorded setup_model because nothing told the agent to pass
  // --model. The funnel into begin now carries it, in both the next_action and the
  // model confirmation the agent presents to its human.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertStringIncludes(d.next_action, "--model");
    const model = d.confirm_with_human.find((c: { id: string }) =>
      c.id === "model"
    );
    assert(
      model !== undefined && model.prompt.includes("--model"),
      `the model confirmation must instruct passing --model: ${
        JSON.stringify(model)
      }`,
    );
  });
});

Deno.test("verify surfaces existing docs/ and agent instructions as conflicts", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# mine\n");
    await Deno.writeTextFile(join(dir, "CLAUDE.md"), "# my rules\n");

    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    ).data;
    const kinds = d.conflicts.map((c: { kind: string }) => c.kind);
    assert(
      kinds.includes("existing_docs"),
      `expected an existing_docs conflict: ${JSON.stringify(kinds)}`,
    );
    assert(
      kinds.includes("existing_instructions"),
      `expected an existing_instructions conflict: ${JSON.stringify(kinds)}`,
    );
    assert(d.findings.existing_instructions.includes("CLAUDE.md"));
  });
});

Deno.test("verify redirects once setup is recorded (the preflight is moot)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    ).data;
    assertEquals(d.phase, "done");
  });
});

// ── the reactivation handoff + provenance ────────────────────────────────────

Deno.test("setup done emits the provider-aware reactivation handoff", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // agents: [claude_code]
    const done = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(done.code, 0, done.output);
    // The human handoff names the wired agent and the fresh-session step.
    assertStringIncludes(done.stdout, "load them at session start");
    assertStringIncludes(done.stdout, "Claude Code");
    // The --json carries it structurally for an agent to act on.
    const d = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    ).data;
    assert(typeof d.reactivation.summary === "string");
    assert(
      d.reactivation.per_agent.some((a: { agent: string }) =>
        a.agent === "claude_code"
      ),
      `expected claude_code in the handoff: ${JSON.stringify(d.reactivation)}`,
    );
  });
});

Deno.test("begin records the agent's self-declared model + discern version as provenance", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--model",
      "test-model-x",
    ]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'setup_model = "test-model-x"');
    // setup_version is observed (non-empty), recorded alongside the model.
    assert(
      /setup_version = "[^"]+"/.test(toml),
      `expected a recorded setup_version: ${toml}`,
    );
  });
});

Deno.test("begin ignores a literal model placeholder, recording no bogus provenance", async () => {
  // The verify funnel shows `--model "<your-model-id>"`; an agent that copies it
  // verbatim instead of substituting must not record `<your-model-id>` as the model.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--model",
      "<your-model-id>",
    ]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assert(
      !toml.includes("setup_model"),
      `a placeholder model must not be recorded: ${toml}`,
    );
  });
});

/** Sort a string array (local helper — the tests compare small id sets). */
function sortedStr(xs: string[]): string[] {
  return [...xs].sort();
}
