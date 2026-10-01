/**
 * What a documentation browser's links and actions may reach: one admitted
 * corpus path or heading, an absolute web page, or nothing. Link resolution
 * is pure and reads only the in-memory corpus; opening a page is the one
 * effect, shared by `discern docs` and the Desk's manual so both answer a
 * reader the same way.
 */

import { truncateText } from "../lib/text.ts";
import { terminalLine } from "../lib/terminal.ts";
import {
  browserOpenFailureMessage,
  type BrowserOpenResult,
  openInBrowser,
} from "../lib/open_browser.ts";
import type {
  MarkdownBrowserChoiceResult,
  MarkdownBrowserLinkResolution,
  MarkdownBrowserLinkResolverInput,
} from "../lib/terminal_interaction.ts";
import { DISCERN_DOCS_URL } from "../shared/brand.ts";

/** Typed picker values keep navigation actions distinct from real file paths. */
export type DocsBrowserChoice =
  | { readonly kind: "document"; readonly path: string }
  | { readonly kind: "promoted-document"; readonly path: string }
  | { readonly kind: "read-online" }
  | { readonly kind: "quit" };

/** Admit only absolute web URLs to the product's browser-opening effect. */
export function approvedDocsExternalUrl(
  destination: string,
): string | undefined {
  if (destination.trim() !== destination || !/^https?:/iu.test(destination)) {
    return undefined;
  }
  try {
    const parsed = new URL(destination);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? destination
      : undefined;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}

/** Bounded in-frame feedback for a destination outside the admitted corpus. */
function unresolvedDocsBrowserLink(
  destination: string,
): MarkdownBrowserLinkResolution {
  const visible = truncateText(terminalLine(destination), 36, "…");
  const target = visible === "" ? "This link" : `"${visible}"`;
  return {
    kind: "unresolved",
    message:
      `${target} is not in this documentation set. Choose a document from the contents.`,
  };
}

/** Decode one URL path or fragment component without admitting hidden controls. */
function decodedDocsLinkComponent(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return /[\p{Cc}\p{Cf}]/u.test(decoded) ? undefined : decoded;
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return undefined;
  }
}

/** Resolve a relative or corpus-root path without consulting the filesystem. */
function resolvedDocsCorpusPath(
  sourcePath: string,
  destination: string,
): string | undefined {
  const rootRelative = destination.startsWith("/");
  const relativeDestination = rootRelative ? destination.slice(1) : destination;
  if (
    relativeDestination === "" || relativeDestination.includes("\\") ||
    relativeDestination.includes("?")
  ) {
    return undefined;
  }
  const decoded = decodedDocsLinkComponent(relativeDestination);
  if (decoded === undefined || decoded.includes("\\")) return undefined;
  const directory = decoded.endsWith("/");
  const pathValue = directory ? decoded.slice(0, -1) : decoded;
  const destinationSegments = pathValue.split("/");
  if (destinationSegments.some((segment) => segment === "")) return undefined;
  const resolved = rootRelative ? [] : sourcePath.split("/").slice(0, -1);
  for (const segment of destinationSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const path = resolved.join("/");
  if (path.toLowerCase().endsWith(".md")) return path;
  const leaf = resolved.at(-1);
  return leaf !== undefined && !leaf.includes(".")
    ? `${path}/README.md`
    : undefined;
}

/**
 * Resolve one package-admitted Markdown destination against the in-memory
 * documentation corpus. Missing, private, unsafe, and non-document targets
 * remain inert; no filesystem probe can widen the admitted tree.
 */
export function resolveDocsBrowserLink(
  input: MarkdownBrowserLinkResolverInput,
): MarkdownBrowserLinkResolution {
  const approvedExternal = approvedDocsExternalUrl(input.destination);
  if (approvedExternal !== undefined) {
    return { kind: "external", destination: approvedExternal };
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(input.destination)) {
    return unresolvedDocsBrowserLink(input.destination);
  }
  const hash = input.destination.indexOf("#");
  const pathPart = hash < 0
    ? input.destination
    : input.destination.slice(0, hash);
  const fragmentPart = hash < 0 ? undefined : input.destination.slice(hash + 1);
  const decodedFragment = fragmentPart === undefined
    ? undefined
    : decodedDocsLinkComponent(fragmentPart);
  if (
    fragmentPart !== undefined &&
    (fragmentPart === "" || decodedFragment === undefined)
  ) {
    return unresolvedDocsBrowserLink(input.destination);
  }
  const fragment = fragmentPart === undefined ? undefined : `#${fragmentPart}`;
  if (pathPart === "") {
    return fragment === undefined
      ? unresolvedDocsBrowserLink(input.destination)
      : { kind: "fragment", fragment };
  }
  const path = resolvedDocsCorpusPath(input.sourcePath, pathPart);
  const document = path === undefined
    ? undefined
    : input.availableDocuments.find((candidate) => candidate.path === path);
  if (document === undefined) {
    return unresolvedDocsBrowserLink(input.destination);
  }
  return {
    kind: "document",
    documentId: document.id,
    ...(fragment === undefined ? {} : { fragment }),
  };
}

/**
 * Open the page a browser's action or external link names in the system
 * browser. Only the online docs and absolute HTTP and HTTPS links leave the
 * documentation; the answer is why nothing opened, if nothing did.
 */
export async function openDocsBrowserChoice(
  result: MarkdownBrowserChoiceResult<DocsBrowserChoice>,
  open: (url: string) => Promise<BrowserOpenResult> = openInBrowser,
): Promise<string | undefined> {
  if (result.kind === "action") {
    if (result.value.kind !== "read-online") {
      throw new TypeError("Documentation browser returned an unknown action.");
    }
    const opened = await open(DISCERN_DOCS_URL);
    return opened.status === "opened"
      ? undefined
      : browserOpenFailureMessage("the docs", DISCERN_DOCS_URL, opened);
  }
  const destination = approvedDocsExternalUrl(result.destination);
  if (destination === undefined) {
    const visible = truncateText(terminalLine(result.destination), 48, "…");
    return `discern didn't open "${visible}": only http:// and https:// links can leave the documentation browser.`;
  }
  const opened = await open(destination);
  return opened.status === "opened"
    ? undefined
    : browserOpenFailureMessage("the link", destination, opened);
}
