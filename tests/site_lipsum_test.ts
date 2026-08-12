/** Structural and copy-neutrality checks for the homepage design-review twin. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { LIPSUM_DESCRIPTION, LIPSUM_TITLE } from "../site/brand.ts";
import { renderLanding } from "../site/page-src/landing.tsx";
import { renderLipsum } from "../site/page-src/lipsum.ts";
import { handler } from "../site/serve.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

/** Remove text and review-only attributes before comparing page structure. */
function structuralMarkup(document: Document): string {
  for (const section of document.querySelectorAll("[data-lipsum-section]")) {
    section.removeAttribute("data-lipsum-section");
  }
  const walker = document.createTreeWalker(document.body, 4);
  const textNodes: Node[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) node.textContent = "";
  return document.body.innerHTML;
}

Deno.test("the lipsum page is the homepage structure with copy-neutral text", () => {
  const landing = new JSDOM(renderLanding());
  const lipsum = new JSDOM(renderLipsum());
  const sourceLength = landing.window.document.body.textContent?.length ?? 0;
  const fillerLength = lipsum.window.document.body.textContent?.length ?? 0;
  assertEquals(
    structuralMarkup(lipsum.window.document),
    structuralMarkup(landing.window.document),
  );

  assert(fillerLength / sourceLength > 0.9);
  assert(fillerLength / sourceLength < 1.1);

  landing.window.close();
  lipsum.window.close();
});

Deno.test("all ten major lipsum sections carry visible review numbers", () => {
  const dom = new JSDOM(renderLipsum());
  const sections = [...dom.window.document.querySelectorAll("main > section")];
  assertEquals(sections.length, 10);
  for (const [index, section] of sections.entries()) {
    const number = index + 1;
    assertEquals(section.getAttribute("data-lipsum-section"), String(number));
    const eyebrow = section.matches(".landing-hero")
      ? section.querySelector(".landing-hero__signature")
      : section.querySelector(
        ".landing-section-heading__kicker .discern-kicker__text",
      );
    const eyebrowText = eyebrow?.textContent?.trim() ?? "";
    const hasNumber = section.matches(".landing-hero")
      ? eyebrowText.includes(`(${number}) `)
      : eyebrowText.startsWith(`(${number}) `);
    assert(hasNumber, `section ${number} has a numbered eyebrow`);
  }
  dom.window.close();
});

Deno.test("the lipsum route removes substantive homepage meaning", async () => {
  const response = await handler(
    new Request("https://discern.sh/lipsum", { headers: BROWSER }),
  );
  assertEquals(response.status, 200);
  const html = await response.text();
  assertStringIncludes(html, `<title>${LIPSUM_TITLE}</title>`);
  assertStringIncludes(html, `content="${LIPSUM_DESCRIPTION}"`);
  assertStringIncludes(html, "Lorem");
  assertStringIncludes(html, "discern");
  for (
    const meaningful of [
      "A bolder way to build",
      "Coding agents can take on substantial work",
      "More capability should widen your ambition",
      "Turn a backlog into organized work",
      "Know what the evidence covers",
      "Software worth putting your name to",
    ]
  ) {
    assertEquals(html.includes(meaningful), false, meaningful);
  }
});
