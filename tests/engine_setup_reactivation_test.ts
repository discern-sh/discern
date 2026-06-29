/**
 * Setup reactivation × provider-registry coverage (ADR 0075/0051) — the forcing
 * function that keeps the setup-completion handoff in step with every vendor's wiring.
 *
 * The reactivation guidance `discern setup done` prints is DERIVED from each provider's
 * setup surface — its live MCP server, its session hooks, and its one-time trust gate
 * (all REQUIRED {@link Provider} fields). So a new vendor's reactivation behaviour
 * follows from its declaration the moment it lands in `PROVIDERS`, with no
 * hand-maintained list. This test ties that derivation back to the registry: it iterates
 * EVERY known agent (the `AGENT_NAMES` SSOT, which `agent_parity_test` pins to
 * `PROVIDERS`) and asserts the reactivation step is coherent with what the agent actually
 * wires.
 *
 * When it fails for a new vendor, the fix is NOT to weaken the assertion — it is to make
 * the vendor's reactivation follow from its wiring: declare its `mcp`/`hooks`/`trust`
 * correctly, or teach `reactivationStep` the new setup-process variation it introduced.
 * The point is that a vendor cannot be added without its setup-completion handoff being
 * accounted for.
 */

import { assert } from "@std/assert";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { providerFor, reactivationStep } from "../src/lib/providers.ts";

Deno.test("every provider's setup reactivation step follows from its wiring", () => {
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(
      provider !== undefined,
      `the registry has no provider for "${name}"`,
    );

    const step = reactivationStep(provider);
    // What discern wired for this agent that a coding agent loads at SESSION START — the
    // live MCP server, or the session hooks. Either means a fresh session is needed.
    const loadsAtSessionStart = provider.mcp.kind === "wired" ||
      provider.hooks !== undefined;

    if (loadsAtSessionStart) {
      // It wires something that loads at session start → it MUST yield a reactivation
      // step, else `setup done` would silently omit a vendor that needs a fresh session.
      assert(
        step !== undefined && step.length > 0,
        `"${name}" wires an MCP server or session hooks but reactivationStep returned ` +
          `none — the setup-done handoff would skip a vendor that needs reactivating`,
      );
      // A vendor that gates committed config behind a one-time trust must carry that
      // action in its step (the same trust.hint doctor surfaces), so the user isn't left
      // with inert config and no idea why the tools never appeared.
      if (provider.trust.required) {
        assert(
          step.includes(provider.trust.hint),
          `"${name}" requires a one-time trust, but its reactivation step omits the ` +
            `trust action — the wired config would stay inert with no explanation`,
        );
      }
    } else {
      // It wires nothing that loads at session start (a reuse-canonical agent with no
      // MCP and no hooks) → it MUST NOT be told to restart for nothing.
      assert(
        step === undefined,
        `"${name}" wires neither an MCP server nor session hooks, yet reactivationStep ` +
          `returned a step — it would be told to start a fresh session for nothing`,
      );
    }
  }
});
