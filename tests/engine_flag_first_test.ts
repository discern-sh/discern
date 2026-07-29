/**
 * Flag-first routing parity — the guard for the class of defect where a
 * pre-Cliffy routing decision in `main()` keys on `argv[0]` while Cliffy
 * itself accepts the global flags BEFORE the subcommand. Any such decision
 * must key on the RESOLVED verb (the first non-global-flag token), or a
 * leading `--json`/`--no-color` smuggles the invocation past the router:
 * the ADR 0036 setup redirect, the operator help, the root JSON refusal,
 * and project script dispatch all diverge.
 *
 * The matrices derive from the single sources of truth so a new member
 * auto-enrols: the global flags are read from the Cliffy registration itself
 * (`globalFlagTokens(buildCli(...))`), and the gated verbs from
 * `SETUP_GATED_VERBS`. The valueless-global test is the forcing function for
 * the technique: `resolveInvocation` skips global flags token-by-token, which
 * is only sound while every global flag takes no value.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { Command } from "@cliffy/command";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine, writeExecutable } from "./engine_helpers.ts";
import { buildCli, globalFlagTokens, resolveInvocation } from "../src/main.ts";
import { SETUP_GATED_VERBS } from "../src/shared/setup_state.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** Every global flag token, straight from the Cliffy registration. */
const GLOBAL_FLAGS: readonly string[] = [
  ...globalFlagTokens(buildCli(false) as unknown as Command),
].sort();

Deno.test("the global-flag registration is non-empty and includes --json", () => {
  // The matrices below iterate this set — an empty derivation would make
  // every flag-first case silently vacuous.
  assert(GLOBAL_FLAGS.length > 0, "no global flags derived from the root");
  assert(GLOBAL_FLAGS.includes("--json"), GLOBAL_FLAGS.join(", "));
});

Deno.test("every global flag is valueless, so token-skipping verb resolution stays sound", () => {
  const root = buildCli(false) as unknown as Command;
  for (const option of root.getOptions(true)) {
    if (option.global !== true) {
      continue;
    }
    assertEquals(
      option.typeDefinition ?? "",
      "",
      `global flag ${option.flags.join("/")} takes a value — ` +
        "resolveInvocation skips single tokens only; teach it lookahead " +
        "before shipping a value-taking global flag.",
    );
  }
});

Deno.test("resolveInvocation finds the verb past any run of global flags", () => {
  const tokens = globalFlagTokens(buildCli(false) as unknown as Command);
  // Verb-first: the plain path stays the plain path.
  assertEquals(resolveInvocation(["map", "--json"], tokens), {
    verb: "map",
    argsWithoutVerb: ["--json"],
  });
  // Each single global flag placed first.
  for (const flag of GLOBAL_FLAGS) {
    assertEquals(resolveInvocation([flag, "map", "x"], tokens), {
      verb: "map",
      argsWithoutVerb: [flag, "x"],
    });
  }
  // Every global flag stacked before the verb.
  assertEquals(
    resolveInvocation([...GLOBAL_FLAGS, "map"], tokens).verb,
    "map",
  );
  // Flags only: no verb at all (routes like bare `discern`).
  assertEquals(resolveInvocation([...GLOBAL_FLAGS], tokens), {
    verb: undefined,
    argsWithoutVerb: [...GLOBAL_FLAGS],
  });
  assertEquals(resolveInvocation([], tokens).verb, undefined);
  // An UNKNOWN leading flag is not skipped — Cliffy owns that error.
  assertEquals(resolveInvocation(["--bogus", "map"], tokens).verb, "--bogus");
});

Deno.test("pre-setup: the redirect fires for every global flag before every gated verb", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    for (const flag of GLOBAL_FLAGS) {
      for (const verb of SETUP_GATED_VERBS) {
        const args = [flag, verb];
        if (!args.includes("--json")) {
          args.push("--json");
        }
        const r = await runAgent(dir, args);
        const label = `discern ${args.join(" ")}`;
        assertEquals(r.code, 1, `${label}: ${r.output}`);
        const res = JSON.parse(r.stdout);
        assertEquals(
          res.error,
          "not_set_up",
          `${label} must hard-redirect to setup (ADR 0036): ${r.output}`,
        );
        assertEquals(res.verb, verb, label);
      }
    }
  });
});

Deno.test("pre-setup: a flags-only JSON invocation returns the root refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["--json"]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false, r.output);
    assertEquals(res.verb, "discern", r.output);
    assertEquals(res.error, "invalid_arguments", r.output);
    assertHasHint(res, HINTS["failure-recovery"], { verb: "discern" });
  });
});

Deno.test("flag-first --help renders the operator help with the scripts command", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["--no-color", "--help"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "scripts");
  });
});

Deno.test("a project script dispatches with a global flag placed first", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho HELLO-FROM-PROJECT\n",
    );
    const r = await runAgent(dir, ["--no-color", "scripts", "hello"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "HELLO-FROM-PROJECT");
  });
});
