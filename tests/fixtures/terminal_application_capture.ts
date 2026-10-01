/** Product-owned launch and readiness for the small terminal adoption fixture. */
import { fromFileUrl, join } from "@std/path";
import { assertChildDesignSystemGraph } from "../../scripts/local_design_system.ts";
import { ptySettledFrame } from "discern-design-system/cli/interactive/testing";
import { TERMINAL_APPLICATION_MINIMUM } from "discern-design-system/cli/interactive";
import type { PtyGeometry, PtyOutputCondition } from "./pty_process.ts";

export const APPLICATION_FIXTURE_ROOT = fromFileUrl(
  new URL("../../", import.meta.url),
);

/**
 * Command arguments keep compilation and package resolution in the consumer.
 * The child must load the same design-system build as the process projecting
 * its frames, so a config linking another build is refused here.
 */
export function applicationProcessArgs(
  config = join(APPLICATION_FIXTURE_ROOT, "deno.json"),
): string[] {
  assertChildDesignSystemGraph(config);
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

/**
 * Readiness requires a settled package frame at the observed kernel geometry,
 * painted after the phase began: a phase's own output usually holds only the
 * rows that changed, so the whole transcript is replayed.
 */
export function applicationFrameReady(
  size: PtyGeometry,
  content = "Refresh complete",
): PtyOutputCondition {
  const marker = size.columns < TERMINAL_APPLICATION_MINIMUM.columns ||
      size.rows < TERMINAL_APPLICATION_MINIMUM.rows
    ? "Too small"
    : content;
  return ptySettledFrame(
    size,
    `settled ${size.columns}x${size.rows} application frame`,
    (capture) => capture.text.includes(marker),
  );
}
