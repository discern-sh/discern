/** The one renderer for every wall glyph, on the server and in the browser alike. */
import type { CSSProperties, ReactElement } from "react";
import {
  drawPrimitive,
  GLYPH_GRID,
  type GlyphDrawing,
  type GlyphLayer,
  glyphLayers,
  type GlyphPose,
  type GlyphShape,
} from "./glyph_grammar.ts";
import { glyphDrawing } from "./glyphs.ts";

/**
 * The custom properties a moving drawing hands the stylesheet: its slide on
 * each axis, its turn, and the point the turn is about. The stylesheet reads
 * each with the value that moves nothing as its fallback, so a drawing
 * carries only the ones its pose sets.
 */
export const GLYPH_POSE_PROPERTIES = [
  "--wall-glyph-dx",
  "--wall-glyph-dy",
  "--wall-glyph-da",
  "--wall-glyph-px",
  "--wall-glyph-py",
] as const;

type PoseStyle =
  & CSSProperties
  & Partial<Record<(typeof GLYPH_POSE_PROPERTIES)[number], string>>;

/**
 * A pose as the stylesheet reads it. Lengths are shares of the drawing's own
 * side, so one value serves a glyph at any size.
 */
function poseStyle(pose: GlyphPose): PoseStyle {
  const style: PoseStyle = {};
  if (pose.slide !== undefined) {
    style["--wall-glyph-dx"] = `${pose.slide[0]}%`;
    style["--wall-glyph-dy"] = `${pose.slide[1]}%`;
  }
  if (pose.turn !== undefined) {
    style["--wall-glyph-da"] = `${pose.turn[0]}deg`;
    style["--wall-glyph-px"] = `${pose.turn[1]}%`;
    style["--wall-glyph-py"] = `${pose.turn[2]}%`;
  }
  return style;
}

/** One drawn element, painted by its tone's class, and marked when its stroke is dashed. */
function Shape({ shape }: { readonly shape: GlyphShape }): ReactElement {
  const tone = `wall-glyph-${shape.paint}`;
  const paint = {
    className: shape.dash === undefined ? tone : `${tone} wall-glyph-dashed`,
    strokeDasharray: shape.dash,
    transform: shape.turn === undefined
      ? undefined
      : `rotate(${shape.turn.join(" ")})`,
  };
  switch (shape.el) {
    case "circle":
      return <circle {...paint} cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case "rect":
      return (
        <rect
          {...paint}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
        />
      );
    case "path":
      return <path {...paint} d={shape.d} />;
  }
}

/**
 * One drawing of the grid: a layer's primitives, in paint order. The first
 * drawing gives the box its picture at rest. Every later one lies over it,
 * corner to corner, and a moving one carries its pose for the stylesheet.
 */
function Layer(
  props: { readonly layer: GlyphLayer; readonly first: boolean },
): ReactElement {
  const { pose, primitives } = props.layer;
  const className = pose !== undefined
    ? "wall-glyph-move"
    : props.first
    ? "wall-glyph-art"
    : "wall-glyph-art wall-glyph-over";
  return (
    <svg
      className={className}
      style={pose === undefined ? undefined : poseStyle(pose)}
      viewBox={`0 0 ${GLYPH_GRID} ${GLYPH_GRID}`}
      width={GLYPH_GRID}
      height={GLYPH_GRID}
      focusable="false"
    >
      {primitives.flatMap(drawPrimitive).map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  );
}

/**
 * Render a drawing as a decorative square box.
 *
 * The box holds one drawing of the grid for each layer `glyphLayers` divides
 * the glyph into, laid over each other in paint order. A still layer never
 * changes. The stylesheet slides and turns a moving layer as one whole
 * drawing: the browser moves a box as one piece and lays nothing out again,
 * where a shape that moves inside a drawing has it lay out every drawing on
 * the wall on each frame.
 */
export function DrawnGlyph(
  props: {
    readonly name: string;
    readonly drawing: GlyphDrawing;
    readonly className?: string;
  },
): ReactElement {
  const className = props.className === undefined
    ? "wall-glyph"
    : `wall-glyph ${props.className}`;
  return (
    <span className={className} aria-hidden="true" data-glyph={props.name}>
      {glyphLayers(props.drawing).map((layer, index) => (
        <Layer key={index} layer={layer} first={index === 0} />
      ))}
    </span>
  );
}

/**
 * Render the named glyph. A name with no authored glyph draws a seeded one,
 * decided by the name alone, so the server and the browser always agree and
 * no card is ever blank.
 */
export function Glyph(
  props: { readonly name: string; readonly className?: string },
): ReactElement {
  return <DrawnGlyph {...props} drawing={glyphDrawing(props.name)} />;
}
