/** The one renderer for every wall glyph, on the server and in the browser alike. */
import type { CSSProperties, ReactElement } from "react";
import {
  drawPrimitive,
  GLYPH_GRID,
  type GlyphPrimitive,
  type GlyphShape,
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

/** One primitive's shapes, grouped when the primitive travels on hover. */
function Primitive(
  { primitive }: { readonly primitive: GlyphPrimitive },
): ReactElement {
  const shapes = drawPrimitive(primitive).map((shape, index) => (
    <Shape key={index} shape={shape} />
  ));
  if (primitive.shift === undefined) return <>{shapes}</>;
  const style: ShiftStyle = {
    "--wall-glyph-dx": `${primitive.shift[0]}px`,
    "--wall-glyph-dy": `${primitive.shift[1]}px`,
  };
  return <g className="wall-glyph-move" style={style}>{shapes}</g>;
}

/**
 * Render the named glyph as a decorative 48 by 48 drawing. A name with no
 * authored glyph draws a seeded one, decided by the name alone, so the server
 * and the browser always agree and no card is ever blank.
 */
export function Glyph(
  props: { readonly name: string; readonly className?: string },
): ReactElement {
  const className = props.className === undefined
    ? "wall-glyph"
    : `wall-glyph ${props.className}`;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${GLYPH_GRID} ${GLYPH_GRID}`}
      width={GLYPH_GRID}
      height={GLYPH_GRID}
      aria-hidden="true"
      focusable="false"
      data-glyph={props.name}
    >
      {glyphDrawing(props.name).map((primitive, index) => (
        <Primitive key={index} primitive={primitive} />
      ))}
    </svg>
  );
}
