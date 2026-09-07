/** Syntax census of elapsed shell waits, including embedded child programs. */
import { ts } from "ts-morph";
import type { WaitingSource } from "./test_waiting_guard.ts";

interface ShellWaitSite {
  readonly path: string;
  readonly enclosing: string;
  readonly argument: string;
  readonly line: number;
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

/** Scan declarations as well as calls, so renamed commands and wrappers enroll. */
export function shellWaitSites(
  sources: readonly WaitingSource[],
): ShellWaitSite[] {
  const sites: ShellWaitSite[] = [];
  for (const item of sources) {
    const inspect = (value: string, scope: string, line: number): void => {
      for (
        const match of value.trim().matchAll(
          /(?:^|[\s;|&'"`(}])(?:\/(?:[\w.-]+\/)*|command\s+|exec\s+)?sleep(?:\s+(\$\{[^}]+\}|[^\s;|'"`\\]+)|$)/gu,
        )
      ) {
        sites.push({
          path: item.path,
          enclosing: scope,
          argument: match[1] ?? "<command>",
          line,
        });
      }
    };
    if (!/\.[cm]?[jt]sx?$/u.test(item.path)) {
      inspect(item.source, "<module>", 1);
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
        inspect(
          value,
          enclosing(node),
          file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        );
      } else {
        ts.forEachChild(node, visit);
      }
    };
    visit(file);
  }
  return sites;
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
