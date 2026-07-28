/**
 * `discern desk` and the bare-`discern` fall-through (ADR 0119): the desk is
 * gated by the shared interaction policy, so under the test harness — where stdio is always
 * piped, never a terminal — every invocation here must land on the
 * non-interactive side: structured refusals for `desk`, byte-boring help for
 * bare `discern`. The interactive branch itself is exercised by the pure model
 * suite (`engine_desk_model_test.ts`); these tests pin the class "no pipe, CI
 * run, or agent harness can ever wander into the interactive surface".
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";

const DESK_SESSION = { [DESK_SESSION_ENV]: "1" };

Deno.test("desk --json: refuses — the desk has no JSON form", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk", "--json"]);
    assertEquals(r.code, 1, r.output);
    const envelope = JSON.parse(r.stdout);
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "desk");
    assertEquals(envelope.error, "invalid_arguments");
    assert(
      Array.isArray(envelope.hints) && envelope.hints.length > 0,
      "the machine refusal should carry a registered next action",
    );
    assertStringIncludes(envelope.message, "status --json");
  });
});

Deno.test("desk --json: a desk-owned child reports the active desk", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk", "--json"], {
      env: DESK_SESSION,
    });
    assertEquals(r.code, 1, r.output);
    const envelope = JSON.parse(r.stdout);
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "desk");
    assertEquals(envelope.error, "desk_already_active");
    assertStringIncludes(envelope.message, "exit");
  });
});

Deno.test("bare discern refuses inside a desk-owned child before interaction policy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, [], { env: DESK_SESSION });
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "already active");
    assertStringIncludes(r.output, "exit");
    assert(!r.output.includes("Pick an effort"));
    assert(!r.output.includes("Commands:"));
  });
});

Deno.test("desk without a TTY: refuses with a pointer at status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.stderr, "interactive terminal");
    assertStringIncludes(r.stderr, "discern status");
  });
});

Deno.test("desk pre-setup: the setup redirect fires before the surface", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["desk", "--json"]);
    assertEquals(r.code, 1, r.output);
    const envelope = JSON.parse(r.stdout);
    assertEquals(envelope.error, "not_set_up");
  });
});

Deno.test("bare discern without a TTY: help, exactly as before the desk existed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, []);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Commands:");
    // The desk is advertised in the help map (its group leads), but piped
    // output must never BE the desk — no prompt, no picker, a clean exit.
    assertStringIncludes(r.stdout, "Your desk");
    assert(
      !r.stdout.includes("Pick an effort"),
      "piped bare discern must never open the interactive picker",
    );
  });
});
