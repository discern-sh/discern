/** Exact designs and shared contracts for discern's terminal-art family. */

import { assert, assertEquals } from "@std/assert";
import {
  DISCERN_ART_VARIANTS,
  type DiscernArtStyle,
  renderDiscernArt,
  renderDiscernCompact,
  renderDiscernMonument,
  renderDiscernResolve,
  renderDiscernSift,
  renderDiscernSignal,
  renderDiscernSplit,
  renderDiscernStamp,
} from "../src/shared/brand_art.ts";

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
};

const DIRECT_RENDERERS: Readonly<Record<DiscernArtStyle, () => string>> = {
  compact: renderDiscernCompact,
  split: renderDiscernSplit,
  signal: renderDiscernSignal,
  stamp: renderDiscernStamp,
  monument: renderDiscernMonument,
  resolve: renderDiscernResolve,
  sift: renderDiscernSift,
};

Deno.test("terminal-art functions preserve every curated design", () => {
  assertEquals(Object.keys(DISCERN_ART_VARIANTS), Object.keys(EXPECTED));
  for (const style of Object.keys(EXPECTED) as DiscernArtStyle[]) {
    assertEquals(DIRECT_RENDERERS[style](), EXPECTED[style], style);
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
