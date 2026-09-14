/** Product admission and evidence around the package's generic PTY transport. */
import {
  type PtyProcessOptions as PackagePtyProcessOptions,
  type PtyProcessResult,
  runPtyProcess as packageRunPtyProcess,
} from "discern-design-system/cli/interactive/testing";
import {
  claimRealPtyBoundary,
  recordRealPtyProcessEvidence,
} from "../real_pty.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "../waiting.ts";

export { ptyOutputContains } from "discern-design-system/cli/interactive/testing";
export type {
  PtyGeometry,
  PtyInputPhase,
  PtyInputStep,
  PtyKeyframeCapture,
  PtyObservedOutput,
  PtyOutputCondition,
  PtyProcessResult,
} from "discern-design-system/cli/interactive/testing";

/** Readiness inherits the repository allowance; transport tests may select completion. */
export type PtyProcessOptions = Omit<
  PackagePtyProcessOptions,
  "readinessTimeoutMs"
>;

/** Claim the real-PTY contract before the package can validate or launch anything. */
export async function runPtyProcess(
  options: PtyProcessOptions,
): Promise<PtyProcessResult> {
  const boundary = claimRealPtyBoundary();
  const result = await packageRunPtyProcess({
    ...options,
    env: {
      TERM: "xterm-256color",
      COLORTERM: "",
      LANG: "en_US.UTF-8",
      LC_ALL: "",
      CI: "false",
      NO_COLOR: "",
      FORCE_COLOR: "",
      ...(options.geometry === undefined ? {} : {
        COLUMNS: String(options.geometry.columns),
        LINES: String(options.geometry.rows),
      }),
      ...options.env,
    },
    timeoutMs: options.timeoutMs ?? TEST_PROCESS_TIMEOUT_MS,
    readinessTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
  });
  recordRealPtyProcessEvidence(boundary, {
    phase: options.input === undefined
      ? options.initialInput === undefined
        ? "no scripted input"
        : "initial input complete"
      : `phase ${options.input.length}/${options.input.length} complete`,
    readiness: options.input?.map(({ waitFor }) =>
      typeof waitFor === "object" && !Array.isArray(waitFor) &&
        "description" in waitFor
        ? waitFor.description
        : JSON.stringify(waitFor)
    ) ?? [],
    transcript: result.transcript,
  });
  return result;
}
