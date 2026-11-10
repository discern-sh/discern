/**
 * The wall's glyphs: one authored drawing per benefit card, keyed by card id.
 *
 * Each drawing suggests its card's idea with a few bold forms from the glyph
 * grammar. The split triangle of the discern mark appears only where discern
 * itself is the subject.
 */
import {
  arc,
  band,
  bar,
  dashed,
  dot,
  frame,
  type GlyphDrawing,
  line,
  poly,
  ring,
  sector,
  seededGlyph,
  shift,
  split,
  trail,
} from "./glyph_grammar.ts";

export const GLYPHS: Readonly<Record<string, GlyphDrawing>> = {
  // One goal above, three briefs branching beneath it.
  "shape-substantial-work": [
    trail([[9, 31], [9, 24], [39, 24], [39, 31]]),
    line(24, 17, 24, 31),
    bar(12, 3, 24, 14),
    bar(3, 31, 12, 14, "tint"),
    bar(18, 31, 12, 14, "tint"),
    bar(33, 31, 12, 14, "tint"),
  ],
  // Three lanes, one agent moving in each.
  "parallel-work-on-one-machine": [
    bar(3, 3, 11.5, 42, "tint"),
    bar(18.25, 3, 11.5, 42, "tint"),
    bar(33.5, 3, 11.5, 42, "tint"),
    dot(8.75, 34, 4),
    shift(dot(24, 13, 4), 0, -3),
    dot(39.25, 24, 4),
  ],
  // Two parties joined by a bridge nobody has to carry.
  "wait-without-relay": [
    dashed(arc(24, 25, 15, 292, 136)),
    dot(10, 31, 7),
    ring(38, 31, 6.1),
  ],
  // Steps rising from a base that is still pending.
  "compose-staged-work": [
    dashed(frame(3, 32, 26, 12, 4)),
    bar(11, 18, 26, 12, "tint"),
    shift(bar(19, 4, 26, 12), 0, -2),
  ],
  // Two streams curve into one trunk.
  "land-finished-work-as-the-project-moves": [
    band(24, 6, 18, 6, 180, 90, "tint"),
    band(24, 42, 18, 6, 270, 90),
    shift(bar(22, 21, 23, 6), 2, 0),
  ],
  // A line pauses, then carries on.
  "resume-later": [
    bar(3, 20.5, 13, 7),
    bar(19.25, 11, 3.5, 26),
    bar(25.25, 11, 3.5, 26),
    shift(bar(32, 20.5, 13, 7, "tint"), 2, 0),
  ],
  // A broken ring, rejoined by the dot in its gap.
  "agent-resume-after-interruption": [
    dot(24, 24, 8, "tint"),
    arc(24, 24, 18, 85, 280),
    dot(36.73, 11.27, 4.6),
  ],
  // A lens over the one row that matters.
  "reduce-routine-review": [
    ring(20, 20, 15.5),
    bar(30.25, 35, 15, 5.5, "solid", 45),
    bar(13, 9.5, 14, 4, "tint"),
    bar(10.5, 17.25, 19, 5.5),
    bar(13, 26.5, 10, 4, "tint"),
  ],
  // A question, hooked above its point.
  "judgment-at-the-change": [
    band(24, 17, 11, 6.5, 270, 270),
    dot(24, 41, 4.5),
  ],
  // A list with one row lit.
  "decisions-in-one-view": [
    dot(7, 9.5, 3.5, "tint"),
    bar(15, 6.5, 30, 6, "tint"),
    dot(7, 24, 4),
    shift(bar(15, 21, 28, 6), 2, 0),
    dot(7, 38.5, 3.5, "tint"),
    bar(15, 35.5, 22, 6, "tint"),
  ],
  // A failure, with the line that explains it and the point to run again.
  "useful-failures-sooner": [
    bar(7, 14, 34, 6, "solid", 45),
    bar(7, 14, 34, 6, "solid", -45),
    bar(3, 37, 30, 7, "tint"),
    dot(41, 40.5, 4),
  ],
  // One file changed, its usual companion still missing.
  "catch-related-files": [
    bar(3, 8, 17, 32),
    line(21, 24, 27, 24),
    dashed(frame(28, 8, 17, 32, 4.5)),
  ],
  // A field of checks, only a few of them needed.
  "run-relevant-checks": [
    dot(8, 8, 4.6),
    dot(24, 8, 4.6, "tint"),
    dot(40, 8, 4.6, "tint"),
    dot(8, 24, 4.6, "tint"),
    dot(24, 24, 4.6, "tint"),
    dot(40, 24, 4.6),
    dot(8, 40, 4.6, "tint"),
    dot(24, 40, 4.6),
    dot(40, 40, 4.6, "tint"),
  ],
  // A small thing in a wide, empty room.
  "context-for-the-task": [
    frame(3, 3, 42, 42, 9),
    shift(bar(9, 29, 10, 10), 2, -2),
  ],
  // A path of steps, the next one marked.
  "agent-orient-from-one-bounded-result": [
    dot(6, 41, 2.6, "tint"),
    dot(14, 34.5, 3.1, "tint"),
    dot(23, 27, 3.6, "tint"),
    ring(34, 16, 10.5),
    dot(34, 16, 5.5),
  ],
  // Three bars reaching one finish line together.
  "agent-run-the-relevant-gate-efficiently": [
    bar(3, 6, 33, 7),
    bar(15, 20.5, 21, 7, "tint"),
    bar(8, 35, 28, 7),
    bar(41, 3, 3.5, 42),
  ],
  // A ring closed by its last segment.
  "project-defined-completion": [
    band(24, 24, 16.5, 7, 14, 240, "tint"),
    band(24, 24, 16.5, 7, 284, 62),
  ],
  // A seal pressed onto the corner of a written sheet.
  "evidence-for-this-change": [
    bar(3, 3, 34, 34, "tint"),
    bar(9, 10, 16, 4),
    bar(9, 18, 10, 4),
    ring(33, 33, 11.5),
    dot(33, 33, 7),
  ],
  // A box with its lid on, kept for later.
  "evidence-that-lasts": [
    shift(bar(3, 5, 42, 10), 0, -2),
    frame(6, 18, 36, 25, 4.5),
    bar(18, 26, 12, 4.5),
  ],
  // A lever, with your hand on it.
  "explicit-release-decision": [
    frame(3, 27, 42, 18, 6),
    bar(22, 10, 5, 25, "solid", 21),
    dot(29.5, 9.5, 6),
  ],
  // A wall with one lane left open.
  "bounded-standing-permission": [
    bar(3, 7.5, 20, 6, "tint"),
    bar(3, 34.5, 20, 6, "tint"),
    bar(3, 21, 33, 6, "tint"),
    bar(27, 3, 6.5, 13.5),
    bar(27, 31.5, 6.5, 13.5),
    shift(dot(40, 24, 4.5), 3, 0),
  ],
  // A branch that leaves the main line and stays off it.
  "unfinished-work-stays-isolated": [
    bar(3, 37, 42, 7),
    trail([[10, 37], [10, 25], [20, 14], [34, 14]]),
    dot(10, 25, 3),
    dot(21, 14, 3),
    shift(ring(39.5, 14, 4.5), 2, 0),
  ],
  // A dashed outline of what is about to happen, ahead of what is.
  "recover-interrupted-operations": [
    shift(dashed(frame(18.5, 3.5, 26, 26, 5)), 1.5, -1.5),
    bar(3, 19, 26, 26),
  ],
  // Two halves that face each other: one settled, one open.
  "agent-carry-judgment-as-judgment": [
    sector(22, 24, 19, 180, 180),
    shift(sector(26, 24, 19, 0, 180, "outline"), 1.5, 0),
  ],
  // A gauge holding the level it has reached.
  "retain-measured-gains": [
    band(24, 33, 17.5, 7, 270, 180, "tint"),
    band(24, 33, 17.5, 7, 270, 115),
    dot(24, 33, 4.5),
  ],
  // A marker moved up its track, the old position left behind.
  "pin-new-baseline": [
    bar(21, 3, 6, 6, "tint"),
    bar(21, 18, 6, 11, "tint"),
    bar(21, 38, 6, 7, "tint"),
    dashed(frame(11, 29, 26, 9, 4)),
    shift(bar(11, 9, 26, 9), 0, -2),
  ],
  // A ruler with one bold mark.
  "standards-that-scale": [
    bar(3, 3, 6, 42, "tint"),
    line(13, 7, 20, 7),
    line(13, 15.5, 20, 15.5),
    line(13, 32.5, 20, 32.5),
    line(13, 41, 20, 41),
    bar(13, 21, 32, 6),
  ],
  // Every instance gathered inside one guard ring.
  "remove-bug-class": [
    ring(24, 24, 20),
    dot(16.5, 18.5, 4.5),
    dot(30, 16, 3.5),
    dot(20.5, 31, 3.5),
    dot(32, 29, 4.5),
  ],
  // Bars stepping down to an empty place on the baseline.
  "retire-old-pattern": [
    bar(3, 6, 9, 31, "tint"),
    bar(15, 17, 9, 20, "tint"),
    bar(27, 28, 9, 9, "tint"),
    ring(41, 32.5, 3.6),
    bar(3, 40, 42, 4.5),
  ],
  // Scattered pieces beside the same pieces put in order.
  "keep-clutter-down": [
    bar(5, 5, 9, 9, "tint", 20),
    bar(15, 19, 8, 8, "tint", -15),
    bar(5, 31, 10, 10, "tint", 38),
    bar(32, 4, 11, 11),
    bar(32, 18.5, 11, 11),
    bar(32, 33, 11, 11),
  ],
  // Two links of a chain, one of them broken.
  "catch-documentation-breakage": [
    shift(band(32.5, 24, 10, 5, 50, 260, "tint"), 2, 0),
    band(15.5, 24, 10, 5, 0, 360),
  ],
  // A tally where one bar stands far above the rest.
  "improve-practice-from-evidence": [
    bar(3, 33, 6.5, 12, "tint"),
    bar(11.9, 26, 6.5, 19, "tint"),
    shift(bar(20.75, 5, 6.5, 40), 0, -2),
    bar(29.6, 22, 6.5, 23, "tint"),
    bar(38.5, 35, 6.5, 10, "tint"),
  ],
  // One source, carried out in every direction.
  "teach-project-once": [
    sector(3, 24, 13, 0, 180),
    bar(20, 21, 25, 6, "tint"),
    bar(18.5, 8, 25, 6, "tint", -28),
    bar(18.5, 34, 25, 6, "tint", 28),
  ],
  // A frame opened to show the frames inside it.
  "inspect-agent-understanding": [
    frame(3, 3, 42, 42, 9),
    bar(11, 11, 26, 26, "tint"),
    bar(18.5, 18.5, 11, 11),
  ],
  // A signpost with one direction marked.
  "preserve-decision-reasons": [
    poly([[36, 26], [11, 26], [4, 33], [11, 40], [36, 40]], "tint"),
    bar(21.5, 3, 5, 42),
    shift(poly([[12, 6], [37, 6], [44, 13], [37, 20], [12, 20]]), 2, 0),
  ],
  // A note pinned over the break in a line.
  "instructions-at-failure": [
    bar(3, 38, 15, 5.5, "tint"),
    bar(28, 38, 17, 5.5, "tint"),
    bar(17.5, 22.5, 9, 9, "solid", 45),
    bar(7, 4, 34, 23),
  ],
  // A clock face with only its first quarter spent.
  "orient-new-session": [
    ring(24, 24, 20),
    sector(24, 24, 14, 0, 90),
  ],
  // Sheets gathered behind a single front page.
  "export-project-briefing": [
    bar(14, 3, 26, 32, "tint"),
    bar(9.5, 8, 26, 32, "tint"),
    bar(5, 13, 26, 32),
  ],
  // One solid original; its echoes fade.
  "reuse-engineering-discipline": [
    dashed(arc(32, 24, 12, 338, 224)),
    arc(23, 24, 12, 338, 224),
    dot(14, 24, 12),
  ],
  // A ladder, climbed one rung at a time.
  "agent-invoke-curated-project-procedures": [
    bar(10, 8, 28, 5.5, "tint"),
    bar(10, 21.25, 28, 5.5),
    bar(10, 34.5, 28, 5.5),
    bar(8, 3, 3.5, 42),
    bar(36.5, 3, 3.5, 42),
  ],
  // The discern mark settling into a project's frame.
  "agent-commissioning": [
    frame(3, 3, 42, 42, 10),
    shift(split(24, 25, 23, 19), 0, -3),
  ],
  // A lone square under an empty sky.
  "small-installation-footprint": [
    dashed(arc(24, 30, 21, 270, 180)),
    bar(17, 26, 14, 14),
    bar(3, 41, 42, 4, "tint"),
  ],
  // The discern mark inside a loop that feeds back into itself.
  "inspect-live-example": [
    arc(24, 24, 20, 35, 290),
    dot(12.53, 7.62, 3.4),
    split(24, 25.5, 20, 17),
  ],
  // One piece pulled from the stack, its place kept open.
  "clean-abandoned-environments": [
    bar(3, 5, 20, 9),
    dashed(frame(3, 19.5, 20, 9, 3.75)),
    shift(bar(25, 19.5, 20, 9, "tint"), -3, 0),
    bar(3, 34, 20, 9),
  ],
  // A pulse crossing a steady disc.
  "agent-manage-the-installation-lifecycle": [
    dot(24, 24, 18, "tint"),
    trail([[3, 24], [14, 24], [19.5, 12], [27.5, 36], [33, 24], [45, 24]]),
  ],
  // A switch that flips either way.
  "switch-providers": [
    frame(3, 11, 42, 26, 13),
    dashed(ring(16, 24, 7)),
    shift(dot(32, 24, 8), -3, 0),
  ],
  // Three different shapes standing on one baseline.
  "practice-across-stacks": [
    bar(3, 38, 42, 5),
    dot(9.5, 27.5, 6.5),
    bar(18, 9, 12, 25, "tint"),
    frame(33.7, 22.7, 9.6, 9.6, 1.5, 45),
  ],
  // Structured rows held between braces.
  "build-on-published-contracts": [
    trail([[14, 4], [9, 4], [9, 20], [5, 24], [9, 28], [9, 44], [14, 44]]),
    trail([[34, 4], [39, 4], [39, 20], [43, 24], [39, 28], [39, 44], [
      34,
      44,
    ]]),
    bar(15, 13, 18, 6.5),
    bar(15, 27.5, 12, 6.5, "tint"),
  ],
  // A calendar with one day chosen.
  "planned-upgrades": [
    bar(3, 3, 42, 8),
    bar(3, 16, 11.5, 12.5, "tint"),
    bar(18.25, 16, 11.5, 12.5, "tint"),
    bar(33.5, 16, 11.5, 12.5, "tint"),
    bar(3, 32.5, 11.5, 12.5, "tint"),
    bar(18.25, 32.5, 11.5, 12.5),
    bar(33.5, 32.5, 11.5, 12.5, "tint"),
  ],
  // The discern mark lifting away; the stack beneath it stays.
  "retain-work-after-uninstall": [
    bar(3, 37, 42, 8),
    bar(3, 26, 42, 8),
    shift(dashed(trail([[14, 21], [34, 21], [24, 5], [14, 21]])), 0, -2),
  ],
  // Two agents overlapping on one task.
  "agent-switch-supported-agent-hosts": [
    dot(17, 24, 14, "tint"),
    ring(31, 24, 14),
    dot(24, 24, 4.5),
  ],
  // A key fading away, because nothing asks for one.
  "local-without-another-model": [
    band(12.5, 24, 7, 5, 0, 360),
    bar(22, 21.5, 23, 5, "tint"),
    bar(33, 26.5, 4.5, 7, "tint"),
    bar(40.5, 26.5, 4.5, 5, "tint"),
  ],
  // A pen held above the page until it may write.
  "explicit-write-authority": [
    frame(3, 22, 23, 23, 5.5),
    dashed(line(21, 27, 9, 39)),
    shift(bar(24.5, 9.25, 21, 6.5, "solid", -45), 2, -2),
  ],
  // A signal that never leaves its box.
  "agent-diagnose-workflow-friction-locally": [
    frame(3, 3, 42, 42, 10),
    dashed(arc(14, 34, 12, 0, 90)),
    dashed(arc(14, 34, 21, 0, 90)),
    dot(14, 34, 5),
  ],
};

/** The drawing for a glyph name: the authored one, or a seeded one for an unknown name. */
export function glyphDrawing(name: string): GlyphDrawing {
  const authored = Object.hasOwn(GLYPHS, name) ? GLYPHS[name] : undefined;
  return authored ?? seededGlyph(name);
}
