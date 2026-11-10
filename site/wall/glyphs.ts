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
  bracket,
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
} from "./glyph_grammar.ts";

export const GLYPHS: Readonly<Record<string, GlyphDrawing>> = {
  // One large aim, and the three finished pieces it becomes.
  "shape-substantial-work": [
    dot(17.5, 24, 14.5, "tint"),
    dot(39.5, 8.5, 5.5),
    dot(39.5, 39.5, 5.5),
    shift(dot(39.5, 24, 5.5), 2, 0),
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
  // Two parties joined directly; the go-between's place stands empty.
  "wait-without-relay": [
    bar(6, 20.5, 36, 7, "solid", -38),
    dot(10, 35, 7),
    dot(38, 13, 7),
    shift(ring(37, 37, 6.5), 2, 2),
  ],
  // Steps rising from a base that is still pending.
  "compose-staged-work": [
    dashed(frame(3, 32.5, 27, 12.5, 4.5)),
    bar(10.5, 17.75, 27, 12.5, "tint"),
    shift(bar(18, 5, 27, 12.5), 0, -2),
  ],
  // Two streams curve into one trunk.
  "land-finished-work-as-the-project-moves": [
    band(24, 6, 18, 7.5, 180, 90, "tint"),
    band(24, 42, 18, 7.5, 270, 90),
    shift(bar(22, 20.25, 23, 7.5), 2, 0),
  ],
  // A line pauses, then carries on.
  "resume-later": [
    bar(3, 19.5, 12, 9),
    bar(18.5, 5, 5, 38),
    bar(25.5, 5, 5, 38),
    shift(bar(33, 19.5, 10, 9, "tint"), 2, 0),
  ],
  // One long run, and a short way back to what it found.
  "agent-resume-after-interruption": [
    bar(3, 5, 42, 13),
    dashed(line(6, 37, 27, 37)),
    shift(dot(38.5, 37, 6.5), -2, 0),
  ],
  // Four marks frame the one thing worth a look.
  "reduce-routine-review": [
    bracket(3, 3, 16, 16, 5.5),
    bracket(45, 3, -16, 16, 5.5),
    bracket(3, 45, 16, -16, 5.5),
    bracket(45, 45, -16, -16, 5.5),
    bar(12, 19, 24, 10),
  ],
  // A decision point, set into the path of a change.
  "judgment-at-the-change": [
    bar(10, 10, 28, 28, "tint", 45),
    frame(10, 10, 28, 28, 4.5, 45),
    bar(19, 19, 10, 10, "solid", 45),
  ],
  // One screen of panes, the pane that needs you lit.
  "decisions-in-one-view": [
    bar(3, 3, 19, 42, "tint"),
    bar(25.5, 3, 19.5, 19.5),
    bar(25.5, 25.5, 19.5, 19.5, "tint"),
  ],
  // A clean break, its two sides laid open to read.
  "useful-failures-sooner": [
    poly([[4, 5], [25, 5], [18, 22.5], [26.5, 22.5], [16.5, 43], [4, 43]]),
    shift(
      poly(
        [[30.5, 5], [44, 5], [44, 43], [22, 43], [33, 19.5], [24, 19.5]],
        "tint",
      ),
      2,
      0,
    ),
  ],
  // One file changed, its usual companion still missing.
  "catch-related-files": [
    bar(3, 8, 17, 32),
    line(21, 24, 27, 24),
    dashed(frame(28, 8, 17, 32, 4.5)),
  ],
  // A field of checks, only a few of them needed.
  "run-relevant-checks": [
    dot(8.5, 8.5, 5.4),
    dot(24, 8.5, 5.4, "tint"),
    dot(39.5, 8.5, 5.4, "tint"),
    dot(8.5, 24, 5.4, "tint"),
    dot(24, 24, 5.4, "tint"),
    dot(39.5, 24, 5.4),
    dot(8.5, 39.5, 5.4, "tint"),
    dot(24, 39.5, 5.4),
    dot(39.5, 39.5, 5.4, "tint"),
  ],
  // A small thing in a wide, calm room.
  "context-for-the-task": [
    bar(3, 3, 42, 42, "tint"),
    shift(bar(9, 28, 11, 11), 2, -2),
  ],
  // A ring closed by its last segment.
  "project-defined-completion": [
    band(24, 24, 16.5, 8.5, 16, 234, "tint"),
    band(24, 24, 16.5, 8.5, 286, 54),
  ],
  // A seal pressed onto the corner of a written sheet.
  "evidence-for-this-change": [
    bar(3, 3, 34, 34, "tint"),
    bar(9, 10, 16, 4),
    bar(9, 18, 10, 4),
    ring(33, 33, 11.5),
    dot(33, 33, 7),
  ],
  // Rings laid down around a core, one for each season it has kept.
  "evidence-that-lasts": [
    dot(24, 24, 7),
    band(24, 24, 13, 5, 0, 360, "tint"),
    ring(24, 24, 20.1),
  ],
  // A pinwheel: a thing made to be spun, again and again.
  "explicit-release-decision": [
    sector(24, 3.5, 20.5, 90, 90),
    sector(44.5, 24, 20.5, 180, 90, "tint"),
    sector(24, 44.5, 20.5, 270, 90),
    sector(3.5, 24, 20.5, 0, 90, "tint"),
  ],
  // A wall with one lane left open.
  "bounded-standing-permission": [
    bar(3, 7, 20, 7.5, "tint"),
    bar(3, 33.5, 20, 7.5, "tint"),
    bar(3, 20.25, 33, 7.5, "tint"),
    bar(27, 3, 7, 13.5),
    bar(27, 31.5, 7, 13.5),
    shift(dot(39.5, 24, 5), 3, 0),
  ],
  // Two failed tries and one that worked, held apart from the main line.
  "unfinished-work-stays-isolated": [
    bar(3, 4, 42, 20, "tint"),
    ring(12.5, 14, 5),
    ring(24, 14, 5),
    dot(35.5, 14, 5.5),
    bar(3, 35, 42, 9),
  ],
  // A dashed outline of what is about to happen, ahead of what is.
  "recover-interrupted-operations": [
    bar(3, 19, 26, 26),
    shift(dashed(frame(18.5, 3.5, 26, 26, 5)), 1.5, -1.5),
  ],
  // Two halves that face each other: one settled, one open.
  "agent-carry-judgment-as-judgment": [
    sector(22, 24, 19, 180, 180),
    shift(sector(26, 24, 19, 0, 180, "outline"), 1.5, 0),
  ],
  // A gauge holding the level it has reached.
  "retain-measured-gains": [
    band(24, 28, 17.5, 8, 240, 240, "tint"),
    band(24, 28, 17.5, 8, 240, 165),
    dot(24, 28, 5),
  ],
  // A marker raised on its track, with an outline where it stood.
  "pin-new-baseline": [
    bar(21, 3, 6, 5.5, "tint"),
    bar(21, 19.5, 6, 10, "tint"),
    bar(21, 40, 6, 5, "tint"),
    dashed(frame(7, 29.5, 34, 10.5, 4.5)),
    shift(bar(7, 8.5, 34, 11), 0, -2),
  ],
  // A ruler with one bold mark.
  "standards-that-scale": [
    bar(3, 3, 8, 42, "tint"),
    bar(15, 5, 9, 4, "tint"),
    bar(15, 13, 9, 4, "tint"),
    bar(15, 33, 9, 4, "tint"),
    bar(15, 41, 9, 4, "tint"),
    bar(15, 20, 30, 8.5),
  ],
  // The empty set: nowhere left for the bug to live.
  "remove-bug-class": [
    band(24, 24, 15.5, 6.5, 0, 360),
    bar(-1, 21, 50, 6, "solid", -45),
  ],
  // Bars fading as they step down to an empty place on the baseline.
  "retire-old-pattern": [
    bar(3, 5, 9.5, 30),
    bar(15, 15, 9.5, 20),
    bar(27, 25, 9.5, 10, "tint"),
    ring(40.5, 30.5, 4),
    bar(3, 39, 42, 6),
  ],
  // Scattered pieces beside what is left once they are put in order.
  "keep-clutter-down": [
    bar(5, 5, 10, 10, "tint", 20),
    bar(13, 19, 9, 9, "tint", -15),
    bar(5, 31, 11, 11, "tint", 38),
    bar(27, 3, 18, 19.5),
    bar(27, 25.5, 18, 19.5),
  ],
  // Two links of a chain, one of them broken.
  "catch-documentation-breakage": [
    band(17, 17, 11, 6.5, 0, 360),
    shift(band(31, 31, 11, 6.5, 95, 260, "tint"), 2, 2),
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
  // A folded map, opened flat.
  "inspect-agent-understanding": [
    poly([[4, 10], [15, 5], [15, 38], [4, 43]]),
    poly([[18.5, 5], [29.5, 10], [29.5, 43], [18.5, 38]], "tint"),
    poly([[33, 10], [44, 5], [44, 38], [33, 43]]),
  ],
  // One thing settled, standing on the two beneath it.
  "preserve-decision-reasons": [
    dot(13, 35, 9.5, "tint"),
    dot(35, 35, 9.5, "tint"),
    shift(dot(24, 13.5, 9.5), 0, 2),
  ],
  // A block arriving over the break in a line.
  "instructions-at-failure": [
    bar(3, 38, 16, 7, "tint"),
    bar(29, 38, 16, 7, "tint"),
    shift(bar(9, 4, 30, 25), 0, 3),
  ],
  // A whole disc, and the one quarter that needs reading.
  "orient-new-session": [
    dot(24, 24, 21, "tint"),
    sector(24, 24, 21, 0, 90),
  ],
  // Sheets gathered behind a single front page.
  "export-project-briefing": [
    bar(16, 3, 24, 30, "tint"),
    bar(10.5, 8.5, 24, 30, "tint"),
    bar(5, 14, 24, 30),
  ],
  // One solid original; its echoes widen and fade.
  "reuse-engineering-discipline": [
    arc(28.5, 24, 18, 338, 224, "tint"),
    arc(23, 24, 16, 338, 224),
    dot(17, 24, 14),
  ],
  // A ladder, climbed one rung at a time.
  "agent-invoke-curated-project-procedures": [
    bar(6, 8, 36, 6, "tint"),
    bar(6, 21, 36, 6),
    bar(6, 34, 36, 6),
    bar(4, 3, 4.5, 42),
    bar(39.5, 3, 4.5, 42),
  ],
  // The discern mark settling into the place made for it.
  "agent-commissioning": [
    poly(
      [[4, 21], [10.5, 21], [10.5, 38], [37.5, 38], [37.5, 21], [44, 21], [
        44,
        45,
      ], [4, 45]],
      "tint",
    ),
    shift(split(24, 18, 23, 24), 0, 3),
  ],
  // One piece in place; the three it never needs stay empty.
  "small-installation-footprint": [
    bar(3, 25.5, 19.5, 19.5),
    ring(12.75, 12.75, 8.5),
    ring(35.25, 12.75, 8.5),
    ring(35.25, 35.25, 8.5),
  ],
  // The discern mark inside a loop that feeds back into itself.
  "inspect-live-example": [
    band(24, 24, 19, 4.5, 35, 290, "tint"),
    dot(13.1, 8.44, 4.5),
    split(24, 25.5, 21, 18),
  ],
  // A way out that turns and leads back.
  "clean-abandoned-environments": [
    bar(3, 6, 24, 9, "tint"),
    band(27, 24, 13.5, 9, 0, 180),
    bar(10, 33, 17, 9),
    shift(dot(10, 37.5, 6.5), -2, 0),
  ],
  // A plain cross on a steady disc.
  "agent-manage-the-installation-lifecycle": [
    dot(24, 24, 21, "tint"),
    bar(19.5, 10, 9, 28),
    bar(10, 19.5, 28, 9),
  ],
  // A switch that flips either way.
  "switch-providers": [
    frame(3, 7, 42, 34, 17),
    dashed(ring(20, 24, 9)),
    shift(dot(30, 24, 12), -3, 0),
  ],
  // Three different shapes standing on one baseline.
  "practice-across-stacks": [
    bar(3, 38.5, 42, 6),
    dot(10, 28, 7),
    bar(19, 7, 11, 28, "tint"),
    bar(32.2, 22.2, 10.6, 10.6, "solid", 45),
  ],
  // Two parts cut to fit each other.
  "build-on-published-contracts": [
    poly(
      [[3, 3], [26, 3], [26, 15], [17, 15], [17, 33], [26, 33], [26, 45], [
        3,
        45,
      ]],
      "tint",
    ),
    shift(
      poly([
        [29.5, 7],
        [45, 7],
        [45, 41],
        [29.5, 41],
        [29.5, 29.5],
        [
          20.5,
          29.5,
        ],
        [20.5, 18.5],
        [29.5, 18.5],
      ]),
      -2,
      0,
    ),
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
  // The discern mark lifting away, hollow; the stack beneath it stays.
  "retain-work-after-uninstall": [
    bar(3, 37, 42, 8),
    bar(3, 26, 42, 8),
    shift(poly([[13, 21], [35, 21], [24, 4]], "outline"), 0, -2),
  ],
  // Two agents overlapping on one task.
  "agent-switch-supported-agent-hosts": [
    dot(18, 18, 15, "tint"),
    ring(30, 30, 15),
    dot(24, 24, 5),
  ],
  // A whole shell with nothing fitted inside it.
  "local-without-another-model": [
    band(24, 24, 17.5, 7, 0, 360),
    dashed(ring(24, 24, 7)),
  ],
  // Two lines, and the one thing that travels between them.
  "explicit-write-authority": [
    bar(-2, 14.5, 38, 5, "solid", -45),
    bar(12, 28.5, 38, 5, "solid", -45),
    shift(dot(24, 24, 5.5), 2, -2),
  ],
  // A signal that fades and stops at the wall.
  "agent-diagnose-workflow-friction-locally": [
    dot(9, 24, 6),
    band(9, 24, 15, 4, 50, 80),
    band(9, 24, 25, 4, 58, 64, "tint"),
    bar(38.5, 3, 6.5, 42),
  ],
};

/** The drawing for a glyph name: the authored one, or a seeded one for an unknown name. */
export function glyphDrawing(name: string): GlyphDrawing {
  const authored = Object.hasOwn(GLYPHS, name) ? GLYPHS[name] : undefined;
  return authored ?? seededGlyph(name);
}
