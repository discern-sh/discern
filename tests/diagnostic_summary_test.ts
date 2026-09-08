/** Bounded wire diagnostics retain the exact complete evidence without another execution. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import { retainResultDiagnostics } from "../src/engine/gate/diagnostic_output.ts";
import type { Diagnostic, DiscernResult } from "../src/shared/result.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { withFailureRecoveryHint } from "../src/shared/hints.ts";
import { FinishOutputSchema } from "../src/shared/result_schemas.ts";
import { renderMcpResult } from "../src/engine/mcp/server.ts";
import { sha256Hex } from "../src/shared/sha256.ts";

Deno.test("large diagnostic summaries retain complete observations, distinct rules, and honest repeat counts", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "diagnostic fixture\n");
    await gitInit(root);
    const diagnostics: Diagnostic[] = Array.from(
      { length: 80 },
      (_, index) => ({
        tool: "locking",
        rule: "publication",
        severity: "error",
        file: `evidence/${index}`,
        message: "Lock ownership unavailable. ".repeat(100),
        output: "complete capture\n".repeat(500),
        reproduce_cmd: "discern status --verbose",
      }),
    );
    const distinct: Diagnostic = {
      tool: "typecheck",
      severity: "error",
      message: "A distinct real finding",
      reproduce_cmd: "discern prepare",
    };
    diagnostics.push(distinct, distinct);
    const result: DiscernResult = withFailureRecoveryHint({
      ok: false,
      verb: "done",
      error: "gate_failed",
      diagnostics,
      message: "Validation failed.",
    });
    const original = JSON.stringify(diagnostics);
    await retainResultDiagnostics(root, result);
    assert(result.diagnosticEvidence !== undefined);
    const full = await Deno.readTextFile(result.diagnosticEvidence.path);
    assertEquals(full, original);
    assertEquals(await sha256Hex(full), result.diagnosticEvidence.digest);
    assertEquals(
      new TextEncoder().encode(full).length,
      result.diagnosticEvidence.bytes,
    );
    const firstPath = result.diagnosticEvidence.path;
    await retainResultDiagnostics(root, result);
    assertEquals(result.diagnosticEvidence.path, firstPath);
    const wire = FinishOutputSchema.parse(serializeResult(result));
    assertEquals(wire.diagnostics?.length, 6);
    assertEquals(wire.diagnostic_evidence?.total, 82);
    assert(
      wire.diagnostics?.some((diagnostic) => diagnostic.tool === "typecheck"),
    );
    assert(wire.diagnostic_evidence?.repeats.includes(2));
    assert(JSON.stringify(wire).length < 30_000);
    const mcp = renderMcpResult(result);
    assertEquals(mcp.structuredContent, serializeResult(result));
    assertStringIncludes(mcp.content[0]?.text ?? "", firstPath);
    assertStringIncludes(mcp.content[0]?.text ?? "", "Repeated 2 times");
    assertEquals(JSON.stringify(result.diagnostics), original);
    diagnostics.push({ ...distinct, message: "A later unrecorded finding" });
    const changed = serializeResult(result);
    assertEquals(changed.diagnostics, diagnostics);
    assertEquals(changed.diagnostic_evidence, undefined);
  });
});

Deno.test("small and unpersisted results keep their complete diagnostics inline", async () => {
  const result: DiscernResult = {
    ok: true,
    verb: "done",
    diagnostics: [{
      tool: "review",
      severity: "warning",
      message: "Read this finding",
      reproduce_cmd: "discern status",
    }],
  };
  await retainResultDiagnostics("/unused-for-small-summary", result);
  assertEquals(result.diagnosticEvidence, undefined);
  assertEquals(serializeResult(result).diagnostics, result.diagnostics);
});

Deno.test("a failed diagnostic write cannot publish a reference to incomplete evidence", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "diagnostic fixture\n");
    await gitInit(root);
    const result: DiscernResult = {
      ok: true,
      verb: "done",
      diagnostics: Array.from({ length: 7 }, () => ({
        tool: "review",
        severity: "warning",
        message: "Complete finding",
        reproduce_cmd: "discern status",
      })),
    };
    const write = Deno.writeTextFile;
    try {
      Deno.writeTextFile = (): Promise<void> =>
        Promise.reject(
          new Deno.errors.WriteZero("Controlled artifact write failure"),
        );
      await retainResultDiagnostics(root, result);
    } finally {
      Deno.writeTextFile = write;
    }
    assertEquals(result.diagnosticEvidence, undefined);
    assertEquals(serializeResult(result).diagnostics, result.diagnostics);
  });
});
