/**
 * Compose a social card as SVG: the site's dark canvas, the homepage's
 * wall motif, the brand lockup, and text set as glyph outlines. One
 * frame serves every page; each card kind arranges its own text within it.
 */

import { createElement, Fragment, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DISCERN_ACCENT_HUE } from "../../src/shared/brand.ts";
import {
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
  DISCERN_MARK_OUTLINE_STROKE,
} from "../brand.ts";
import { clusterHueStyle } from "../wall/clusters.ts";
import { drawPrimitive, type GlyphShape } from "../wall/glyph_grammar.ts";
import { glyphDrawing } from "../wall/glyphs.ts";
import type { ClusterId } from "../wall/types.ts";
import { SOCIAL_CARD_SIZE } from "./address.ts";
import type {
  DocumentCard,
  ReleaseCard,
  SocialCard,
  StatementCard,
} from "./model.ts";
import type { Ink, Paragraph, TextStyle, Typesetter } from "./typeset.ts";

/** sRGB hex for an OKLCH colour, so the rasteriser receives a plain colour. */
export function oklchHex(
  lightness: number,
  chroma: number,
  hue: number,
): string {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return `#${
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((linear) => {
      const clamped = Math.min(1, Math.max(0, linear));
      const encoded = clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255).toString(16).padStart(2, "0");
    }).join("")
  }`;
}

/** One fill, named by the site token whose dark-theme value it reproduces. */
interface Paint {
  readonly token: `--discern-color-${string}`;
  readonly color: string;
  readonly opacity: number;
}

/** The site's dark appearance at discern's hue, as each card paints it. */
export const CARD_PALETTE = {
  canvas: {
    token: "--discern-color-canvas",
    color: oklchHex(0.14, 0.021, DISCERN_ACCENT_HUE),
    opacity: 1,
  },
  ink: { token: "--discern-color-ink", color: "#ffffff", opacity: 0.92 },
  muted: {
    token: "--discern-color-ink-muted",
    color: "#ffffff",
    opacity: 0.74,
  },
  faint: {
    token: "--discern-color-ink-faint",
    color: "#ffffff",
    opacity: 0.55,
  },
  accent: {
    token: "--discern-color-accent-ink",
    color: oklchHex(0.74, 0.14, DISCERN_ACCENT_HUE),
    opacity: 1,
  },
} as const satisfies Record<string, Paint>;

const { width: WIDTH, height: HEIGHT } = SOCIAL_CARD_SIZE;
const MARGIN = 72;
const RIGHT = WIDTH - MARGIN;
const URL_BASELINE = 572;
/** Descender depth below a baseline, in ems, before the next block's gap. */
const DESCENT = 0.24;

/** Two decimal places keep path data compact without visible error. */
function fixed(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Drawn pieces in order, as siblings in the SVG. */
function layers(parts: readonly ReactElement[]): ReactElement {
  return (
    <>
      {parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}
    </>
  );
}

/** A stroked symbol, such as the drawn arrow. */
function stroke(d: string, width: number, fill: Paint): ReactElement {
  return (
    <path
      d={d}
      fill="none"
      stroke={fill.color}
      strokeOpacity={fill.opacity}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Fill every outline in one path; draw each mark and stroked symbol separately. */
function paint(inks: readonly Ink[], fill: Paint): ReactElement {
  const outlines = inks.flatMap((ink) => ink.kind === "outline" ? [ink.d] : [])
    .join("");
  const parts: ReactElement[] = [];
  if (outlines !== "") {
    parts.push(
      <path d={outlines} fill={fill.color} fillOpacity={fill.opacity} />,
    );
  }
  for (const ink of inks) {
    if (ink.kind === "mark") parts.push(mark(ink.x, ink.y, ink.scale, fill));
    if (ink.kind === "stroke") parts.push(stroke(ink.d, ink.width, fill));
  }
  return layers(parts);
}

/** The canonical mark at one position and scale of its 100-unit box. */
function mark(x: number, y: number, scale: number, fill: Paint): ReactElement {
  return (
    <g
      transform={`translate(${fixed(x)} ${fixed(y)}) scale(${
        fixed(scale * 1000) / 1000
      })`}
      opacity={fill.opacity}
    >
      <path d={DISCERN_MARK_FILLED_PATH} fill={fill.color} />
      <path
        d={DISCERN_MARK_OUTLINE_PATH}
        fill="none"
        stroke={fill.color}
        strokeWidth={DISCERN_MARK_OUTLINE_STROKE}
        strokeLinejoin="round"
      />
    </g>
  );
}

/** A still wall glyph, using the same shapes as the homepage. */
function wallGlyph(shape: GlyphShape, index: number): ReactElement {
  const { el, paint, dash, turn, ...geometry } = shape;
  const outlined = paint === "outline" || paint === "faint";
  return createElement(el, {
    ...geometry,
    key: index,
    fill: outlined ? "none" : "currentColor",
    fillOpacity: paint === "tint" ? 0.34 : 1,
    stroke: outlined ? "currentColor" : undefined,
    strokeOpacity: paint === "faint" ? 0.48 : 1,
    strokeWidth: dash === undefined ? 1.75 : 2.6,
    strokeDasharray: dash,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    transform: turn === undefined ? undefined : `rotate(${turn.join(" ")})`,
  });
}

/** The cropped wall keeps its drawings to the right of the card's text. */
const WALL_TILES = [
  {
    x: 750,
    y: -56,
    height: 188,
    glyph: "shape-substantial-work",
    cluster: "build-further",
  },
  {
    x: 750,
    y: 150,
    height: 218,
    glyph: "judgment-at-the-change",
    cluster: "return-human-attention",
  },
  {
    x: 750,
    y: 386,
    height: 188,
    glyph: "evidence-that-lasts",
    cluster: "know-what-is-ready",
  },
  {
    x: 946,
    y: 24,
    height: 188,
    glyph: "parallel-work-on-one-machine",
    cluster: "build-further",
  },
  {
    x: 946,
    y: 230,
    height: 218,
    glyph: "evidence-for-this-change",
    cluster: "know-what-is-ready",
  },
  {
    x: 946,
    y: 466,
    height: 188,
    glyph: "compose-staged-work",
    cluster: "build-further",
  },
  {
    x: 1142,
    y: -76,
    height: 218,
    glyph: "decisions-in-one-view",
    cluster: "return-human-attention",
  },
  {
    x: 1142,
    y: 160,
    height: 188,
    glyph: "context-for-the-task",
    cluster: "keep-project-knowledge-working",
  },
  {
    x: 1142,
    y: 366,
    height: 218,
    glyph: "project-defined-completion",
    cluster: "know-what-is-ready",
  },
] as const satisfies ReadonlyArray<{
  x: number;
  y: number;
  height: number;
  glyph: string;
  cluster: ClusterId;
}>;

/** Dark card faces, colored edges, and the homepage's glyphs, faded beneath the copy. */
function wallBackdrop(quiet = false): ReactElement {
  return (
    <g opacity={quiet ? 0.45 : 1}>
      <defs>
        <linearGradient id="wall-surface" x2="0" y2="1">
          <stop stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.015" />
        </linearGradient>
        <linearGradient id="wall-edge" x2="0.8" y2="1">
          <stop stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.035" />
        </linearGradient>
        <linearGradient id="wall-shade">
          <stop offset="0.45" stopColor={CARD_PALETTE.canvas.color} />
          <stop
            offset="0.82"
            stopColor={CARD_PALETTE.canvas.color}
            stopOpacity="0.4"
          />
          <stop
            offset="1"
            stopColor={CARD_PALETTE.canvas.color}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      {WALL_TILES.map((tile, index) => {
        const hue = clusterHueStyle(tile.cluster)["--wall-hue"];
        const accent = oklchHex(0.8, 0.1, hue);
        return (
          <g key={index} transform={`translate(${tile.x} ${tile.y})`}>
            <defs>
              <radialGradient id={`wall-wash-${index}`} cx="0" cy="0" r="1">
                <stop stopColor={accent} stopOpacity="0.12" />
                <stop offset="1" stopColor={accent} stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect
              width="178"
              height={tile.height}
              rx="16"
              fill="url(#wall-surface)"
              stroke="url(#wall-edge)"
            />
            <rect
              width="178"
              height={tile.height}
              rx="16"
              fill={`url(#wall-wash-${index})`}
            />
            <g transform="translate(24 24)" color={accent} opacity="0.62">
              {glyphDrawing(tile.glyph).flatMap(drawPrimitive).map(wallGlyph)}
            </g>
            <path
              d="M24 100H137M24 116H109"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.09"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      <rect width={WIDTH} height={HEIGHT} fill="url(#wall-shade)" />
    </g>
  );
}

/** Inter at the site's headline settings. */
function headline(size: number): TextStyle {
  return {
    face: "sans",
    weight: 600,
    size,
    tracking: -0.052,
    features: ["calt", "dlig", "ss01", "ss02", "ss03"],
  };
}

const LEDE: TextStyle = {
  face: "sans",
  weight: 400,
  size: 32,
  tracking: -0.01,
};
const URL_TEXT: TextStyle = { face: "mono", weight: 400, size: 21 };
const EYEBROW: TextStyle = {
  face: "sans",
  weight: 600,
  size: 19,
  tracking: 0.14,
  features: ["ss03"],
};

/** Lay text blocks down a column, aligning each block's cap height to its top. */
class Column {
  readonly parts: ReactElement[] = [];

  constructor(
    private readonly type: Typesetter,
    private readonly x: number,
    public y: number,
  ) {}

  /** Draw a paragraph, then move below its last line's descenders. */
  add(
    paragraph: Paragraph,
    style: TextStyle,
    leading: number,
    fill: Paint,
  ): void {
    let baseline = this.y + this.type.capHeight(style);
    for (const line of paragraph.lines) {
      this.parts.push(paint(line.draw(this.x, baseline), fill));
      baseline += style.size * leading;
    }
    this.y = baseline - style.size * leading + style.size * DESCENT;
  }

  /** Leave vertical space before the next block. */
  gap(pixels: number): void {
    this.y += pixels;
  }

  /** How many lines of a style still fit above `floor`. */
  room(style: TextStyle, leading: number, floor: number): number {
    const first = this.y + this.type.capHeight(style);
    return first > floor
      ? 0
      : 1 + Math.floor((floor - first) / (style.size * leading));
  }
}

/** The brand lockup in the top-left corner, with an optional corpus crumb. */
function lockup(type: Typesetter, crumb?: string): ReactElement {
  const name: TextStyle = {
    face: "mono",
    weight: 600,
    size: 30,
    tracking: -0.01,
  };
  const word = type.shape("discern", name);
  const parts = [
    mark(MARGIN, 60, 0.34, CARD_PALETTE.ink),
    paint(word.draw(120, 88), CARD_PALETTE.ink),
  ];
  if (crumb !== undefined) {
    const trail = type.shape(crumb, { ...name, weight: 400 });
    parts.push(paint(trail.draw(130 + word.width, 88), CARD_PALETTE.faint));
  }
  return layers(parts);
}

/** The page address, right-aligned along the foot and cut to fit. */
function address(
  type: Typesetter,
  route: string,
  style = URL_TEXT,
): ReactElement {
  const text = `discern.sh${route === "/" ? "" : route}`;
  const line = type.line(text, style, RIGHT - MARGIN);
  return paint(line.draw(RIGHT - line.width, URL_BASELINE), CARD_PALETTE.faint);
}

/** A marketing page: its headline with the wall behind it. */
function statement(card: StatementCard, type: Typesetter): ReactElement {
  const column = new Column(type, MARGIN, 182);
  const title = type.fit(card.headline, headline, [112, 96, 84, 72], {
    width: 820,
    maxLines: 3,
    balance: true,
  });
  column.add(title.paragraph, title.style, 0.98, CARD_PALETTE.ink);
  column.gap(42);
  column.add(
    type.paragraph(card.lede, { ...LEDE, size: 33 }, {
      width: 800,
      maxLines: 2,
      balance: true,
    }),
    { ...LEDE, size: 33 },
    1.3,
    CARD_PALETTE.muted,
  );
  return layers([
    wallBackdrop(),
    lockup(type),
    ...column.parts,
    address(type, card.route, { ...URL_TEXT, size: 22 }),
  ]);
}

/** The eyebrow: a section numeral in the accent, then small capitals. */
function eyebrow(
  type: Typesetter,
  card: DocumentCard,
  column: Column,
): void {
  const baseline = column.y + type.capHeight(EYEBROW);
  let x = MARGIN;
  if (card.numeral !== undefined) {
    const numeral = type.shape(card.numeral, {
      face: "mono",
      weight: 600,
      size: EYEBROW.size,
    });
    column.parts.push(
      paint(numeral.draw(x, baseline), CARD_PALETTE.accent),
    );
    x += numeral.width + 14;
  }
  const label = type.line(
    card.eyebrow.toLocaleUpperCase("en"),
    EYEBROW,
    RIGHT - x,
  );
  column.parts.push(paint(label.draw(x, baseline), CARD_PALETTE.faint));
  column.y = baseline + EYEBROW.size * DESCENT;
}

/** Title sizes from largest to smallest, with the lines each may use. */
const DOCUMENT_TITLE_STEPS = [
  [112, 3],
  [100, 3],
  [88, 3],
  [76, 3],
  [66, 3],
  [58, 4],
  [52, 4],
] as const;
const DOCUMENT_LEDE: TextStyle = { face: "serif", weight: 400, size: 32 };
/** The lowest a document's description may reach, clear of the address. */
const DOCUMENT_FLOOR = 488;

/** A document's text at one title step, and how much of it fit. */
interface DocumentText {
  readonly column: Column;
  readonly title: Paragraph;
  readonly lede?: Paragraph;
}

/** Serif title, then as much description as the space below it allows. */
function documentText(
  card: DocumentCard,
  type: Typesetter,
  [size, maxLines]: readonly [number, number],
): DocumentText {
  const column = new Column(type, MARGIN, 176);
  eyebrow(type, card, column);
  column.gap(30);
  const style: TextStyle = {
    face: "serif",
    weight: 600,
    size,
    tracking: -0.012,
  };
  const title = type.paragraph(card.title, style, {
    width: 1000,
    maxLines,
    balance: true,
  });
  column.add(title, style, 1.02, CARD_PALETTE.ink);
  if (card.lede === "") return { column, title };
  column.gap(26);
  const lines = Math.min(3, column.room(DOCUMENT_LEDE, 1.3, DOCUMENT_FLOOR));
  if (lines === 0) return { column, title };
  const lede = type.paragraph(card.lede, DOCUMENT_LEDE, {
    width: 920,
    maxLines: lines,
    balance: true,
  });
  column.add(lede, DOCUMENT_LEDE, 1.3, CARD_PALETTE.muted);
  return { column, title, lede };
}

/** Whether a document's whole title and whole description were set. */
function complete(card: DocumentCard, text: DocumentText): boolean {
  return !text.title.truncated &&
    (card.lede === "" ||
      (text.lede !== undefined && !text.lede.truncated));
}

/**
 * Set a document's text at the largest title size that fits the whole title
 * and description. A description too long for any size is cut short beneath
 * the largest complete title instead.
 */
export function setDocumentText(
  card: DocumentCard,
  type: Typesetter,
): DocumentText {
  let fallback: DocumentText | undefined;
  let last: DocumentText | undefined;
  for (const step of DOCUMENT_TITLE_STEPS) {
    last = documentText(card, type, step);
    if (complete(card, last)) return last;
    if (fallback === undefined && !last.title.truncated) fallback = last;
  }
  const chosen = fallback ?? last;
  if (chosen === undefined) throw new Error("no document title steps");
  return chosen;
}

/** A manual page, map, or decision: serif title, its description, and its address. */
function documentLayout(card: DocumentCard, type: Typesetter): ReactElement {
  return layers([
    wallBackdrop(true),
    lockup(type, card.crumb),
    ...setDocumentText(card, type).column.parts,
    address(type, card.route),
  ]);
}

/** The releases page: the newest version, its codename, and its summary. */
function releaseLayout(card: ReleaseCard, type: Typesetter): ReactElement {
  const parts = [wallBackdrop(), lockup(type, "/releases")];
  if (card.date !== undefined) {
    const date = type.shape(card.date, { ...LEDE, size: 21, tracking: 0 });
    parts.push(paint(date.draw(RIGHT - date.width, 88), CARD_PALETTE.faint));
  }
  const column = new Column(type, MARGIN, 196);
  const version = type.fit(
    card.version,
    (size) => ({ ...headline(size), features: ["tnum", "ss01"] }),
    [150, 124, 100],
    { width: 640, maxLines: 1 },
  );
  const versionLine = version.paragraph.lines[0];
  const baseline = column.y + type.capHeight(version.style);
  if (versionLine !== undefined) {
    column.parts.push(
      paint(versionLine.draw(MARGIN - 4, baseline), CARD_PALETTE.ink),
    );
    if (card.codename !== undefined) {
      const codename = type.shape(card.codename, {
        face: "serif-italic",
        weight: 400,
        size: 66,
      });
      column.parts.push(
        paint(
          codename.draw(MARGIN + versionLine.width + 28, baseline),
          CARD_PALETTE.muted,
        ),
      );
    }
  }
  column.y = baseline + version.style.size * DESCENT;
  column.gap(40);
  column.add(
    type.paragraph(card.summary, LEDE, {
      width: 760,
      maxLines: 3,
      balance: true,
    }),
    LEDE,
    1.32,
    CARD_PALETTE.muted,
  );
  return layers([...parts, ...column.parts, address(type, card.route)]);
}

/** The complete SVG for one card. */
export function drawSocialCard(card: SocialCard, type: Typesetter): string {
  const body = card.kind === "statement"
    ? statement(card, type)
    : card.kind === "document"
    ? documentLayout(card, type)
    : releaseLayout(card, type);
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <rect width={WIDTH} height={HEIGHT} fill={CARD_PALETTE.canvas.color} />
      {body}
    </svg>,
  );
}
