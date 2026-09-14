/** Product-owned launch and readiness for the small terminal adoption fixture. */
import { fromFileUrl, join } from "@std/path";
import { captureTerminalFrame } from "discern-design-system/cli/interactive/testing";
import { TERMINAL_APPLICATION_MINIMUM } from "discern-design-system/cli/interactive";
import { type PtyGeometry, type PtyOutputCondition } from "./pty_process.ts";

export const APPLICATION_FIXTURE_ROOT = fromFileUrl(
  new URL("../../", import.meta.url),
);

/** Command arguments keep compilation and package resolution in the consumer. */
export function applicationProcessArgs(
  config = join(APPLICATION_FIXTURE_ROOT, "deno.json"),
): string[] {
  return [
    "run",
    "--config",
    config,
    "-A",
    join(
      APPLICATION_FIXTURE_ROOT,
      "tests/fixtures/terminal_application_process.ts",
    ),
  ];
}

/** Readiness requires a complete package frame at the observed kernel geometry. */
export function applicationFrameReady(
  size: PtyGeometry,
  content = "Refresh complete",
): PtyOutputCondition {
  const marker = size.columns < TERMINAL_APPLICATION_MINIMUM.columns ||
      size.rows < TERMINAL_APPLICATION_MINIMUM.rows
    ? "Resize"
    : content;
  return {
    description: `complete ${size.columns}x${size.rows} application frame`,
    test: ({ phaseStdout }) => {
      try {
        return captureTerminalFrame(phaseStdout, size).frame.includes(marker);
      } catch {
        return false;
      }
    },
  };
}
