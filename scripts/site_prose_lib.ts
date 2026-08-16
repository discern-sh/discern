/**
 * One deterministic public-site prose projection shared by the Vale gate and
 * both site Standards. The canonical marketing-page registry supplies every
 * route, renderer, source path, and register; markup, attributes, code, and
 * duplicate rendered strings never enter the measured bytes.
 */

import { dirname, join, resolve } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderMarketingPage } from "../site/build.ts";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import {
  countProse,
  fleschKincaidGrade,
  type ProseCounts,
} from "./plain_reading_grade_lib.ts";
import { proseWordCount } from "./prose_lib.ts";

const BLOCK_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "dt",
  "dd",
  "li",
  "blockquote",
  "figcaption",
  "th",
  "td",
  "a",
  "button",
  ".discern-site-footer__description",
].join(",");
const CONTAINER_BLOCK_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "dt",
  "dd",
  "li",
  "blockquote",
  "figcaption",
  "th",
  "td",
].join(",");

/** One registry-owned page after markup-free projection. */
export interface ProjectedSiteProsePage {
  route: string;
  source: string;
  stagePath: string;
  blocks: string[];
  prose: string;
}

/** The temporary corpus Vale receives, plus exact measurement metadata. */
export interface StagedSiteProse {
  dir: string;
  words: number;
  pages: ProjectedSiteProsePage[];
  sources: ReadonlyMap<string, string>;
}

/** Collapse browser-rendered whitespace and restore punctuation adjacency. */
function normalizeRenderedText(value: string): string {
  return value.replace(/[\s\u00a0]+/g, " ")
    .replace(/\s+([,.;:!?%)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+(['’][\p{L}]+)/gu, "$1")
    .trim();
}

/** Read text with element boundaries represented as visual spacing. */
function readableText(element: Element | null): string {
  if (element === null) return "";
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const segments: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = node.nodeValue?.trim();
    if (value) segments.push(value);
  }
  return normalizeRenderedText(segments.join(" "));
}

/** Whether a selected element is represented by a more precise child block. */
function ownsDistinctBlock(element: Element): boolean {
  if (element.matches("a,button")) {
    return element.closest(CONTAINER_BLOCK_SELECTOR) === null;
  }
  return element.querySelector(CONTAINER_BLOCK_SELECTOR) === null;
}

/**
 * Project the authored prose a visitor can read from one rendered page.
 * Script-enhanced controls are included even when their no-JavaScript state is
 * hidden; repeated prompts and CTA labels are measured once as authored copy.
 */
export function visibleSiteProse(html: string): {
  blocks: string[];
  prose: string;
} {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  for (const control of document.querySelectorAll("[data-copy-prompt]")) {
    control.removeAttribute("hidden");
  }
  for (
    const excluded of document.querySelectorAll(
      "script,style,template,noscript,svg,code,pre,[aria-hidden='true'],[data-site-prose-exclude]",
    )
  ) {
    excluded.remove();
  }

  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const element of document.body.querySelectorAll(BLOCK_SELECTOR)) {
    if (element.closest("[hidden]") !== null || !ownsDistinctBlock(element)) {
      continue;
    }
    const text = readableText(element);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    blocks.push(text);
  }
  for (
    const metadata of [
      readableText(document.querySelector("title")),
      normalizeRenderedText(
        document.querySelector('meta[name="description"]')?.getAttribute(
          "content",
        ) ?? "",
      ),
    ]
  ) {
    if (metadata === "" || seen.has(metadata)) continue;
    seen.add(metadata);
    blocks.push(metadata);
  }
  dom.window.close();
  return { blocks, prose: `${blocks.join("\n\n")}\n` };
}

/** Convert a route to its stable Markdown path within the staged brand tier. */
function routeStagePath(route: string): string {
  const leaf = route === "/" ? "index" : route.replace(/^\/+|\/+$/g, "");
  return `_internal/brand/${leaf}.md`;
}

/** Project every prose-guarded page from the marketing registry in route order. */
export function projectSiteProse(): ProjectedSiteProsePage[] {
  return MARKETING_PAGES
    .filter((page) => page.prose === "guarded")
    .map((page) => {
      const projected = visibleSiteProse(renderMarketingPage(page.route));
      return {
        route: page.route,
        source: page.source,
        stagePath: routeStagePath(page.route),
        ...projected,
      };
    });
}

/** Stage the exact corpus shared by the site prose check and measurements. */
export async function stageSiteProse(
  repoRoot: string,
): Promise<StagedSiteProse> {
  const dir = await Deno.makeTempDir({ prefix: "discern-site-prose-" });
  const pages = projectSiteProse();
  const sources = new Map<string, string>();
  let words = 0;
  for (const page of pages) {
    const destination = join(dir, page.stagePath);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.writeTextFile(destination, page.prose);
    sources.set(resolve(destination), resolve(repoRoot, page.source));
    words += proseWordCount(page.prose);
  }
  return { dir, words, pages, sources };
}

/** Map a staged Vale path back to the registry-owned authored source. */
export function siteProseSource(
  path: string,
  stage: StagedSiteProse,
): string {
  return stage.sources.get(resolve(path)) ?? path;
}

/** Flesch–Kincaid grade over the same deduplicated blocks Vale receives. */
export function siteProseReadingGrade(
  pages: readonly ProjectedSiteProsePage[],
): number {
  const total: ProseCounts = { sentences: 0, words: 0, syllables: 0 };
  for (const block of pages.flatMap(({ blocks }) => blocks)) {
    const counts = countProse(block);
    total.sentences += counts.sentences;
    total.words += counts.words;
    total.syllables += counts.syllables;
  }
  return fleschKincaidGrade(total);
}
