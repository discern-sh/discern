/**
 * Whether setup's `next_action` is one directly runnable shell command.
 *
 * The value is guidance, not an execution surface, but a compound such as
 * `git init && discern setup verify` makes machine consumers guess where the
 * first action ends. Scan shell quoting so user-supplied values remain legal
 * when the retry renderer has safely single-quoted them, while executable
 * control operators and command substitution remain forbidden.
 */
import type { DiscernResult } from "./result.ts";

/** Return whether setup guidance contains one directly runnable command. */
export function isSingleRunnableSetupCommand(command: string): boolean {
  const text = command.trim();
  if (text === "") return false;

  let quote: "single" | "double" | undefined;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) continue;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== "single" && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" && quote !== "double") {
      quote = quote === "single" ? undefined : "single";
      continue;
    }
    if (char === '"' && quote !== "single") {
      quote = quote === "double" ? undefined : "double";
      continue;
    }
    if (quote === "single") continue;

    if (char === "`" || (char === "$" && text[index + 1] === "(")) {
      return false;
    }
    if (quote === undefined && /[\n\r;&|]/.test(char)) {
      return false;
    }
  }
  return quote === undefined && !escaped;
}

const SETUP_RESULT_VERBS = new Set([
  "setup",
  "setup begin",
  "setup verify",
  "setup step",
  "setup done",
  "setup accept",
]);

/** Whether an emitted result belongs to setup's single-command journey. */
export function isSetupResultVerb(verb: string): boolean {
  return SETUP_RESULT_VERBS.has(verb);
}

/** The safe diagnostic route when setup itself crashes unexpectedly. */
export const SETUP_CRASH_NEXT_ACTION = "discern doctor" as const;

/** Add the outer boundary's retry command when a generic refusal interrupts a
 * setup route before the route-specific result can be built. Existing payload
 * facts and route-owned commands always win. */
export function withSetupResultNextAction(
  result: DiscernResult,
  fallback: string,
): DiscernResult {
  if (!isSetupResultVerb(result.verb)) return result;
  const source = typeof result.data === "object" && result.data !== null
    ? result.data as Record<string, unknown>
    : {};
  if (source.next_action !== undefined) return result;
  if (!isSingleRunnableSetupCommand(fallback)) {
    throw new Error(
      `internal setup result invariant: ${result.verb} fallback must be one runnable command`,
    );
  }
  return {
    ...result,
    data: { ...source, next_action: fallback },
  };
}

/** Fail a quiet setup result that does not carry its single-command route. */
export function assertSetupResultNextAction(result: {
  verb: string;
  data?: unknown;
}): void {
  if (!isSetupResultVerb(result.verb)) return;
  const data = result.data;
  const nextAction = typeof data === "object" && data !== null
    ? Reflect.get(data, "next_action")
    : undefined;
  if (
    typeof nextAction !== "string" ||
    !isSingleRunnableSetupCommand(nextAction)
  ) {
    throw new Error(
      `internal setup result invariant: ${result.verb} must carry one runnable data.next_action`,
    );
  }
}
