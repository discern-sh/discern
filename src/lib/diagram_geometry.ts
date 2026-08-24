/**
 * Diagram-geometry scanner — the executable predicate behind the
 * misaligned-box-drawing-diagram class.
 *
 * The mechanism that permits the defect: code-block bodies are the one
 * Markdown surface no formatter rewrites, so a diagram's 2D geometry survives
 * only as long as every editor re-counts columns by hand. This scanner makes
 * the geometry checkable: inside any fenced or indented block that contains
 * box-drawing STRUCTURE (a
 * corner or junction glyph), every drawing glyph's vertical claims must be
 * honoured — a glyph that connects upward must find a downward-connecting
 * glyph (or label text, a legal anchor) directly above it, never space or a
 * non-connecting drawing glyph — and every arrowhead must sit on its shaft.
 *
 * Two consumers, one definition of "aligned": `discern tidy` checks the
 * Markdown surfaces it formats (src/engine/tidy/tidy.ts), and this repo's
 * own gate sweeps every tracked Markdown file
 * (tests/diagram_geometry_test.ts).
 *
 * Deliberate leniency, so real idioms stay legal:
 *  - label text vertically anchors a line (`person` above `│`, a tree name
 *    above `└──`) — only space and unreciprocated DRAWING glyphs violate;
 *  - horizontal claims are enforced only between two drawing glyphs, because
 *    labels legally interrupt shafts (`──discern start──►`);
 *  - an arrowhead may POINT at the glyph it meets instead of continuing its
 *    shaft (`▲` directly under a border's `┬`);
 *  - a code block with no corner/junction glyph is not a diagram (quoted
 *    `── job │` output lines, plain flows) and is skipped, as is proportional
 *    prose outside code blocks, where geometry is meaningless;
 *  - a fence whose info string carries the word `freeform` is exempt — the
 *    escape for intentional character art that is not a box diagram.
 *
 * Residual (documented, not covered): pure-ASCII art (`+--|`), half-line and
 * mixed-weight glyphs, and display-width hazards from wide characters. Those
 * glyph families can be added to the claims tables; the rules need no change.
 */

import { fencedBlocks } from "./docs_integrity.ts";

/** The common geometry-scanner view of either Markdown code-block form. */
interface DiagramBlock {
  /** The info string of a fenced block; indented blocks have none. */
  info: string;
  /** 1-based source line of the first body row. */
  startLine: number;
  /** Code rows with their Markdown indentation removed. */
  lines: string[];
}

/** One geometry violation inside a fenced diagram block. */
export interface DiagramViolation {
  /** 1-based source line in the Markdown file. */
  line: number;
  /** 1-based code-point column on that line. */
  column: number;
  /** The offending glyph. */
  glyph: string;
  /** What is wrong, phrased for whoever realigns the diagram. */
  reason: string;
}

type Side = "u" | "r" | "d" | "l";

/** Box-drawing glyphs and the sides they connect (u/r/d/l), by family:
 * light, heavy, double, dashed, and rounded corners. */
const BOX_CLAIMS: Readonly<Record<string, string>> = {
  "─": "rl",
  "━": "rl",
  "═": "rl",
  "┄": "rl",
  "┅": "rl",
  "┈": "rl",
  "┉": "rl",
  "╌": "rl",
  "╍": "rl",
  "│": "ud",
  "┃": "ud",
  "║": "ud",
  "┆": "ud",
  "┇": "ud",
  "┊": "ud",
  "┋": "ud",
  "╎": "ud",
  "╏": "ud",
  "┌": "dr",
  "┏": "dr",
  "╔": "dr",
  "╭": "dr",
  "┐": "dl",
  "┓": "dl",
  "╗": "dl",
  "╮": "dl",
  "└": "ur",
  "┗": "ur",
  "╚": "ur",
  "╰": "ur",
  "┘": "ul",
  "┛": "ul",
  "╝": "ul",
  "╯": "ul",
  "├": "udr",
  "┣": "udr",
  "╠": "udr",
  "┤": "udl",
  "┫": "udl",
  "╣": "udl",
  "┬": "rld",
  "┳": "rld",
  "╦": "rld",
  "┴": "rlu",
  "┻": "rlu",
  "╩": "rlu",
  "┼": "urdl",
  "╋": "urdl",
  "╬": "urdl",
};

/** Arrowheads: the single claim names the side the shaft attaches to. */
const ARROW_CLAIMS: Readonly<Record<string, Side>> = {
  "►": "l",
  "◄": "r",
  "▲": "d",
  "▼": "u",
};

const OPPOSITE: Readonly<Record<Side, Side>> = {
  u: "d",
  d: "u",
  l: "r",
  r: "l",
};

const SIDE_NAME: Readonly<Record<Side, string>> = {
  u: "above",
  d: "below",
  l: "to its left",
  r: "to its right",
};

/** A corner or junction — the presence that marks a fence as a diagram. */
function isStructural(glyph: string): boolean {
  const claims = BOX_CLAIMS[glyph];
  return claims !== undefined &&
    (claims.includes("u") || claims.includes("d")) &&
    (claims.includes("l") || claims.includes("r"));
}

/** Any glyph the claims tables know — box-drawing or arrowhead. */
function isDrawing(glyph: string): boolean {
  return BOX_CLAIMS[glyph] !== undefined || ARROW_CLAIMS[glyph] !== undefined;
}

/** Whether `glyph` connects toward `side` (false for text and undefined). */
function connects(glyph: string | undefined, side: Side): boolean {
  if (glyph === undefined) return false;
  const claims = BOX_CLAIMS[glyph] ?? ARROW_CLAIMS[glyph];
  return claims !== undefined && claims.includes(side);
}

/** Read the grid cell one step from a coordinate in the requested direction. */
function neighbourAt(
  grid: readonly (readonly string[])[],
  row: number,
  col: number,
  side: Side,
): string | undefined {
  if (side === "u") return grid[row - 1]?.[col];
  if (side === "d") return grid[row + 1]?.[col];
  if (side === "l") return grid[row]?.[col - 1];
  return grid[row]?.[col + 1];
}

/** Describe a neighboring glyph for a precise geometry diagnostic. */
function describe(glyph: string | undefined): string {
  if (glyph === undefined) return "the edge of the block";
  if (glyph === " ") return "only space";
  return `"${glyph}"`;
}

/** The info-string word that exempts a fence from the geometry check. */
export const FREEFORM_FENCE_WORD = "freeform";

/**
 * Extract Markdown's indented code blocks without double-enrolling fenced
 * bodies. A block row begins with one tab or four spaces. Blank rows may live
 * inside a block; trailing blanks are discarded so following prose never joins
 * it. The scanner needs only this deliberately small renderer-equivalent view:
 * geometry is activated by box structure, not by a language info string.
 */
function indentedCodeBlocks(md: string): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  const source = md.split("\n");
  let fence: string | undefined;
  let block: DiagramBlock | undefined;

  const flush = (): void => {
    if (block === undefined) return;
    while (block.lines.at(-1) === "") block.lines.pop();
    if (block.lines.length > 0) out.push(block);
    block = undefined;
  };

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index] ?? "";
    const fenceMarker = line.match(/^ {0,3}(```|~~~)/)?.[1];
    if (fence !== undefined) {
      flush();
      if (fenceMarker === fence && line.trim().startsWith(fence)) {
        fence = undefined;
      }
      continue;
    }
    if (fenceMarker !== undefined) {
      flush();
      fence = fenceMarker;
      continue;
    }

    const indented = line.startsWith("\t")
      ? line.slice(1)
      : line.startsWith("    ")
      ? line.slice(4)
      : undefined;
    if (indented !== undefined) {
      block ??= { info: "", startLine: index + 1, lines: [] };
      block.lines.push(indented);
      continue;
    }
    if (line.trim() === "" && block !== undefined) {
      block.lines.push("");
      continue;
    }
    flush();
  }
  flush();
  return out;
}

/**
 * Scan one Markdown document: every fenced or indented code block containing
 * box-drawing structure is checked as a character grid (code-point columns,
 * the unit an editor aligns by). Returns violations in document order.
 */
export function scanMarkdownDiagrams(md: string): DiagramViolation[] {
  const out: DiagramViolation[] = [];
  const blocks: DiagramBlock[] = [
    ...fencedBlocks(md),
    ...indentedCodeBlocks(md),
  ].sort((left, right) => left.startLine - right.startLine);
  for (const block of blocks) {
    if (block.info.split(/\s+/).includes(FREEFORM_FENCE_WORD)) continue;
    const grid = block.lines.map((line) => Array.from(line));
    if (!grid.some((row) => row.some(isStructural))) continue;
    scanGrid(grid, block.startLine, out);
  }
  return out;
}

/** Report tabs and box-drawing connections whose neighboring cells disagree. */
function scanGrid(
  grid: readonly (readonly string[])[],
  startLine: number,
  out: DiagramViolation[],
): void {
  const push = (
    row: number,
    col: number,
    glyph: string,
    reason: string,
  ): void => {
    out.push({ line: startLine + row, column: col + 1, glyph, reason });
  };
  for (let row = 0; row < grid.length; row += 1) {
    const cells = grid[row] ?? [];
    for (let col = 0; col < cells.length; col += 1) {
      const glyph = cells[col] ?? "";
      if (glyph === "\t") {
        push(
          row,
          col,
          "\\t",
          "tab character inside a diagram block: tabs break column alignment",
        );
        continue;
      }
      const box = BOX_CLAIMS[glyph];
      if (box !== undefined) {
        for (const side of ["u", "r", "d", "l"] as const) {
          if (!box.includes(side)) continue;
          const at = SIDE_NAME[side];
          const neighbour = neighbourAt(grid, row, col, side);
          const vertical = side === "u" || side === "d";
          if (neighbour === undefined || neighbour === " ") {
            // Horizontally, an open end is legal (a run may stop anywhere);
            // vertically it is the misalignment this scanner exists to catch.
            if (vertical) {
              push(
                row,
                col,
                glyph,
                `connects ${at} but finds ${describe(neighbour)}`,
              );
            }
          } else if (
            isDrawing(neighbour) && !connects(neighbour, OPPOSITE[side]) &&
            // An arrowhead may POINT at the claimer instead of continuing
            // its shaft (`▲` directly under a border's `┬`).
            ARROW_CLAIMS[neighbour] !== side
          ) {
            push(
              row,
              col,
              glyph,
              `connects ${at} into ${
                describe(neighbour)
              }, which does not connect back`,
            );
          }
          // Any other neighbour is label text — a legal anchor.
        }
        continue;
      }
      const arrow = ARROW_CLAIMS[glyph];
      if (arrow !== undefined) {
        const neighbour = neighbourAt(grid, row, col, arrow);
        const vertical = arrow === "u" || arrow === "d";
        const anchored = vertical
          ? neighbour !== undefined && neighbour !== " " &&
            (!isDrawing(neighbour) || connects(neighbour, OPPOSITE[arrow]))
          : connects(neighbour, OPPOSITE[arrow]);
        if (!anchored) {
          push(
            row,
            col,
            glyph,
            `arrowhead needs its shaft ${SIDE_NAME[arrow]}; found ${
              describe(neighbour)
            }`,
          );
        }
      }
    }
  }
}
