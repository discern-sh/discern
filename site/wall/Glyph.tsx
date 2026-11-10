/** The one renderer for every wall glyph, on the server and in the browser alike. */
import type { CSSProperties, ReactElement } from "react";
import {
  drawPrimitive,
  GLYPH_GRID,
  type GlyphPoint,
  type GlyphPrimitive,
  type GlyphShape,
  gridShare,
} from "./glyph_grammar.ts";
import { glyphDrawing } from "./glyphs.ts";

type ShiftStyle =
  & CSSProperties
  & Record<"--wall-glyph-dx" | "--wall-glyph-dy", string>;

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
 * One drawing of the grid: the given primitives, in paint order. A drawing
 * that travels carries its distance for the stylesheet as a share of its own
 * side, so one value serves a glyph at any size.
 */
function Layer(
  props: {
    readonly className: string;
    readonly primitives: readonly GlyphPrimitive[];
    readonly shift?: GlyphPoint;
  },
): ReactElement {
  const style: ShiftStyle | undefined = props.shift === undefined
    ? undefined
    : {
      "--wall-glyph-dx": `${gridShare(props.shift[0])}%`,
      "--wall-glyph-dy": `${gridShare(props.shift[1])}%`,
    };
  return (
    <svg
      className={props.className}
      style={style}
      viewBox={`0 0 ${GLYPH_GRID} ${GLYPH_GRID}`}
      width={GLYPH_GRID}
      height={GLYPH_GRID}
      focusable="false"
    >
      {props.primitives.flatMap(drawPrimitive).map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  );
}

/**
 * Render the named glyph as a decorative square box. A name with no authored
 * glyph draws a seeded one, decided by the name alone, so the server and the
 * browser always agree and no card is ever blank.
 *
 * The box holds one drawing of the primitives that stay still. A primitive
 * that travels is a second drawing of the same grid, laid over the first, and
 * the stylesheet moves that whole drawing. The browser moves a box as one
 * piece and lays nothing out again. A shape that moves inside a drawing has
 * the browser lay out every drawing on the wall on each frame.
 */
export function Glyph(
  props: { readonly name: string; readonly className?: string },
): ReactElement {
  const className = props.className === undefined
    ? "wall-glyph"
    : `wall-glyph ${props.className}`;
  const drawing = glyphDrawing(props.name);
  return (
    <span className={className} aria-hidden="true" data-glyph={props.name}>
      <Layer
        className="wall-glyph-art"
        primitives={drawing.filter((primitive) =>
          primitive.shift === undefined
        )}
      />
      {drawing.map((primitive, index) =>
        primitive.shift === undefined ? null : (
          <Layer
            key={index}
            className="wall-glyph-move"
            primitives={[primitive]}
            shift={primitive.shift}
          />
        )
      )}
    </span>
  );
}
