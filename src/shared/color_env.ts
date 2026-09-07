/**
 * Colour hygiene at the child-process boundary.
 *
 * Setting `NO_COLOR` alone cannot turn a child's colour off: Deno — following
 * the wider FORCE_COLOR convention — lets an inherited `FORCE_COLOR` defeat
 * both `NO_COLOR` and non-TTY detection, so a spawn site that sets only
 * `NO_COLOR` still receives ANSI-decorated output under a colour-forcing
 * invoking environment (agent harness shells commonly export `FORCE_COLOR=3`).
 * Every spawn that needs plain, parseable child output therefore resolves BOTH
 * variables through {@link colorResolvedEnv} — the single authority for that
 * decision — and machine parsers additionally strip escapes with
 * {@link stripAnsi} rather than trusting environment hygiene alone.
 * A structural guard (tests/engine_color_contract_test.ts) fails any spawn-env
 * literal that sets `NO_COLOR` without resolving `FORCE_COLOR` beside it.
 */

/**
 * Spawn-env entries that resolve a child's colour OFF: `NO_COLOR` set, and
 * `FORCE_COLOR` blanked — empty means unset, so an inherited value can't
 * recolour spawned output.
 */
export function colorResolvedEnv(): Record<string, string> {
  return { NO_COLOR: "1", FORCE_COLOR: "" };
}

/** The ESC byte, built without a control-character regex literal. */
const ESC = String.fromCharCode(27);

/** Every ANSI CSI escape sequence, colour SGR included. */
const ANSI_ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** Remove ANSI escape sequences so machine parsing sees only the text. */
export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_ESCAPES, "");
}
