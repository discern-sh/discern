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
 * The second format is **JUnit XML** — the cross-runner test-report standard
 * most test tools can emit (`--reporter=junit`, `--junit-xml`, …). The same
 * doctrine applies: the format is recognized, never the runner. Only failing
 * test cases become diagnostics, each carrying the case's file and name when
 * the report offers them, so a red test stage names which tests broke — and a
 * recorded diagnostic class can attribute a recurring or flaky failure to its
 * test — instead of handing back one opaque output blob.
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
 * Slice the JUnit XML report out of a command's combined output, or undefined
 * when there isn't one. The slice runs from the first `<testsuites`/`<testsuite`
 * open tag to the last matching close tag, so runner banners before the report
 * and exit-status noise after it never confuse the parse. Detection requires a
 * real element boundary, so prose that merely mentions the word cannot fire it;
 * a document with no close tag is rejected rather than half-read.
 */
export function extractJunit(output: string): string | undefined {
  const open = output.search(/<testsuites?[\s/>]/);
  if (open < 0) {
    return undefined;
  }
  const ends = ["</testsuites>", "</testsuite>"]
    .map((tag) => {
      const at = output.lastIndexOf(tag);
      return at < 0 ? -1 : at + tag.length;
    })
    .filter((end) => end > open);
  if (ends.length === 0) {
    return undefined;
  }
  return output.slice(open, Math.max(...ends));
}

/** Decode the XML entities machine-emitted JUnit uses; anything else passes through. */
function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code = body.startsWith("#x")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return named[body] ?? whole;
    },
  );
}

/** Decode ordinary XML text while preserving each CDATA section literally. */
function decodeXmlText(text: string): string {
  let decoded = "";
  let cursor = 0;
  for (const match of text.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    if (match.index === undefined) {
      continue;
    }
    decoded += decodeXmlEntities(text.slice(cursor, match.index));
    decoded += match[1] ?? "";
    cursor = match.index + match[0].length;
  }
  return decoded + decodeXmlEntities(text.slice(cursor));
}

/** Parse one XML open tag's attributes into a name → decoded-value map. */
function tagAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? "";
    if (name !== undefined && !attrs.has(name)) {
      attrs.set(name, decodeXmlEntities(value));
    }
  }
  return attrs;
}

/** A trimmed attribute value, or undefined when absent or blank. */
function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * A value that names a file only when it reads like a path (it carries a
 * separator). JUnit `classname` holds a real path for some runners and a dotted
 * language identifier for others; only the former may become `file`.
 */
function pathLike(value: string | undefined): string | undefined {
  if (value === undefined || !/[\\/]/.test(value)) {
    return undefined;
  }
  return value.replace(/^\.\//, "");
}

/** Read a 1-based positive integer attribute, or undefined. */
function positiveIntAttr(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  return n > 0 ? n : undefined;
}

/**
 * Project a JUnit XML report into {@link Diagnostic}s — one per failing (or
 * errored) test case; passing and skipped cases contribute nothing. `file`
 * prefers the case's own `file` attribute, then a path-like `classname`, then a
 * path-like enclosing `<testsuite name>`; `rule` is the test's name, so a
 * recorded diagnostic class identifies the exact test. Returns undefined when
 * no case failed — a red run whose report shows no failures (a crash before the
 * suite, a runner error) keeps its Tier-0 raw output instead. Defensive
 * throughout: runners vary in which fields they populate, and a malformed
 * fragment is skipped, never thrown.
 */
export function junitToDiagnostics(
  xml: string,
  tool: string,
  reproduceCmd: string,
): Diagnostic[] | undefined {
  // Suite open tags in document order; a case's suite is the nearest one above.
  const suites: { at: number; name: string | undefined }[] = [];
  for (const m of xml.matchAll(/<testsuite(?![\w-])[^>]*>/g)) {
    if (m.index !== undefined) {
      suites.push({ at: m.index, name: tagAttributes(m[0]).get("name") });
    }
  }
  const out: Diagnostic[] = [];
  let suiteIdx = -1;
  const cases = xml.matchAll(
    /<testcase(?![\w-])([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testcase\s*>)/g,
  );
  for (const m of cases) {
    const body = m[2];
    if (m.index === undefined || body === undefined) {
      continue; // self-closing: a passing case, nothing to report
    }
    const failure = body.match(
      /<(failure|error)(?![\w-])([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/,
    );
    if (failure === null) {
      continue;
    }
    while (
      suiteIdx + 1 < suites.length && (suites[suiteIdx + 1]?.at ?? 0) < m.index
    ) {
      suiteIdx++;
    }
    const attrs = tagAttributes(m[1] ?? "");
    const failureAttrs = tagAttributes(failure[2] ?? "");
    const failureBody = failure[3];
    const message = nonBlank(failureAttrs.get("message")) ??
      nonBlank(
        failureBody === undefined ? undefined : decodeXmlText(failureBody),
      ) ?? "(no message)";
    const diag: Diagnostic = {
      tool,
      severity: "error",
      message,
      reproduce_cmd: reproduceCmd,
    };
    const file = nonBlank(attrs.get("file"))?.replace(/^\.\//, "") ??
      pathLike(attrs.get("classname")) ??
      pathLike(suites[suiteIdx]?.name);
    if (file !== undefined) {
      diag.file = file;
    }
    const line = positiveIntAttr(attrs.get("line"));
    if (line !== undefined) {
      diag.line = line;
    }
    const col = positiveIntAttr(attrs.get("col"));
    if (col !== undefined) {
      diag.col = col;
    }
    const rule = nonBlank(attrs.get("name"));
    if (rule !== undefined) {
      diag.rule = rule;
    }
    out.push(diag);
  }
  return out.length > 0 ? out : undefined;
}

/** A recognized format can carry no findings; that still stops format probing. */
interface DiagnosticFormatMatch {
  diagnostics: Diagnostic[] | undefined;
}

/** One auto-detected machine format and the parser that owns it. */
interface DiagnosticFormat {
  id: string;
  label: string;
  normalize: (
    output: string,
    tool: string,
    reproduceCmd: string,
  ) => DiagnosticFormatMatch | undefined;
}

/** Recognize and normalize SARIF, preserving an empty recognized report. */
function normalizeSarif(
  output: string,
  tool: string,
  reproduceCmd: string,
): DiagnosticFormatMatch | undefined {
  const sarif = extractSarif(output);
  return sarif === undefined
    ? undefined
    : { diagnostics: sarifToDiagnostics(sarif, tool, reproduceCmd) };
}

/** Recognize and normalize JUnit XML, preserving an empty recognized report. */
function normalizeJunit(
  output: string,
  tool: string,
  reproduceCmd: string,
): DiagnosticFormatMatch | undefined {
  const junit = extractJunit(output);
  return junit === undefined
    ? undefined
    : { diagnostics: junitToDiagnostics(junit, tool, reproduceCmd) };
}

/**
 * The machine formats diagnostic normalization recognizes, in detection order.
 * Parsing, setup instructions, improvement coaching, and documentation enrollment
 * all derive from or are checked against this registry.
 */
export const DIAGNOSTIC_FORMATS = [
  {
    id: "sarif",
    label: "SARIF",
    normalize: normalizeSarif,
  },
  {
    id: "junit-xml",
    label: "JUnit XML",
    normalize: normalizeJunit,
  },
] as const satisfies readonly DiagnosticFormat[];

/** Format the supported diagnostic-format labels as an English list. */
export function diagnosticFormatList(
  conjunction: "and" | "or" = "and",
): string {
  const labels = DIAGNOSTIC_FORMATS.map((format) => format.label);
  if (labels.length < 2) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} ${conjunction} ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, ${conjunction} ${labels.at(-1)}`;
}

/**
 * Normalize a failed job's captured output into structured diagnostics, or
 * undefined when no known format is recognized (the caller then keeps the Tier-0
 * raw-output diagnostic). Declared text formats are a separate future slice.
 */
export function normalizeDiagnostics(
  output: string,
  tool: string,
  reproduceCmd: string,
): Diagnostic[] | undefined {
  for (const format of DIAGNOSTIC_FORMATS) {
    const match = format.normalize(output, tool, reproduceCmd);
    if (match !== undefined) {
      return match.diagnostics;
    }
  }
  return undefined;
}
