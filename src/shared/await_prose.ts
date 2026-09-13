/** Plain-language descriptions derived from the await condition and its observations. */
import type { AwaitData } from "./result_schemas.ts";

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
