/**
 * Shared fixtures for the `done --json` suites. The envelope tests split
 * across sibling files so `deno test --parallel` (which distributes per FILE)
 * can spread their serial `done` runs over workers; the helpers live here, in
 * a non-test module, because importing one _test.ts from another would
 * re-register its tests under the importer's runner.
 */

import { assert } from "@std/assert";
import { pathExists } from "../src/shared/fs_presence.ts";
import {
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

export { pathExists };

type DoneEnvelope = CliResultForCommand<"done">;
type DoneGateData = Extract<
  NonNullable<DoneEnvelope["data"]>,
  { failed_stage: unknown }
>;
type DoneGateEnvelope = DoneEnvelope & { data: DoneGateData };
type DoneStep = NonNullable<DoneEnvelope["steps"]>[number];
type DoneDiagnostic = NonNullable<DoneEnvelope["diagnostics"]>[number];

/** Distinguish a completed Gate result from a config-issue done refusal. */
function hasGateData(result: DoneEnvelope): result is DoneGateEnvelope {
  return result.data !== undefined && "failed_stage" in result.data;
}

/** Validate `done --json` stdout and require its completed Gate data variant. */
export function decodeGateResult(stdout: string): DoneGateEnvelope {
  const result = decodeCliResult(stdout, "done");
  assert(
    hasGateData(result),
    `expected done Gate data, got ${JSON.stringify(result.data)}`,
  );
  return result;
}

/** Find the executed step with a requested label in a validated done result. */
export function stepFor(
  obj: DoneEnvelope,
  label: string,
): DoneStep {
  const step = obj.steps?.find((candidate) => candidate.label === label);
  assert(step, `expected step ${JSON.stringify(label)}`);
  return step;
}

/** Find the diagnostic for a requested tool in a validated done result. */
export function diagFor(
  obj: DoneEnvelope,
  tool: string,
): DoneDiagnostic | undefined {
  return obj.diagnostics?.find((diagnostic) => diagnostic.tool === tool);
}

/** Require every genuinely failed job or scope step to have a matching diagnostic tool. */
export function assertFailedStepsHaveDiagnostics(obj: DoneEnvelope): void {
  const failed = (obj.steps ?? []).filter((s) =>
    (s.kind === "job" || s.kind === "scope-gate") && s.outcome === "failed"
  );
  assert(failed.length > 0, "expected at least one genuinely failed job step");
  const tools = new Set((obj.diagnostics ?? []).map((d) => d.tool));
  for (const step of failed) {
    assert(
      tools.has(step.label),
      `failed step ${step.label} must yield a diagnostic: ${
        JSON.stringify(obj.diagnostics)
      }`,
    );
  }
}

/** Detect forbidden C0 bytes while allowing JSON-safe newlines and tabs. */
export function hasDroppedC0Control(s: string): boolean {
  return s.split("").some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 && code !== 0x0a && code !== 0x09;
  });
}
