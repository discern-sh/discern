/**
 * Source-preserving Markdown destination rebasing.
 *
 * The CommonMark/GFM parser decides which bytes are real links, images, and
 * reference definitions. Their source positions then let this module replace
 * only the destination token in the original text. No Markdown is serialized,
 * so labels, titles, spacing, escapes, and literal code retain their authored
 * bytes.
 */

import * as posix from "@std/path/posix";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

interface SourcePoint {
  readonly offset?: number | undefined;
}

interface SourcePosition {
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}

interface MarkdownNode {
  readonly type: string;
  readonly url?: string | undefined;
  readonly position?: SourcePosition | undefined;
  readonly children?: readonly MarkdownNode[] | undefined;
}

interface DestinationSpan {
  /** Inclusive source offset of the destination bytes, excluding `<` / `>`. */
  readonly start: number;
  /** Exclusive source offset of the destination bytes, excluding `<` / `>`. */
  readonly end: number;
}

interface Replacement extends DestinationSpan {
  readonly value: string;
}

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** Convert a configured project path to the slash vocabulary Markdown uses. */
function projectPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Whether the parser-resolved destination is a project-local file reference. */
function isLocalFileDestination(destination: string): boolean {
  return destination !== "" &&
    !destination.startsWith("#") &&
    !destination.startsWith("?") &&
    !destination.startsWith("/") &&
    !URI_SCHEME.test(destination);
}

/** Whether `at` is escaped by an odd run of preceding backslashes. */
function isEscaped(source: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && source[i] === "\\"; i -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/** Find the matching `]` for a link/image label, including nested labels. */
function closingLabel(source: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (isEscaped(source, i)) continue;
    if (source[i] === "[") {
      depth += 1;
    } else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

/** Skip CommonMark whitespace before a destination token. */
function skipWhitespace(source: string, from: number): number {
  let at = from;
  while (at < source.length && /[\t\n\r ]/u.test(source[at] ?? "")) {
    at += 1;
  }
  return at;
}

/** Locate one angle-bracket or raw destination from its opening byte. */
function destinationFrom(
  source: string,
  from: number,
): DestinationSpan | undefined {
  const start = skipWhitespace(source, from);
  if (source[start] === "<") {
    for (let i = start + 1; i < source.length; i += 1) {
      if (source[i] === ">" && !isEscaped(source, i)) {
        return { start: start + 1, end: i };
      }
    }
    return undefined;
  }

  let parentheses = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (isEscaped(source, i)) continue;
    if (char === "(") {
      parentheses += 1;
      continue;
    }
    if (char === ")") {
      if (parentheses === 0) return { start, end: i };
      parentheses -= 1;
      continue;
    }
    if (/[\t\n\r ]/u.test(char) && parentheses === 0) {
      return { start, end: i };
    }
  }
  return start < source.length ? { start, end: source.length } : undefined;
}

/** Locate the destination token inside one parser-recognized Markdown node. */
function destinationSpan(
  source: string,
  node: MarkdownNode,
): DestinationSpan | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || start >= end) {
    return undefined;
  }
  const slice = source.slice(start, end);
  const labelOpen = node.type === "image" ? 1 : 0;
  if (slice[labelOpen] !== "[") return undefined;
  const labelClose = closingLabel(slice, labelOpen);
  if (labelClose === undefined) return undefined;

  if (node.type === "definition") {
    const colon = slice.indexOf(":", labelClose + 1);
    if (colon < 0) return undefined;
    const span = destinationFrom(slice, colon + 1);
    return span === undefined
      ? undefined
      : { start: start + span.start, end: start + span.end };
  }

  if (slice[labelClose + 1] !== "(") return undefined;
  const span = destinationFrom(slice, labelClose + 2);
  return span === undefined
    ? undefined
    : { start: start + span.start, end: start + span.end };
}

/** Index of a query or fragment suffix outside Markdown escapes. */
function suffixStart(destination: string): number {
  for (let i = 0; i < destination.length; i += 1) {
    if (
      (destination[i] === "?" || destination[i] === "#") &&
      !isEscaped(destination, i)
    ) {
      return i;
    }
  }
  return destination.length;
}

/** Rebase raw destination bytes without normalizing or reserializing their syntax. */
function rebaseDestination(
  destination: string,
  sourcePath: string,
  outputPath: string,
): string {
  const sourceDir = posix.dirname(projectPath(sourcePath));
  const outputDir = posix.dirname(projectPath(outputPath));
  if (sourceDir === outputDir) return destination;

  const suffixAt = suffixStart(destination);
  const localPath = destination.slice(0, suffixAt);
  const suffix = destination.slice(suffixAt);
  const fromOutputToSource = posix.relative(outputDir, sourceDir);
  let rebased = posix.normalize(posix.join(fromOutputToSource, localPath));
  if (localPath.endsWith("/") && !rebased.endsWith("/")) {
    rebased += "/";
  }
  return `${rebased}${suffix}`;
}

/** Collect destination replacements from parser-recognized nodes only. */
function collectReplacements(
  source: string,
  node: MarkdownNode,
  sourcePath: string,
  outputPath: string,
  replacements: Replacement[],
): void {
  if (
    (node.type === "link" || node.type === "image" ||
      node.type === "definition") &&
    node.url !== undefined && isLocalFileDestination(node.url)
  ) {
    const span = destinationSpan(source, node);
    if (span !== undefined) {
      const destination = source.slice(span.start, span.end);
      const value = rebaseDestination(destination, sourcePath, outputPath);
      if (value !== destination) replacements.push({ ...span, value });
    }
  }
  for (const child of node.children ?? []) {
    collectReplacements(source, child, sourcePath, outputPath, replacements);
  }
}

/**
 * Preserve every local Markdown link's project target when source is emitted at
 * another project-relative path. Only parser-recognized destination bytes change;
 * all other source bytes are returned verbatim.
 */
export function rebaseMarkdownLinks(
  source: string,
  sourcePath: string,
  outputPath: string,
): string {
  if (
    posix.dirname(projectPath(sourcePath)) ===
      posix.dirname(projectPath(outputPath))
  ) {
    return source;
  }
  const root: MarkdownNode = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const replacements: Replacement[] = [];
  collectReplacements(source, root, sourcePath, outputPath, replacements);
  replacements.sort((a, b) => b.start - a.start);
  let output = source;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.value +
      output.slice(replacement.end);
  }
  return output;
}
