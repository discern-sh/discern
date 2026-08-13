/**
 * Discern's terminal-art adapters over the published design-system triangle
 * authority. Reusable motifs call package renderers byte-for-byte; only the
 * product-specific pyramid and recursive gasket remain composed here.
 */

import {
  DISCERN_TRIANGLE_ASCII_GLYPHS,
  DISCERN_TRIANGLE_GLYPHS,
  DISCERN_TRIANGLE_SPINNER_ORDER,
  DISCERN_TRIANGLE_WEAVE_ORDER,
  measureText,
  renderTriangleActivityBeacon,
  renderTrianglePattern,
  renderTriangleProgressFrame,
  renderTriangleSectionRule,
  renderTriangleSpinnerFrame,
  renderTriangleWorkflowStepper,
  type TerminalCapabilities,
} from "discern-design-system/cli";
import { type DiscernArtAnimation, finishAnimation } from "./animation.ts";
import type { DiscernArtVariant } from "./brand.ts";

export {
  DISCERN_TRIANGLE_ASCII_GLYPHS,
  DISCERN_TRIANGLE_GLYPHS,
  DISCERN_TRIANGLE_SPINNER_ORDER,
  DISCERN_TRIANGLE_WEAVE_ORDER,
};

/** Maximum visible cells one product-specific triangle frame may contain. */
export const MAX_TRIANGLE_ART_CELLS = 10_000;

/** Stable package inputs used by the ANSI-free maintainer gallery. */
export const TRIANGLE_GALLERY_CAPABILITIES: TerminalCapabilities = Object
  .freeze({
    colorDepth: "none",
    columns: 120,
    unicode: true,
  });

/** Layout inputs for a centered solid pyramid of package-owned glyphs. */
export interface TrianglePyramidOptions {
  readonly rows: number;
  readonly phase?: number;
  readonly capabilities?: TerminalCapabilities;
}

/** Layout inputs for one subdivision state of Discern's recursive figure. */
export interface TriangleGasketOptions {
  readonly rows: number;
  /** Subdivision rounds opened; defaults to the full depth for `rows`. */
  readonly levels?: number;
  readonly phase?: number;
  readonly capabilities?: TerminalCapabilities;
}

type TriangleName = keyof typeof DISCERN_TRIANGLE_GLYPHS;

/** Reject a dimension or phase before it reaches allocation or modulo logic. */
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

/** Bound a caller-controlled product-art dimension before allocation. */
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

/** Reject a composed product frame once its total visible area is known. */
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

/**
 * Select one package-owned glyph for a product composition. This is deliberately
 * not a generic pattern renderer: package renderTrianglePattern owns that job.
 */
function productGlyph(
  position: number,
  phase: number,
  capabilities: TerminalCapabilities,
): string {
  const index = normalizedIndex(
    position + phase,
    DISCERN_TRIANGLE_WEAVE_ORDER.length,
  );
  const name = DISCERN_TRIANGLE_WEAVE_ORDER[index] ??
    DISCERN_TRIANGLE_WEAVE_ORDER[0];
  const glyphs: Readonly<Record<TriangleName, string>> = capabilities.unicode
    ? DISCERN_TRIANGLE_GLYPHS
    : DISCERN_TRIANGLE_ASCII_GLYPHS;
  return glyphs[name];
}

/** Render Discern's solid pyramid from package glyph and order constants. */
export function renderTrianglePyramid(
  options: TrianglePyramidOptions,
): string {
  assertArtDimension(options.rows, "triangle pyramid rows", 1);
  const phase = options.phase ?? 0;
  assertSafeInteger(phase, "triangle pyramid phase", Number.MIN_SAFE_INTEGER);
  assertFrameCellBudget(options.rows * options.rows, "triangle pyramid area");
  const capabilities = options.capabilities ?? TRIANGLE_GALLERY_CAPABILITIES;
  return Array.from(
    { length: options.rows },
    (_, row) => {
      const cells = Array.from(
        { length: 2 * row + 1 },
        (_, position) => productGlyph(position, phase, capabilities),
      ).join("");
      return `${" ".repeat(options.rows - 1 - row)}${cells}`;
    },
  ).join("\n");
}

/** Decide whether one pyramid cell survives the requested subdivisions. */
function gasketCellSurvives(
  row: number,
  position: number,
  rows: number,
  levels: number,
): boolean {
  let size = rows;
  let localRow = row;
  let localPosition = position;
  for (let remaining = levels; remaining > 0 && size > 1; remaining -= 1) {
    const half = size / 2;
    if (localRow < half) {
      size = half;
      continue;
    }
    const lowerRow = localRow - half;
    if (localPosition <= 2 * lowerRow) {
      localRow = lowerRow;
      size = half;
      continue;
    }
    if (localPosition < 2 * half) return false;
    localRow = lowerRow;
    localPosition -= 2 * half;
    size = half;
  }
  return true;
}

/** Render Discern's Sierpinski gasket over package-owned triangle glyphs. */
export function renderTriangleGasket(
  options: TriangleGasketOptions,
): string {
  assertArtDimension(options.rows, "triangle gasket rows", 1);
  if ((options.rows & (options.rows - 1)) !== 0) {
    throw new TypeError(
      `triangle gasket rows must be a power of two; received ${options.rows}`,
    );
  }
  const fullDepth = Math.log2(options.rows);
  const levels = options.levels ?? fullDepth;
  assertSafeInteger(levels, "triangle gasket levels", 0);
  if (levels > fullDepth) {
    throw new TypeError(
      `triangle gasket levels must not exceed ${fullDepth} for ${options.rows} rows; received ${levels}`,
    );
  }
  const phase = options.phase ?? 0;
  assertSafeInteger(phase, "triangle gasket phase", Number.MIN_SAFE_INTEGER);
  assertFrameCellBudget(options.rows * options.rows, "triangle gasket area");
  const capabilities = options.capabilities ?? TRIANGLE_GALLERY_CAPABILITIES;
  return Array.from({ length: options.rows }, (_, row) => {
    let cells = "";
    for (let position = 0; position < 2 * row + 1; position += 1) {
      cells += gasketCellSurvives(row, position, options.rows, levels)
        ? productGlyph(position, phase, capabilities)
        : " ";
    }
    return `${" ".repeat(options.rows - 1 - row)}${cells}`;
  }).join("\n");
}

const DIVIDER = Object.freeze({ length: 32 });
const RIBBON = Object.freeze({ length: 24, thickness: 3 });
const WEAVE = Object.freeze({
  length: 8,
  orientation: "vertical" as const,
  thickness: 4,
});
const PROGRESS = Object.freeze({ completed: 25, total: 100, width: 40 });
const SECTION_LABEL = "quality gate";
const SECTION_RULE = Object.freeze({ width: 30 });
const STEPS = Object.freeze(["inspect", "plan", "apply", "verify"] as const);
const BEACON = Object.freeze({ width: 32, phase: 14 });
const PYRAMID = Object.freeze({ rows: 8 });
const GASKET = Object.freeze({ rows: 8 });

function packagePattern(
  options: Parameters<typeof renderTrianglePattern>[0],
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return renderTrianglePattern(options, capabilities);
}

function packageProgress(
  options: Parameters<typeof renderTriangleProgressFrame>[0],
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return renderTriangleProgressFrame(options, capabilities);
}

function packageSectionRule(
  label: string,
  options: Parameters<typeof renderTriangleSectionRule>[1],
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return renderTriangleSectionRule(
    label,
    options,
    capabilities,
  );
}

function packageStepper(
  activeIndex: number,
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return renderTriangleWorkflowStepper(
    STEPS.map((label, index) => ({
      label,
      status: index < activeIndex
        ? "complete" as const
        : index === activeIndex
        ? "active" as const
        : "pending" as const,
      phase: index,
    })),
    capabilities,
  );
}

function packageBeacon(
  phase: number,
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  return renderTriangleActivityBeacon(
    { ...BEACON, phase },
    capabilities,
  );
}

/** Render the package spinner order as a static, inspectable storyboard. */
function renderSpinnerStoryboard(
  capabilities: TerminalCapabilities = TRIANGLE_GALLERY_CAPABILITIES,
): string {
  const frames = DISCERN_TRIANGLE_SPINNER_ORDER.map((_, phase) =>
    renderTriangleSpinnerFrame(phase, capabilities)
  );
  return `${frames.join(" -> ")} -> (repeat)`;
}

function animateDivider(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [4, 8, 16, 24].map((length) => packagePattern({ length }, capabilities)),
    55,
    350,
  );
}

function animateRibbon(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [1, 2].map((thickness) =>
      packagePattern({ ...RIBBON, thickness }, capabilities)
    ),
    90,
    400,
  );
}

function animateWeave(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [1, 2, 3, 4, 5, 6, 7].map((length) =>
      packagePattern({ ...WEAVE, length }, capabilities)
    ),
    55,
    350,
  );
}

function animateSpinner(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    Array.from(
      { length: DISCERN_TRIANGLE_SPINNER_ORDER.length * 2 },
      (_, phase) => renderTriangleSpinnerFrame(phase, capabilities),
    ),
    90,
    250,
  );
}

function animateProgress(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 5, 10, 15, 20].map((completed) =>
      packageProgress({ ...PROGRESS, completed }, capabilities)
    ),
    80,
    450,
  );
}

function renderGrowingSectionRule(
  visibleArmCells: number,
  capabilities: TerminalCapabilities,
): string {
  const labelWidth = measureText(SECTION_LABEL);
  const finalLeftCells = Math.floor(
    (SECTION_RULE.width - labelWidth - 2) / 2,
  );
  const frameWidth = labelWidth + 2 + visibleArmCells * 2;
  return `${" ".repeat(finalLeftCells - visibleArmCells)}${
    packageSectionRule(SECTION_LABEL, { width: frameWidth }, capabilities)
  }`;
}

function animateSectionRule(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [2, 4, 6].map((cells) => renderGrowingSectionRule(cells, capabilities)),
    70,
    450,
  );
}

function animateStepper(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 1, 2].map((activeIndex) => packageStepper(activeIndex, capabilities)),
    180,
    500,
  );
}

function animateBeacon(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((phase) =>
      packageBeacon(phase, capabilities)
    ),
    45,
    350,
  );
}

function animatePyramid(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  return finishAnimation(
    staticArt,
    [
      ...[1, 2, 3, 4, 5, 6, 7].map((rows) =>
        staticArt.split("\n").slice(0, rows).join("\n")
      ),
      renderTrianglePyramid({ ...PYRAMID, phase: 2, capabilities }),
    ],
    90,
    400,
  );
}

function animateGasket(
  staticArt: string,
  capabilities: TerminalCapabilities,
): DiscernArtAnimation {
  const woven = renderTriangleGasket({ ...GASKET, levels: 0, capabilities });
  const rows = woven.split("\n");
  return finishAnimation(
    staticArt,
    [
      ...rows.slice(0, -1).map((_, index) =>
        rows.slice(0, index + 1).join("\n")
      ),
      woven,
      ...Array.from(
        { length: Math.log2(GASKET.rows) - 1 },
        (_, level) =>
          renderTriangleGasket({
            ...GASKET,
            levels: level + 1,
            capabilities,
          }),
      ),
    ],
    90,
    400,
  );
}

/**
 * Reusable gallery entries. Each static renderer is an adapter over one public
 * package API with explicit capabilities; no reusable motif is implemented here.
 */
export const DISCERN_PACKAGE_TRIANGLE_MOTIFS = {
  divider: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packagePattern(DIVIDER, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateDivider(packagePattern(DIVIDER, capabilities), capabilities),
  },
  ribbon: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packagePattern(RIBBON, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateRibbon(packagePattern(RIBBON, capabilities), capabilities),
  },
  weave: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packagePattern(WEAVE, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateWeave(packagePattern(WEAVE, capabilities), capabilities),
  },
  spinner: {
    charset: "unicode",
    render: renderSpinnerStoryboard,
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateSpinner(renderSpinnerStoryboard(capabilities), capabilities),
  },
  progress: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packageProgress(PROGRESS, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateProgress(packageProgress(PROGRESS, capabilities), capabilities),
  },
  "section-rule": {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packageSectionRule(SECTION_LABEL, SECTION_RULE, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateSectionRule(
        packageSectionRule(SECTION_LABEL, SECTION_RULE, capabilities),
        capabilities,
      ),
  },
  stepper: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packageStepper(3, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateStepper(packageStepper(3, capabilities), capabilities),
  },
  beacon: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      packageBeacon(BEACON.phase, capabilities),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateBeacon(packageBeacon(BEACON.phase, capabilities), capabilities),
  },
} as const satisfies Readonly<Record<string, DiscernArtVariant>>;

/** Discern-only compositions that the package intentionally does not own. */
export const DISCERN_PRODUCT_TRIANGLE_ART = {
  pyramid: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      renderTrianglePyramid({ ...PYRAMID, capabilities }),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animatePyramid(
        renderTrianglePyramid({ ...PYRAMID, capabilities }),
        capabilities,
      ),
  },
  gasket: {
    charset: "unicode",
    render: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      renderTriangleGasket({ ...GASKET, capabilities }),
    animate: (capabilities = TRIANGLE_GALLERY_CAPABILITIES) =>
      animateGasket(
        renderTriangleGasket({ ...GASKET, capabilities }),
        capabilities,
      ),
  },
} as const satisfies Readonly<Record<string, DiscernArtVariant>>;

/** A reusable package motif exposed by Discern's maintainer gallery. */
export type DiscernPackageTriangleMotif =
  keyof typeof DISCERN_PACKAGE_TRIANGLE_MOTIFS;

/** A product-specific triangle composition. */
export type DiscernProductTriangleArt =
  keyof typeof DISCERN_PRODUCT_TRIANGLE_ART;
