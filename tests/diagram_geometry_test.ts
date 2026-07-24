/**
 * The misaligned-diagram class, cured as a class: agents edit fenced
 * box-drawing diagrams as prose, and no formatter owns fence bodies (`deno
 * fmt` skips them; `discern tidy` keeps them byte-for-byte) — so ragged
 * borders and drifted columns accumulated with nothing to stop them.
 *
 * The predicate (tests/diagram_geometry.ts): inside any fenced block with
 * box-drawing structure, every drawing glyph's vertical claims must be
 * reciprocated and every arrowhead must sit on its shaft. The universe is
 * every tracked Markdown file (tests/repo_authored_paths.ts) — map, ADRs,
 * private notes, README, and the shipped `templates/` surface alike — so a
 * new page, tree, or template enrols the moment it is tracked.
 *
 * Bite proofs first (a guard is trusted only once it has failed on a bad
 * fixture), tolerance proofs for the legal idioms the corpus actually uses,
 * one adversarial future sibling in unrelated vocabulary and a different
 * glyph family, then the live sweep the gate runs.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type DiagramViolation,
  scanMarkdownDiagrams,
} from "./diagram_geometry.ts";
import { REPO_ROOT, TRACKED_MD_FILES } from "./repo_authored_paths.ts";

function fenced(...lines: string[]): string {
  return ["```", ...lines, "```", ""].join("\n");
}

function at(violations: DiagramViolation[]): string[] {
  return violations.map((v) => `${v.line}:${v.column} ${v.glyph}`);
}

// ── bite proofs ───────────────────────────────────────────────────────────────

Deno.test("a ragged box border is a violation (the guard bites)", () => {
  const found = scanMarkdownDiagrams(fenced(
    "┌────────┐",
    "│ too wide  │",
    "└────────┘",
  ));
  // The stray border floats both above and below — one violation per side.
  assertEquals(at(found), ["3:13 │", "3:13 │"]);
  assert(
    found.every((v) => v.reason.includes("edge of the block")),
    "names the floating side",
  );
});

Deno.test("a drifted interior divider is a violation on both rows", () => {
  const found = scanMarkdownDiagrams(fenced(
    "┌────┬────┐",
    "│   │     │",
    "└────┴────┘",
  ));
  assertEquals(at(found), ["2:6 ┬", "3:5 │", "3:5 │", "4:6 ┴"]);
});

Deno.test("a junction whose hanger drifted is a violation", () => {
  const found = scanMarkdownDiagrams(fenced(
    "┌───────┐",
    "│  box  │",
    "└───┬───┘",
    "  │",
    "  ▼",
  ));
  // The ┬ hangs into space and the drifted │ floats under a plain dash.
  assertEquals(at(found), ["4:5 ┬", "5:3 │"]);
});

Deno.test("a floating arrowhead is a violation", () => {
  const found = scanMarkdownDiagrams(fenced(
    "┌───┐",
    "│ x │",
    "└───┘",
    "  ▼",
  ));
  assertEquals(at(found), ["5:3 ▼"]);
  assert(found[0]?.reason.includes("shaft"), "names the missing shaft");
});

Deno.test("a tab inside a diagram block is a violation", () => {
  const found = scanMarkdownDiagrams(fenced(
    "┌──┐",
    "│\tx │",
    "└──┘",
  ));
  assert(
    found.some((v) => v.reason.includes("tab")),
    "tabs break column alignment and must be flagged",
  );
});

Deno.test("adversarial future sibling: unrelated names and another glyph family still bite", () => {
  // Nothing here shares vocabulary or glyph weight with any current diagram:
  // a double-line box with a ragged border, and a rounded box one column
  // short. The tables must reject both without being taught these names.
  const doubled = scanMarkdownDiagrams(fenced(
    "╔══════════════╗",
    "║ FLUXCAPACITOR  ║",
    "╚══════════════╝",
  ));
  assertEquals(at(doubled), ["2:16 ╗", "3:18 ║", "3:18 ║", "4:16 ╝"]);
  const rounded = scanMarkdownDiagrams(fenced(
    "╭─ ORBIT ──╮",
    "│ payload  │",
    "╰─────────╯",
  ));
  assertEquals(at(rounded), ["3:12 │", "4:11 ╯"]);
});

// ── tolerance proofs: the corpus's legal idioms stay legal ────────────────────

Deno.test("an aligned pipeline of boxes with arrow shafts is clean", () => {
  assertEquals(
    scanMarkdownDiagrams(fenced(
      "┌─────────────┐      ┌─────────────┐      ┌─────────────┐",
      "│   <input>   │ ───► │  <core>     │ ───► │  <output>   │",
      "└─────────────┘      └─────────────┘      └─────────────┘",
    )),
    [],
  );
});

Deno.test("titles embedded in borders and nested boxes are clean", () => {
  assertEquals(
    scanMarkdownDiagrams(fenced(
      "┌─ OUTER (labelled) ───────────┐",
      "│  prose, with → arrows in it  │",
      "│  ┌─ INNER ────────────────┐  │",
      "│  │  nested content        │  │",
      "│  └────────────────────────┘  │",
      "└──────────────────────────────┘",
    )),
    [],
  );
});

Deno.test("tree diagrams anchor to label text and are clean", () => {
  assertEquals(
    scanMarkdownDiagrams(fenced(
      "the-directory/",
      "├── one-file",
      "│   └── nested",
      "└── another",
    )),
    [],
  );
});

Deno.test("lines hung from labels, embedded shaft labels, and decorations are clean", () => {
  assertEquals(
    scanMarkdownDiagrams(fenced(
      "a person / an agent",
      "       │  runs <verb> ⟲ again ∥ concurrently",
      "       ▼",
      "┌──────────────┐",
      "│  the engine  │ ◄──shaft label── source",
      "└──────┬───────┘",
      "       ▲",
      "       └── returns",
    )),
    [],
  );
});

Deno.test("a fence without box structure is not a diagram and is skipped", () => {
  assertEquals(
    scanMarkdownDiagrams(fenced(
      "── build │ warning: something",
      "── test  │ 12 passed",
      "trunk ───► fix ───► done",
    )),
    [],
  );
});

Deno.test("box-drawing characters outside fences are ignored", () => {
  assertEquals(
    scanMarkdownDiagrams([
      "Prose may quote └── tree lines or a │ separator freely:",
      "├──.mcp.json — rendered proportionally, geometry means nothing.",
      "",
    ].join("\n")),
    [],
  );
});

// ── the live sweep the gate runs ──────────────────────────────────────────────

Deno.test("the tracked-Markdown universe covers the shipped surface", () => {
  assert(
    TRACKED_MD_FILES.some((rel) => rel.startsWith("templates/")),
    "templates/ ships to every project — if it left the universe, seed " +
      "diagrams would go unguarded",
  );
});

Deno.test("every fenced box-drawing diagram in tracked Markdown is geometrically sound", async () => {
  const failures: string[] = [];
  for (const rel of TRACKED_MD_FILES) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const v of scanMarkdownDiagrams(text)) {
      failures.push(`${rel}:${v.line}:${v.column} "${v.glyph}" ${v.reason}`);
    }
  }
  assertEquals(
    failures,
    [],
    "misaligned box-drawing diagram(s). Realign the fence: pad every " +
      "interior row to the border width, and keep verticals, junctions, " +
      "and arrowheads in the same code-point column as the glyph they " +
      "join. (Scanner: tests/diagram_geometry.ts)",
  );
});
