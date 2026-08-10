/** Exact designs and shared contracts for discern's terminal-art family. */

import { assert, assertEquals } from "@std/assert";
import {
  DISCERN_ART_VARIANTS,
  type DiscernArtStyle,
  renderDiscernArt,
} from "../art/terminal/brand.ts";

const EXPECTED: Readonly<Record<DiscernArtStyle, string>> = {
  compact: "◮ discern",
  split: [
    "     /\\",
    "    /|#\\",
    "   / |##\\",
    "  /  |###\\",
    " /___|####\\",
    "  ◮ discern",
  ].join("\n"),
  signal: [
    "         /\\",
    "--------/|#\\--------",
    "-------/ |##\\-------",
    "------/  |###\\------",
    "-----/___|####\\-----",
    "       discern",
  ].join("\n"),
  stamp: [
    "+-------------------+",
    "|      /\\           |",
    "|     /|#\\          |",
    "|    /_|##\\ discern |",
    "+-------------------+",
  ].join("\n"),
  monument: [
    "    /\\            _ _",
    "   /|#\\        __| (_)___  ___ ___ _ __ _ __",
    "  / |##\\      / _` | / __|/ __/ _ \\ '__| '_ \\",
    " /  |###\\    | (_| | \\__ \\ (_|  __/ |  | | | |",
    "/___|####\\    \\__,_|_|___/\\___\\___|_|  |_| |_|",
  ].join("\n"),
  resolve: [
    "◮",
    " ◮ d",
    "  ◮ di",
    "   ◮ dis",
    "    ◮ disc",
    "     ◮ disce",
    "      ◮ discer",
    "       ◮ discern",
  ].join("\n"),
  sift: [
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
    "    discern",
  ].join("\n"),
  insertion: [
    "n r e c s i d",
    "d n r e c s i",
    "d i n r e c s",
    "d i s n r e c",
    "d i s c n r e",
    "d i s c e n r",
    "d i s c e r n",
    "  ◮ discern",
  ].join("\n"),
  interleave: [
    "d       s       e       n",
    "    i       c       r",
    "d   i   s   c   e   r   n",
    "        ◮ discern",
  ].join("\n"),
  compress: [
    "d   i   s   c   e   r   n",
    " d  i  s  c  e  r  n",
    "  d i s c e r n",
    "   discern",
    "  ◮ discern",
  ].join("\n"),
  refine: [
    "   /\\          /\\",
    "  /  \\   ->   /|#\\   ->   ◮ discern",
    " /____\\      /_|##\\",
  ].join("\n"),
  separate: [
    ". # . # . # . #",
    " \\ \\ \\ \\ / / / /",
    "   \\ \\ \\|/ / /",
    "      \\|/",
    "       /\\",
    "      /|#\\",
    "     /_|##\\",
    ". . . .     # # # #",
    "     ◮ discern",
  ].join("\n"),
  focus: [
    "???c???",
    "??sce??",
    "?iscer?",
    "discern",
    "◮ discern",
  ].join("\n"),
};

Deno.test("terminal-art functions preserve every curated design", () => {
  assertEquals(Object.keys(DISCERN_ART_VARIANTS), Object.keys(EXPECTED));
  for (const style of Object.keys(EXPECTED) as DiscernArtStyle[]) {
    assertEquals(DISCERN_ART_VARIANTS[style].render(), EXPECTED[style], style);
    assertEquals(renderDiscernArt(style), EXPECTED[style], style);
  }
});

Deno.test("terminal-art variants stay deterministic and safe to compose", () => {
  const seen = new Set<string>();
  for (const [style, variant] of Object.entries(DISCERN_ART_VARIANTS)) {
    const first = variant.render();
    const second = variant.render();
    assertEquals(second, first, `${style} must be deterministic`);
    assert(!seen.has(first), `${style} duplicates another variant`);
    seen.add(first);
    assert(first !== "", `${style} must not be empty`);
    assert(!first.startsWith("\n"), `${style} starts with a blank row`);
    assert(!first.endsWith("\n"), `${style} owns no trailing newline`);
    assert(!first.includes("\r"), `${style} contains a carriage return`);
    assert(!first.includes("\t"), `${style} contains a tab`);
    assert(!first.includes("\x1b"), `${style} contains ANSI styling`);
    for (const character of first) {
      assert(
        character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
        `${style} contains terminal control ${JSON.stringify(character)}`,
      );
    }
    for (const line of first.split("\n")) {
      assert(
        !/\s$/u.test(line),
        `${style} line has trailing whitespace: ${JSON.stringify(line)}`,
      );
    }
  }
});

Deno.test("ASCII-labelled art uses only printable 7-bit characters", () => {
  for (const [style, variant] of Object.entries(DISCERN_ART_VARIANTS)) {
    if (variant.charset !== "ascii") continue;
    for (const character of variant.render()) {
      const code = character.codePointAt(0) ?? 0;
      assert(
        character === "\n" || (code >= 0x20 && code <= 0x7e),
        `${style} contains non-ASCII ${JSON.stringify(character)}`,
      );
    }
  }
});

Deno.test("Unicode-labelled art contains a non-ASCII character", () => {
  for (const [style, variant] of Object.entries(DISCERN_ART_VARIANTS)) {
    if (variant.charset !== "unicode") continue;
    assert(
      [...variant.render()].some((character) =>
        (character.codePointAt(0) ?? 0) > 0x7f
      ),
      `${style} is labelled Unicode but contains only ASCII`,
    );
  }
});
