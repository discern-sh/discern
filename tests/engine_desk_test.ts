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

Deno.test("desk --json: refuses — the desk has no JSON form", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["desk", "--json"]);
    assertEquals(r.code, 1, r.output);
    const envelope = JSON.parse(r.stdout);
    assertEquals(envelope.ok, false);
    assertEquals(envelope.verb, "desk");
    assertEquals(envelope.error, "interactive_only");
    assertStringIncludes(envelope.message, "status --json");
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
