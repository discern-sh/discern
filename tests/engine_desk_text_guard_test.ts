/**
 * Multi-line product text never reaches a single-line sanitizer in the Desk.
 * The single-line sanitizer shows a line break as a visible control picture,
 * so evidence such as a commit list or Git's stderr would collapse into one
 * paragraph of "␊" marks. The Desk's text module is the only importer of the
 * terminal sanitizers: single-line slots join lines with spaces, and reading
 * regions keep each line on its own row.
 */

import { assert, assertEquals } from "@std/assert";
import { Node, Project } from "ts-morph";
import {
  createTerminalApplicationModel,
  renderTerminalApplication,
  type TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import { FakeTerminalIO } from "discern-design-system/cli/interactive/testing";
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { scanDeskModules } from "./desk_module_scan.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import { readyReview } from "./fixtures/desk_product.ts";
import { deskLine, deskLiteral } from "../src/engine/desk/text.ts";
import {
  type DeskIntent,
  type DeskLayer,
  deskProduct,
  type DeskProductState,
} from "../src/engine/desk/desk_state.ts";
import { open } from "../src/engine/desk/desk_transitions.ts";
import { deskKeymap, deskView } from "../src/engine/desk/inbox_view.ts";
import {
  observedDesk,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
} from "./fixtures/desk_product.ts";

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

/** One view, as a terminal would show it. */
function rendered<A>(
  view: TerminalApplicationView<A>,
  keymap: Parameters<typeof createTerminalApplicationModel<A>>[1] = {},
  columns = 100,
): string {
  const io = new FakeTerminalIO([], { columns, rows: 40 });
  return renderTerminalApplication(
    createTerminalApplicationModel(view, keymap).model,
    io.size(),
    io.capabilities(),
  ).frame;
}

Deno.test("Desk text guard", async () => {
  const { files, findings } = await scanDeskModules({
    owner: TEXT_MODULE,
    scan: sanitizerImports,
  });
  await assertNamedCasesAsync({
    "only the Desk's text module reaches the terminal sanitizers": () => {
      assert(files.includes(TEXT_MODULE));
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
      const frame = rendered(
        {
          header: { leading: [{ text: "Evidence" }] },
          body: {
            kind: "reading",
            id: "evidence",
            content: createCliBlock(renderMarkdownCli, {
              source: deskLiteral(
                "abc1234 First commit\n- def5678 # Second *commit*\n1. ghi9012",
              ),
            }),
          },
          footer: { left: [] },
        },
        {},
        60,
      );
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
    "no Desk view shows a control picture for multi-line observations": () => {
      const multiline = "first line\nsecond line";
      const data = productSurvey([
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
      const listed: DeskProductState = deskProduct(
        deskProduct(observedDesk(data), { kind: "tip", tip: multiline }).state,
        {
          kind: "returned",
          now: PRODUCT_VIEW_ENV.now,
          outcome: {
            command: "discern done",
            ok: false,
            message: { tone: "danger", text: multiline },
          },
        },
      ).state;
      const step = {
        kind: "action" as const,
        action: "park" as const,
        taskId: "alpha",
        stage: "review" as const,
      };
      const layers: readonly DeskLayer[] = [
        { kind: "actions", rowId: "alpha" },
        { kind: "palette" },
        { kind: "reader", reader: { kind: "keys" } },
        { kind: "reader", reader: { kind: "tip" } },
        { kind: "reader", reader: { kind: "landing" } },
        { kind: "reader", reader: { kind: "main" } },
        { kind: "reader", reader: { kind: "activity" } },
        { kind: "reader", reader: { kind: "recovery", taskId: "alpha" } },
        {
          kind: "reader",
          reader: { kind: "notice", title: "Notice", lines: [multiline] },
        },
        {
          kind: "result",
          sheet: {
            title: "It didn't complete",
            lines: [{
              mark: "failure",
              text: multiline,
              detail: [multiline],
              source: { kind: "result", field: "message" },
            }],
            output: multiline,
            command: multiline,
          },
        },
        {
          kind: "review",
          step,
          load: {
            state: "ready",
            value: readyReview("Park Alpha?", {
              lines: [{
                mark: "warning",
                text: multiline,
                source: { kind: "registry", bucket: "park", index: 0 },
              }],
              blockers: [multiline],
              footnote: multiline,
              safeLabel: "Keep",
              confirmLabel: "Park",
            }),
          },
        },
        { kind: "review", step, load: { state: "failed", error: multiline } },
        {
          kind: "form",
          step: { ...step, action: "follow_up" },
          values: { brief: multiline },
          load: { state: "failed", error: multiline },
        },
      ];
      const views: Array<[string, DeskProductState]> = [
        ["inbox", listed],
        ...layers.map((layer): [string, DeskProductState] => [
          `${layer.kind} ${JSON.stringify(layer).slice(0, 60)}`,
          open(listed, layer).state,
        ]),
      ];
      for (const [name, state] of views) {
        const frame = rendered<DeskIntent>(
          deskView(
            state,
            { ...PRODUCT_UI, selected: "alpha" },
            PRODUCT_VIEW_ENV,
          ),
          { keymap: deskKeymap(), viKeys: true },
        );
        assert(!CONTROL_PICTURE.test(frame), `${name}:\n${frame}`);
      }
    },
  });
});
