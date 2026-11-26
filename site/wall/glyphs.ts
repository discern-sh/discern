/**
 * The wall's glyphs: one authored drawing per benefit card, keyed by card id.
 *
 * Each drawing suggests its card's idea with a few bold forms from the glyph
 * grammar, and makes one gesture while its card is lit. The split triangle of
 * the discern mark appears only where discern itself is the subject.
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
  pivot,
  poly,
  ring,
  sector,
  seededGlyph,
  shift,
  split,
} from "./glyph_grammar.ts";

export const GLYPHS: Readonly<Record<string, GlyphDrawing>> = {
  // One large aim, and the three finished pieces it becomes, which spread away from it.
  "shape-substantial-work": [
    dot(17.5, 24, 14.5, "tint"),
    shift(dot(39.5, 8.5, 5.5), 4, -3),
    shift(dot(39.5, 39.5, 5.5), 4, 3),
    shift(dot(39.5, 24, 5.5), 5, 0),
  ],
  // Three lanes, one agent in each, all advancing up their own lane at their own pace.
  "parallel-work-on-one-machine": [
    bar(3, 3, 11.5, 42, "tint"),
    bar(18.25, 3, 11.5, 42, "tint"),
    bar(33.5, 3, 11.5, 42, "tint"),
    shift(dot(8.75, 34, 4), 0, -10),
    shift(dot(24, 13, 4), 0, -6),
    shift(dot(39.25, 24, 4), 0, -10),
  ],
  // Two parties joined directly; the go-between's place stands empty and,
  // lit, drifts away from the link.
  "wait-without-relay": [
    bar(6, 20.5, 36, 7, "solid", -38),
    dot(10, 35, 7),
    dot(38, 13, 7),
    shift(ring(37, 37, 6.5), 4, 4),
  ],
  // Steps rising from a base that is still pending; the newest step settles squarely on the one below.
  "compose-staged-work": [
    dashed(frame(3, 32.5, 27, 12.5, 4.5)),
    bar(10.5, 17.75, 27, 12.5, "tint"),
    shift(bar(18, 5, 27, 12.5), -7.5, 0),
  ],
  // Two streams curve into one trunk. Lit, the tinted stream slides along the
  // trunk and joins it further on, after the solid one.
  "land-finished-work-as-the-project-moves": [
    shift(band(24, 6, 18, 7.5, 180, 90, "tint"), 12, 0),
    band(24, 42, 18, 7.5, 270, 90),
    bar(22, 20.25, 23, 7.5),
  ],
  // A line pauses, then carries on: lit, the pause lies down into the line.
  "resume-later": [
    bar(3, 19.5, 12, 9),
    pivot(bar(18.5, 5, 5, 38), 90, 21, 24),
    pivot(bar(25.5, 5, 5, 38), 90, 28, 24),
    bar(33, 19.5, 10, 9, "tint"),
  ],
  // One long run, and a short way back to what it found: the agent travels back along it.
  "agent-resume-after-interruption": [
    bar(3, 5, 42, 13),
    dashed(line(6, 37, 27, 37)),
    shift(dot(38.5, 37, 6.5), -12, 0),
  ],
  // Four marks frame the one thing worth a look; lit, they close in on it.
  "reduce-routine-review": [
    shift(bracket(3, 3, 16, 16, 5.5), 0, 7),
    shift(bracket(45, 3, -16, 16, 5.5), 0, 7),
    shift(bracket(3, 45, 16, -16, 5.5), 0, -7),
    shift(bracket(45, 45, -16, -16, 5.5), 0, -7),
    bar(12, 19, 24, 10),
  ],
  // A decision point, set into the path of a change. While lit, its outer
  // diamond turns 45 degrees into a square around the mark it holds.
  "judgment-at-the-change": [
    pivot(bar(10, 10, 28, 28, "tint", 45), 45, 24, 24),
    pivot(frame(10, 10, 28, 28, 4.5, 45), 45, 24, 24),
    bar(19, 19, 10, 10, "solid", 45),
  ],
  // One screen of panes, the pane that needs you lit. While lit, that pane
  // slides forward over the others, toward the middle of the screen.
  "decisions-in-one-view": [
    bar(3, 3, 19, 42, "tint"),
    bar(25.5, 25.5, 19.5, 19.5, "tint"),
    shift(bar(25.5, 3, 19.5, 19.5), -7, 7),
  ],
  // A clean break, its two sides tipping open from the crack's foot to be read.
  "useful-failures-sooner": [
    pivot(
      poly([[4, 5], [25, 5], [18, 22.5], [26.5, 22.5], [16.5, 43], [4, 43]]),
      -9,
      16.5,
      43,
    ),
    pivot(
      poly(
        [[30.5, 5], [44, 5], [44, 43], [22, 43], [33, 19.5], [24, 19.5]],
        "tint",
      ),
      9,
      22,
      43,
    ),
  ],
  // One file changed, its usual companion still missing. While lit, the
  // missing companion rises to be noticed.
  "catch-related-files": [
    bar(3, 8, 17, 32),
    line(21, 24, 27, 24),
    shift(dashed(frame(28, 8, 17, 32, 4.5)), 0, -7),
  ],
  // A field of checks, only a few of them needed. Lit, the lower right four
  // turn a quarter about their middle, and the needed checks stand in one line
  // across the field.
  "run-relevant-checks": [
    dot(24, 8.5, 5.4, "tint"),
    dot(39.5, 8.5, 5.4, "tint"),
    dot(8.5, 24, 5.4, "tint"),
    dot(8.5, 39.5, 5.4, "tint"),
    dot(8.5, 8.5, 5.4),
    pivot(dot(24, 24, 5.4, "tint"), 90, 31.75, 31.75),
    pivot(dot(39.5, 39.5, 5.4, "tint"), 90, 31.75, 31.75),
    pivot(dot(39.5, 24, 5.4), 90, 31.75, 31.75),
    pivot(dot(24, 39.5, 5.4), 90, 31.75, 31.75),
  ],
  // A small thing in a wide, calm room, stepping into the middle of it.
  "context-for-the-task": [
    bar(3, 3, 42, 42, "tint"),
    shift(bar(9, 28, 11, 11), 8, -8),
  ],
  // A ring closed by its last segment. Lit, three more segments turn out from
  // under it along the ring, and the ring is whole: four parts, every one
  // solid. The three are a hair slimmer than the segment that hides them.
  "project-defined-completion": [
    band(24, 24, 16.5, 8.5, 16, 234, "tint"),
    pivot(band(24, 24, 16.5, 8, 286, 54), -90, 24, 24),
    pivot(band(24, 24, 16.5, 8, 286, 54), 90, 24, 24),
    pivot(band(24, 24, 16.5, 8, 286, 54), 180, 24, 24),
    band(24, 24, 16.5, 8.5, 286, 54),
  ],
  // A seal on the corner of a written sheet, pressed onto the sheet it vouches for.
  "evidence-for-this-change": [
    bar(3, 3, 34, 34, "tint"),
    bar(9, 10, 16, 4),
    bar(9, 18, 10, 4),
    shift(ring(33, 33, 11.5), -7, -7),
    shift(dot(33, 33, 7), -7, -7),
  ],
  // Rings laid down around a core, one for each season it has kept. The core
  // lifts out of its rings, a record drawn up again long after it was laid down.
  "evidence-that-lasts": [
    band(24, 24, 13, 5, 0, 360, "tint"),
    ring(24, 24, 20.1),
    shift(dot(24, 24, 7), 0, -10),
  ],
  // A pinwheel: a thing made to be spun, again and again. Lit, it turns 17
  // degrees and holds there, caught in its spin.
  "explicit-release-decision": [
    pivot(sector(24, 3.5, 20.5, 90, 90), 17, 24, 24),
    pivot(sector(44.5, 24, 20.5, 180, 90, "tint"), 17, 24, 24),
    pivot(sector(24, 44.5, 20.5, 270, 90), 17, 24, 24),
    pivot(sector(3.5, 24, 20.5, 0, 90, "tint"), 17, 24, 24),
  ],
  // A wall with one lane left open. Lit, the change rolls through the gap in the
  // wall without stopping.
  "bounded-standing-permission": [
    bar(3, 7, 20, 7.5, "tint"),
    bar(3, 33.5, 20, 7.5, "tint"),
    bar(3, 20.25, 33, 7.5, "tint"),
    bar(27, 3, 7, 13.5),
    bar(27, 31.5, 7, 13.5),
    shift(dot(39.5, 24, 5), -12, 0),
  ],
  // Two failed tries and one that worked, held apart from the main line. The
  // failed tries drop to the floor of their own space and stop short of main.
  "unfinished-work-stays-isolated": [
    bar(3, 4, 42, 20, "tint"),
    shift(ring(12.5, 14, 5), 0, 5),
    shift(ring(24, 14, 5), 0, 5),
    dot(35.5, 14, 5.5),
    bar(3, 35, 42, 9),
  ],
  // A dashed outline of what is about to happen, ahead of what is. Lit, the
  // outline draws back over the project, and a tinted copy slides out from
  // under the project to fill it: the change, shown in place before it is
  // made.
  "recover-interrupted-operations": [
    shift(bar(4, 20, 24, 24, "tint"), 8.25, -8.25),
    bar(3, 19, 26, 26),
    shift(dashed(frame(18.5, 3.5, 26, 26, 5)), -7.25, 7.25),
  ],
  // Two halves that face each other: one settled, one open. They slide apart
  // along their seam, so the judged half stands out of line with the tested one.
  "agent-carry-judgment-as-judgment": [
    shift(sector(22, 24, 19, 180, 180), -2, -5),
    shift(sector(26, 24, 19, 0, 180, "outline"), 1, 5),
  ],
  // A gauge holding the level it has reached. Lit, the level runs an eighth of
  // a turn further along its track and holds the gain. The length it gains is
  // a hair slimmer than the level, which hides it at rest.
  "retain-measured-gains": [
    band(24, 28, 17.5, 8, 240, 240, "tint"),
    pivot(band(24, 28, 17.5, 7.5, 0, 45), 45, 24, 28),
    band(24, 28, 17.5, 8, 240, 165),
    dot(24, 28, 5),
  ],
  // A marker raised on its track, with an outline where it stood. Lit, the
  // outline rises to sit under the marker as the new floor.
  "pin-new-baseline": [
    bar(21, 3, 6, 5.5, "tint"),
    bar(21, 19.5, 6, 10, "tint"),
    bar(21, 40, 6, 5, "tint"),
    shift(dashed(frame(7, 29.5, 34, 10.5, 4.5)), 0, -8),
    bar(7, 8.5, 34, 11),
  ],
  // A ruler with one bold mark. Lit, the mark rises to sit on a higher notch.
  "standards-that-scale": [
    bar(3, 3, 8, 42, "tint"),
    bar(15, 5, 9, 4, "tint"),
    bar(15, 13, 9, 4, "tint"),
    bar(15, 33, 9, 4, "tint"),
    bar(15, 41, 9, 4, "tint"),
    shift(bar(15, 20, 30, 8.5), 0, -9),
  ],
  // The empty set: nowhere left for the bug to live. Lit, the stroke swings a
  // quarter turn to strike the ring the other way.
  "remove-bug-class": [
    band(24, 24, 15.5, 6.5, 0, 360),
    pivot(bar(-1, 21, 50, 6, "solid", -45), 90, 24, 24),
  ],
  // Bars stepping down to an empty place on the baseline; lit, all three sink
  // into the baseline, and the last is almost gone.
  "retire-old-pattern": [
    shift(bar(3, 5, 9.5, 30), 0, 10),
    shift(bar(15, 15, 9.5, 20), 0, 10),
    shift(bar(27, 25, 9.5, 10, "tint"), 0, 10),
    ring(40.5, 30.5, 4),
    bar(3, 39, 42, 6),
  ],
  // Scattered pieces beside what is left once they are put in order. Lit, the
  // pieces square up and tuck in behind the stack.
  "keep-clutter-down": [
    shift(pivot(bar(5, 5, 10, 10, "tint", 20), -20, 10, 10), 11.5, 2.5),
    shift(pivot(bar(13, 19, 9, 9, "tint", -15), 15, 17.5, 23.5), 11, 0),
    shift(pivot(bar(5, 31, 11, 11, "tint", 38), -38, 10.5, 36.5), 11.5, -2.5),
    bar(27, 3, 18, 19.5),
    bar(27, 25.5, 18, 19.5),
  ],
  // Two links of a chain, one of them broken. Lit, the broken link turns its
  // gap toward the whole link and slips off it.
  "catch-documentation-breakage": [
    band(17, 17, 11, 6.5, 0, 360),
    shift(pivot(band(31, 31, 11, 6.5, 95, 260, "tint"), -90, 31, 31), 2, 2),
  ],
  // A tally where one bar stands far above the rest, and rises clear of the
  // row while its card is lit.
  "improve-practice-from-evidence": [
    bar(3, 33, 6.5, 12, "tint"),
    bar(11.9, 26, 6.5, 19, "tint"),
    shift(bar(20.75, 5, 6.5, 40), 0, -5),
    bar(29.6, 22, 6.5, 23, "tint"),
    bar(38.5, 35, 6.5, 10, "tint"),
  ],
  // One source, carried out in every direction; lit, each ray travels
  // further out along its own line.
  "teach-project-once": [
    sector(3, 24, 13, 0, 180),
    shift(bar(20, 21, 25, 6, "tint"), 5, 0),
    shift(bar(18.5, 8, 25, 6, "tint", -28), 4.5, -2.5),
    shift(bar(18.5, 34, 25, 6, "tint", 28), 4.5, 2.5),
  ],
  // A folded map, opened flat: its outer panels spread away from the middle one.
  "inspect-agent-understanding": [
    shift(poly([[4, 10], [15, 5], [15, 38], [4, 43]]), -6, 0),
    poly([[18.5, 5], [29.5, 10], [29.5, 43], [18.5, 38]], "tint"),
    shift(poly([[33, 10], [44, 5], [44, 38], [33, 43]]), 6, 0),
  ],
  // One thing settled, standing on the two beneath it; lit, it drops into the
  // cradle they make.
  "preserve-decision-reasons": [
    dot(13, 35, 9.5, "tint"),
    dot(35, 35, 9.5, "tint"),
    shift(dot(24, 13.5, 9.5), 0, 6),
  ],
  // A block arriving over the break in a line; lit, it drops 12 and lands across the break.
  "instructions-at-failure": [
    bar(3, 38, 16, 7, "tint"),
    bar(29, 38, 16, 7, "tint"),
    shift(bar(9, 4, 30, 25), 0, 12),
  ],
  // A whole disc, and the one quarter that needs reading: the quarter swings round to the part the task needs.
  "orient-new-session": [
    dot(24, 24, 21, "tint"),
    pivot(sector(24, 24, 21, 0, 90), 90, 24, 24),
  ],
  // Sheets gathered behind a single front page; lit, the back sheet and the front page
  // meet on the middle one, and the stack becomes one page.
  "export-project-briefing": [
    shift(bar(16, 3, 24, 30, "tint"), -5.5, 5.5),
    bar(10.5, 8.5, 24, 30, "tint"),
    shift(bar(5, 14, 24, 30), 5.5, -5.5),
  ],
  // One solid original; its echoes widen and fade, then close in to share its centre.
  "reuse-engineering-discipline": [
    shift(arc(28.5, 24, 18, 338, 224, "tint"), -11.5, 0),
    shift(arc(23, 24, 16, 338, 224), -6, 0),
    dot(17, 24, 14),
  ],
  // A ladder, climbed one rung at a time: the rungs step up between the rails.
  "agent-invoke-curated-project-procedures": [
    shift(bar(6, 8, 36, 6, "tint"), 0, -5),
    shift(bar(6, 21, 36, 6), 0, -5),
    shift(bar(6, 34, 36, 6), 0, -5),
    bar(4, 3, 4.5, 42),
    bar(39.5, 3, 4.5, 42),
  ],
  // The discern mark settling into the place made for it; lit, it drops 8 onto the floor of its seat.
  "agent-commissioning": [
    poly(
      [[4, 21], [10.5, 21], [10.5, 38], [37.5, 38], [37.5, 21], [44, 21], [
        44,
        45,
      ], [4, 45]],
      "tint",
    ),
    shift(split(24, 18, 23, 24), 0, 8),
  ],
  // One piece in place; the three it never needs stay empty and, lit, drift off to the
  // corners.
  "small-installation-footprint": [
    bar(3, 25.5, 19.5, 19.5),
    shift(ring(12.75, 12.75, 8.5), -4.5, -4.5),
    shift(ring(35.25, 12.75, 8.5), 4.5, -4.5),
    shift(ring(35.25, 35.25, 8.5), 4.5, 4.5),
  ],
  // The discern mark inside a loop that feeds back into itself; lit, the loop and its
  // leading dot go a quarter turn further round the mark.
  "inspect-live-example": [
    pivot(band(24, 24, 19, 4.5, 35, 290, "tint"), 90, 24, 24),
    pivot(dot(13.1, 8.44, 4.5), 90, 24, 24),
    split(24, 25.5, 21, 18),
  ],
  // A way out that turns and leads back; lit, the end of the way back swings up onto the
  // removed path, as committed work comes back.
  "clean-abandoned-environments": [
    bar(3, 6, 24, 9, "tint"),
    band(27, 24, 13.5, 9, 0, 180),
    bar(10, 33, 17, 9),
    pivot(dot(10, 37.5, 6.5), 77, 27, 24),
  ],
  // A plain cross on a steady disc; lit, its two arms swing into a tick.
  "agent-manage-the-installation-lifecycle": [
    dot(24, 24, 21, "tint"),
    shift(pivot(bar(19.5, 10, 9, 28), 35, 24, 24), 6, -2),
    shift(pivot(bar(10, 19.5, 28, 9), 50, 24, 24), -11, -1),
  ],
  // A switch that flips either way: the knob crosses over and covers its dashed seat.
  "switch-providers": [
    frame(3, 7, 42, 34, 17),
    dashed(ring(20, 24, 9)),
    shift(dot(30, 24, 12), -10, 0),
  ],
  // Three different shapes standing on one baseline. Lit, the diamond turns
  // 45 degrees about its center and drops 2.2 to stand square on the line
  // with the others.
  "practice-across-stacks": [
    bar(3, 38.5, 42, 6),
    dot(10, 28, 7),
    bar(19, 7, 11, 28, "tint"),
    shift(
      pivot(bar(32.2, 22.2, 10.6, 10.6, "solid", 45), 45, 37.5, 27.5),
      0,
      2.2,
    ),
  ],
  // Two parts cut to fit each other. Lit, the solid part slides 6 into the
  // tinted one's notch.
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
        [20.5, 29.5],
        [20.5, 18.5],
        [29.5, 18.5],
      ]),
      -6,
      0,
    ),
  ],
  // A calendar with one day chosen. The chosen day covers a tinted day like
  // the rest; lit, it hops over to the next day along, turning half a circle
  // about the point between the two.
  "planned-upgrades": [
    bar(3, 3, 42, 8),
    bar(3, 16, 11.5, 12.5, "tint"),
    bar(18.25, 16, 11.5, 12.5, "tint"),
    bar(33.5, 16, 11.5, 12.5, "tint"),
    bar(3, 32.5, 11.5, 12.5, "tint"),
    bar(18.25, 32.5, 11.5, 12.5, "tint"),
    bar(33.5, 32.5, 11.5, 12.5, "tint"),
    pivot(bar(18.25, 32.5, 11.5, 12.5), 180, 31.625, 38.75),
  ],
  // The discern mark lifting away, hollow; the stack beneath it stays.
  "retain-work-after-uninstall": [
    bar(3, 37, 42, 8),
    bar(3, 26, 42, 8),
    shift(poly([[13, 21], [35, 21], [24, 4]], "outline"), 9, -3),
  ],
  // Two agents overlapping on one task. Lit, the task slides 8.5 out of the
  // overlap to the center of the second agent.
  "agent-switch-supported-agent-hosts": [
    dot(18, 18, 15, "tint"),
    ring(30, 30, 15),
    shift(dot(24, 24, 5), 6, 6),
  ],
  // A whole shell with nothing fitted inside it. Lit, its two halves turn apart
  // at the top, and the shell stands open on the empty place.
  "local-without-another-model": [
    pivot(band(24, 24, 17.5, 7, 180, 180), -45, 24, 24),
    pivot(band(24, 24, 17.5, 7, 0, 180), 45, 24, 24),
    dashed(ring(24, 24, 7)),
  ],
  // Two lines, and the one thing that travels between them, sliding along its lane.
  "explicit-write-authority": [
    bar(-2, 14.5, 38, 5, "solid", -45),
    bar(12, 28.5, 38, 5, "solid", -45),
    shift(dot(24, 24, 5.5), 7, -7),
  ],
  // A signal that fades and stops at the wall; its waves push out and the wall swallows the outer one.
  "agent-diagnose-workflow-friction-locally": [
    dot(9, 24, 6),
    shift(band(9, 24, 15, 4, 50, 80), 6, 0),
    shift(band(9, 24, 25, 4, 58, 64, "tint"), 6, 0),
    bar(38.5, 3, 6.5, 42),
  ],
};

/** The drawing for a glyph name: the authored one, or a seeded one for an unknown name. */
export function glyphDrawing(name: string): GlyphDrawing {
  const authored = Object.hasOwn(GLYPHS, name) ? GLYPHS[name] : undefined;
  return authored ?? seededGlyph(name);
}
