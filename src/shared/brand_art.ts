/**
 * Pure terminal-art renderers derived from discern's canonical text mark.
 * Callers own colour, placement, terminal checks, and any choice of variant.
 */

import { DISCERN_MARK, DISCERN_NAME, DISCERN_WORDMARK } from "./brand.ts";
import {
  animateDiscernCompact,
  animateDiscernCompress,
  animateDiscernFocus,
  animateDiscernInsertion,
  animateDiscernInterleave,
  animateDiscernMonument,
  animateDiscernRefine,
  animateDiscernResolve,
  animateDiscernSeparate,
  animateDiscernSift,
  animateDiscernSignal,
  animateDiscernSplit,
  animateDiscernStamp,
  type DiscernArtAnimation,
} from "./brand_animation.ts";

export type { DiscernArtAnimation } from "./brand_animation.ts";

/** The character repertoire a terminal-art variant requires. */
export type DiscernArtCharset = "ascii" | "unicode";

/** One discoverable renderer and the character repertoire its output uses. */
export interface DiscernArtVariant {
  readonly charset: DiscernArtCharset;
  readonly render: () => string;
  readonly animate: () => DiscernArtAnimation;
}

/** Join authored rows without adding the trailing newline the caller owns. */
function terminalArt(lines: readonly string[]): string {
  return lines.join("\n");
}

/** Return the canonical one-line wordmark for the narrowest terminal spaces. */
function renderDiscernCompact(): string {
  return DISCERN_WORDMARK;
}

/** Enlarge the split triangle while retaining the canonical wordmark below it. */
function renderDiscernSplit(): string {
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
function renderDiscernSignal(): string {
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
function renderDiscernStamp(): string {
  return terminalArt([
    "+-------------------+",
    "|      /\\           |",
    "|     /|#\\          |",
    `|    /_|##\\ ${DISCERN_NAME} |`,
    "+-------------------+",
  ]);
}

/** Render the widest variant as a classic shell-banner monument. */
function renderDiscernMonument(): string {
  return terminalArt([
    "    /\\            _ _",
    "   /|#\\        __| (_)___  ___ ___ _ __ _ __",
    "  / |##\\      / _` | / __|/ __/ _ \\ '__| '_ \\",
    " /  |###\\    | (_| | \\__ \\ (_|  __/ |  | | | |",
    "/___|####\\    \\__,_|_|___/\\___\\___|_|  |_| |_|",
  ]);
}

/** Reveal one more letter on each step behind the canonical mark. */
function renderDiscernResolve(): string {
  const lines = [DISCERN_MARK];
  for (let index = 1; index <= DISCERN_NAME.length; index += 1) {
    lines.push(
      `${" ".repeat(index)}${DISCERN_MARK} ${DISCERN_NAME.slice(0, index)}`,
    );
  }
  return terminalArt(lines);
}

/** Sift a mixed character field into the half-filled triangular mark. */
function renderDiscernSift(): string {
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

/** Put one more letter into its final position on each successive row. */
function renderDiscernInsertion(): string {
  return terminalArt([
    "n r e c s i d",
    "d n r e c s i",
    "d i n r e c s",
    "d i s n r e c",
    "d i s c n r e",
    "d i s c e n r",
    "d i s c e r n",
    `  ${DISCERN_WORDMARK}`,
  ]);
}

/** Merge two staggered letter streams into the ordered product name. */
function renderDiscernInterleave(): string {
  return terminalArt([
    "d       s       e       n",
    "    i       c       r",
    "d   i   s   c   e   r   n",
    `        ${DISCERN_WORDMARK}`,
  ]);
}

/** Remove space in measured steps until the name reaches its compact lockup. */
function renderDiscernCompress(): string {
  return terminalArt([
    "d   i   s   c   e   r   n",
    " d  i  s  c  e  r  n",
    "  d i s c e r n",
    `   ${DISCERN_NAME}`,
    `  ${DISCERN_WORDMARK}`,
  ]);
}

/** Refine an outline into the half-filled triangle and then the text mark. */
function renderDiscernRefine(): string {
  return terminalArt([
    "   /\\          /\\",
    `  /  \\   ->   /|#\\   ->   ${DISCERN_WORDMARK}`,
    " /____\\      /_|##\\",
  ]);
}

/** Pass a mixed stream through the split mark and separate its two classes. */
function renderDiscernSeparate(): string {
  return terminalArt([
    ". # . # . # . #",
    " \\ \\ \\ \\ / / / /",
    "   \\ \\ \\|/ / /",
    "      \\|/",
    "       /\\",
    "      /|#\\",
    "     /_|##\\",
    ". . . .     # # # #",
    `     ${DISCERN_WORDMARK}`,
  ]);
}

/** Reveal the name from its centre while the surrounding noise falls away. */
function renderDiscernFocus(): string {
  return terminalArt([
    "???c???",
    "??sce??",
    "?iscer?",
    DISCERN_NAME,
    DISCERN_WORDMARK,
  ]);
}

/**
 * The selectable terminal-art family and its one enrolment boundary. Callers
 * render a named member through this table or {@link renderDiscernArt}.
 */
export const DISCERN_ART_VARIANTS = {
  compact: {
    charset: "unicode",
    render: renderDiscernCompact,
    animate: () => animateDiscernCompact(renderDiscernCompact()),
  },
  split: {
    charset: "unicode",
    render: renderDiscernSplit,
    animate: () => animateDiscernSplit(renderDiscernSplit()),
  },
  signal: {
    charset: "ascii",
    render: renderDiscernSignal,
    animate: () => animateDiscernSignal(renderDiscernSignal()),
  },
  stamp: {
    charset: "ascii",
    render: renderDiscernStamp,
    animate: () => animateDiscernStamp(renderDiscernStamp()),
  },
  monument: {
    charset: "ascii",
    render: renderDiscernMonument,
    animate: () => animateDiscernMonument(renderDiscernMonument()),
  },
  resolve: {
    charset: "unicode",
    render: renderDiscernResolve,
    animate: () => animateDiscernResolve(renderDiscernResolve()),
  },
  sift: {
    charset: "ascii",
    render: renderDiscernSift,
    animate: () => animateDiscernSift(renderDiscernSift()),
  },
  insertion: {
    charset: "unicode",
    render: renderDiscernInsertion,
    animate: () => animateDiscernInsertion(renderDiscernInsertion()),
  },
  interleave: {
    charset: "unicode",
    render: renderDiscernInterleave,
    animate: () => animateDiscernInterleave(renderDiscernInterleave()),
  },
  compress: {
    charset: "unicode",
    render: renderDiscernCompress,
    animate: () => animateDiscernCompress(renderDiscernCompress()),
  },
  refine: {
    charset: "unicode",
    render: renderDiscernRefine,
    animate: () => animateDiscernRefine(renderDiscernRefine()),
  },
  separate: {
    charset: "unicode",
    render: renderDiscernSeparate,
    animate: () => animateDiscernSeparate(renderDiscernSeparate()),
  },
  focus: {
    charset: "unicode",
    render: renderDiscernFocus,
    animate: () => animateDiscernFocus(renderDiscernFocus()),
  },
} as const satisfies Readonly<Record<string, DiscernArtVariant>>;

/** A name accepted by the selectable terminal-art renderer. */
export type DiscernArtStyle = keyof typeof DISCERN_ART_VARIANTS;

/** Render a caller-selected variant without adding styling or a final newline. */
export function renderDiscernArt(style: DiscernArtStyle): string {
  return DISCERN_ART_VARIANTS[style].render();
}

/** Build a caller-selected semantic timeline with the static render last. */
export function renderDiscernArtAnimation(
  style: DiscernArtStyle,
): DiscernArtAnimation {
  return DISCERN_ART_VARIANTS[style].animate();
}
