/**
 * Pure terminal-art renderers derived from discern's canonical text mark.
 * Callers own colour, placement, terminal checks, and any choice of variant.
 */

import { DISCERN_MARK, DISCERN_NAME, DISCERN_WORDMARK } from "./brand.ts";

/** The character repertoire a terminal-art variant requires. */
export type DiscernArtCharset = "ascii" | "unicode";

/** One discoverable renderer and the character repertoire its output uses. */
export interface DiscernArtVariant {
  readonly charset: DiscernArtCharset;
  readonly render: () => string;
}

/** Join authored rows without adding the trailing newline the caller owns. */
function terminalArt(lines: readonly string[]): string {
  return lines.join("\n");
}

/** Return the canonical one-line wordmark for the narrowest terminal spaces. */
export function renderDiscernCompact(): string {
  return DISCERN_WORDMARK;
}

/** Enlarge the split triangle while retaining the canonical wordmark below it. */
export function renderDiscernSplit(): string {
  return terminalArt([
    "     /\\",
    "    /|#\\",
    "   / |##\\",
    "  /  |###\\",
    " /___|####\\",
    `  ${DISCERN_WORDMARK}`,
  ]);
}

/** Carry the half-filled mark through horizontal scan lines into its name. */
export function renderDiscernSignal(): string {
  return terminalArt([
    "         /\\",
    "--------/|#\\--------",
    "-------/ |##\\-------",
    "------/  |###\\------",
    "-----/___|####\\-----",
    `       ${DISCERN_NAME}`,
  ]);
}

/** Set the mark and name inside a compact 7-bit terminal stamp. */
export function renderDiscernStamp(): string {
  return terminalArt([
    "+-------------------+",
    "|      /\\           |",
    "|     /|#\\          |",
    `|    /_|##\\ ${DISCERN_NAME} |`,
    "+-------------------+",
  ]);
}

/** Render the widest variant as a classic shell-banner monument. */
export function renderDiscernMonument(): string {
  return terminalArt([
    "    /\\            _ _",
    "   /|#\\        __| (_)___  ___ ___ _ __ _ __",
    "  / |##\\      / _` | / __|/ __/ _ \\ '__| '_ \\",
    " /  |###\\    | (_| | \\__ \\ (_|  __/ |  | | | |",
    "/___|####\\    \\__,_|_|___/\\___\\___|_|  |_| |_|",
  ]);
}

/** Reveal one more letter on each step behind the canonical mark. */
export function renderDiscernResolve(): string {
  const lines = [DISCERN_MARK];
  for (let index = 1; index <= DISCERN_NAME.length; index += 1) {
    lines.push(
      `${" ".repeat(index)}${DISCERN_MARK} ${DISCERN_NAME.slice(0, index)}`,
    );
  }
  return terminalArt(lines);
}

/** Sift a mixed character field into the half-filled triangular mark. */
export function renderDiscernSift(): string {
  return terminalArt([
    ".      :      #",
    " \\     |     /",
    "  \\    |    /",
    "   \\   |   /",
    "    \\  |  /",
    "     \\ | /",
    "      \\|/",
    "      /\\",
    "     /|#\\",
    "    /_|##\\",
    `    ${DISCERN_NAME}`,
  ]);
}

/**
 * The selectable terminal-art family. Variant functions remain public for
 * direct use; this table gives callers one typed lookup when the choice is data.
 */
export const DISCERN_ART_VARIANTS = {
  compact: { charset: "unicode", render: renderDiscernCompact },
  split: { charset: "unicode", render: renderDiscernSplit },
  signal: { charset: "ascii", render: renderDiscernSignal },
  stamp: { charset: "ascii", render: renderDiscernStamp },
  monument: { charset: "ascii", render: renderDiscernMonument },
  resolve: { charset: "unicode", render: renderDiscernResolve },
  sift: { charset: "ascii", render: renderDiscernSift },
} as const satisfies Readonly<Record<string, DiscernArtVariant>>;

/** A name accepted by the selectable terminal-art renderer. */
export type DiscernArtStyle = keyof typeof DISCERN_ART_VARIANTS;

/** Render a caller-selected variant without adding styling or a final newline. */
export function renderDiscernArt(style: DiscernArtStyle): string {
  return DISCERN_ART_VARIANTS[style].render();
}
