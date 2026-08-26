/** Synthetic future tooling kind used to prove registry enrollment. */

import {
  createToolTempDirCapability,
  type ToolTempDirOperationOverrides,
  type ToolTempDirPolicy,
  TOOL_TEMP_DIR_KINDS,
} from "../../scripts/temp_dir.ts";

/** One future evidence-retaining kind layered onto the live registry. */
export const FUTURE_TOOL_TEMP_DIR_KINDS = {
  ...TOOL_TEMP_DIR_KINDS,
  "future-evidence": {
    purpose: "future command evidence retained after callback failure",
    prefix: "discern-future-evidence-",
    recursiveCleanup: true,
    preserveOnFailure: true,
  },
} as const satisfies Readonly<Record<string, ToolTempDirPolicy>>;

/** Callback capability for the live registry plus the planted future kind. */
export type FutureToolTempDirCapability = <T>(
  kind: keyof typeof FUTURE_TOOL_TEMP_DIR_KINDS,
  fn: (dir: string) => T | Promise<T>,
) => Promise<T>;

/** Create the future-member capability with optional deterministic failures. */
export function futureToolTempDirCapability(
  overrides: ToolTempDirOperationOverrides = {},
): FutureToolTempDirCapability {
  return createToolTempDirCapability(FUTURE_TOOL_TEMP_DIR_KINDS, overrides);
}
