/**
 * The one-cell marks the Desk's views use beyond status's row states.
 *
 * Each is a Unicode form and its ASCII fallback. Every name the package's
 * glyph table also names carries exactly the package's pair, which a test
 * holds; the Desk keeps its own copy only because its views import nothing
 * but types and Component renderers from the package.
 */

import { DISCERN_MARK } from "../../shared/brand.ts";
import type { DeskConsequenceMark } from "./model.ts";

/** A one-cell mark and its ASCII form. */
export interface DeskGlyph {
  readonly unicode: string;
  readonly ascii: string;
}

/** Marks the Desk shows, by the package's glyph names where it has one. */
export const DESK_GLYPHS = {
  done: { unicode: "✓", ascii: "v" },
  failed: { unicode: "✕", ascii: "x" },
  /** Work running now; animates where the view asks it to. */
  running: { unicode: "◐", ascii: "@" },
  attention: { unicode: "!", ascii: "!" },
  changes: { unicode: "→", ascii: ">" },
  removes: { unicode: "−", ascii: "-" },
  keeps: { unicode: "=", ascii: "=" },
  restorable: { unicode: "↺", ascii: "~" },
  overlap: { unicode: "⇄", ascii: "&" },
  separator: { unicode: "·", ascii: "-" },
  /** A return from a child, on the message line. */
  back: { unicode: "←", ascii: "<" },
  meterFill: { unicode: "━", ascii: "=" },
  meterTrack: { unicode: "─", ascii: "-" },
  /** The project mark: once, in the header; dropped without Unicode. */
  brand: { unicode: DISCERN_MARK, ascii: "" },
} as const satisfies Record<string, DeskGlyph>;

/** The mark each consequence and result line leads with. */
export const CONSEQUENCE_GLYPHS = {
  evidence: DESK_GLYPHS.done,
  changes: DESK_GLYPHS.changes,
  removes: DESK_GLYPHS.removes,
  discards: DESK_GLYPHS.removes,
  keeps: DESK_GLYPHS.keeps,
  recoverable: DESK_GLYPHS.restorable,
  warning: DESK_GLYPHS.attention,
  failure: DESK_GLYPHS.failed,
} as const satisfies Record<DeskConsequenceMark | "failure", DeskGlyph>;
