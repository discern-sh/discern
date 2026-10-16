/**
 * Typesetting for social cards: shape text with the design system's own
 * variable fonts and lay it out as glyph outlines, so the rasteriser needs no
 * font support and every card matches the site's faces, weights, and
 * OpenType features exactly.
 */

import { Buffer } from "buffer";
// @ts-types="@types/fontkit"
import * as fontkit from "fontkit";
import { decompress } from "woff2-encoder";
import { DISCERN_MARK } from "../brand.ts";

/** The four faces the design system ships, by their card role. */
export type Face = "sans" | "serif" | "serif-italic" | "mono";

/** Each face's file inside the design system's emitted font selection. */
const FACE_FILES: Readonly<Record<Face, string>> = {
  sans: "fonts/inter.woff2",
  serif: "fonts/crimson-pro-roman.woff2",
  "serif-italic": "fonts/crimson-pro-italic.woff2",
  mono: "fonts/jetbrains-mono.woff2",
};

/** Faces consulted, in order, for a character the requested face lacks. */
const FALLBACK_FACES: readonly Face[] = ["sans", "mono"];

/** One text style; `tracking` is CSS letter-spacing in ems. */
export interface TextStyle {
  readonly face: Face;
  readonly weight: number;
  readonly size: number;
  readonly tracking?: number;
  readonly features?: readonly string[];
}

/** One painted piece of text: glyph outlines, the drawn mark, or a stroked symbol. */
export type Ink =
  | { readonly kind: "outline"; readonly d: string }
  | {
    readonly kind: "mark";
    readonly x: number;
    readonly y: number;
    readonly scale: number;
  }
  | { readonly kind: "stroke"; readonly d: string; readonly width: number };

/** A character drawn as a vector because no shipped face carries it. */
interface DrawnGlyph {
  advance(style: TextStyle, capHeight: number): number;
  ink(x: number, baseline: number, style: TextStyle, capHeight: number): Ink;
}

/** The drawn mark's visible extent in its 100-unit box, stroke included. */
const MARK_BOX = { left: 6.5, bottom: 87.5, width: 87, height: 79 } as const;

/** The canonical mark, cap-high on the baseline. */
const DRAWN_MARK: DrawnGlyph = {
  advance: (style, capHeight) =>
    MARK_BOX.width * capHeight / MARK_BOX.height + style.size * 0.12,
  ink: (x, baseline, _style, capHeight) => {
    const scale = capHeight / MARK_BOX.height;
    return {
      kind: "mark",
      x: x - MARK_BOX.left * scale,
      y: baseline - MARK_BOX.bottom * scale,
      scale,
    };
  },
};

/** A rightwards arrow on the cap-height axis, stroked at the style's weight. */
const DRAWN_ARROW: DrawnGlyph = {
  advance: (style) => style.size * 0.92,
  ink: (x, baseline, style, capHeight) => {
    const em = style.size;
    const axis = baseline - capHeight / 2;
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      kind: "stroke",
      d: `M${round(x + 0.1 * em)} ${round(axis)}H${round(x + 0.78 * em)}M${
        round(x + 0.56 * em)
      } ${round(axis - 0.21 * em)}L${round(x + 0.8 * em)} ${round(axis)}L${
        round(x + 0.56 * em)
      } ${round(axis + 0.21 * em)}`,
      width: round(em * (0.03 + style.weight * 0.0001)),
    };
  },
};

/** Characters drawn as vectors, keyed by code point. */
const DRAWN_GLYPHS: ReadonlyMap<number, DrawnGlyph> = new Map([
  [DISCERN_MARK.codePointAt(0) ?? 0, DRAWN_MARK],
  [0x2192, DRAWN_ARROW],
]);

/** One stretch of text that a single face sets, or one drawn glyph. */
type Run =
  | { face: Face; text: string }
  | { face: "drawn"; text: string; glyph: DrawnGlyph };

/** Text shaped at one style, ready to draw at any origin. */
export interface Shaped {
  readonly text: string;
  readonly width: number;
  draw(x: number, baseline: number): Ink[];
}

/** A paragraph broken into lines, with whether its text was cut short. */
export interface Paragraph {
  readonly lines: readonly Shaped[];
  readonly truncated: boolean;
}

/** Where a paragraph may break and how many lines it may use. */
export interface ParagraphBounds {
  readonly width: number;
  readonly maxLines: number;
  readonly balance?: boolean;
}

/** A character no shipped face can draw. */
export class MissingGlyphError extends Error {
  /** Name the character and its code point so the source text can be fixed. */
  constructor(readonly character: string) {
    super(
      `No design-system face can draw ${JSON.stringify(character)} (U+${
        (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(
          4,
          "0",
        )
      })`,
    );
    this.name = "MissingGlyphError";
  }
}

const ELLIPSIS = "…";

/** Words to wrap, with each free-standing dash kept on its preceding word's line. */
function unbreakable(text: string): string[] {
  const words: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    const last = words.length - 1;
    if (/^[—–]$/u.test(word) && last >= 0) words[last] += ` ${word}`;
    else if (word.length > 0) words.push(word);
  }
  return words;
}

/** Decode one WOFF2 file into a font that can be instanced at any weight. */
async function openFace(woff2: Uint8Array): Promise<fontkit.Font> {
  const loaded = fontkit.create(Buffer.from(await decompress(woff2)));
  if ("fonts" in loaded) {
    throw new Error("expected one font, found a collection");
  }
  return loaded;
}

/** The loaded faces and every weight instance requested so far. */
export class Typesetter {
  private readonly instances = new Map<string, fontkit.Font>();

  private constructor(
    private readonly faces: Readonly<Record<Face, fontkit.Font>>,
  ) {}

  /** Open every face through one byte reader, such as the built font bundle. */
  static async open(
    read: (file: string) => Promise<Uint8Array>,
  ): Promise<Typesetter> {
    const load = async (face: Face) => openFace(await read(FACE_FILES[face]));
    const [sans, serif, serifItalic, mono] = await Promise.all([
      load("sans"),
      load("serif"),
      load("serif-italic"),
      load("mono"),
    ]);
    return new Typesetter({ sans, serif, "serif-italic": serifItalic, mono });
  }

  /** The face instanced at one weight on its `wght` axis. */
  private font(face: Face, weight: number): fontkit.Font {
    const key = `${face}@${weight}`;
    const cached = this.instances.get(key);
    if (cached !== undefined) return cached;
    const base = this.faces[face];
    const instance = base.variationAxes["wght"] === undefined
      ? base
      : base.getVariation({ wght: weight });
    this.instances.set(key, instance);
    return instance;
  }

  /** The face that sets one character, falling back as CSS would, else its drawing. */
  private faceFor(character: string, face: Face): Face | DrawnGlyph {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character)) return face;
    for (const candidate of [face, ...FALLBACK_FACES]) {
      if (this.faces[candidate].hasGlyphForCodePoint(codePoint)) {
        return candidate;
      }
    }
    const drawn = DRAWN_GLYPHS.get(codePoint);
    if (drawn === undefined) throw new MissingGlyphError(character);
    return drawn;
  }

  /** Split text into runs that one face can set, with each drawn glyph alone. */
  private runs(text: string, face: Face): Run[] {
    const runs: Run[] = [];
    for (const character of text) {
      const chosen = this.faceFor(character, face);
      const last = runs.at(-1);
      if (typeof chosen !== "string") {
        runs.push({ face: "drawn", text: character, glyph: chosen });
      } else if (last !== undefined && last.face === chosen) {
        last.text += character;
      } else {
        runs.push({ face: chosen, text: character });
      }
    }
    return runs;
  }

  /** Cap height of a style in pixels, for aligning a block's optical top. */
  capHeight(style: TextStyle): number {
    const font = this.font(style.face, style.weight);
    return font.capHeight / font.unitsPerEm * style.size;
  }

  /** Shape one line of text; the width omits trailing letter-spacing. */
  shape(text: string, style: TextStyle): Shaped {
    const tracking = (style.tracking ?? 0) * style.size;
    const placements: ((x: number, baseline: number) => Ink)[] = [];
    let pen = 0;
    for (const run of this.runs(text, style.face)) {
      if (run.face === "drawn") {
        const { glyph } = run;
        const capHeight = this.capHeight(style);
        const at = pen;
        placements.push((x, baseline) =>
          glyph.ink(x + at, baseline, style, capHeight)
        );
        pen += glyph.advance(style, capHeight) + tracking;
        continue;
      }
      pen = this.placeGlyphs(run.text, run.face, style, pen, placements);
    }
    const width = Math.max(0, pen - tracking);
    return {
      text,
      width,
      draw: (x, baseline) => placements.map((place) => place(x, baseline)),
    };
  }

  /** Lay out one single-face run from `pen`, returning the advanced pen. */
  private placeGlyphs(
    text: string,
    face: Face,
    style: TextStyle,
    start: number,
    placements: ((x: number, baseline: number) => Ink)[],
  ): number {
    const font = this.font(face, style.weight);
    const scale = style.size / font.unitsPerEm;
    const tracking = (style.tracking ?? 0) * style.size;
    const run = font.layout(text, [...(style.features ?? [])]);
    let pen = start;
    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index];
      if (position === undefined) return;
      const at = pen + position.xOffset * scale;
      const rise = position.yOffset * scale;
      placements.push((x, baseline) => ({
        kind: "outline",
        d: glyph.path.scale(scale, -scale).translate(x + at, baseline - rise)
          .toSVG(),
      }));
      pen += position.xAdvance * scale + tracking;
    });
    return pen;
  }

  /** Greedy line breaks for `words` at one width, as word counts per line. */
  private breaks(
    widths: readonly number[],
    space: number,
    width: number,
  ): number[] {
    const counts: number[] = [];
    let line = 0;
    let count = 0;
    for (const word of widths) {
      const next = count === 0 ? word : line + space + word;
      if (count > 0 && next > width) {
        counts.push(count);
        line = word;
        count = 1;
      } else {
        line = next;
        count += 1;
      }
    }
    if (count > 0) counts.push(count);
    return counts;
  }

  /** The narrowest width that keeps the greedy line count, as `text-wrap: balance` does. */
  private balancedWidth(
    widths: readonly number[],
    space: number,
    width: number,
  ): number {
    const lines = this.breaks(widths, space, width).length;
    if (lines < 2) return width;
    let low = width / 2;
    let high = width;
    for (let step = 0; step < 14; step++) {
      const middle = (low + high) / 2;
      if (this.breaks(widths, space, middle).length > lines) low = middle;
      else high = middle;
    }
    return high;
  }

  /** Break text into at most `maxLines` lines, ending a cut line with an ellipsis. */
  paragraph(
    text: string,
    style: TextStyle,
    bounds: ParagraphBounds,
  ): Paragraph {
    const words = unbreakable(text);
    const widths = words.map((word) => this.shape(word, style).width);
    const space = this.shape("a a", style).width -
      this.shape("aa", style).width;
    const width = bounds.balance === true
      ? this.balancedWidth(widths, space, bounds.width)
      : bounds.width;
    const counts = this.breaks(widths, space, width);
    const lines: string[] = [];
    let used = 0;
    for (const count of counts.slice(0, bounds.maxLines)) {
      lines.push(words.slice(used, used + count).join(" "));
      used += count;
    }
    const truncated = used < words.length;
    if (truncated && lines.length > 0) {
      lines[lines.length - 1] = this.fitWithEllipsis(
        words.slice(used - (counts[lines.length - 1] ?? 0)),
        style,
        bounds.width,
      );
    }
    return {
      lines: lines.map((line) => this.shape(line, style)),
      truncated,
    };
  }

  /** The longest run of leading words that still fits once an ellipsis follows. */
  private fitWithEllipsis(
    words: readonly string[],
    style: TextStyle,
    width: number,
  ): string {
    for (let count = words.length; count > 0; count--) {
      const candidate = `${
        words.slice(0, count).join(" ").replace(/[\s,;:.—–-]+$/u, "")
      }${ELLIPSIS}`;
      if (this.shape(candidate, style).width <= width) return candidate;
    }
    return ELLIPSIS;
  }

  /**
   * Set text at the largest size that needs no more than `bounds.maxLines`
   * lines, falling back to the smallest size and an ellipsis.
   */
  fit(
    text: string,
    styleAt: (size: number) => TextStyle,
    sizes: readonly number[],
    bounds: ParagraphBounds,
  ): { style: TextStyle; paragraph: Paragraph } {
    const fallback = sizes.at(-1);
    if (fallback === undefined) throw new Error("fit needs at least one size");
    for (const size of sizes) {
      const style = styleAt(size);
      const paragraph = this.paragraph(text, style, bounds);
      if (!paragraph.truncated || size === fallback) {
        return { style, paragraph };
      }
    }
    throw new Error("unreachable: the fallback size always returns");
  }

  /** One line cut from the end to fit `width`, keeping its start readable. */
  line(text: string, style: TextStyle, width: number): Shaped {
    const whole = this.shape(text, style);
    if (whole.width <= width) return whole;
    let keep = text.length;
    while (keep > 0) {
      keep -= 1;
      const candidate = this.shape(`${text.slice(0, keep)}${ELLIPSIS}`, style);
      if (candidate.width <= width) return candidate;
    }
    return this.shape(ELLIPSIS, style);
  }
}
