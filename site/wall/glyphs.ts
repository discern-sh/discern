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
  lands,
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
  // One big card, the goal, above three empty places for briefs. Lit, three
  // small cards slide out from under the goal and seat in those places.
  "shape-substantial-work": [
    bar(6, 29.5, 10, 8, "tint"),
    bar(19, 29.5, 10, 8, "tint"),
    bar(32, 29.5, 10, 8, "tint"),
    lands(shift(bar(6, 17.6, 10, 8), 0, 11.9)),
    lands(shift(bar(19, 17.6, 10, 8), 0, 11.9)),
    lands(shift(bar(32, 17.6, 10, 8), 0, 11.9)),
    bar(4, 10, 40, 16),
  ],
  // Three identical project folders side by side, an agent above each.
  // Lit, every agent and its folder close together at once, each agent
  // seated inside its own copy.
  "parallel-work-on-one-machine": [
    lands(
      shift(
        poly(
          [[3, 25], [8, 25], [9.5, 28], [15, 28], [15, 45], [3, 45]],
          "tint",
        ),
        0,
        -11,
      ),
    ),
    lands(
      shift(
        poly(
          [[18, 25], [23, 25], [24.5, 28], [30, 28], [30, 45], [18, 45]],
          "tint",
        ),
        0,
        -11,
      ),
    ),
    lands(
      shift(
        poly(
          [[33, 25], [38, 25], [39.5, 28], [45, 28], [45, 45], [33, 45]],
          "tint",
        ),
        0,
        -11,
      ),
    ),
    lands(shift(dot(9, 14.5, 3.5), 0, 11)),
    lands(shift(dot(24, 14.5, 3.5), 0, 11)),
    lands(shift(dot(39, 14.5, 3.5), 0, 11)),
  ],
  // A bend where one lane feeds the next: another's work sits up its lane, and
  // a play mark waits past the empty corner. Lit, the work lands in the corner
  // and the play mark carries on along its own lane.
  "wait-without-relay": [
    poly([[4, 4], [18, 4], [18, 29], [44, 29], [44, 43], [4, 43]], "tint"),
    lands(shift(bar(5.5, 18.5, 11, 11), 0, 12)),
    shift(poly([[21.5, 30], [32, 36], [21.5, 42]]), 10, 0),
  ],
  // A pending block, tinted and marked with a dashed inner edge, stands clear of
  // a solid base, with a new block held high above it. Lit, the new block comes
  // down and seats flush on the pending block.
  "compose-staged-work": [
    bar(6, 40, 36, 5),
    bar(10, 20, 28, 16, "tint"),
    dashed(frame(13, 23, 22, 10, 2.5)),
    lands(shift(bar(10, 3, 28, 9), 0, 8)),
  ],
  // A branch from below has already merged into the main line; a second branch
  // waits apart, aimed at the same joint. Lit, it slides in and merges too.
  "land-finished-work-as-the-project-moves": [
    lands(shift(band(-271.30, 294.30, 400, 7, 43.987, 2.026), 7.5, 7.5)),
    band(301.80, 311.80, 400, 7, 313.987, 2.026),
    band(31.00, 423.94, 400, 7, 358.997, 2.005),
  ],
  // A line of work stops at a pause mark, with the rest of it still to do.
  // Lit, both pause bars tip forward together and lie down in the line, so
  // the work runs on from where it stopped toward what remains.
  "resume-later": [
    bar(3, 20, 5, 8),
    lands(pivot(bar(12.5, 17.5, 8, 13), 90, 16.5, 24)),
    lands(pivot(bar(27.5, 17.5, 8, 13), 90, 31.5, 24)),
    bar(40, 20, 5, 8, "tint"),
  ],
  // A finished run, and a short way over it to the result at its end. Lit,
  // the agent hops over the run and lands on the result.
  "agent-resume-after-interruption": [
    dashed(arc(24, 31, 16, 302, 116)),
    bar(16, 26, 16, 10),
    dot(8, 31, 5, "tint"),
    dot(40, 31, 5, "tint"),
    lands(pivot(dot(8, 31, 5), 180, 24, 31)),
  ],
  // Four marks frame the one thing worth a look; lit, they close in on it.
  "reduce-routine-review": [
    shift(bracket(3, 3, 16, 16, 5.5), 0, 7),
    shift(bracket(45, 3, -16, 16, 5.5), 0, 7),
    shift(bracket(3, 45, 16, -16, 5.5), 0, -7),
    shift(bracket(45, 45, -16, -16, 5.5), 0, -7),
    bar(12, 19, 24, 10),
  ],
  // A standing question, pinned above where changes pass. Lit, a change rises
  // to meet its pointer.
  "judgment-at-the-change": [
    frame(7, 5, 34, 20, 9),
    poly([[12, 24], [21, 24], [13, 31]]),
    bar(19.5, 10.5, 9, 9, "solid", 45),
    bar(5.5, 39.5, 37, 5, "tint"),
    lands(shift(bar(5, 39, 38, 6), 0, -8)),
  ],
  // One screen listing every task, the one waiting on you lit. While lit,
  // that task rises to the top of the list and seats in the first row.
  "decisions-in-one-view": [
    frame(4, 4, 40, 40, 6),
    dot(14, 13, 4, "tint"),
    bar(21, 9, 17, 8, "tint"),
    dot(14, 24, 4, "tint"),
    bar(21, 20, 17, 8, "tint"),
    dot(14, 35, 4, "tint"),
    bar(21, 31, 17, 8, "tint"),
    lands(shift(dot(14, 24, 4), 0, -11)),
    lands(shift(bar(21, 20, 17, 8), 0, -11)),
  ],
  // A solid block split across by a jagged crack. Lit, the halves part and
  // the break gives up two lines of output, stacked in the gap.
  "useful-failures-sooner": [
    shift(bar(11, 12.75, 26, 3.75, "tint"), 0, 5.5),
    shift(bar(11, 30, 17, 3.75, "tint"), 0, -5.5),
    shift(
      poly([
        [6, 10.5],
        [42, 10.5],
        [42, 21.2],
        [34, 22.65],
        [22.95, 19.5],
        [19.95, 24],
        [6, 19.9],
      ]),
      0,
      -7.5,
    ),
    shift(
      poly([
        [6, 22.6],
        [21.05, 27],
        [24.05, 22.5],
        [33.95, 25.35],
        [42, 23.8],
        [42, 37.5],
        [6, 37.5],
      ]),
      0,
      7.5,
    ),
  ],
  // A changed file, its link, and the missing companion left out of line
  // below it. Lit, the companion rises into line beside the file it goes with.
  "catch-related-files": [
    bar(4, 11, 15, 26),
    line(20, 24, 27, 24),
    lands(shift(dashed(frame(28.5, 18, 15.5, 26, 4.5)), 0, -7)),
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
  // A long output: its first and last lines solid, a cut through the middle.
  // Lit, the first and last lines close in to the cut, leaving start and end.
  "context-for-the-task": [
    bar(8.25, 12.25, 25.5, 5.5, "tint"),
    dashed(line(10, 24, 38, 24)),
    bar(8.25, 30.25, 19.5, 5.5, "tint"),
    lands(shift(bar(8, 3, 32, 6), 0, 9)),
    lands(shift(bar(8, 39, 24, 6), 0, -9)),
  ],
  // A ring of four checks: one solid quarter done, three short tinted marks
  // still waiting. Lit, three solid quarters turn out from under the first,
  // cover the marks, and close into one unbroken ring.
  "project-defined-completion": [
    band(24, 24, 16.5, 7.5, 37, 16, "tint"),
    band(24, 24, 16.5, 7.5, 127, 16, "tint"),
    band(24, 24, 16.5, 7.5, 217, 16, "tint"),
    lands(pivot(band(24, 24, 16.5, 8, 271, 88), -90, 24, 24)),
    lands(pivot(band(24, 24, 16.5, 8, 271, 88), 90, 24, 24)),
    lands(pivot(band(24, 24, 16.5, 8, 271, 88), 180, 24, 24)),
    band(24, 24, 16.5, 8.5, 271, 88),
  ],
  // A seal on the corner of a written sheet. Lit, it comes to rest on the
  // sheet's blank lower corner, under the lines it vouches for.
  "evidence-for-this-change": [
    bar(3, 3, 37, 37, "tint"),
    bar(8, 8, 22, 4),
    bar(8, 15, 11, 4),
    lands(shift(ring(35.5, 35.5, 8.5), -8, -8)),
    lands(shift(dot(35.5, 35.5, 5), -8, -8)),
  ],
  // A line of history with an older commit carrying its note, and a lens at the
  // newest end. Lit, the lens sweeps back along the history onto the noted commit.
  "evidence-that-lasts": [
    bar(3, 26.25, 38, 3.5, "tint"),
    dot(6.5, 28, 3),
    poly([[14, 3], [22, 3], [27, 8], [27, 15], [14, 15]]),
    dot(21, 28, 3.5),
    lands(pivot(ring(36, 28, 7.5), -58.4, 28.5, 41.4)),
    lands(
      pivot(bar(26.56, 36.56, 7.5, 3.2, "solid", 119.2), -58.4, 28.5, 41.4),
    ),
  ],
  // A lab flask with liquid in its base. Lit, two bubbles rise out of the
  // liquid into the flask: the experiment is running.
  "explicit-release-decision": [
    poly([[18, 4], [30, 4], [30, 13], [43, 43], [5, 43], [18, 13]], "outline"),
    shift(dot(19.5, 35.5, 3), 0, -10),
    shift(dot(28, 35, 2.5), 0, -12),
    poly([[14.2, 31.5], [33.8, 31.5], [37.3, 39.5], [10.7, 39.5]]),
  ],
  // Three changes before a wall that leaves one lane open to the main line.
  // Lit, the change in the open lane runs through and docks; the others wait.
  "bounded-standing-permission": [
    bar(37, 3, 6, 42),
    bar(27, 3, 5, 13, "tint"),
    bar(27, 32, 5, 13, "tint"),
    dot(15, 10, 6, "tint"),
    dot(15, 38, 6, "tint"),
    lands(shift(dot(19, 24, 6), 12, 0)),
  ],
  // A walled-off room beside the main line, where the top block of a stack has
  // tipped over against the wall between them. Lit, it settles back onto the
  // stack inside its room, and main never moves.
  "unfinished-work-stays-isolated": [
    frame(4, 7, 29, 34, 4),
    bar(10.5, 25.5, 16, 9),
    lands(pivot(bar(15.266, 12.942, 16, 9, "solid", 35), -35, 21.768, 25.278)),
    bar(37, 3, 8, 42),
  ],
  // The project, and a dashed outline of the change planned beside it. Lit, a
  // tinted copy swings out from behind the project into the outline: the change
  // shown in place, with the project itself untouched.
  "recover-interrupted-operations": [
    lands(pivot(bar(5, 26, 17, 17, "tint"), 90, 34.5, 34.5)),
    bar(4, 25, 19, 19),
    dashed(frame(25, 4, 19, 19, 4)),
  ],
  // One disc, half solid and half outlined. Lit, the halves part evenly and
  // show the rule that stands between them.
  "agent-carry-judgment-as-judgment": [
    line(24, 11, 24, 37),
    shift(sector(24, 24, 15.5, 180, 180), -5, 0),
    shift(sector(24, 24, 14.625, 0, 180, "outline"), 5, 0),
  ],
  // A gauge with its level standing at twelve o'clock, half way along the
  // track. Lit, the level runs a quarter turn further and holds the gain; the
  // gain lies under the level at rest, a hair slimmer so it stays hidden.
  "retain-measured-gains": [
    band(24, 28, 17.5, 8, 240, 240, "tint"),
    pivot(band(24, 28, 17.5, 7.5, 270, 90), 90, 24, 28),
    band(24, 28, 17.5, 8, 240, 120),
    dot(24, 28, 5),
  ],
  // A crossbar resting on two clamps low on a pair of standing posts. Lit, the
  // clamps slide up their posts carrying the bar, and lock at the higher setting.
  "pin-new-baseline": [
    bar(6, 3, 5, 37, "tint"),
    bar(37, 3, 5, 37, "tint"),
    bar(3, 40, 11, 5, "tint"),
    bar(34, 40, 11, 5, "tint"),
    lands(shift(frame(3.5, 30, 10, 6, 2), 0, -12)),
    lands(shift(frame(34.5, 30, 10, 6, 2), 0, -12)),
    lands(shift(bar(11, 24.5, 26, 5.5), 0, -12)),
  ],
  // A bold limit bar over a wheel of four different measures. Lit, the
  // wheel turns a quarter and a new measure comes up under the same limit.
  "standards-that-scale": [
    bar(10, 4.5, 28, 5),
    lands(pivot(bar(18.75, 10, 10.5, 10.5), 90, 24, 27.5)),
    lands(pivot(dot(36, 27.5, 5.25), 90, 24, 27.5)),
    lands(pivot(ring(24, 39.5, 4.75), 90, 24, 27.5)),
    lands(pivot(dot(12, 27.5, 5.75, "tint"), 90, 24, 27.5)),
    lands(pivot(sector(12, 27.5, 5.75, 270, 120), 90, 24, 27.5)),
  ],
  // A field of identical domes with the same fault in three places: three sit
  // upside down. Lit, all three turn the right way up together.
  "remove-bug-class": [
    sector(9, 14, 6, 270, 180),
    sector(24, 14, 6, 270, 180),
    pivot(sector(39, 8, 6, 90, 180), 180, 39, 11),
    pivot(sector(16.5, 21, 6, 90, 180), 180, 16.5, 24),
    sector(31.5, 27, 6, 270, 180),
    sector(9, 40, 6, 270, 180),
    pivot(sector(24, 34, 6, 90, 180), 180, 24, 37),
    sector(39, 40, 6, 270, 180),
  ],
  // A count of old uses stepping down to zero, four bars rising from one solid
  // floor. Lit, the last bar settles flat into the floor: none are left.
  "retire-old-pattern": [
    bar(4.5, 5, 7.5, 33),
    bar(15, 14, 7.5, 24),
    bar(25.5, 23, 7.5, 15),
    lands(shift(bar(36, 30, 7.5, 8), 0, 6.5)),
    bar(3, 36, 42, 9),
  ],
  // A neat stack with loose pieces strewn around it. Lit, the pieces square up
  // and slide in under the stack until only the stack is left.
  "keep-clutter-down": [
    shift(pivot(bar(4.5, 7, 7, 7, "tint", 25), -25, 8, 10.5), 11.5, 1.5),
    shift(pivot(bar(36.5, 12, 7, 7, "tint", -20), 20, 40, 15.5), -12, 0),
    shift(pivot(bar(4.5, 32, 8, 8, "tint", 40), -40, 8.5, 36), 11.5, -1),
    bar(15, 4, 18, 18),
    bar(15, 26, 18, 18),
  ],
  // A whole link with a dim, broken-open link hanging off its rim, beside an
  // empty corner catch. Lit, the broken link slips off and settles in the catch.
  "catch-documentation-breakage": [
    band(12, 12, 7, 4, 0, 360),
    lands(shift(band(21.9, 21.9, 7, 4, 25, 220, "tint"), 6.6, 6.6)),
    bracket(45, 45, -20, -20, 4.5),
  ],
  // A dot plot of counts on one floor: low, uneven tinted columns and one solid
  // column piled far above them. Lit, one more count rises out of its top dot.
  "improve-practice-from-evidence": [
    dot(6, 42, 3, "tint"),
    dot(6, 33.5, 3, "tint"),
    dot(15, 42, 3, "tint"),
    dot(24, 42, 3),
    dot(24, 33.5, 3),
    dot(24, 25, 3),
    shift(dot(24, 16.5, 3), 0, -8.5),
    dot(24, 16.5, 3),
    dot(33, 42, 3, "tint"),
    dot(42, 42, 3, "tint"),
  ],
  // One source reaching one node, with two more nodes waiting in tint. Lit,
  // copies of its line fan out from under it and reach every node.
  "teach-project-once": [
    bar(8.56, 14.36, 27, 3.8, "tint", -35),
    bar(8.56, 29.84, 27, 3.8, "tint", 35),
    dot(33.12, 8.51, 4.8, "tint"),
    dot(33.12, 39.49, 4.8, "tint"),
    lands(pivot(bar(11, 22.1, 27, 3.8), -35, 11, 24)),
    lands(pivot(dot(38, 24, 4.8), -35, 11, 24)),
    lands(pivot(bar(11, 22.1, 27, 3.8), 35, 11, 24)),
    lands(pivot(dot(38, 24, 4.8), 35, 11, 24)),
    bar(11, 22, 27, 4),
    dot(38, 24, 5),
    bar(4, 17, 14, 14),
  ],
  // A three-panel map, half folded, a place marked on each outer panel. Lit,
  // the map opens flat: both outer panels slide out to meet the middle at its
  // folds.
  "inspect-agent-understanding": [
    lands(shift(poly([[8, 13], [22, 8], [22, 35], [8, 40]], "tint"), -5, 0)),
    lands(shift(dot(12.5, 17, 3), -5, 0)),
    lands(shift(poly([[26, 13], [40, 8], [40, 35], [26, 40]], "tint"), 5, 0)),
    lands(shift(dot(35.5, 31, 3), 5, 0)),
    poly([[17, 5], [31, 10], [31, 43], [17, 38]]),
  ],
  // A decision diamond and a written note of its reasons, set apart; lit, the
  // two slide into one column, the decision heading the note that explains it.
  "preserve-decision-reasons": [
    shift(
      poly([[12.5, 4.5], [21.5, 13.5], [12.5, 22.5], [3.5, 13.5]]),
      10.75,
      0,
    ),
    shift(bar(23, 24.5, 22, 19, "tint"), -10.75, 0),
    shift(bar(28, 29.5, 12, 4), -10.75, 0),
    shift(bar(28, 36, 8, 4), -10.75, 0),
  ],
  // A thick line broken by a gap, its missing span raised upright on the near
  // edge like a drawbridge. Lit, the span swings down into the gap and the line
  // runs whole.
  "instructions-at-failure": [
    bar(3, 19, 12, 11, "tint"),
    bar(33, 19, 12, 11, "tint"),
    lands(pivot(bar(11, 5, 11, 18), 90, 15, 23)),
  ],
  // A compass with its needle off true. Lit, the needle swings round and
  // settles on north.
  "orient-new-session": [
    ring(24, 24, 20),
    pivot(poly([[12.69, 12.69], [28.6, 19.4], [19.4, 28.6]]), 45, 24, 24),
    pivot(
      poly([[35.31, 35.31], [28.6, 19.4], [19.4, 28.6]], "tint"),
      45,
      24,
      24,
    ),
    dot(24, 24, 3),
  ],
  // Three separate pages in a column, the top one dog-eared, each with a line of
  // text. Lit, the outer pages close on the middle one into one tight, evenly
  // spaced stack read in order.
  "export-project-briefing": [
    shift(
      poly([[11, 3], [31.5, 3], [37, 8.5], [37, 11.5], [11, 11.5]], "tint"),
      0,
      5.25,
    ),
    shift(bar(15, 5.25, 12, 4), 0, 5.25),
    poly([[11, 19.75], [37, 19.75], [37, 28.25], [11, 28.25]], "tint"),
    bar(15, 22, 16, 4),
    shift(poly([[11, 36.5], [37, 36.5], [37, 45], [11, 45]], "tint"), 0, -5.25),
    shift(bar(15, 38.75, 10, 4), 0, -5.25),
  ],
  // One solid tag above three tinted copies of it, each set out of step.
  // Lit, the copies slide into line beneath the original.
  "reuse-engineering-discipline": [
    poly([[11.5, 4], [30.5, 4], [36.5, 7.75], [30.5, 11.5], [11.5, 11.5]]),
    shift(
      poly(
        [[4.5, 15.5], [23.5, 15.5], [29.5, 19.25], [23.5, 23], [4.5, 23]],
        "tint",
      ),
      7,
      0,
    ),
    shift(
      poly(
        [[18.5, 26], [37.5, 26], [43.5, 29.75], [37.5, 33.5], [18.5, 33.5]],
        "tint",
      ),
      -7,
      0,
    ),
    shift(
      poly(
        [[4.5, 36.5], [23.5, 36.5], [29.5, 40.25], [23.5, 44], [4.5, 44]],
        "tint",
      ),
      7,
      0,
    ),
  ],
  // A flight of steps with a climber on the bottom step. Lit, it hops over
  // the step's edge and lands on the next one up.
  "agent-invoke-curated-project-procedures": [
    poly(
      [
        [4, 44],
        [4, 35],
        [14, 35],
        [14, 26],
        [24, 26],
        [24, 17],
        [34, 17],
        [34, 8],
        [44, 8],
        [44, 44],
      ],
      "tint",
    ),
    lands(pivot(dot(9, 30.5, 4.5), 180, 14, 26)),
  ],
  // The discern mark poised over a seat made to its size. Lit, it lowers
  // into the seat and stands on its floor.
  "agent-commissioning": [
    poly(
      [[4, 19], [10.5, 19], [10.5, 36], [37.5, 36], [37.5, 19], [44, 19], [
        44,
        43,
      ], [4, 43]],
      "tint",
    ),
    lands(shift(split(24, 16, 23, 24), 0, 8)),
  ],
  // A laptop with an empty screen. Lit, a command prompt rises out of the
  // deck onto its own screen.
  "small-installation-footprint": [
    frame(9, 10, 30, 23, 3),
    shift(line(17.5, 31, 21.5, 34), 0, -12),
    shift(line(21.5, 34, 17.5, 37), 0, -12),
    shift(line(24, 37, 30.5, 37), 0, -12),
    bar(4, 30, 40, 8),
  ],
  // The discern mark inside a loop whose leading dot feeds back into its own
  // start. Lit, the loop and its dot go a quarter turn further round the mark.
  "inspect-live-example": [
    pivot(band(24, 24, 18.75, 4.5, 35, 290, "tint"), 90, 24, 24),
    pivot(dot(13.25, 8.64, 4.5), 90, 24, 24),
    split(24, 25.5, 21, 18),
  ],
  // An open bin with a piece of work inside, beside its empty place. Lit, the
  // work hops back out of the bin into its place.
  "clean-abandoned-environments": [
    poly([[5, 22], [29, 22], [27, 44], [7, 44]], "tint"),
    bar(4.4, 13, 24, 4, "solid", -30),
    dot(39, 34, 6, "tint"),
    lands(pivot(dot(17, 34, 6), 140, 28, 38)),
  ],
  // A health cross on a steady disc. Lit, the cross turns an eighth as one
  // piece while its lower arms draw in and its upright reaches out, and it
  // holds as a tick.
  "agent-manage-the-installation-lifecycle": [
    dot(24, 24, 21, "tint"),
    lands(
      shift(pivot(bar(19.25, 27.4, 9.5, 9.6), 45, 43.85, 41.09), -10.49, 4.54),
    ),
    lands(
      shift(pivot(bar(27.4, 19.25, 9.6, 9.5), 45, 11.34, -7.52), 10.64, -4.21),
    ),
    lands(
      shift(pivot(bar(19.25, 15.75, 9.5, 12), 45, 32.26, 38.79), -8.72, 0.27),
    ),
    lands(
      shift(pivot(bar(19.25, 11.25, 9.5, 9.25), 45, 32.26, 38.79), -8.72, 0.27),
    ),
    lands(
      shift(pivot(bar(19.25, 15, 9.5, 13.75), 45, 3.29, 33.04), -4.3, -10.4),
    ),
    lands(
      shift(pivot(bar(15, 19.25, 13.75, 9.5), 45, 3.29, 33.04), -4.3, -10.4),
    ),
    lands(shift(pivot(bar(19.25, 11, 9.5, 9.6), 45, 3.29, 33.04), -4.3, -10.4)),
    lands(shift(pivot(bar(11, 19.25, 9.6, 9.5), 45, 3.29, 33.04), -4.3, -10.4)),
  ],
  // A toggle switch with its knob at one end of the housing. Lit, the knob
  // flips across to the other end.
  "switch-providers": [
    frame(4, 10, 40, 28, 14),
    shift(dot(18, 24, 10), 12, 0),
  ],
  // Three different shapes standing on one baseline, the last balanced on a
  // corner. Lit, it turns and settles square on the line with the others.
  "practice-across-stacks": [
    bar(3, 38.5, 42, 6),
    dot(9, 29, 6),
    bar(18, 7, 10.5, 28, "tint"),
    lands(
      shift(
        pivot(bar(32.2, 22.2, 10.6, 10.6, "solid", 45), 45, 37.5, 27.5),
        0.5,
        2.2,
      ),
    ),
  ],
  // Two parts cut to fit each other. Lit, the solid part slides its tab into
  // the tinted part's notch and docks flush, closing one block.
  "build-on-published-contracts": [
    poly(
      [[11, 6], [24, 6], [24, 17], [19, 17], [19, 31], [24, 31], [24, 42], [
        11,
        42,
      ]],
      "tint",
    ),
    lands(shift(
      poly([
        [32, 6],
        [45, 6],
        [45, 42],
        [32, 42],
        [32, 31],
        [27, 31],
        [27, 17],
        [32, 17],
      ]),
      -8,
      0,
    )),
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
  // The discern mark, tinted and outlined, seated on a stack of solid work.
  // Lit, it lifts straight off, and the stack stays where it was.
  "retain-work-after-uninstall": [
    bar(3, 35, 42, 6),
    bar(3, 26, 42, 6),
    shift(poly([[11, 24], [37, 24], [24, 9]], "tint"), 0, -6),
    shift(poly([[11, 24], [37, 24], [24, 9]], "outline"), 0, -6),
  ],
  // Two agents, the first holding the task at its centre and the second empty.
  // Lit, the task arcs over and seats at the centre of the second agent.
  "agent-switch-supported-agent-hosts": [
    dot(14, 14, 11, "tint"),
    ring(33, 33, 11),
    lands(pivot(dot(14, 14, 5), 180, 23.5, 23.5)),
  ],
  // A faint key with a strike line broken open around it. Lit, the two halves
  // of the strike slide together across the key, and it stands struck out.
  "local-without-another-model": [
    band(14.45, 33.55, 5, 4, 0, 360, "tint"),
    bar(16.26, 18.99, 21.5, 4, "tint", -45),
    bar(31.69, 18.67, 3, 5, "tint", -45),
    bar(35.58, 14.99, 3, 6, "tint", -45),
    lands(shift(bar(4.59, 11.34, 18.5, 5, "solid", 45), 4.5, 4.5)),
    lands(shift(bar(24.91, 31.66, 18.5, 5, "solid", 45), -4.5, -4.5)),
  ],
  // A diagonal lane between two rails, with a dot at its near end and a marked
  // place at its middle. Lit, the dot runs along its lane and settles on that place.
  "explicit-write-authority": [
    bar(-1.01, 15.74, 38, 4.5, "solid", -45),
    bar(11.01, 27.76, 38, 4.5, "solid", -45),
    dot(24, 24, 4.5, "tint"),
    lands(shift(dot(15.52, 32.48, 4.5), 8.48, -8.48)),
  ],
  // A broadcast source and its two waves face a tall wall. Lit, the signal
  // pushes out to the wall and stops there, evenly spaced: nothing gets past.
  "agent-diagnose-workflow-friction-locally": [
    lands(shift(dot(8, 24, 5), 7.5, 0)),
    lands(shift(band(8, 24, 10.5, 4, 50, 80), 7.5, 0)),
    lands(shift(band(8, 24, 18, 4, 52, 76, "tint"), 7.5, 0)),
    bar(39, 3, 6, 42),
  ],
};

/** The drawing for a glyph name: the authored one, or a seeded one for an unknown name. */
export function glyphDrawing(name: string): GlyphDrawing {
  const authored = Object.hasOwn(GLYPHS, name) ? GLYPHS[name] : undefined;
  return authored ?? seededGlyph(name);
}
