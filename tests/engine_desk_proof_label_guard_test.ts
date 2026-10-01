/**
 * A Desk row's word, glyph, and colour come from status's row state, never
 * from the Proof alone. A proven task can be stale, queued, or waiting on an
 * exception, so a label derived from the Proof reads "valid" where status
 * says otherwise. Three checks hold that: a structural scan lets only named
 * fact readers look at a Proof's status, the decision model's look must equal
 * status's own for every written state, and the rendered row must show
 * status's label and tones, not the decision's copy of them.
 */

import { assert, assertEquals } from "@std/assert";
import { Node, Project } from "ts-morph";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { scanDeskModules } from "./desk_module_scan.ts";
import { fleetEntry, statusData } from "./status_fleet.ts";
import { NOW, TABLE_ROWS } from "./row_state_table.ts";
import type {
  StatusFleetEntry,
  SubmissionRowData,
} from "../src/shared/result_schemas.ts";
import {
  FLEET_ROW_STATES,
  type FleetRowTone,
  rowStateLabel,
} from "../src/engine/status/row_states.ts";
import { presentFleetRow } from "../src/engine/status/fleet_rows.ts";
import {
  buildDeskDecision,
  buildDeskRows,
  deskRowId,
} from "../src/engine/desk/model.ts";
import { deskView } from "../src/engine/desk/inbox_view.ts";
import { tone } from "../src/engine/desk/inspector_view.ts";
import {
  freshDesk,
  observeDesk,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
} from "./fixtures/desk_product.ts";

/**
 * The Desk functions that may read a Proof's status, each for a fact other
 * than a row's look: the Proof fact itself, the consequence predicates, and
 * landing availability; and in the inspector, the Checks fact's diffstat,
 * the Main fact's emphasis, and which landing facts a proven task lists. A
 * new reader must be named here with its reason.
 */
const PROOF_FACT_READERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "src/engine/desk/model.ts",
    new Set(["proofFact", "actionContext", "landableReason"]),
  ],
  [
    "src/engine/desk/inspector_view.ts",
    new Set(["checksFact", "mainFact", "taskFacts"]),
  ],
]);

/** Whether an expression is a Proof value: a `proof` or `gate_proof`
 * property, or a call that returns one. */
function isProofValue(expression: Node): boolean {
  if (
    Node.isCallExpression(expression) &&
    /(?:^|\.)fleetRowProof$/u.test(expression.getExpression().getText())
  ) return true;
  return /(?:^|\.)(?:gate_proof|proof)$/u.test(
    expression.getText().replaceAll("?", ""),
  );
}

/** Every read of a Proof's status or honored flag outside a named reader. */
function proofStatusReads(source: string, file = "candidate.ts"): string[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const readers = PROOF_FACT_READERS.get(file) ?? new Set<string>();
  return project.createSourceFile("candidate.ts", source).getDescendants()
    .flatMap((node) => {
      if (
        !Node.isPropertyAccessExpression(node) ||
        !["status", "honored"].includes(node.getName()) ||
        !isProofValue(node.getExpression())
      ) return [];
      const reader = node.getFirstAncestor(Node.isFunctionDeclaration)
        ?.getName();
      return reader !== undefined && readers.has(reader)
        ? []
        : [`line ${node.getStartLineNumber()}: ${node.getText()}`];
    });
}

/** The facts a written row's decision and presentation are built from. */
interface TableObservation {
  readonly trunk: string;
  readonly nowMs: number;
  readonly queue: SubmissionRowData[];
  readonly fleet: StatusFleetEntry[];
}

/** One written row as status surveys it: the row, any landing copy that
 * speaks for it, and its queue row. */
function observe(row: (typeof TABLE_ROWS)[number]): TableObservation {
  const integration = row.context?.integration;
  return {
    trunk: "main",
    nowMs: NOW,
    queue: row.context?.queueRow === undefined ? [] : [row.context.queueRow],
    fleet: [
      row.entry,
      ...(integration === undefined ? [] : [
        fleetEntry({ branch: "integration/task", integration }),
      ]),
    ],
  };
}

/** The look a row shows: its label, glyph, ASCII form, and two tones. */
interface RowLook {
  readonly label: string;
  readonly glyph: string;
  readonly ascii: string;
  readonly tones: {
    readonly glyph: FleetRowTone;
    readonly label: FleetRowTone;
  };
}

/** Pick only the look from a decision or a presentation. */
function lookOf(shown: RowLook): RowLook {
  return {
    label: shown.label,
    glyph: shown.glyph,
    ascii: shown.ascii,
    tones: { glyph: shown.tones.glyph, label: shown.tones.label },
  };
}

Deno.test("Desk Proof label guard", async () => {
  const { files, findings } = await scanDeskModules({
    scan: (source, file) => proofStatusReads(source, file),
  });
  await assertNamedCasesAsync({
    "only named fact readers in the Desk read a Proof status": () => {
      for (const file of PROOF_FACT_READERS.keys()) {
        assert(files.includes(file), file);
      }
      assertEquals(findings, []);
    },
    "the scan finds a Proof status read in any spelling": () => {
      assertEquals(
        proofStatusReads(
          'const a = row.entry.gate_proof?.status === "honored"; const b = row.decision.proof.status; const c = proof.status; const d = decision.proof.honored; const e = fleetRowProof(entry).status;',
        ).length,
        5,
      );
      assertEquals(proofStatusReads("const a = row.decision.status;"), []);
      assertEquals(
        proofStatusReads(
          'function buildDeskDecision() { return proof.honored ? "Proof valid" : x; }',
          "src/engine/desk/model.ts",
        ).length,
        1,
        "a reader is named by function, never by module",
      );
    },
    "every written state's decision looks exactly as status presents it":
      () => {
        for (const row of TABLE_ROWS) {
          const observation = observe(row);
          const look = FLEET_ROW_STATES[row.state];
          const expected: RowLook = {
            label: rowStateLabel(row.state, row.context?.queueRow),
            glyph: look.glyph,
            ascii: look.ascii,
            tones: { glyph: look.glyphTone, label: look.labelTone },
          };
          assertEquals(
            lookOf(presentFleetRow(row.entry, observation)),
            expected,
            `row ${row.row}: status`,
          );
          assertEquals(
            lookOf(buildDeskDecision(row.entry, observation)),
            expected,
            `row ${row.row}: desk`,
          );
        }
      },
    "every written state's row shows status's label, glyph, and tones": () => {
      for (const row of TABLE_ROWS) {
        const observation = observe(row);
        const data = statusData(observation.fleet, {
          queue: observation.queue,
        });
        const [desk] = buildDeskRows(
          observation.fleet,
          new Map(),
          new Map(),
          observation,
        );
        assert(desk !== undefined, `row ${row.row}`);
        const view = deskView(
          observeDesk(freshDesk(), data, NOW).state,
          PRODUCT_UI,
          { ...PRODUCT_VIEW_ENV, now: NOW },
        );
        assert(view.body.kind !== "reading", `row ${row.row}`);
        const items = (view.body.list?.groups ?? []).flatMap((group) =>
          group.items
        );
        assertEquals(
          items.filter((item) => item.id.startsWith("integration")),
          [],
          `row ${row.row}: integration checkouts never show as tasks`,
        );
        const shown = items.find((item) => item.id === deskRowId(desk));
        assert(shown !== undefined, `row ${row.row}`);
        const look = FLEET_ROW_STATES[row.state];
        assertEquals(
          {
            glyph: shown.marker?.unicode,
            ascii: shown.marker?.ascii,
            glyphTone: shown.marker?.tone,
            label: shown.cells?.label?.[0]?.text,
            labelTone: shown.cells?.label?.[0]?.tone,
          },
          {
            glyph: look.glyph,
            ascii: look.ascii,
            glyphTone: tone(look.glyphTone),
            label: rowStateLabel(row.state, row.context?.queueRow),
            labelTone: tone(look.labelTone),
          },
          `row ${row.row}`,
        );
      }
    },
  });
});
