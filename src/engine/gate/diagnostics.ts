/**
 * Tier-1 diagnostic normalization (ADR 0028): turn a failed gate command's raw
 * output into structured {@link Diagnostic}s carrying `file`/`line`/`col`/`rule`,
 * so an agent (or an IDE) jumps straight to each finding instead of reading prose.
 *
 * The first format is **SARIF** — the cross-tool standard many linters and
 * type-checkers can emit (`--format sarif`, `--sarif`, …). It is auto-detected,
 * not declared: a project opts in simply by making its command emit SARIF, and
 * discern recognizes the *format*, never the tool — so the stack-neutral core
 * stays neutral. Detection is unambiguous (valid JSON + a `runs` array + a
 * 2.x/sarif marker), so a non-SARIF tool's output can never be misread; anything
 * unrecognized falls back to the Tier-0 raw-output diagnostic.
 *
 * Declared text formats (a per-check regex / `[diagnostics.<name>]`) are the
 * planned next slice; until then, a tool that emits only human text carries its
 * raw output (Tier 0), which an LLM agent reads directly.
 */

import type { Diagnostic } from "../../shared/result.ts";

/**
 * Extract a SARIF log object from a command's combined output, or undefined when
 * it isn't SARIF. Tries the whole string first; if that fails (stderr noise mixed
 * in), retries the first `{`…last `}` slice. Only accepts an object that is
 * unmistakably SARIF — a `runs` array plus a `version: "2.x"` or a `$schema`
 * naming sarif — so detection never fires on incidental JSON.
 */
export function extractSarif(
  output: string,
): Record<string, unknown> | undefined {
  const candidates: string[] = [output];
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(output.slice(first, last + 1));
  }
  for (const text of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") {
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.runs)) {
      continue;
    }
    const version = typeof obj.version === "string" ? obj.version : "";
    const schema = typeof obj.$schema === "string" ? obj.$schema : "";
    // A real SARIF version is exactly `2.x.y`; require that shape (not any "2."
    // prefix) or an explicit sarif `$schema`, so a non-SARIF tool can't be misread.
    if (/^2\.\d/.test(version) || /sarif/i.test(schema)) {
      return obj;
    }
  }
  return undefined;
}

/** Read a nested string, or undefined when any hop is missing/not a string. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Read a 1-based positive integer (SARIF line/column), or undefined. */
function int(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

/** Map a SARIF `level` to the diagnostic severity (everything non-warning is an error). */
function severityOf(level: unknown): "error" | "warning" {
  return level === "warning" || level === "note" ? "warning" : "error";
}

/**
 * Project a SARIF log into {@link Diagnostic}s — one per `result`, across every
 * `run`. `tool` and `reproduceCmd` come from the gate job (SARIF's own tool name
 * is the linter, not the discern job label). Returns undefined when the log holds
 * no results, so the caller keeps the Tier-0 raw diagnostic rather than emitting
 * an empty list. Defensive throughout: tools vary in which optional fields they
 * populate, and a malformed entry is skipped, never thrown.
 */
export function sarifToDiagnostics(
  sarif: Record<string, unknown>,
  tool: string,
  reproduceCmd: string,
): Diagnostic[] | undefined {
  const out: Diagnostic[] = [];
  const runs = Array.isArray(sarif.runs) ? sarif.runs : [];
  for (const run of runs) {
    if (run === null || typeof run !== "object") {
      continue;
    }
    const results = (run as Record<string, unknown>).results;
    if (!Array.isArray(results)) {
      continue;
    }
    for (const r of results) {
      if (r === null || typeof r !== "object") {
        continue;
      }
      const res = r as Record<string, unknown>;
      const message = str((res.message as Record<string, unknown>)?.text) ??
        "(no message)";
      const loc = Array.isArray(res.locations) ? res.locations[0] : undefined;
      const physical = loc && typeof loc === "object"
        ? (loc as Record<string, unknown>).physicalLocation as
          | Record<string, unknown>
          | undefined
        : undefined;
      const artifact = physical?.artifactLocation as
        | Record<string, unknown>
        | undefined;
      const region = physical?.region as Record<string, unknown> | undefined;
      const diag: Diagnostic = {
        tool,
        severity: severityOf(res.level),
        message,
        reproduce_cmd: reproduceCmd,
      };
      const file = str(artifact?.uri);
      if (file !== undefined) {
        diag.file = file;
      }
      const line = int(region?.startLine);
      if (line !== undefined) {
        diag.line = line;
      }
      const col = int(region?.startColumn);
      if (col !== undefined) {
        diag.col = col;
      }
      const rule = str(res.ruleId);
      if (rule !== undefined) {
        diag.rule = rule;
      }
      out.push(diag);
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalize a failed job's captured output into structured diagnostics, or
 * undefined when no known format is recognized (the caller then keeps the Tier-0
 * raw-output diagnostic). Currently recognizes SARIF; declared text formats are
 * the next slice.
 */
export function normalizeDiagnostics(
  output: string,
  tool: string,
  reproduceCmd: string,
): Diagnostic[] | undefined {
  const sarif = extractSarif(output);
  if (sarif !== undefined) {
    return sarifToDiagnostics(sarif, tool, reproduceCmd);
  }
  return undefined;
}
