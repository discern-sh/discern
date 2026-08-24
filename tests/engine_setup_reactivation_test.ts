/**
 * Setup reactivation × provider-registry coverage (ADR 0075/0051) — the forcing
 * function that keeps the setup-completion handoff in step with every vendor's wiring.
 *
 * The reactivation message `discern setup done` prints is DERIVED from each provider's
 * setup surface — its live MCP server, session hooks, project rules, one-time trust gate,
 * and human-facing setup advice. So a new vendor's reactivation behaviour follows from
 * its declaration the moment it lands in `PROVIDERS`, with no hand-maintained list. This
 * test ties that derivation back to the registry: it iterates
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
import {
  ACTIVATION_CLI_CHECK,
  ACTIVATION_TOOL_INVENTORY_ACTION,
  activationCheck,
  providerFor,
  reactivationStep,
} from "../src/lib/providers.ts";

Deno.test("every provider's setup reactivation step follows from its wiring", () => {
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(
      provider !== undefined,
      `the registry has no provider for "${name}"`,
    );

    const step = reactivationStep(provider);
    const activation = activationCheck(provider);
    assert(activation.recovery === provider.activation.recovery);
    assert(activation.cliFallback === ACTIVATION_CLI_CHECK);
    if (provider.mcp.kind === "wired") {
      assert(activation.kind === "mcp");
      assert(activation.command === provider.activation.callable);
    } else {
      assert(activation.kind === "cli");
      assert(activation.command === ACTIVATION_CLI_CHECK);
    }
    // What discern wired for this agent that a coding agent loads at SESSION START — the
    // live MCP server, session hooks, or project rules. Any means a fresh session is
    // needed.
    const loadsAtSessionStart = provider.mcp.kind === "wired" ||
      provider.hooks !== undefined ||
      provider.projectRules !== undefined;
    assert(
      provider.humanSetupAdvice === undefined || loadsAtSessionStart,
      `"${name}" declares human setup advice but has no session-start wiring whose ` +
        "setup-done handoff can carry it",
    );
    if (provider.humanSetupAdvice !== undefined) {
      assert(
        provider.humanSetupAdvice.humanOnlyTopics.length > 0,
        `"${name}" declares human setup advice without naming the human-only ` +
          "topics generic agent instructions must exclude",
      );
      for (const topic of provider.humanSetupAdvice.humanOnlyTopics) {
        assert(
          provider.humanSetupAdvice.handoff.includes(topic),
          `"${name}" marks "${topic}" as human-only, but its setup handoff does ` +
            "not contain that topic",
        );
        assert(
          provider.humanSetupAdvice.documentationTopics.includes(topic),
          `"${name}" marks "${topic}" as human-only, but its provider ` +
            "documentation does not require that topic",
        );
      }
    }

    if (loadsAtSessionStart) {
      // It wires something that loads at session start → it MUST yield a reactivation
      // step, else `setup done` would silently omit a vendor that needs a fresh session.
      assert(
        step !== undefined && step.length > 0,
        `"${name}" wires MCP, hooks, or project rules but reactivationStep returned ` +
          `none — the setup-done handoff would skip a vendor that needs reactivating`,
      );
      assert(
        step.includes(`\`${activation.command}\``) &&
          step.includes(activation.recovery) &&
          step.includes(`\`${ACTIVATION_CLI_CHECK}\``) &&
          step.includes("confirmed only when") &&
          step.includes(ACTIVATION_TOOL_INVENTORY_ACTION) &&
          step.includes("`discern doctor`"),
        `"${name}" must serve one exact local check, its registry-owned ` +
          "recovery, and the canonical CLI fallback without inferring activation",
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
      if (provider.humanSetupAdvice !== undefined) {
        assert(
          step.includes(provider.humanSetupAdvice.handoff),
          `"${name}" declares human-facing setup advice, but its setup-done ` +
            "handoff omits it",
        );
        assert(
          !step.includes(".."),
          `"${name}" setup handoff joins its instructions with duplicate punctuation`,
        );
      }
    } else {
      // It wires nothing that loads at session start (a reuse-canonical agent with no
      // MCP, hooks, or project rules) → it MUST NOT be told to restart for nothing.
      assert(
        step === undefined,
        `"${name}" wires neither MCP, hooks, nor project rules, yet reactivationStep ` +
          `returned a step — it would be told to start a fresh session for nothing`,
      );
    }
  }
});
