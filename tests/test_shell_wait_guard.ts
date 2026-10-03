/** Syntax census of elapsed shell waits, including embedded child programs. */
import { join } from "@std/path";
import { ts } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { shellAwaitFile } from "./shell_hold.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { isTestWaitingPath, type WaitingSource } from "./test_waiting_guard.ts";

interface ShellWaitSite {
  readonly path: string;
  readonly enclosing: string;
  readonly argument: string;
  readonly line: number;
}

/** One decoded string, template, or non-module source with its owner. */
interface ShellText {
  readonly path: string;
  readonly enclosing: string;
  readonly line: number;
  readonly value: string;
}

/** Nearest named test or helper; string aliases remain enrolled at declaration. */
function enclosing(node: ts.Node): string {
  for (
    let current: ts.Node | undefined = node;
    current !== undefined;
    current = current.parent
  ) {
    if (ts.isCallExpression(current)) {
      const first = current.arguments[0];
      if (
        first !== undefined && ts.isStringLiteralLike(first) &&
        current.arguments.some((arg) =>
          ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
        )
      ) return first.text;
      if (
        first !== undefined && ts.isObjectLiteralExpression(first) &&
        first.properties.some((property) =>
          ts.isPropertyAssignment(property) && property.name.getText() === "fn"
        )
      ) {
        for (const property of first.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === "name" &&
            ts.isStringLiteralLike(property.initializer)
          ) return property.initializer.text;
        }
      }
    }
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return current.name.text;
    }
  }
  return "<module>";
}

/** Decode literals and static concatenation without building a type checker. */
function textValue(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteralLike(node) || ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
  ) return node.text;
  if (ts.isParenthesizedExpression(node)) return textValue(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = textValue(node.left);
    const right = textValue(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text +
      node.templateSpans.map((span) =>
        `\${${span.expression.getText()}}${span.literal.text}`
      ).join("");
  }
  return undefined;
}

/** Decode every string a source could hand to a shell, at its enclosing owner. */
function shellTexts(sources: readonly WaitingSource[]): ShellText[] {
  const texts: ShellText[] = [];
  for (const item of sources) {
    if (!/\.[cm]?[jt]sx?$/u.test(item.path)) {
      texts.push({
        path: item.path,
        enclosing: "<module>",
        line: 1,
        value: item.source,
      });
      continue;
    }
    const file = ts.createSourceFile(
      item.path,
      item.source,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      const value = textValue(node);
      if (value !== undefined) {
        texts.push({
          path: item.path,
          enclosing: enclosing(node),
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          value,
        });
      } else {
        ts.forEachChild(node, visit);
      }
    };
    visit(file);
  }
  return texts;
}

const SHELL_SLEEP =
  /(?:^|[\s;|&'"`(}])(?:\/(?:[\w.-]+\/)*|command\s+|exec\s+)?sleep(?:\s+(\$\{[^}]+\}|[^\s;|'"`\\]+)|$)/gu;

/** Scan declarations as well as calls, so renamed commands and wrappers enroll. */
export function shellWaitSites(
  sources: readonly WaitingSource[],
): ShellWaitSite[] {
  return shellTexts(sources).flatMap((text) =>
    [...text.value.trim().matchAll(SHELL_SLEEP)].map((match) => ({
      path: text.path,
      enclosing: text.enclosing,
      argument: match[1] ?? "<command>",
      line: text.line,
    }))
  );
}

/** A `[`/`test` unary file predicate such as `-e`, `-f`, or `-s`. */
const FILE_TEST = String.raw`(?:\[|test)\s+(?:!\s+)?-[bcdefghLprSsuwx]\s`;
/** A loop whose condition is a file predicate, wherever its body is written. */
const FILE_LOOP = new RegExp(
  "(?:^|[\\s;|&'\"`(}])(?:while|until)\\s+(?:!\\s+)?" + FILE_TEST,
  "u",
);
const FILE_PREDICATE = new RegExp(FILE_TEST, "u");

/**
 * The one renderer allowed to poll a file. Its holds also end once their
 * directory or owning process is gone, so an abandoned fixture cannot poll
 * forever.
 */
export const SHELL_FILE_HOLD_RENDERER = {
  path: "tests/shell_hold.ts",
  enclosing: shellAwaitFile.name,
} as const;

/**
 * Shell text that polls a file: a loop whose condition is a file predicate,
 * or a file predicate beside a timed wait in the same text.
 */
export function shellFileHoldSites(
  sources: readonly WaitingSource[],
): Omit<ShellText, "value">[] {
  return shellTexts(sources).filter((text) => {
    const value = text.value.trim();
    return FILE_LOOP.test(value) ||
      (FILE_PREDICATE.test(value) && value.match(SHELL_SLEEP) !== null);
  }).map(({ path, enclosing, line }) => ({ path, enclosing, line }));
}

/** Tests and repository tools, whose holds poll directories they own. */
export async function shellHoldSources(
  root: string = REPO_ROOT,
): Promise<WaitingSource[]> {
  const files = await structuralGuardScope({
    guard: "tests/test_shell_wait_guard.ts#shell-file-holds",
    universe: {
      kind: "specialized",
      name: "executable text including test fixtures",
      text: true,
      reason:
        "A file hold is spawned from Deno modules, shell fixtures, or child programs embedded in either, including executable fixture trees.",
    },
    narrow: {
      reason:
        "Tests and repository tools at any depth hold children on directories they own; shipped code, workflows, and prose never spawn one.",
      include: (path) =>
        isTestWaitingPath(path) || /(?:^|\/)scripts\//u.test(path),
    },
  }, root);
  return await Promise.all(files.map(async (path) => ({
    path,
    source: await Deno.readTextFile(join(root, path)),
  })));
}

/** Every file hold must come from the renderer that bounds it by its owner. */
export function shellFileHoldFindings(
  sources: readonly WaitingSource[],
): string[] {
  return shellFileHoldSites(sources).filter((site) =>
    site.path !== SHELL_FILE_HOLD_RENDERER.path ||
    site.enclosing !== SHELL_FILE_HOLD_RENDERER.enclosing
  ).map((site) =>
    `${site.path}:${site.line} polls a file in a hand-written shell loop in ${
      JSON.stringify(site.enclosing)
    }; render the hold with ${SHELL_FILE_HOLD_RENDERER.enclosing} from ${SHELL_FILE_HOLD_RENDERER.path}, which also ends it once its directory or owning process is gone`
  ).sort();
}

export interface ShellWaitBoundary {
  readonly path: string;
  readonly enclosing: string;
  readonly argument: string;
  readonly count: number;
  readonly classification:
    | "condition-poll"
    | "elapsed-behavior"
    | "serialization-stimulus";
  /** Why elapsed time paces an observation or is the behavior under test. */
  readonly reason: string;
}

/** Bind every remaining elapsed shell wait to an explicit, reviewed purpose. */
export function shellWaitingFindings(
  sources: readonly WaitingSource[],
  boundaries: readonly ShellWaitBoundary[] = [],
): string[] {
  const sites = shellWaitSites(sources);
  const key = (
    site: Pick<ShellWaitSite, "path" | "enclosing" | "argument">,
  ): string => JSON.stringify([site.path, site.enclosing, site.argument]);
  const enrolled = new Map(
    boundaries.map((boundary) => [key(boundary), boundary]),
  );
  const counts = new Map<string, number>();
  const findings: string[] = [];
  if (enrolled.size !== boundaries.length) {
    findings.push("shell wait boundaries repeat an enrollment");
  }
  for (const site of sites) {
    const identity = key(site);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
    if (!enrolled.has(identity)) {
      findings.push(
        `${site.path}:${site.line} has an unregistered elapsed shell wait in ${
          JSON.stringify(site.enclosing)
        } (${site.argument}); use an observed-state acknowledgement, or register a genuine elapsed or polling contract`,
      );
    }
  }
  for (const [identity, boundary] of enrolled) {
    if (
      boundary.reason.trim().length < 20 ||
      !Number.isSafeInteger(boundary.count) || boundary.count < 1
    ) {
      findings.push(
        `shell wait boundary ${identity} requires a specific reason and positive count`,
      );
    }
    if ((counts.get(identity) ?? 0) !== boundary.count) {
      findings.push(
        `shell wait boundary ${identity} has ${
          counts.get(identity) ?? 0
        } sites; expected ${boundary.count}`,
      );
    }
  }
  return findings.sort();
}
