/**
 * Shared fixtures for the `done --json` suites. The envelope tests split
 * across sibling files so `deno test --parallel` (which distributes per FILE)
 * can spread their serial `done` runs over workers; the helpers live here, in
 * a non-test module, because importing one _test.ts from another would
 * re-register its tests under the importer's runner.
 */

import { assert } from "@std/assert";
import { pathExists } from "../src/shared/fs_presence.ts";

export { pathExists };

/** A parsed `--json` envelope, deliberately loose: verb-specific data rides
 * in fields no shared type pins, and the assertions are the contract. */
export interface LooseEnvelope {
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

/** Decode a done envelope into the shared loose assertion shape. */
export function parseJson(stdout: string): LooseEnvelope {
  return JSON.parse(stdout.trim()) as LooseEnvelope;
}

/** The step with this label — typed loose (and trusted present, as each
 * assertion immediately checks it) like the envelope it came from. */
export function stepFor(obj: LooseEnvelope, label: string): LooseEnvelope {
  return obj.steps.find((s: { label: string }) => s.label === label);
}

/** The diagnostic for this tool, or undefined — call sites assert presence. */
export function diagFor(obj: LooseEnvelope, tool: string): LooseEnvelope {
  return (obj.diagnostics ?? []).find((d: { tool: string }) => d.tool === tool);
}

export interface JsonStep {
  kind: string;
  label: string;
  outcome: string;
}

export interface JsonDiagnostic {
  tool: string;
}

/** Require every genuinely failed job or scope step to have a matching diagnostic tool. */
export function assertFailedStepsHaveDiagnostics(obj: {
  steps?: JsonStep[];
  diagnostics?: JsonDiagnostic[];
}): void {
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
