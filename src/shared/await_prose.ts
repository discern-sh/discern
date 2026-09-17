/** Plain-language descriptions derived from the await condition and its observations. */
import type { AwaitData } from "./result_schemas.ts";
import {
  code,
  number,
  object,
  text,
  unique,
} from "./result_markdown_values.ts";

/** Keep the watch's target and revision context visible, including older partial records. */
export function awaitContextLines(
  data: Record<string, unknown>,
  condition?: AwaitData,
): string[] {
  const observed = object(data.observed) ?? {};
  return unique([
    ...(condition === undefined ? [] : [
      `Requested condition: ${awaitConditionDescription(condition)}.`,
      awaitObservationSentence(condition),
    ]),
    text(data.trunk) === undefined
      ? undefined
      : `Shared branch: ${code(data.trunk)}.`,
    text(observed.tip) === undefined
      ? undefined
      : `Observed task revision: ${code(observed.tip)}.`,
    text(observed.trunk_start) === undefined
      ? undefined
      : `Shared-branch revision at watch start: ${code(observed.trunk_start)}.`,
    text(observed.trunk_head) === undefined
      ? undefined
      : `Latest shared-branch revision: ${code(observed.trunk_head)}.`,
    number(data.timeout_s) === undefined
      ? undefined
      : `This observation window: ${number(data.timeout_s)} s.`,
  ]);
}

/** Explain the requested transition without requiring knowledge of condition codes. */
export function awaitConditionDescription(
  data: Pick<AwaitData, "condition" | "branch" | "trunk">,
): string {
  switch (data.condition) {
    case "green":
      return `required checks for \`${data.branch}\` to have valid completion evidence`;
    case "landed":
      return `the work from \`${data.branch}\` to reach \`${data.trunk}\``;
    case "trunk-moved":
      return `\`${data.trunk}\` to change from the revision at the start of this watch`;
    default:
      // Await conditions are an open vocabulary; describe an unknown one by name.
      return `the \`${data.condition}\` condition to hold`;
  }
}

/** Report the latest observed state without guessing why evidence is absent. */
export function awaitObservationSentence(
  data: Pick<AwaitData, "condition" | "trunk" | "observed">,
): string {
  const observed = data.observed;
  if (observed.landed === true) {
    return `The work has reached \`${data.trunk}\`.`;
  }
  if (data.condition === "trunk-moved") {
    return observed.trunk_head === undefined
      ? "The current shared-branch revision could not be read."
      : observed.trunk_head === observed.trunk_start
      ? `\`${data.trunk}\` has not changed since this watch started.`
      : `\`${data.trunk}\` has changed since this watch started.`;
  }
  if (data.condition === "landed") {
    return `The work has not reached \`${data.trunk}\` yet.`;
  }
  return observed.proof_status === "honored"
    ? "The latest changes have valid completion evidence."
    : `The latest changes do not yet have valid completion evidence (Proof: ${
      observed.proof_status ?? "unreadable"
    }).`;
}
