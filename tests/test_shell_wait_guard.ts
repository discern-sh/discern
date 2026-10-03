/** Syntax census of elapsed shell waits, including embedded child programs. */
import { ts } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { shellAwaitFile } from "./shell_hold.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
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
/** A command that reads a file, as a content poll's condition does. */
const FILE_READ = String.raw`(?:grep|cat|head|tail|wc|cmp|diff)\s`;
/** A `[`/`test` condition on a file read's output: `[ "$(cat f)" = go ]`. */
const READ_TEST = String.raw`(?:\[|test)\s+(?:!\s+)?"?\$\(` + FILE_READ;
/** Where a shell word starts inside decoded text. */
const WORD_START = "(?:^|[\\s;|&'\"`(}])";
const LOOP_START = String.raw`${WORD_START}(?:while|until)\s+(?:!\s+)?`;
/** A loop whose condition is a file predicate, wherever its body is written. */
const EXISTENCE_LOOP = new RegExp(LOOP_START + FILE_TEST, "u");
/** A loop whose condition reads a file, wherever its body is written. */
const CONTENT_LOOP = new RegExp(
  `${LOOP_START}(?:${FILE_READ}|${READ_TEST})`,
  "u",
);
const LOOP = new RegExp(String.raw`${WORD_START}(?:while|until)\s`, "u");
const FILE_PREDICATE = new RegExp(FILE_TEST, "u");
const FILE_CONTENT = new RegExp(WORD_START + FILE_READ, "u");
const PACED = new RegExp(SHELL_SLEEP.source, "u");
/** A per-attempt counter: `i=$((i+1))`, `i=$(($i + 1))`, or `: $((i+=1))`. */
const ATTEMPT_COUNTER =
  /(?:(\w+)=\$\(\(\s*\$?\1\s*\+\s*1\s*\)\)|\$\(\(\s*(\w+)\s*\+=\s*1\s*\)\))/gu;

/** One test or helper's decoded texts, read together as one shell program. */
interface ShellScope {
  readonly path: string;
  readonly enclosing: string;
  readonly texts: readonly ShellText[];
}

/**
 * Group decoded texts by their enclosing test or helper, so a loop written as
 * an array of lines, or assembled from separate literals, reads as one program.
 */
function shellScopes(sources: readonly WaitingSource[]): ShellScope[] {
  const scopes = new Map<string, ShellText[]>();
  for (const text of shellTexts(sources)) {
    const key = JSON.stringify([text.path, text.enclosing]);
    const texts = scopes.get(key) ?? [];
    texts.push({ ...text, value: text.value.trim() });
    scopes.set(key, texts);
  }
  return [...scopes.values()].flatMap((texts) =>
    texts[0] === undefined
      ? []
      : [{ path: texts[0].path, enclosing: texts[0].enclosing, texts }]
  );
}

/** Whether a scope counts its attempts and compares that count to a limit. */
function attemptBounded(texts: readonly ShellText[]): boolean {
  const program = texts.map((text) => text.value).join("\n");
  return [...program.matchAll(ATTEMPT_COUNTER)].some((match) => {
    const counter = match[1] ?? match[2];
    return counter !== undefined && new RegExp(
      String.raw`\$\{?${counter}\}?"?\s+-(?:gt|ge|lt|le|eq)\s+"?\d`,
      "u",
    ).test(program);
  });
}

/** What a shell file poll waits for, which decides what may bound it. */
export type ShellFilePoll = "existence" | "content";

/** One test or helper whose shell polls a file, at the poll's first text. */
export interface ShellFileHoldSite {
  readonly path: string;
  readonly enclosing: string;
  readonly line: number;
  readonly polls: ShellFilePoll;
}

/**
 * The one renderer allowed to poll a file's existence. Its holds also end
 * once their directory or owning process is gone, so an abandoned fixture
 * cannot poll forever.
 */
export const SHELL_FILE_HOLD_RENDERER = {
  path: "tests/shell_hold.ts",
  enclosing: shellAwaitFile.name,
} as const;

/**
 * Tests and helpers whose shell polls a file, read one scope at a time. A
 * scope polls a file's existence when a loop's condition is a file predicate,
 * or when a file predicate and a timed wait share it. It polls a file's
 * content when a loop's condition reads the file, or when a loop, a file read
 * and a timed wait share it, unless it counts and limits its attempts: a read
 * of a removed file never succeeds, so only that limit ends the poll.
 */
export function shellFileHoldSites(
  sources: readonly WaitingSource[],
): ShellFileHoldSite[] {
  return shellScopes(sources).flatMap((scope) => {
    const marked = (pattern: RegExp): ShellText | undefined =>
      scope.texts.find((text) => pattern.test(text.value));
    const site = (
      text: ShellText,
      polls: ShellFilePoll,
    ): ShellFileHoldSite[] => [
      { path: scope.path, enclosing: scope.enclosing, line: text.line, polls },
    ];
    const paced = marked(PACED) !== undefined;
    const existence = marked(EXISTENCE_LOOP) ??
      (paced ? marked(FILE_PREDICATE) : undefined);
    if (existence !== undefined) return site(existence, "existence");
    const content = marked(CONTENT_LOOP) ??
      (paced && marked(LOOP) !== undefined ? marked(FILE_CONTENT) : undefined);
    return content === undefined || attemptBounded(scope.texts)
      ? []
      : site(content, "content");
  });
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
  return await readScopedSources(root, files);
}

/**
 * Every existence poll must come from the renderer that bounds it by its
 * owner, and every content poll must limit its attempts.
 */
export function shellFileHoldFindings(
  sources: readonly WaitingSource[],
): string[] {
  const renderer =
    `${SHELL_FILE_HOLD_RENDERER.enclosing} from ${SHELL_FILE_HOLD_RENDERER.path}`;
  return shellFileHoldSites(sources).flatMap((site) => {
    const at = `${site.path}:${site.line}`;
    const scope = JSON.stringify(site.enclosing);
    if (site.polls === "content") {
      return [
        `${at} polls a file's content in a shell loop with no attempt limit in ${scope}; count and limit its attempts, so a removed file or an abandoned fixture cannot keep it polling, or wait for any content with the nonEmpty option of ${renderer}`,
      ];
    }
    return site.path === SHELL_FILE_HOLD_RENDERER.path &&
        site.enclosing === SHELL_FILE_HOLD_RENDERER.enclosing
      ? []
      : [
        `${at} polls a file in a hand-written shell loop in ${scope}; render the hold with ${renderer}, which also ends it once its directory or owning process is gone`,
      ];
  }).sort();
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
