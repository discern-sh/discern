/**
 * Multi-line product text never reaches a single-line sanitizer in the Desk.
 * The single-line sanitizer shows a line break as a visible control picture,
 * so evidence such as a commit list or Git's stderr would collapse into one
 * paragraph of "␊" marks. The Desk's text module is the only importer of the
 * terminal sanitizers: single-line slots join lines with spaces, and reading
 * regions keep each line on its own row.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project } from "ts-morph";
import {
  renderTerminalApplication,
  updateTerminalApplication,
} from "discern-design-system/cli/interactive";
import { FakeTerminalIO } from "discern-design-system/cli/interactive/testing";
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { statusData, taskFleetEntry } from "./fixtures/status_fleet.ts";
import { deskLine, deskLiteral } from "../src/engine/desk/text.ts";
import { buildDeskRows } from "../src/engine/desk/model.ts";
import {
  deskApplicationView,
  type DeskPage,
} from "../src/engine/desk/application_view.ts";

const TEXT_MODULE = "src/engine/desk/text.ts";
const CONTROL_PICTURE = /[\u2400-\u2421]/u;

/** Every import or call of a terminal sanitizer in one module. */
function sanitizerImports(source: string): string[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile("candidate.ts", source);
  const sanitizer = /^terminal(?:Line|Multiline)$/u;
  const imported: string[] = file.getImportDeclarations().flatMap((
    declaration,
  ) =>
    /\/lib\/terminal\.ts$/u.test(declaration.getModuleSpecifierValue())
      ? declaration.getNamedImports().map((item) => item.getName())
        .filter((name) => sanitizer.test(name))
      : []
  );
  const called: string[] = file.getDescendants().flatMap((node) =>
    Node.isCallExpression(node) &&
      sanitizer.test(node.getExpression().getText())
      ? [node.getExpression().getText()]
      : []
  );
  return [...imported, ...called];
}

/** One rendered page of the Desk, as a terminal would show it. */
function rendered(
  view: ReturnType<typeof deskApplicationView>,
  columns = 100,
): string {
  const io = new FakeTerminalIO([], { columns, rows: 40 });
  return renderTerminalApplication(
    updateTerminalApplication(view),
    io.size(),
    io.capabilities(),
  ).frame;
}

Deno.test("Desk text guard", async () => {
  const files = await structuralGuardScope({
    guard: "tests/engine_desk_text_guard_test.ts#desk-text-sanitizers",
    universe: "authored-ts",
    narrow: {
      reason:
        "The Desk subtree composes product text into package slots; other commands keep their own presenters.",
      include: (path) => path.startsWith("src/engine/desk/"),
    },
  });
  await assertNamedCasesAsync({
    "only the Desk's text module reaches the terminal sanitizers": async () => {
      assert(files.includes(TEXT_MODULE));
      const findings: string[] = [];
      for (const file of files) {
        if (file === TEXT_MODULE) continue;
        const source = await Deno.readTextFile(join(REPO_ROOT, file));
        findings.push(
          ...sanitizerImports(source).map((name) => `${file}: ${name}`),
        );
      }
      assertEquals(findings, []);
      assertEquals(
        sanitizerImports(
          'import { terminalLine as line } from "../../lib/terminal.ts"; terminalMultiline(x);',
        ),
        ["terminalLine", "terminalMultiline"],
      );
    },
    "a single-line slot joins lines; a reading keeps each line": () => {
      assertEquals(
        deskLine("abc1234 First commit\r\ndef5678 Second commit"),
        "abc1234 First commit def5678 Second commit",
      );
      assert(!CONTROL_PICTURE.test(deskLine("a\nb\u2028c")));
      const io = new FakeTerminalIO([], { columns: 60, rows: 12 });
      const frame = renderTerminalApplication(
        updateTerminalApplication({
          title: "Evidence",
          regions: [{
            kind: "reading",
            id: "evidence",
            title: "Commits",
            content: createCliBlock(renderMarkdownCli, {
              source: deskLiteral(
                "abc1234 First commit\n- def5678 # Second *commit*\n1. ghi9012",
              ),
            }),
          }],
        }),
        io.size(),
        io.capabilities(),
      ).frame;
      assert(!CONTROL_PICTURE.test(frame), frame);
      for (
        const line of [
          "abc1234 First commit",
          "- def5678 # Second *commit*",
          "1. ghi9012",
        ]
      ) {
        assert(
          frame.split("\n").some((row) => row.includes(line)),
          `${line} keeps its own row:\n${frame}`,
        );
      }
    },
    "no Desk page shows a control picture for multi-line observations": () => {
      const multiline = "first line\nsecond line";
      const data = statusData([
        taskFleetEntry("alpha", {
          ahead: 1,
          task: {
            id: "alpha",
            branch: "agent/alpha",
            title: "Alpha",
            title_source: "recorded",
            brief: multiline,
          },
          gate_proof: { status: "unavailable", reason: multiline },
          read_failure: undefined,
        }),
      ], {
        queue: [{
          effort: "alpha",
          branch: "agent/alpha",
          path: "/worktrees/alpha",
          head: "abc1234",
          submitted_at: "2026-01-01T00:00:00.000Z",
          authority: "awaiting-owner",
          position: 1,
          readiness: "waiting",
          reason: multiline,
        }],
      });
      const rows = buildDeskRows(data.fleet ?? [], new Map(), new Map(), {
        trunk: "main",
        nowMs: 0,
      });
      const pages: readonly DeskPage[] = [
        "overview",
        "task",
        "more",
        "details",
        "help",
        "tip",
        "queue",
        "notice",
      ];
      for (const page of pages) {
        const frame = rendered(deskApplicationView(
          {
            data,
            rows,
            phase: "fresh",
            message: multiline,
            notice: multiline,
            tip: multiline,
          },
          page,
          "alpha",
        ));
        assert(!CONTROL_PICTURE.test(frame), `${page}:\n${frame}`);
      }
    },
  });
});
