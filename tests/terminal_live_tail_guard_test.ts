/// <reference lib="deno.unstable" />

/**
 * Streamed output reaches a repainting package view only through the live
 * tail.
 *
 * A package view that repaints lays out every line it holds again on each
 * frame, and the work that wrote a line chose its length. Two paths carry
 * streamed text to such a view, and this guard enumerates every call site on
 * each from the authored runtime source:
 *
 * - The Gate hands child lines to the package activity log. Every `append` or
 *   `updatePartial` call in a module that imports the activity log must bound
 *   its text with `liveTailText` inline.
 * - Output captured beside a live screen arrives as `StreamedOutput`, whose
 *   text only the live tail module reads. Every runtime call of a reader must
 *   pass a limit computed by `liveTailLimit`, and runtime source never reads
 *   the text whole.
 *
 * The terminal boundary guard separately admits the activity log only in the
 * Gate's live controller.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const LIVE_TAIL_AUTHORITY = "src/lib/live_tail.ts";
const INTERACTIVE_MODULE = "discern-design-system/cli/interactive";
const ACTIVITY_LOG_EXPORTS = new Set([
  "withActivityLog",
  "ActivityLogController",
]);
const ACTIVITY_LOG_LINE_METHODS = new Set(["append", "updatePartial"]);
/** Each streamed-output reader, by the index of its limit argument. */
const STREAMED_OUTPUT_READERS: ReadonlyMap<string, number> = new Map([
  ["liveTailOutput", 1],
  ["liveTailOutputLines", 2],
]);
const WHOLE_READER = "wholeStreamedOutput";

const RUNTIME_FILES = await structuralGuardScope({
  guard: "tests/terminal_live_tail_guard_test.ts#runtime-streamed-output",
  universe: "authored-ts",
  narrow: {
    reason:
      "The live tail governs runtime presentation code; tests read streamed output whole to check it and plant violations.",
    include: (rel) => !rel.startsWith("tests/"),
  },
});

/** One path from streamed text to a repainting view, and whether it is bound. */
interface StreamedSite {
  readonly file: string;
  readonly line: number;
  readonly path: "activity-log" | "streamed-output-reader" | "whole-read";
  readonly bounded: boolean;
}

/** A property or member name written as an identifier or a string literal. */
function propertyName(node: Deno.lint.Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** The called member's name, for `object.name(...)` or `object["name"](...)`. */
function calledMember(node: Deno.lint.CallExpression): string | undefined {
  return node.callee.type === "MemberExpression"
    ? propertyName(node.callee.property)
    : undefined;
}

/** A source span, as Deno's syntax tree reports it. */
type Span = readonly [number, number];

/**
 * The spans of text handed to the activity log that must each hold a bound
 * call: every branch of a conditional but a string literal. A spread hands
 * over text no span can vouch for.
 */
function lineBranches(node: Deno.lint.Node): Span[] | undefined {
  if (node.type === "SpreadElement") return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return [];
  if (node.type === "ConditionalExpression") {
    const consequent = lineBranches(node.consequent);
    const alternate = lineBranches(node.alternate);
    return consequent === undefined || alternate === undefined
      ? undefined
      : [...consequent, ...alternate];
  }
  return [node.range];
}

/** One call site awaiting the facts the whole module establishes. */
interface PendingSite {
  readonly line: number;
  readonly path: StreamedSite["path"];
  /** Spans that must each contain a bound call, for an activity-log line. */
  readonly branches?: readonly Span[];
  /** A limit argument that is a named constant, for a reader. */
  readonly limitName?: string;
  readonly bounded: boolean;
}

/** Every streamed-text call site in one module. */
function streamedSites(rel: string, source: string): StreamedSite[] {
  const pending: PendingSite[] = [];
  const authority = new Map<string, string>();
  const namespaces = new Set<string>();
  const limitConstants = new Set<string>();
  const boundCalls: Span[] = [];
  let activityLog = false;
  const plugin = {
    name: "discern-live-tail",
    rules: {
      collect: {
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const line = (node: Deno.lint.Node): number =>
            context.sourceCode.text.slice(0, node.range[0]).split("\n").length;
          const imported = (callee: Deno.lint.Node): string | undefined => {
            if (callee.type === "Identifier") return authority.get(callee.name);
            if (
              callee.type === "MemberExpression" &&
              callee.object.type === "Identifier" &&
              namespaces.has(callee.object.name)
            ) return propertyName(callee.property);
            return undefined;
          };
          const limitCall = (
            node: Deno.lint.Node | null | undefined,
          ): boolean =>
            node?.type === "CallExpression" &&
            imported(node.callee) === "liveTailLimit";
          const reader = (
            node: Deno.lint.CallExpression,
            limitAt: number,
          ): PendingSite => {
            const limit = node.arguments[limitAt];
            return {
              line: line(node),
              path: "streamed-output-reader",
              bounded: limitCall(limit),
              ...(limit?.type === "Identifier"
                ? { limitName: limit.name }
                : {}),
            };
          };
          return {
            ImportDeclaration(node): void {
              const specifier = node.source.value;
              const dependency = specifier.startsWith(".")
                ? normalize(join(dirname(rel), specifier)).replaceAll("\\", "/")
                : specifier;
              for (const entry of node.specifiers) {
                if (dependency === LIVE_TAIL_AUTHORITY) {
                  if (entry.type === "ImportNamespaceSpecifier") {
                    namespaces.add(entry.local.name);
                  } else if (entry.type === "ImportSpecifier") {
                    const name = propertyName(entry.imported);
                    if (name !== undefined) {
                      authority.set(entry.local.name, name);
                    }
                  }
                }
                if (
                  dependency === INTERACTIVE_MODULE &&
                  entry.type === "ImportSpecifier" &&
                  ACTIVITY_LOG_EXPORTS.has(propertyName(entry.imported) ?? "")
                ) activityLog = true;
              }
            },
            VariableDeclarator(node): void {
              if (node.id.type === "Identifier" && limitCall(node.init)) {
                limitConstants.add(node.id.name);
              }
            },
            CallExpression(node): void {
              const name = imported(node.callee);
              if (name === "liveTailText") boundCalls.push(node.range);
              if (name === WHOLE_READER) {
                pending.push({
                  line: line(node),
                  path: "whole-read",
                  bounded: false,
                });
              }
              const limitAt = name === undefined
                ? undefined
                : STREAMED_OUTPUT_READERS.get(name);
              if (limitAt !== undefined) pending.push(reader(node, limitAt));
              const method = calledMember(node);
              if (
                activityLog && method !== undefined &&
                ACTIVITY_LOG_LINE_METHODS.has(method)
              ) {
                const text = node.arguments[0];
                const branches = text === undefined
                  ? undefined
                  : lineBranches(text);
                pending.push({
                  line: line(node),
                  path: "activity-log",
                  bounded: false,
                  ...(branches === undefined ? {} : { branches }),
                });
              }
            },
          };
        },
      },
    },
  } satisfies Deno.lint.Plugin;
  Deno.lint.runPlugin(plugin, rel, source);
  const holdsBound = ([start, end]: Span): boolean =>
    boundCalls.some(([from, to]) => from >= start && to <= end);
  return pending.map(({ line, path, branches, limitName, bounded }) => ({
    file: rel,
    line,
    path,
    bounded: bounded ||
      (branches !== undefined && branches.every(holdsBound)) ||
      (limitName !== undefined && limitConstants.has(limitName)),
  }));
}

/** Every streamed-text call site the authored runtime source contains. */
async function runtimeSites(): Promise<StreamedSite[]> {
  const sites: StreamedSite[] = [];
  for (const rel of RUNTIME_FILES) {
    if (rel === LIVE_TAIL_AUTHORITY) continue;
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (!source.includes("live_tail") && !source.includes(INTERACTIVE_MODULE)) {
      continue;
    }
    sites.push(...streamedSites(rel, source));
  }
  return sites;
}

/** The sites a guard reports: each unbounded path, by file and line. */
function unbounded(sites: readonly StreamedSite[]): string[] {
  return sites.filter((site) => !site.bounded).map((site) =>
    `${site.file}:${site.line} ${site.path}`
  );
}

Deno.test("streamed output reaches a repainting view only through the live tail", async () => {
  const sites = await runtimeSites();
  assertEquals(
    unbounded(sites),
    [],
    "Bound streamed text before a repainting view receives it: call liveTailText inline in an activity-log append or updatePartial, pass a liveTailOutput reader a limit from liveTailLimit, and never read StreamedOutput whole at runtime.",
  );
  for (const path of ["activity-log", "streamed-output-reader"] as const) {
    assert(
      sites.some((site) => site.path === path),
      `the guard found no ${path} call site, so it would pass vacuously`,
    );
  }
});

Deno.test("the live tail guard rejects every unbounded path it can find", () => {
  const planted = [
    'import { withActivityLog } from "discern-design-system/cli/interactive";',
    'import * as tail from "../../lib/live_tail.ts";',
    'import { liveTailLimit as limitFor, liveTailOutput as shown, liveTailOutputLines, liveTailText as bound, wholeStreamedOutput as whole } from "../../lib/live_tail.ts";',
    "const LIMIT = limitFor(80, 6);",
    "const WIDE = 1_000_000;",
    "log.append(`${prefix}${bound('line', text, LIMIT, '…')}`);",
    "log.updatePartial(text === '' ? '' : bound('partial', text, LIMIT, '…'));",
    "log.append(`${prefix}${text}`);",
    "log['updatePartial'](text === '' ? text : bound('partial', text, LIMIT, '…'));",
    "shown(output, LIMIT, '…');",
    "shown(output, limitFor(80, 24), '…');",
    "shown(output, WIDE, '…');",
    "liveTailOutputLines(output, 3, Number.POSITIVE_INFINITY, '…');",
    "tail.liveTailOutput(output, LIMIT, '…');",
    "whole(output);",
    "tail.wholeStreamedOutput(output);",
  ].join("\n");
  const sites = streamedSites("src/engine/desk/planted.ts", planted);
  assertEquals(
    sites.map((site) => `${site.line} ${site.path} ${site.bounded}`),
    [
      "6 activity-log true",
      "7 activity-log true",
      "8 activity-log false",
      "9 activity-log false",
      "10 streamed-output-reader true",
      "11 streamed-output-reader true",
      "12 streamed-output-reader false",
      "13 streamed-output-reader false",
      "14 streamed-output-reader true",
      "15 whole-read false",
      "16 whole-read false",
    ],
  );
  assertEquals(
    streamedSites(
      "src/engine/desk/planted.ts",
      planted.replace(/^.*withActivityLog.*$/mu, ""),
    )
      .filter((site) => site.path === "activity-log"),
    [],
    "a module without the package activity log has no activity-log path",
  );
});
