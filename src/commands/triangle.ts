/**
 * `discern triangle` — the surprise behind the project mark: draw discern's
 * triangle as a triangle of triangles. The verb needs no project, config, or
 * network; the hidden-verb registry records why it stays out of the help
 * listing. On a capable interactive terminal the woven pyramid rises from its
 * apex and opens into the recursive figure before settling; everywhere else
 * it prints once, complete.
 */

import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { TriangleData } from "../shared/result_schemas.ts";
import { DISCERN_MARK, DISCERN_WORDMARK } from "../shared/brand.ts";
import { DISCERN_PRODUCT_TRIANGLE_ART } from "../../art/terminal/triangle.ts";
import { TRIANGLE_GALLERY_CAPABILITIES } from "../../art/terminal/triangle.ts";
import type { TerminalCapabilities } from "discern-design-system/cli";
import {
  planTerminalPlayback,
  type TerminalPlaybackPlan,
} from "../lib/terminal_playback.ts";
import {
  observeTerminalAnimationEnvironment,
  runTerminalPlayback,
  terminalAnimationAllowed,
  type TerminalAnimationEnvironment,
  terminalPlaybackPort,
} from "../lib/terminal_animation.ts";
import { displayWidth } from "../lib/text.ts";
import { writeStdout } from "../engine/output.ts";

/** Options for {@link runTriangle}. */
export interface TriangleOptions {
  readonly json: boolean;
  readonly noColor: boolean;
  readonly plain: boolean;
}

/** The validated command decision computed before any terminal output. */
export type TriangleCommandPlan =
  | { readonly mode: "static"; readonly output: string }
  | { readonly mode: "animate"; readonly playback: TerminalPlaybackPlan };

/** The one figure this surface draws, owned by the curated motif registry. */
const FIGURE = DISCERN_PRODUCT_TRIANGLE_ART.gasket;

/** Center a line under the figure's base without adding trailing padding. */
function centerUnderFigure(line: string): string {
  const base = Math.max(
    ...FIGURE.render().split("\n").map((row) => displayWidth(row)),
  );
  const pad = Math.max(0, Math.floor((base - displayWidth(line)) / 2));
  return `${" ".repeat(pad)}${line}`;
}

/** Compose the resting art: the figure signed with the wordmark at its base. */
export function renderTriangleArt(
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return `${FIGURE.render(capabilities)}\n\n${
    centerUnderFigure(DISCERN_WORDMARK)
  }`;
}

/** Build the `triangle` result envelope (the core `--json` serializes). */
export function triangleResult(): DiscernResult<TriangleData> {
  return {
    ok: true,
    verb: "triangle",
    data: {
      mark: DISCERN_MARK,
      art: renderTriangleArt(),
    },
  };
}

/**
 * Decide between the one-shot print and the animated reveal. The reveal reuses
 * the gasket motif's timeline, so the gallery and the verb share one motion.
 */
export function planTriangleCommand(
  environment: TerminalAnimationEnvironment,
  options: { readonly plain: boolean },
): TriangleCommandPlan {
  const art = renderTriangleArt(environment.capabilities);
  const staticPlan = { mode: "static", output: `${art}\n` } as const;
  if (options.plain || !terminalAnimationAllowed(environment)) {
    return staticPlan;
  }
  const animation = FIGURE.animate(environment.capabilities);
  const playback = planTerminalPlayback(
    [{
      label: centerUnderFigure(DISCERN_WORDMARK),
      frames: animation.frames,
      frameMs: animation.frameMs,
      finalHoldMs: animation.finalHoldMs,
    }],
    {
      terminalColumns: environment.terminalColumns,
      terminalRows: environment.terminalRows,
      finalTranscript: art,
    },
  );
  return playback === null ? staticPlan : { mode: "animate", playback };
}

/** Run `discern triangle`; returns the process exit code. */
export async function runTriangle(options: TriangleOptions): Promise<number> {
  if (options.json) {
    const log = new Logger({ json: true, noColor: options.noColor });
    log.result(triangleResult());
    return 0;
  }
  const plan = planTriangleCommand(
    observeTerminalAnimationEnvironment(),
    options,
  );
  if (plan.mode === "static") {
    writeStdout(plan.output);
    return 0;
  }
  await runTerminalPlayback(plan.playback, terminalPlaybackPort(writeStdout));
  return 0;
}
