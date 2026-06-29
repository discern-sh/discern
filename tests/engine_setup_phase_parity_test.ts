/**
 * Setup-phase PARITY guard (ADR 0051/0075) — the forcing function tying the staged-
 * setup sub-verb SSOT to its CLI registration.
 *
 * `SETUP_SUBVERBS` (setup_state.ts) is the single source for the handshake's sub-verbs
 * (verify/begin/step/done). They are RE-LISTED by hand as `.command()` registrations
 * under `setup` in `buildCli` (each needs its own description + action, so it can't be a
 * derived list). Without a tie, adding a sub-verb to the SSOT — or registering one with
 * no SSOT entry — would drift silently: a welcome that funnels to a verb that doesn't
 * exist, or a sub-verb the SSOT (and its docs/tests) forgets. This test is that tie.
 *
 * When it fails, the fix is NOT to weaken the assertion — it is to reconcile the two:
 * register the missing `.command()` under `setup`, or update `SETUP_SUBVERBS`.
 */

import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { FEATURES } from "../src/shared/features.ts";
import { SETUP_SUBVERBS } from "../src/shared/setup_state.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("the setup sub-verbs registered cover EXACTLY SETUP_SUBVERBS", () => {
  // Build the real CLI with every feature on, find the `setup` command, and read back
  // its registered sub-verbs. They must be exactly SETUP_SUBVERBS.
  const root = buildCli(new Set(FEATURES), false) as unknown as Command;
  const setup = root.getCommands().find((c) => c.getName() === "setup");
  assert(setup !== undefined, "the `setup` command is not registered");
  const registered = setup.getCommands().map((c) => c.getName());
  assertEquals(
    sorted(registered),
    sorted(SETUP_SUBVERBS),
    "the setup sub-verb registrations have drifted from SETUP_SUBVERBS — add or remove " +
      "a `.command()` under `setup` in buildCli, or update the SSOT",
  );
});
