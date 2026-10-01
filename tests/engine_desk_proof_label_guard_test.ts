/**
 * A Desk row's word, glyph, and colour come from status's row state, never
 * from the Proof alone. A proven task can be stale, queued, or waiting on an
 * exception, so a label derived from `gate_proof.status` reads "valid" where
 * status says otherwise. The structural scan keeps every Desk module but the
 * decision model from reading a Proof status at all; the rendered check proves
 * each written state's row shows exactly status's look.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project } from "ts-morph";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { fleetEntry, statusData } from "./fixtures/status_fleet.ts";
import { NOW, TABLE_ROWS } from "./fixtures/row_state_table.ts";
import { FLEET_ROW_STATES } from "../src/engine/status/row_states.ts";
import { buildDeskRows } from "../src/engine/desk/model.ts";
import { deskApplicationView } from "../src/engine/desk/application_view.ts";

/** The one Desk module allowed to read a Proof status: it builds the Proof
 * facts and consequence predicates, never a row's label or tone. */
const PROOF_FACT_MODULE = "src/engine/desk/model.ts";

/** Every place a module reads the status of a Proof value. */
function proofStatusReads(source: string): string[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile("candidate.ts", source);
  return file.getDescendants().flatMap((node) =>
    Node.isPropertyAccessExpression(node) && node.getName() === "status" &&
      /(?:^|\.)(?:gate_proof|proof)$/u.test(
        node.getExpression().getText().replaceAll("?", ""),
      )
      ? [`line ${node.getStartLineNumber()}: ${node.getText()}`]
      : []
  );
}

Deno.test("Desk Proof label guard", async () => {
  const files = await structuralGuardScope({
    guard: "tests/engine_desk_proof_label_guard_test.ts#desk-proof-status",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only the Desk's modules render rows from status's state; status itself owns the Proof facts it classifies.",
      include: (path) => path.startsWith("src/engine/desk/"),
    },
  });
  await assertNamedCasesAsync({
    "no Desk module outside the decision model reads a Proof status":
      async () => {
        assert(files.includes(PROOF_FACT_MODULE));
        const findings: string[] = [];
        for (const file of files) {
          if (file === PROOF_FACT_MODULE) continue;
          const source = await Deno.readTextFile(join(REPO_ROOT, file));
          findings.push(
            ...proofStatusReads(source).map((hit) => `${file} ${hit}`),
          );
        }
        assertEquals(findings, []);
      },
    "the scan finds a Proof status read in any spelling": () => {
      assertEquals(
        proofStatusReads(
          'const a = row.entry.gate_proof?.status === "honored"; const b = row.decision.proof.status; const c = proof.status;',
        ).length,
        3,
      );
      assertEquals(proofStatusReads("const a = row.decision.status;"), []);
    },
    "every written state's row shows status's label, glyph, and tone": () => {
      for (const row of TABLE_ROWS) {
        const integration = row.context?.integration;
        const data = statusData([
          row.entry,
          ...(integration === undefined ? [] : [
            fleetEntry({ branch: "integration/task", integration }),
          ]),
        ], {
          ...(row.context?.queueRow === undefined
            ? {}
            : { queue: [row.context.queueRow] }),
        });
        const [desk] = buildDeskRows(data.fleet ?? [], new Map(), new Map(), {
          trunk: "main",
          nowMs: NOW,
          queue: data.queue ?? [],
        });
        assert(desk !== undefined, `row ${row.row}`);
        const tasks = deskApplicationView(
          { data, rows: [desk], phase: "fresh" },
          "overview",
        ).regions[0];
        assert(tasks?.kind === "choices");
        const [shown] = tasks.entries;
        assert(shown !== undefined && shown.kind !== "group-heading");
        const look = FLEET_ROW_STATES[row.state];
        assertEquals(shown.indicator?.content, look.glyph, `row ${row.row}`);
        assertEquals(shown.indicator?.ascii, look.ascii, `row ${row.row}`);
        assertEquals(shown.status?.content, desk.decision.label);
        assertEquals(
          shown.status?.tone === "success" ||
            shown.indicator?.tone === "success",
          look.glyphTone === "success" || look.labelTone === "success",
          `row ${row.row}: green only where status is green`,
        );
      }
    },
  });
});
