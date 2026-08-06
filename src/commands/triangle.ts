/**
 * `discern triangle` — the Easter egg behind the project mark: draw discern's
 * triangle as a triangle of triangles. The verb needs no project, config, or
 * network; the hidden-verb registry records why it stays out of the help
 * listing. On a capable interactive terminal the pyramid rises from its apex
 * before settling; everywhere else it prints once, complete.
 */

import { Logger } from "../lib/log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { TriangleData } from "../shared/result_schemas.ts";
import { DISCERN_MARK, DISCERN_WORDMARK } from "../shared/brand.ts";
import {
  DISCERN_TRIANGLE_MOTIFS,
  renderTrianglePyramid,
} from "../lib/triangle_art.ts";
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

/** The one pyramid geometry this surface draws. */
const PYRAMID_ROWS = 8;

/** Center a line under the pyramid's base without adding trailing padding. */
function centerUnderPyramid(line: string): string {
  const base = 2 * PYRAMID_ROWS - 1;
  const pad = Math.max(0, Math.floor((base - displayWidth(line)) / 2));
  return `${" ".repeat(pad)}${line}`;
}

/** Compose the resting art: the pyramid signed with the wordmark at its base. */
export function renderTriangleArt(): string {
  return `${renderTrianglePyramid({ rows: PYRAMID_ROWS })}\n\n${
    centerUnderPyramid(DISCERN_WORDMARK)
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
 * the pyramid motif's timeline, so the gallery and the verb share one motion.
 */
export function planTriangleCommand(
  environment: TerminalAnimationEnvironment,
  options: { readonly plain: boolean },
): TriangleCommandPlan {
  const art = renderTriangleArt();
  const staticPlan = { mode: "static", output: `${art}\n` } as const;
  if (options.plain || !terminalAnimationAllowed(environment)) {
    return staticPlan;
  }
  const animation = DISCERN_TRIANGLE_MOTIFS.pyramid.animate();
  const playback = planTerminalPlayback(
    [{
      label: centerUnderPyramid(DISCERN_WORDMARK),
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
