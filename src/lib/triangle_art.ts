/**
 * Pure, ANSI-free terminal patterns built from discern's four half-filled
 * triangles. Callers own colour, placement, capability checks, and time.
 */

import { displayWidth } from "./text.ts";
import {
  type DiscernArtAnimation,
  finishAnimation,
} from "../shared/brand_animation.ts";
import type { DiscernArtVariant } from "../shared/brand_art.ts";

/** The four marks, named once by their Unicode orientation and filled half. */
export const DISCERN_TRIANGLE_GLYPHS = Object.freeze(
  {
    upRight: "◮",
    upLeft: "◭",
    downLeft: "⧨",
    downRight: "⧩",
  } as const,
);

/** The tessellating order used by dividers, fields, and progress fills. */
export const DISCERN_TRIANGLE_WEAVE_CYCLE = Object.freeze(
  [
    DISCERN_TRIANGLE_GLYPHS.upRight,
    DISCERN_TRIANGLE_GLYPHS.downRight,
    DISCERN_TRIANGLE_GLYPHS.upLeft,
    DISCERN_TRIANGLE_GLYPHS.downLeft,
  ] as const,
);

/** The canonical phase order used by indeterminate activity indicators. */
export const DISCERN_TRIANGLE_SPINNER_CYCLE = Object.freeze(
  [
    DISCERN_TRIANGLE_GLYPHS.upRight,
    DISCERN_TRIANGLE_GLYPHS.upLeft,
    DISCERN_TRIANGLE_GLYPHS.downLeft,
    DISCERN_TRIANGLE_GLYPHS.downRight,
  ] as const,
);

const REVERSED_WEAVE_CYCLE = Object.freeze(
  [
    DISCERN_TRIANGLE_WEAVE_CYCLE[3],
    DISCERN_TRIANGLE_WEAVE_CYCLE[2],
    DISCERN_TRIANGLE_WEAVE_CYCLE[1],
    DISCERN_TRIANGLE_WEAVE_CYCLE[0],
  ] as const,
);
const EMPTY_TRACK_GLYPH = ".";
const STEPPER_PENDING_GLYPH = "·";
const STEPPER_CONNECTOR_GLYPH = "│";

/** Maximum visible cells one pure triangle frame may contain. */
export const MAX_TRIANGLE_ART_CELLS = 10_000;

type NonEmptyCycle = readonly [string, ...string[]];

/** Inputs for a rectangular tessellation of the canonical triangle cycle. */
export interface TrianglePatternOptions {
  readonly columns: number;
  readonly rows?: number;
  readonly phase?: number;
  /** Phase added to odd rows; `-1` creates the interlocking weave. */
  readonly oddRowPhase?: number;
  readonly direction?: "forward" | "reverse";
}

/** Inputs for a determinate triangle progress frame. */
export interface TriangleProgressOptions {
  readonly completed: number;
  readonly total: number;
  readonly width: number;
}

/** Layout inputs for a labeled triangle rule. */
export interface TriangleSectionRuleOptions {
  readonly width: number;
  readonly phase?: number;
}

/** State inputs for one frame of a vertical workflow stepper. */
export interface TriangleStepperOptions {
  readonly activeIndex: number;
}

/** State inputs for one frame of a moving packet on a dotted activity rail. */
export interface TriangleBeaconOptions {
  readonly width: number;
  readonly offset: number;
  readonly phase?: number;
}

/** Reject a dimension or phase before it reaches modulo or repetition logic. */
function assertSafeInteger(
  value: number,
  label: string,
  minimum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      `${label} must be a safe integer of at least ${minimum}; received ${value}`,
    );
  }
}

/** Bound a caller-controlled dimension before it reaches an allocation API. */
function assertArtDimension(
  value: number,
  label: string,
  minimum: number,
): void {
  assertSafeInteger(value, label, minimum);
  if (value > MAX_TRIANGLE_ART_CELLS) {
    throw new TypeError(
      `${label} must not exceed ${MAX_TRIANGLE_ART_CELLS}; received ${value}`,
    );
  }
}

/** Reject a composed multi-part frame once its total visible area is known. */
function assertFrameCellBudget(cells: number, label: string): void {
  if (!Number.isSafeInteger(cells) || cells > MAX_TRIANGLE_ART_CELLS) {
    throw new TypeError(
      `${label} must not exceed ${MAX_TRIANGLE_ART_CELLS} visible cells; received ${cells}`,
    );
  }
}

/** Return a stable non-negative index for positive or negative phase values. */
function normalizedIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

/** Read from a known non-empty cycle without a nullable modulo result. */
function cycleGlyph(cycle: NonEmptyCycle, index: number): string {
  return cycle[normalizedIndex(index, cycle.length)] ?? cycle[0];
}

/** Render a cycle prefix, including the zero-length fragments used in layouts. */
function renderCycle(
  length: number,
  phase: number,
  direction: "forward" | "reverse",
): string {
  const cycle = direction === "forward"
    ? DISCERN_TRIANGLE_WEAVE_CYCLE
    : REVERSED_WEAVE_CYCLE;
  const normalizedPhase = normalizedIndex(phase, cycle.length);
  return Array.from(
    { length },
    (_, index) => cycleGlyph(cycle, normalizedPhase + index),
  ).join("");
}

/** Floor a scaled proportion without rounding a sub-threshold value upward. */
function proportionalFloor(
  completed: number,
  total: number,
  units: number,
): number {
  const multiplied = completed * units;
  const scaled = Number.isFinite(multiplied)
    ? multiplied / total
    : (completed / total) * units;
  return Math.min(units, Math.floor(scaled));
}

/** Validate one user-authored label for safe single-line terminal composition. */
function assertTerminalLabel(label: string, name: string): void {
  if (label === "" || label.trim() !== label) {
    throw new TypeError(`${name} must be non-empty with no outer whitespace`);
  }
  for (const character of label) {
    if (/\p{Cc}|\p{Cf}/u.test(character)) {
      throw new TypeError(
        `${name} must contain no terminal control characters`,
      );
    }
  }
}

/**
 * Render a one- or multi-row triangle pattern. Odd rows are phase-shifted by
 * default, producing the interlocking vertical weave from the same authority.
 */
export function renderTrianglePattern(
  options: TrianglePatternOptions,
): string {
  assertArtDimension(options.columns, "triangle pattern columns", 1);
  const rows = options.rows ?? 1;
  const phase = options.phase ?? 0;
  const oddRowPhase = options.oddRowPhase ?? -1;
  assertArtDimension(rows, "triangle pattern rows", 1);
  assertFrameCellBudget(options.columns * rows, "triangle pattern area");
  if (!Number.isSafeInteger(phase)) {
    throw new TypeError(
      `triangle pattern phase must be a safe integer; received ${phase}`,
    );
  }
  if (!Number.isSafeInteger(oddRowPhase)) {
    throw new TypeError(
      `triangle pattern oddRowPhase must be a safe integer; received ${oddRowPhase}`,
    );
  }
  const direction = options.direction ?? "forward";
  if (direction !== "forward" && direction !== "reverse") {
    throw new TypeError(
      `triangle pattern direction must be "forward" or "reverse"; received ${
        JSON.stringify(direction)
      }`,
    );
  }
  const normalizedPhase = normalizedIndex(
    phase,
    DISCERN_TRIANGLE_WEAVE_CYCLE.length,
  );
  const normalizedOddRowPhase = normalizedIndex(
    oddRowPhase,
    DISCERN_TRIANGLE_WEAVE_CYCLE.length,
  );
  return Array.from({ length: rows }, (_, row) =>
    renderCycle(
      options.columns,
      normalizedPhase + (row % 2 === 0 ? 0 : normalizedOddRowPhase),
      direction,
    )).join("\n");
}

/** Render one phase of the canonical indeterminate spinner. */
export function renderTriangleSpinnerFrame(index: number): string {
  if (!Number.isSafeInteger(index)) {
    throw new TypeError(
      `triangle spinner index must be a safe integer; received ${index}`,
    );
  }
  return cycleGlyph(DISCERN_TRIANGLE_SPINNER_CYCLE, index);
}

/** Render one truthful determinate-progress frame without overstating progress. */
export function renderTriangleProgress(
  options: TriangleProgressOptions,
): string {
  if (!Number.isFinite(options.total) || options.total <= 0) {
    throw new TypeError(
      `triangle progress total must be a positive finite number; received ${options.total}`,
    );
  }
  if (
    !Number.isFinite(options.completed) || options.completed < 0 ||
    options.completed > options.total
  ) {
    throw new TypeError(
      `triangle progress completed must be finite and between 0 and ${options.total}; received ${options.completed}`,
    );
  }
  assertArtDimension(options.width, "triangle progress width", 1);

  const percentage = proportionalFloor(options.completed, options.total, 100);
  const filled = proportionalFloor(
    options.completed,
    options.total,
    options.width,
  );
  const label = `[${percentage}%] `;
  assertFrameCellBudget(
    displayWidth(label) + options.width,
    "triangle progress frame",
  );
  return `${label}${renderCycle(filled, 0, "forward")}${
    EMPTY_TRACK_GLYPH.repeat(options.width - filled)
  }`;
}

/** Render a centered label with forward and reflected triangle arms. */
export function renderTriangleSectionRule(
  label: string,
  options: TriangleSectionRuleOptions,
): string {
  assertTerminalLabel(label, "triangle section-rule label");
  assertArtDimension(options.width, "triangle section-rule width", 1);
  const phase = options.phase ?? 0;
  if (!Number.isSafeInteger(phase)) {
    throw new TypeError(
      `triangle section-rule phase must be a safe integer; received ${phase}`,
    );
  }
  const labelWidth = displayWidth(label);
  const minimumWidth = labelWidth + 4;
  if (options.width < minimumWidth) {
    throw new TypeError(
      `triangle section-rule width must be at least ${minimumWidth} for ${
        JSON.stringify(label)
      }; received ${options.width}`,
    );
  }
  const armCells = options.width - labelWidth - 2;
  const leftCells = Math.floor(armCells / 2);
  const rightCells = armCells - leftCells;
  const normalizedPhase = normalizedIndex(
    phase,
    DISCERN_TRIANGLE_WEAVE_CYCLE.length,
  );
  const leftArm = renderCycle(leftCells, normalizedPhase, "forward");
  const reflectedLeft = [...leftArm].reverse().join("");
  const outerExtension = rightCells === leftCells
    ? ""
    : renderCycle(1, normalizedPhase - 1, "forward");
  return `${leftArm} ${label} ${reflectedLeft}${outerExtension}`;
}

/** Resolve one step marker without duplicating its semantic state logic. */
function stepperMarker(index: number, activeIndex: number): string {
  const phase = renderTriangleSpinnerFrame(index);
  return index < activeIndex
    ? phase
    : index === activeIndex
    ? `[${phase}]`
    : STEPPER_PENDING_GLYPH;
}

/** Render one state of a vertical staged-work rail. */
export function renderTriangleStepper(
  steps: readonly string[],
  options: TriangleStepperOptions,
): string {
  assertArtDimension(steps.length, "triangle stepper steps", 1);
  assertSafeInteger(options.activeIndex, "triangle stepper activeIndex", 0);
  if (options.activeIndex >= steps.length) {
    throw new TypeError(
      `triangle stepper activeIndex must be below ${steps.length}; received ${options.activeIndex}`,
    );
  }
  let frameCells = 0;
  for (const [index, step] of steps.entries()) {
    assertTerminalLabel(step, `triangle stepper step ${index + 1}`);
    frameCells += displayWidth(stepperMarker(index, options.activeIndex)) + 1 +
      displayWidth(step);
    if (index < steps.length - 1) {
      frameCells += displayWidth(STEPPER_CONNECTOR_GLYPH);
    }
    assertFrameCellBudget(frameCells, "triangle stepper frame");
  }

  const lines: string[] = [];
  for (const [index, step] of steps.entries()) {
    lines.push(`${stepperMarker(index, options.activeIndex)} ${step}`);
    if (index < steps.length - 1) {
      lines.push(STEPPER_CONNECTOR_GLYPH);
    }
  }
  return lines.join("\n");
}

/** Render one state of a four-glyph activity packet moving over a fixed rail. */
export function renderTriangleBeacon(options: TriangleBeaconOptions): string {
  assertArtDimension(options.width, "triangle beacon width", 4);
  assertSafeInteger(options.offset, "triangle beacon offset", 0);
  const phase = options.phase ?? 0;
  if (!Number.isSafeInteger(phase)) {
    throw new TypeError(
      `triangle beacon phase must be a safe integer; received ${phase}`,
    );
  }
  const packetWidth = DISCERN_TRIANGLE_WEAVE_CYCLE.length;
  const maximumOffset = options.width - packetWidth;
  if (options.offset > maximumOffset) {
    throw new TypeError(
      `triangle beacon offset must be at most ${maximumOffset}; received ${options.offset}`,
    );
  }
  return `${EMPTY_TRACK_GLYPH.repeat(options.offset)}${
    renderCycle(packetWidth, phase, "forward")
  }${EMPTY_TRACK_GLYPH.repeat(maximumOffset - options.offset)}`;
}

const DIVIDER = Object.freeze({ columns: 32 });
const RIBBON = Object.freeze({ columns: 24, rows: 3 });
const WEAVE = Object.freeze({ columns: 4, rows: 8 });
const PROGRESS = Object.freeze({ completed: 25, total: 100, width: 40 });
const SECTION_LABEL = "quality gate";
const SECTION_RULE = Object.freeze({ width: 30 });
const STEPS = Object.freeze(["inspect", "plan", "apply", "verify"] as const);
const BEACON = Object.freeze({ width: 32, offset: 14 });

/** Render the static storyboard that exposes every spinner phase without motion. */
function renderSpinnerStoryboard(): string {
  return `${DISCERN_TRIANGLE_SPINNER_CYCLE.join(" -> ")} -> (repeat)`;
}

/** Animate one triangle run growing across its eventual static width. */
function animateDivider(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [4, 8, 16, 24].map((columns) => renderTrianglePattern({ columns })),
    55,
    350,
  );
}

/** Build the thick rule one tessellated strand at a time. */
function animateRibbon(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [1, 2].map((rows) => renderTrianglePattern({ ...RIBBON, rows })),
    90,
    400,
  );
}

/** Reveal the vertical weave one interlocking row at a time. */
function animateWeave(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [1, 2, 3, 4, 5, 6, 7].map((rows) =>
      renderTrianglePattern({ ...WEAVE, rows })
    ),
    55,
    350,
  );
}

/** Rotate twice through the canonical spinner phases, then show its storyboard. */
function animateSpinner(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    Array.from({ length: 8 }, (_, index) => renderTriangleSpinnerFrame(index)),
    90,
    250,
  );
}

/** Fill the reference progress track to its authored 25 percent frame. */
function animateProgress(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 5, 10, 15, 20].map((completed) => {
      const frame = renderTriangleProgress({ ...PROGRESS, completed });
      return completed < 10 ? ` ${frame}` : frame;
    }),
    80,
    450,
  );
}

/** Keep the section label fixed while its visible arms extend in both directions. */
function renderGrowingSectionRule(visibleArmCells: number): string {
  const labelWidth = displayWidth(SECTION_LABEL);
  const finalLeftCells = Math.floor(
    (SECTION_RULE.width - labelWidth - 2) / 2,
  );
  const frameWidth = labelWidth + 2 + (visibleArmCells * 2);
  return `${" ".repeat(finalLeftCells - visibleArmCells)}${
    renderTriangleSectionRule(SECTION_LABEL, { width: frameWidth })
  }`;
}

/** Grow matching triangle arms away from the section label. */
function animateSectionRule(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [2, 4, 6].map(renderGrowingSectionRule),
    70,
    450,
  );
}

/** Advance the active bracket through each stage of the reference workflow. */
function animateStepper(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 1, 2].map((activeIndex) =>
      renderTriangleStepper(STEPS, { activeIndex })
    ),
    180,
    500,
  );
}

/** Send the activity packet out and back before it settles at the centre. */
function animateBeacon(staticArt: string): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 4, 8, 12, 16, 20, 24, 28, 24, 20, 16].map((offset, phase) =>
      renderTriangleBeacon({ width: BEACON.width, offset, phase })
    ),
    45,
    350,
  );
}

/**
 * Curated reusable triangle treatments. This registry is the single enrolment
 * boundary for the static and animated maintainer galleries.
 */
export const DISCERN_TRIANGLE_MOTIFS = {
  divider: {
    charset: "unicode",
    render: () => renderTrianglePattern(DIVIDER),
    animate: () => animateDivider(renderTrianglePattern(DIVIDER)),
  },
  ribbon: {
    charset: "unicode",
    render: () => renderTrianglePattern(RIBBON),
    animate: () => animateRibbon(renderTrianglePattern(RIBBON)),
  },
  weave: {
    charset: "unicode",
    render: () => renderTrianglePattern(WEAVE),
    animate: () => animateWeave(renderTrianglePattern(WEAVE)),
  },
  spinner: {
    charset: "unicode",
    render: renderSpinnerStoryboard,
    animate: () => animateSpinner(renderSpinnerStoryboard()),
  },
  progress: {
    charset: "unicode",
    render: () => renderTriangleProgress(PROGRESS),
    animate: () => animateProgress(renderTriangleProgress(PROGRESS)),
  },
  "section-rule": {
    charset: "unicode",
    render: () => renderTriangleSectionRule(SECTION_LABEL, SECTION_RULE),
    animate: () =>
      animateSectionRule(
        renderTriangleSectionRule(SECTION_LABEL, SECTION_RULE),
      ),
  },
  stepper: {
    charset: "unicode",
    render: () => renderTriangleStepper(STEPS, { activeIndex: 3 }),
    animate: () =>
      animateStepper(renderTriangleStepper(STEPS, { activeIndex: 3 })),
  },
  beacon: {
    charset: "unicode",
    render: () => renderTriangleBeacon(BEACON),
    animate: () => animateBeacon(renderTriangleBeacon(BEACON)),
  },
} as const satisfies Readonly<Record<string, DiscernArtVariant>>;

/** A name accepted by the curated triangle-motif registry. */
export type DiscernTriangleMotif = keyof typeof DISCERN_TRIANGLE_MOTIFS;
