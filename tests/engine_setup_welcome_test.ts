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
import { SetupVerifyOutputSchema } from "../src/shared/result_schemas.ts";

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
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lay the marker-carrying skeletons

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

Deno.test("the fresh welcome --json carries the same instructional substance as the human render (parity)", async () => {
  // A JSON-consuming agent must not get a colder, thinner welcome than one reading
  // the dual-addressed human text (ADR 0075): the "you drive this; nothing until
  // begin; verify hands you the message to relay" framing rides on both paths.
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const human = (await runAgent(dir, ["setup"])).stdout;
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;

    // The agent guidance carries the role + the verify funnel the human prose has,
    // and points at verify as the source of the message to relay (ADR 0086).
    assertStringIncludes(d.agent_guidance, "nothing is written until");
    assertStringIncludes(
      d.agent_guidance,
      "hands you the exact message to relay",
    );
    assertStringIncludes(d.agent_guidance, "discern setup verify");
    // The human framing carries the most-capable-model nudge the human block makes.
    assertStringIncludes(d.human_framing, "most capable model");
    // Both surfaces actually say it, so neither path is the thinner one.
    assertStringIncludes(human, "MOST CAPABLE");
  });
});

Deno.test("the in-progress welcome --json carries the 'your job, not a status' agent guidance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]);
    const d =
      JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout).data;
    assertEquals(d.phase, "in_progress");
    // The resume framing the human text carries ("this is YOUR job ... not a status
    // to report back") must ride the JSON path too, not just the human one.
    assertStringIncludes(d.agent_guidance, "YOUR job");
    assertStringIncludes(d.agent_guidance, "discern setup done");
  });
});

// ── the verify preflight ─────────────────────────────────────────────────────

Deno.test("verify reports grounded findings and the consent conversation, writing nothing", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    );
    const d = res.data;
    assertEquals(d.phase, "fresh");
    assertEquals(d.findings.git.repo, true);
    assertEquals(d.findings.docs.exists, false);
    assert(typeof d.findings.worktree_path === "string");
    // The consent conversation rides the prose `guidance` lane (not structured
    // fields the agent summarizes) as a ready-to-relay message: the relay licence,
    // then the points to settle with the human — model, worktree, ready — plus the
    // funnel to begin (ADR 0086).
    assertStringIncludes(d.guidance, "Relay the message below to your human");
    assertStringIncludes(d.guidance, "Am I your most capable model");
    assertStringIncludes(
      d.guidance,
      "Isolated working copies will live beside",
    );
    assertStringIncludes(d.guidance, "Ready for me to begin");
    assertStringIncludes(d.next_action, "begin");
    // The command the agent runs after the conversation carries the consent
    // attestation — a fresh begin refuses without it.
    assertStringIncludes(d.next_action, "--confirmed");
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
    // The consent guidance instructs passing --model for best-effort provenance.
    assertStringIncludes(d.guidance, "--model");
  });
});

Deno.test("verify's consent guidance is identical and faithful across the human render and --json (the A9 parity guard)", async () => {
  // Running `verify --json` once led an agent to summarize and weaken the consent
  // conversation — it dropped "open warmly", reworded the model question, and guessed a
  // model id — while the SAME verify in human-readable form was followed faithfully.
  // The consent now rides ONE prose `guidance` lane; this pins the two surfaces to the
  // same text and asserts every load-bearing instruction survives in both, so they can
  // never silently diverge again (ADR 0078, the two-lane rule).
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    const human = (await runAgent(dir, ["setup", "verify"])).stdout;
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    const d = res.data;

    // One source, two renderings: the human preflight embeds the --json prose lane
    // verbatim, so the consent conversation cannot drift between the surfaces.
    assert(
      typeof d.guidance === "string" && d.guidance.length > 200,
      `expected a substantial consent guidance string: ${d.guidance}`,
    );
    assertStringIncludes(human, d.guidance);

    // Every load-bearing point is present in BOTH surfaces: the adaptive relay
    // licence, the exact model question verbatim, the three-pillar explainer, the
    // time+token expectation, the worktree location, and the confirmed command — the
    // content a courier agent must carry unweakened (ADR 0086, the two-lane rule).
    for (
      const needle of [
        "adapt the wording to your own voice if you like, but keep every point",
        "Am I your most capable model?",
        "Everything I configure here is inherited by every future session.",
        "isolated working copies (git worktrees)",
        "20–40 minutes",
        "Isolated working copies will live beside",
        "--confirmed",
      ]
    ) {
      assertStringIncludes(
        d.guidance,
        needle,
        `--json guidance missing: ${needle}`,
      );
      assertStringIncludes(human, needle, `human render missing: ${needle}`);
    }

    // Faithfulness (ADR 0041): the real serialized envelope — guidance and all —
    // validates against the schema the data is typed from.
    SetupVerifyOutputSchema.parse(res);
  });
});

Deno.test("verify surfaces existing docs/ and agent instructions as conflicts", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# mine\n");
    await Deno.writeTextFile(join(dir, "CLAUDE.md"), "# my rules\n");

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"]))
        .stdout,
    );
    const d = res.data;
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
    // With a docs/ tree present, the relay message asks where discern's own docs
    // should live (recommending docs/discern/) and the command carries --docs.
    assertStringIncludes(d.guidance, "You already have a docs/ folder");
    assertStringIncludes(d.guidance, "docs/discern/");
    assertStringIncludes(d.guidance, "--docs");
    assertEquals(d.findings.docs.suggested_discern_dir, "docs/discern/");
    assertStringIncludes(d.next_action, "--docs");
    SetupVerifyOutputSchema.parse(res);
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
      "--confirmed",
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
      "--confirmed",
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
