/**
 * Copy-neutral design-review twin of the homepage.
 *
 * The archived full landing renderer remains the one structural authority.
 * This module changes only its visible words and adds review numbers to the
 * top-level sections, so the two routes cannot acquire different layouts by
 * accident.
 */

import { LIPSUM_DESCRIPTION, LIPSUM_TITLE } from "../brand.ts";
import { renderOldLanding } from "./landing.tsx";

const LOREM_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "ut",
  "et",
  "eiusmod",
  "tempor",
  "incididunt",
  "labore",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "ad",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "proident",
  "non",
  "qui",
  "sunt",
  "culpa",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum",
] as const;

const PRESERVED_WORDS = new Set(["discern", "github"]);
const WORD = /\p{L}+(?:[-'’]\p{L}+)*/gu;
const HAS_WORD = /\p{L}/u;
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface OpenElement {
  readonly name: string;
  readonly section?: number;
}

/** Choose a deterministic filler word whose width approximates the source. */
function nearestLoremWord(length: number, offset: number): string {
  let distance = Number.POSITIVE_INFINITY;
  const candidates: string[] = [];
  for (const word of LOREM_WORDS) {
    const nextDistance = Math.abs(word.length - length);
    if (nextDistance < distance) {
      distance = nextDistance;
      candidates.length = 0;
      candidates.push(word);
    } else if (nextDistance === distance) {
      candidates.push(word);
    }
  }
  return candidates[offset % candidates.length] ?? "lorem";
}

/** Preserve the original token's coarse capitalization without its meaning. */
function matchCase(source: string, filler: string): string {
  if (source === source.toUpperCase()) return filler.toUpperCase();
  const first = source[0];
  return first !== undefined && first === first.toUpperCase()
    ? `${filler[0]?.toUpperCase() ?? ""}${filler.slice(1)}`
    : filler;
}

/** Replace each visible word while preserving spacing, punctuation, and scale. */
function neutralizeText(source: string, start: number): string {
  let offset = start;
  return source.replace(WORD, (word) => {
    if (PRESERVED_WORDS.has(word.toLowerCase())) return word;
    const filler = nearestLoremWord(word.length, offset);
    offset += 1;
    return matchCase(word, filler);
  });
}

/** Extract the lower-case tag name from one opening or closing HTML token. */
function tagName(token: string, closing: boolean): string | undefined {
  const expression = closing ? /^<\/([a-z][\w-]*)/i : /^<([a-z][\w-]*)/i;
  return expression.exec(token)?.[1]?.toLowerCase();
}

/** Add one generated data attribute to a non-void opening tag. */
function numberSectionTag(token: string, number: number): string {
  return token.replace(/>$/, ` data-lipsum-section="${number}">`);
}

/**
 * Replace body text while tracking enough HTML structure to number only
 * sections that are direct children of main.
 */
function neutralizeBody(body: string): string {
  const stack: OpenElement[] = [];
  const numbered = new Set<number>();
  let sectionCount = 0;
  let activeSection: number | undefined;
  let pendingNumber: number | undefined;
  let textOffset = 0;
  const output: string[] = [];

  for (const token of body.split(/(<[^>]+>)/g)) {
    if (token === "") continue;
    if (!token.startsWith("<")) {
      let text = neutralizeText(token, textOffset);
      textOffset += 1;
      if (pendingNumber !== undefined && HAS_WORD.test(token)) {
        text = `(${pendingNumber}) ${text}`;
        numbered.add(pendingNumber);
        pendingNumber = undefined;
      }
      output.push(text);
      continue;
    }

    const closing = token.startsWith("</");
    const name = tagName(token, closing);
    if (name === undefined || token.startsWith("<!")) {
      output.push(token);
      continue;
    }

    if (closing) {
      const element = stack.pop();
      if (element?.section !== undefined) activeSection = undefined;
      output.push(token);
      continue;
    }

    const parent = stack.at(-1)?.name;
    let section: number | undefined;
    let renderedToken = token;
    if (name === "section" && parent === "main") {
      sectionCount += 1;
      section = sectionCount;
      activeSection = section;
      renderedToken = numberSectionTag(token, section);
    }

    const isEyebrow = token.includes('class="landing-hero__signature"') ||
      token.includes('class="discern-kicker__text"');
    if (
      activeSection !== undefined &&
      !numbered.has(activeSection) &&
      isEyebrow
    ) {
      pendingNumber = activeSection;
    }

    if (!token.endsWith("/>") && !VOID_ELEMENTS.has(name)) {
      stack.push(section === undefined ? { name } : { name, section });
    }
    output.push(renderedToken);
  }

  if (sectionCount !== 10 || numbered.size !== sectionCount) {
    throw new Error(
      `lipsum numbered ${numbered.size} of ${sectionCount} major sections`,
    );
  }
  return output.join("");
}

/** Replace the body and metadata while retaining the homepage's exact shell. */
export function renderLipsum(): string {
  const landing = renderOldLanding();
  const bodyStart = landing.indexOf("<body>");
  const bodyEnd = landing.indexOf("</body>", bodyStart);
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error("lipsum source has no complete body");
  }

  const openEnd = bodyStart + "<body>".length;
  const body = neutralizeBody(landing.slice(openEnd, bodyEnd));
  const document = `${landing.slice(0, openEnd)}${body}${
    landing.slice(bodyEnd)
  }`
    .replace(
      "Generated by site/build.ts from site/page-src/landing.tsx",
      "Generated by site/build.ts from site/page-src/lipsum.ts",
    )
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${LIPSUM_TITLE}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${LIPSUM_DESCRIPTION}" />`,
    );
  return document;
}
