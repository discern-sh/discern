/// <reference lib="deno.unstable" />

/**
 * Streamed output reaches a repainting package view only through the live
 * tail.
 *
 * A package view that repaints lays out every line it holds again on each
 * frame, and the work that wrote a line chose its length. Two paths carry
 * streamed text to such a view. Each view's limit is a `LiveTailLimit`, which
 * only `liveTailLimit` makes, so the compiler holds where a limit comes from.
 * This guard holds the rest, across the authored runtime source:
 *
 * - The Gate hands child lines to the package activity log. In a module that
 *   imports the activity log, every part of an `append` or `updatePartial`
 *   argument that is not a literal is the job prefix or an inline
 *   `liveTailText` call that bounds the streamed text.
 * - Output captured beside a live screen arrives as `StreamedOutput`, whose
 *   text only the live tail module reads. Runtime source never reads it
 *   whole.
 * - The bound and the readers are called where they are imported: never
 *   passed on, re-exported, or loaded dynamically, so this guard sees every
 *   call.
 * - No limit is forged by a type assertion or sized by a literal or an
 *   unbounded number, and only a module that opens the activity log takes
 *   the append-only limit.
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
/** The one name an activity-log line may join unbounded: its job's prefix. */
const ACTIVITY_LOG_PREFIX = "prefix";
const BOUND = "liveTailText";
const READERS = new Set(["liveTailOutput", "liveTailOutputLines"]);
const WHOLE_READER = "wholeStreamedOutput";
/** Live tail functions a module may only call where it imports them. */
const CALLED_ONLY = new Set([BOUND, WHOLE_READER, ...READERS]);
const LIMIT_FUNCTION = "liveTailLimit";
const LIMIT_TYPE = "LiveTailLimit";
const APPEND_ONLY_LIMIT = "APPEND_ONLY_LIMIT";
/** Wrappers whose operand is still a runtime value, unlike other type syntax. */
const VALUE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

const RUNTIME_FILES = await structuralGuardScope({
  guard: "tests/terminal_live_tail_guard_test.ts#runtime-streamed-output",
  universe: "authored-ts",
  narrow: {
    reason:
      "The live tail governs runtime presentation code; tests read streamed output whole to check it and plant violations.",
    include: (rel) => !rel.startsWith("tests/"),
  },
});

/** One path from streamed text toward a repainting view. */
type StreamedPath =
  | "activity-log"
  | "streamed-output-reader"
  | "whole-read"
  | "escaped"
  | "forged-limit"
  | "literal-size"
  | "append-only-limit";

/** One site on a path, and whether it keeps the live tail's bound. */
interface StreamedSite {
  readonly file: string;
  readonly line: number;
  readonly path: StreamedPath;
  readonly bounded: boolean;
}

/** A property or member name written as an identifier or a string literal. */
function propertyName(node: Deno.lint.Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** Whether two nodes are the same source span. */
function sameSpan(left: Deno.lint.Node, right: Deno.lint.Node): boolean {
  return left.range[0] === right.range[0] && left.range[1] === right.range[1];
}

/** A name a module reads a live tail export through. */
type Reference = Deno.lint.Identifier | Deno.lint.MemberExpression;

/** Whether `node` is the callee its parent calls. */
function calledDirectly(node: Reference): boolean {
  const parent = node.parent;
  return parent.type === "CallExpression" && sameSpan(parent.callee, node);
}

/** Whether a string literal, or a template without substitutions. */
function literalText(node: Deno.lint.Node | undefined): boolean {
  if (node?.type === "Literal") return typeof node.value === "string";
  return node?.type === "TemplateLiteral" && node.expressions.length === 0;
}

/**
 * Whether an identifier names a runtime value where it stands: not a
 * property name, an import binding, a re-export's source name, or type
 * syntax.
 */
function valueReference(node: Deno.lint.Identifier): boolean {
  const parent = node.parent;
  switch (parent.type) {
    case "MemberExpression":
      return parent.computed || !sameSpan(parent.property, node);
    case "Property":
      return sameSpan(parent.value, node);
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return false;
    case "ExportSpecifier":
      return parent.parent.type === "ExportNamedDeclaration" &&
        parent.parent.source === null && sameSpan(parent.local, node);
    default:
      return !parent.type.startsWith("TS") || VALUE_WRAPPERS.has(parent.type);
  }
}

/**
 * The parts of text handed to the activity log that are not literals: the
 * substitutions of a template, the operands of a concatenation, the branches
 * of a conditional. A spread hands over text no part can vouch for.
 */
function textParts(node: Deno.lint.Node): Deno.lint.Node[] | undefined {
  if (node.type === "SpreadElement") return undefined;
  if (literalText(node)) return [];
  const parts = (children: readonly Deno.lint.Node[]) => {
    const found = children.map(textParts);
    return found.some((part) => part === undefined)
      ? undefined
      : found.flatMap((part) => part ?? []);
  };
  switch (node.type) {
    case "TemplateLiteral":
      return parts(node.expressions);
    case "BinaryExpression":
      return node.operator === "+" ? parts([node.left, node.right]) : [node];
    case "ConditionalExpression":
      return parts([node.consequent, node.alternate]);
    default:
      return [node];
  }
}

/** Whether a size given to `liveTailLimit` is a literal or unbounded. */
function unboundedSize(node: Deno.lint.Node | undefined): boolean {
  if (node === undefined || node.type === "Literal") return true;
  if (node.type === "Identifier") {
    return node.name === "Infinity" || node.name === "NaN";
  }
  return node.type === "MemberExpression" &&
    node.object.type === "Identifier" && node.object.name === "Number";
}

/** The repository path an import specifier in `rel` names. */
function dependency(rel: string, specifier: string): string {
  return specifier.startsWith(".")
    ? normalize(join(dirname(rel), specifier)).replaceAll("\\", "/")
    : specifier;
}

/** Every streamed-text site in one module. */
function streamedSites(rel: string, source: string): StreamedSite[] {
  const sites: StreamedSite[] = [];
  const appendOnly: number[] = [];
  const authority = new Map<string, string>();
  const namespaces = new Set<string>();
  let activityLog = false;
  const plugin = {
    name: "discern-live-tail",
    rules: {
      collect: {
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const line = (node: Deno.lint.Node): number =>
            context.sourceCode.text.slice(0, node.range[0]).split("\n").length;
          const seen = new Set<string>();
          /** Record a site once, though a shorthand visits its span twice. */
          const site = (
            node: Deno.lint.Node,
            path: StreamedPath,
            bounded = false,
          ): void => {
            const key = `${path}:${node.range.join(":")}`;
            if (seen.has(key)) return;
            seen.add(key);
            sites.push({ file: rel, line: line(node), path, bounded });
          };
          /** The live tail export a callee names, imported or namespaced. */
          const exported = (node: Deno.lint.Node): string | undefined => {
            if (node.type === "Identifier") return authority.get(node.name);
            return node.type === "MemberExpression" &&
                node.object.type === "Identifier" &&
                namespaces.has(node.object.name)
              ? propertyName(node.property)
              : undefined;
          };
          /** A value reference to a live tail export, wherever it stands. */
          const referenced = (node: Reference, name: string): void => {
            if (name === WHOLE_READER) site(node, "whole-read");
            else if (CALLED_ONLY.has(name) && !calledDirectly(node)) {
              site(node, "escaped");
            }
            if (name === APPEND_ONLY_LIMIT) appendOnly.push(line(node));
          };
          /** Whether a part of an activity-log line keeps the bound. */
          const boundPart = (part: Deno.lint.Node): boolean =>
            (part.type === "Identifier" &&
              part.name === ACTIVITY_LOG_PREFIX) ||
            (part.type === "CallExpression" &&
              exported(part.callee) === BOUND &&
              part.arguments[1] !== undefined &&
              !literalText(part.arguments[1]));
          const fromLiveTail = (
            node: { readonly source: Deno.lint.Node | null },
          ): boolean =>
            node.source?.type === "Literal" &&
            typeof node.source.value === "string" &&
            dependency(rel, node.source.value) === LIVE_TAIL_AUTHORITY;
          const forged = (
            node: Deno.lint.TSAsExpression | Deno.lint.TSTypeAssertion,
          ): void => {
            const type = node.typeAnnotation;
            if (type.type !== "TSTypeReference") return;
            const name = type.typeName.type === "Identifier"
              ? authority.get(type.typeName.name)
              : type.typeName.type === "TSQualifiedName" &&
                  type.typeName.left.type === "Identifier" &&
                  namespaces.has(type.typeName.left.name)
              ? type.typeName.right.name
              : undefined;
            if (name === LIMIT_TYPE) site(node, "forged-limit");
          };
          return {
            ImportDeclaration(node): void {
              const from = dependency(rel, node.source.value);
              for (const entry of node.specifiers) {
                if (from === LIVE_TAIL_AUTHORITY) {
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
                  from === INTERACTIVE_MODULE &&
                  entry.type === "ImportSpecifier" &&
                  ACTIVITY_LOG_EXPORTS.has(propertyName(entry.imported) ?? "")
                ) activityLog = true;
              }
            },
            ExportNamedDeclaration(node): void {
              if (fromLiveTail(node)) site(node, "escaped");
            },
            ExportAllDeclaration(node): void {
              if (fromLiveTail(node)) site(node, "escaped");
            },
            ImportExpression(node): void {
              if (fromLiveTail(node)) site(node, "escaped");
            },
            Identifier(node): void {
              if (!valueReference(node)) return;
              const name = authority.get(node.name);
              if (name !== undefined) referenced(node, name);
              const parent = node.parent;
              if (
                namespaces.has(node.name) &&
                !(parent.type === "MemberExpression" &&
                  sameSpan(parent.object, node))
              ) site(node, "escaped");
            },
            MemberExpression(node): void {
              if (
                node.object.type !== "Identifier" ||
                !namespaces.has(node.object.name)
              ) return;
              const name = propertyName(node.property);
              if (name === undefined) site(node, "escaped");
              else referenced(node, name);
            },
            TSAsExpression: forged,
            TSTypeAssertion: forged,
            CallExpression(node): void {
              const name = exported(node.callee);
              if (name !== undefined && READERS.has(name)) {
                site(node, "streamed-output-reader", true);
              }
              if (
                name === LIMIT_FUNCTION &&
                node.arguments.slice(1, 3).some(unboundedSize)
              ) site(node, "literal-size");
              const method = node.callee.type === "MemberExpression"
                ? propertyName(node.callee.property)
                : undefined;
              if (
                !activityLog || method === undefined ||
                !ACTIVITY_LOG_LINE_METHODS.has(method)
              ) return;
              const text = node.arguments[0];
              const parts = text === undefined ? undefined : textParts(text);
              site(
                node,
                "activity-log",
                parts !== undefined && parts.every(boundPart),
              );
            },
          };
        },
      },
    },
  } satisfies Deno.lint.Plugin;
  Deno.lint.runPlugin(plugin, rel, source);
  if (!activityLog) {
    sites.push(
      ...appendOnly.map((line) => ({
        file: rel,
        line,
        path: "append-only-limit" as const,
        bounded: false,
      })),
    );
  }
  return sites.sort((left, right) => left.line - right.line);
}

/** Every streamed-text site the authored runtime source contains. */
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
    "Bound streamed text before a repainting view receives it. In an activity-log append or updatePartial, join only the job's prefix to an inline liveTailText call on the streamed text. Call the live tail's bound and readers where you import them. Never read StreamedOutput whole at runtime, assert a LiveTailLimit, size one with a literal, or take APPEND_ONLY_LIMIT outside the module that opens the activity log.",
  );
  for (const path of ["activity-log", "streamed-output-reader"] as const) {
    assert(
      sites.some((site) => site.path === path),
      `the guard found no ${path} site, so it would pass vacuously`,
    );
  }
});

Deno.test("the live tail guard rejects every unbounded path it can find", () => {
  const planted = [
    'import { withActivityLog } from "discern-design-system/cli/interactive";',
    'import * as tail from "../../lib/live_tail.ts";',
    'import { APPEND_ONLY_LIMIT, liveTailLimit as limitFor, type LiveTailLimit, liveTailOutput as shown, liveTailOutputLines, liveTailText as bound, wholeStreamedOutput as whole } from "../../lib/live_tail.ts";',
    'const LIMIT = limitFor("fill", columns, rows);',
    'log.append(`${prefix}${bound("line", text, LIMIT, "…")}`);',
    'log.updatePartial(text === "" ? "" : bound("partial", text, LIMIT, "…"));',
    "log.append(`${prefix}${text}`);",
    'log["updatePartial"](text === "" ? text : bound("partial", text, LIMIT, "…"));',
    'log.append(`${bound("line", prefix, LIMIT, "…")}${text}`);',
    'log.updatePartial(prefix + bound("partial", "", LIMIT, "…"));',
    "log.append(...lines);",
    'shown(output, LIMIT, "…");',
    'tail.liveTailOutputLines(output, 3, LIMIT, "…");',
    'limitFor("fit", 1e9, rows);',
    'tail.liveTailLimit("fit", columns, Number.MAX_SAFE_INTEGER);',
    "const read = shown;",
    "export { liveTailOutputLines };",
    'export { liveTailText } from "../../lib/live_tail.ts";',
    'export * from "../../lib/live_tail.ts";',
    'const loaded = await import("../../lib/live_tail.ts");',
    "const namespace = tail;",
    "whole(output);",
    "tail.wholeStreamedOutput(output);",
    "const forged = 1e9 as LiveTailLimit;",
    "const qualified = (1e9 as unknown) as tail.LiveTailLimit;",
    "const appendOnly = APPEND_ONLY_LIMIT;",
  ].join("\n");
  const sites = streamedSites("src/engine/desk/planted.ts", planted);
  assertEquals(
    sites.map((site) => `${site.line} ${site.path} ${site.bounded}`),
    [
      "5 activity-log true",
      "6 activity-log true",
      "7 activity-log false",
      "8 activity-log false",
      "9 activity-log false",
      "10 activity-log false",
      "11 activity-log false",
      "12 streamed-output-reader true",
      "13 streamed-output-reader true",
      "14 literal-size false",
      "15 literal-size false",
      "16 escaped false",
      "17 escaped false",
      "18 escaped false",
      "19 escaped false",
      "20 escaped false",
      "21 escaped false",
      "22 whole-read false",
      "23 whole-read false",
      "24 forged-limit false",
      "25 forged-limit false",
    ],
  );
  assertEquals(
    streamedSites(
      "src/engine/desk/planted.ts",
      planted.replace(/^.*withActivityLog.*$/mu, ""),
    )
      .filter((site) =>
        site.path === "activity-log" || site.path === "append-only-limit"
      )
      .map((site) => `${site.line} ${site.path}`),
    ["26 append-only-limit"],
    "a module without the package activity log hands it no line, and takes no append-only limit",
  );
});
