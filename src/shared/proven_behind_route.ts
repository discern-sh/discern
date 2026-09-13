/**
 * The proven-behind routing sentences: how status tells an agent that a clean
 * HEAD with honored Proof routes to acceptance when the trunk moved on. The
 * `status-proven-behind` registry entry delegates here; the authority variant
 * mirrors the up-to-date ready family's decision structure.
 */

/** The resolved landing authority the routing sentence adapts to. */
export type ProvenBehindAuthority =
  | { kind: "effort-grant" }
  | { kind: "standing-grant"; scopes: readonly string[] }
  | { kind: "uncovered" }
  | { kind: "review" };

/** Compose the complete hint text; `acceptCommand` is the surface-rendered
 * command reference the registry supplies. */
export function provenBehindRouteText(
  trunk: string,
  authority: ProvenBehindAuthority,
  acceptCommand: string,
): string {
  const middle = authority.kind === "effort-grant"
    ? `The owner pre-authorized this landing at the desk: run ${acceptCommand} now.`
    : authority.kind === "standing-grant"
    ? `The standing grant for ${
      authority.scopes.join(", ")
    } covers it: run ${acceptCommand} now.`
    : `Report this branch to your owner in your own words, end with the result's Proof line verbatim, ${
      authority.kind === "uncovered"
        ? "then stop: the recorded grant does not cover this landing."
        : "then wait."
    } When the owner accepts it, run ${acceptCommand} directly.`;
  return `This clean HEAD is committed with honored Proof; ${trunk} moved on beneath it, which withdraws nothing — no update or new Proof is owed for that. ${middle} ${acceptCommand} composes and checks the combined code in a disposable integration worktree and lands the exact proven result; a conflict, a failed combined check, or a renewed checkpoint judgment names its own next step.`;
}
