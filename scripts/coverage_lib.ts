/** Coverage analysis over the elected Git-derived product-module universe. */

import {
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
  SEPARATOR,
  toFileUrl,
} from "@std/path";
import { ts } from "ts-morph";

export type SourceModuleKind =
  | "executable"
  | "type-only"
  | "no-executable-lines";

export interface SourceModule {
  readonly path: string;
  readonly kind: SourceModuleKind;
}

export type FileCoverageStatus =
  | "measured"
  | "unloaded"
  | "type-only"
  | "no-executable-lines";

export interface FileCoverage {
  readonly path: string;
  readonly hit: number;
  readonly found: number;
  readonly pct: number | null;
  readonly status: FileCoverageStatus;
}

export type CoverageIssueKind =
  | "lcov-outside-universe"
  | "lcov-path-mismatch"
  | "lcov-kind-mismatch"
  | "invalid-lcov";

export interface CoverageIssue {
  readonly kind: CoverageIssueKind;
  readonly source: string;
  readonly message: string;
}

export interface SrcCoverage {
  readonly pct: number;
  readonly hit: number;
  readonly found: number;
  readonly files: readonly FileCoverage[];
  readonly issues: readonly CoverageIssue[];
}

export interface ModuleCoverageException {
  readonly path: string;
  readonly measuredPct: number;
  readonly owner: string;
  readonly reason: string;
  readonly recovery: string;
}

export interface ModuleCoverageEvaluation {
  readonly failureCount: number;
  readonly failures: readonly string[];
}

interface LcovRecord {
  readonly source: string;
  readonly lines: ReadonlyMap<number, number>;
}

/** Count the executed lines in one per-line execution-count map. */
function hitLineCount(lines: ReadonlyMap<number, number>): number {
  let hit = 0;
  for (const count of lines.values()) {
    if (count > 0) hit += 1;
  }
  return hit;
}

/** Escape one literal URL for use as an anchored regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The one URL prefix that bounds this checkout's product source tree. Every
 * surface that admits or rejects a module by URL — the report include filter
 * and the raw-profile pruner — derives its boundary from this prefix.
 */
export function srcCoverageUrlPrefix(repoRoot: string): string {
  return toFileUrl(`${join(repoRoot, "src")}${SEPARATOR}`).href;
}

/** Build one LCOV report pass over this checkout's product source tree. */
export function lcovReportArgs(
  profile: string,
  repoRoot: string,
): string[] {
  return [
    "coverage",
    profile,
    "--lcov",
    `--include=^${escapeRegExp(srcCoverageUrlPrefix(repoRoot))}`,
  ];
}

/** Round a percentage to the one decimal place shown by Deno coverage. */
function percentage(hit: number, found: number): number {
  if (found === 0) return 0;
  return Math.round((hit / found) * 1_000) / 10;
}

/** Tell whether a declaration is erased from the emitted module. */
function hasDeclareModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.DeclareKeyword
  ) ?? false;
}

/** Classify one top-level statement by whether it emits runtime code. */
function statementKind(
  statement: ts.Statement,
): "runtime" | "type" | "empty" {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return "type";
  }
  if (hasDeclareModifier(statement)) return "type";
  if (ts.isFunctionDeclaration(statement) && statement.body === undefined) {
    return "type";
  }
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause === undefined) return "runtime";
    if (clause.isTypeOnly) return "type";
    if (clause.name !== undefined) return "runtime";
    const bindings = clause.namedBindings;
    if (bindings === undefined || ts.isNamespaceImport(bindings)) {
      return "runtime";
    }
    if (bindings.elements.length === 0) return "runtime";
    return bindings.elements.every((element) => element.isTypeOnly)
      ? "type"
      : "runtime";
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return statement.isTypeOnly ? "type" : "runtime";
  }
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return "type";
    const clause = statement.exportClause;
    if (clause !== undefined && ts.isNamedExports(clause)) {
      if (
        clause.elements.length === 0 && statement.moduleSpecifier === undefined
      ) {
        return "empty";
      }
      if (
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly)
      ) {
        return "type";
      }
    }
    return "runtime";
  }
  if (
    ts.isEmptyStatement(statement) ||
    statement.kind === ts.SyntaxKind.NotEmittedStatement
  ) {
    return "empty";
  }
  return "runtime";
}

/** Classify a source module by emitted runtime semantics, not LCOV presence. */
export function classifyModuleSource(
  path: string,
  source: string,
): SourceModuleKind {
  let scriptKind = ts.ScriptKind.TS;
  if (/\.tsx$/i.test(path)) scriptKind = ts.ScriptKind.TSX;
  else if (/\.[cm]?jsx?$/i.test(path)) scriptKind = ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  let sawType = false;
  for (const statement of sourceFile.statements) {
    const kind = statementKind(statement);
    if (kind === "runtime") return "executable";
    if (kind === "type") sawType = true;
  }
  return sawType ? "type-only" : "no-executable-lines";
}

/**
 * Parse complete LCOV records without granting them module membership.
 *
 * DA lines are the authority for a record's per-line execution counts; the
 * LF/LH summary must agree with them, so a record that claims lines it does
 * not enumerate diagnoses instead of counting.
 */
function parseLcov(lcov: string): {
  records: LcovRecord[];
  issues: CoverageIssue[];
} {
  const records: LcovRecord[] = [];
  const issues: CoverageIssue[] = [];
  let open = false;
  let source: string | undefined;
  let foundClaim: number | undefined;
  let hitClaim: number | undefined;
  let lines = new Map<number, number>();
  let fault: string | undefined;
  const finish = (terminated: boolean): void => {
    if (!open) return;
    if (!terminated) fault ??= "the record is missing end_of_record";
    if (source === undefined) fault ??= "the record has no SF source";
    if (foundClaim === undefined || hitClaim === undefined) {
      fault ??= "the record is missing its LF or LH summary";
    } else if (foundClaim !== lines.size || hitClaim !== hitLineCount(lines)) {
      fault ??= `the LF:${foundClaim}/LH:${hitClaim} summary disagrees with ` +
        `its ${lines.size} DA lines (${hitLineCount(lines)} hit)`;
    }
    if (fault === undefined && source !== undefined) {
      records.push({ source, lines });
    } else {
      issues.push({
        kind: "invalid-lcov",
        source: source ?? "<missing SF>",
        message: `LCOV record '${source ?? "<missing SF>"}' is invalid: ${
          fault ?? "the record is incomplete"
        }`,
      });
    }
    open = false;
    source = undefined;
    foundClaim = undefined;
    hitClaim = undefined;
    lines = new Map();
    fault = undefined;
  };
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      finish(false);
      open = true;
      source = line.slice(3);
    } else if (line.startsWith("DA:")) {
      open = true;
      const [lineText, countText] = line.slice(3).split(",", 2);
      const lineNumber = Number(lineText);
      const count = Number(countText);
      if (
        lineText === undefined || countText === undefined ||
        !/^\d+$/.test(lineText) || !/^\d+$/.test(countText) ||
        !Number.isSafeInteger(lineNumber) || lineNumber < 1 ||
        !Number.isSafeInteger(count)
      ) {
        fault ??= `DA line '${line}' is malformed`;
      } else if (lines.has(lineNumber)) {
        fault ??= `DA line ${lineNumber} appears twice`;
      } else {
        lines.set(lineNumber, count);
      }
    } else if (line.startsWith("LF:")) {
      open = true;
      foundClaim = Number(line.slice(3));
    } else if (line.startsWith("LH:")) {
      open = true;
      hitClaim = Number(line.slice(3));
    } else if (line === "end_of_record") {
      finish(true);
    }
  }
  finish(false);
  return { records, issues };
}

/** Resolve an LCOV source to one canonical repository-relative path. */
function canonicalSource(
  source: string,
  repoRoot: string,
): { path?: string; issue?: CoverageIssue } {
  let filesystemPath: string;
  try {
    filesystemPath = source.startsWith("file:") ? fromFileUrl(source) : source;
  } catch {
    return {
      issue: {
        kind: "lcov-path-mismatch",
        source,
        message:
          `LCOV source '${source}' is not a valid file URL or absolute path`,
      },
    };
  }
  if (!isAbsolute(filesystemPath)) {
    return {
      issue: {
        kind: "lcov-path-mismatch",
        source,
        message:
          `LCOV source '${source}' must be an absolute path for canonical matching`,
      },
    };
  }
  const root = normalize(repoRoot);
  const path = relative(root, normalize(filesystemPath));
  if (path === ".." || path.startsWith(`..${SEPARATOR}`) || isAbsolute(path)) {
    return {
      issue: {
        kind: "lcov-outside-universe",
        source,
        message:
          `LCOV source '${source}' is outside the elected repository module universe`,
      },
    };
  }
  return { path: path.replaceAll(SEPARATOR, "/") };
}

/**
 * Join LCOV reports to every elected source module, assigning absence zero.
 *
 * Accepts one report or several — concurrent report passes over disjoint
 * profile shards each contribute a report. Records for the same module merge
 * per line: execution counts sum, so a line hit in any report counts hit once
 * and the line universe is the union the single merged pass would produce.
 */
export function srcLineCoverage(
  lcov: string | readonly string[],
  repoRoot: string,
  modules: readonly SourceModule[],
): SrcCoverage {
  const reports = typeof lcov === "string" ? [lcov] : lcov;
  const moduleByPath = new Map(modules.map((module) => [module.path, module]));
  const merged = new Map<string, Map<number, number>>();
  const issues: CoverageIssue[] = [];
  for (const report of reports) {
    const parsed = parseLcov(report);
    issues.push(...parsed.issues);
    for (const record of parsed.records) {
      const canonical = canonicalSource(record.source, repoRoot);
      if (canonical.issue !== undefined) {
        issues.push(canonical.issue);
        continue;
      }
      const path = canonical.path;
      if (path === undefined || !moduleByPath.has(path)) {
        issues.push({
          kind: "lcov-outside-universe",
          source: record.source,
          message: `LCOV source '${record.source}' resolves to '${
            path ?? "<unknown>"
          }', which is outside the elected module universe`,
        });
        continue;
      }
      const target = merged.get(path) ?? new Map<number, number>();
      for (const [lineNumber, count] of record.lines) {
        target.set(lineNumber, (target.get(lineNumber) ?? 0) + count);
      }
      merged.set(path, target);
    }
  }

  const files = [...modules]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((module): FileCoverage => {
      const measured = merged.get(module.path);
      if (module.kind !== "executable") {
        if (measured !== undefined && measured.size > 0) {
          issues.push({
            kind: "lcov-kind-mismatch",
            source: module.path,
            message:
              `LCOV reports executable lines for ${module.kind} module '${module.path}'`,
          });
        }
        return {
          path: module.path,
          hit: 0,
          found: 0,
          pct: null,
          status: module.kind,
        };
      }
      if (measured === undefined) {
        return {
          path: module.path,
          hit: 0,
          found: 0,
          pct: 0,
          status: "unloaded",
        };
      }
      const found = measured.size;
      const hit = hitLineCount(measured);
      if (found === 0) {
        issues.push({
          kind: "lcov-kind-mismatch",
          source: module.path,
          message:
            `Executable module '${module.path}' emitted an LCOV record with no executable lines`,
        });
      }
      return {
        path: module.path,
        hit,
        found,
        pct: percentage(hit, found),
        status: "measured",
      };
    });
  const measuredFiles = files.filter((file) => file.status === "measured");
  const hit = measuredFiles.reduce((sum, file) => sum + file.hit, 0);
  const found = measuredFiles.reduce((sum, file) => sum + file.found, 0);
  return { pct: percentage(hit, found), hit, found, files, issues };
}

/** Validate one exception's recovery metadata. */
function exceptionMetadataFailure(
  exception: ModuleCoverageException,
): string | undefined {
  if (!Number.isFinite(exception.measuredPct) || exception.measuredPct < 0) {
    return `Module coverage exception '${exception.path}' has an invalid measured value`;
  }
  for (
    const [name, value] of [
      ["owner", exception.owner],
      ["reason", exception.reason],
      ["recovery", exception.recovery],
    ] as const
  ) {
    if (value.trim().length < 8 || /[\r\n]/.test(value)) {
      return `Module coverage exception '${exception.path}' needs a specific one-line ${name}`;
    }
  }
  return undefined;
}

/** Enforce a floor, exact legacy debts, and stale-exception removal. */
export function evaluateModuleCoverage(
  coverage: SrcCoverage,
  floor: number,
  exceptions: readonly ModuleCoverageException[],
): ModuleCoverageEvaluation {
  const failures = coverage.issues.map((issue) => issue.message);
  const exceptionByPath = new Map<string, ModuleCoverageException>();
  for (const exception of exceptions) {
    const metadataFailure = exceptionMetadataFailure(exception);
    if (metadataFailure !== undefined) failures.push(metadataFailure);
    if (exceptionByPath.has(exception.path)) {
      failures.push(
        `Module coverage exception '${exception.path}' is duplicated`,
      );
    } else {
      exceptionByPath.set(exception.path, exception);
    }
  }

  const fileByPath = new Map(coverage.files.map((file) => [file.path, file]));
  for (const file of coverage.files) {
    const exception = exceptionByPath.get(file.path);
    if (file.status === "unloaded") {
      failures.push(
        `Executable module '${file.path}' is unloaded and measures 0.0%; load it through a behavioral test`,
      );
      if (exception !== undefined) {
        failures.push(
          `Module coverage exception '${file.path}' is invalid: unloaded modules cannot be exempted`,
        );
      }
      continue;
    }
    if (file.status !== "measured" || file.pct === null) {
      if (exception !== undefined) {
        failures.push(
          `Module coverage exception '${file.path}' is stale: ${file.status} modules do not need an exception`,
        );
      }
      continue;
    }
    if (file.pct >= floor) {
      if (exception !== undefined) {
        failures.push(
          `Module coverage exception '${file.path}' is stale: ${
            file.pct.toFixed(1)
          }% now meets the ${floor.toFixed(1)}% floor`,
        );
      }
      continue;
    }
    if (exception === undefined) {
      failures.push(
        `Module '${file.path}' is newly below the ${
          floor.toFixed(1)
        }% line floor at ${
          file.pct.toFixed(1)
        }%; add behavioral coverage or register reviewed legacy debt`,
      );
    } else if (file.pct < exception.measuredPct) {
      failures.push(
        `Module '${file.path}' regressed from its ${
          exception.measuredPct.toFixed(1)
        }% exception baseline to ${file.pct.toFixed(1)}%`,
      );
    }
  }
  for (const exception of exceptions) {
    if (!fileByPath.has(exception.path)) {
      failures.push(
        `Module coverage exception '${exception.path}' is stale: the module is not in the elected universe`,
      );
    }
  }
  return { failureCount: failures.length, failures };
}

/** Render measured coverage and every explicit non-runtime or unloaded state. */
export function renderTable(coverage: SrcCoverage): string {
  const rows = coverage.files.map((file) => {
    let coverageText: string;
    if (file.pct !== null) coverageText = `${file.pct.toFixed(1)}%`;
    else coverageText = "—";
    const state = file.status === "no-executable-lines"
      ? "no executable lines"
      : file.status;
    return `${file.path.padEnd(58)} ${coverageText.padStart(7)}  ${state}`;
  });
  rows.push("-".repeat(80));
  rows.push(
    `${"All measured src/ files".padEnd(58)} ${
      `${coverage.pct.toFixed(1)}%`.padStart(7)
    }  ${coverage.hit}/${coverage.found}`,
  );
  return rows.join("\n");
}
