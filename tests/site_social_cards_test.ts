/** Every page's social card: its address, its complete text, and the image served for it. */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApproachBackdrop } from "discern-design-system/react";
import { pngSize } from "../scripts/site_smoke.ts";
import {
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
} from "../site/brand.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { loadReleaseCatalogue } from "../site/releases/catalogue.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";
import {
  RETIRED_SOCIAL_CARD_ASSETS,
  SOCIAL_CARD_SIZE,
  socialCardPath,
  socialCardRoute,
} from "../site/social/address.ts";
import {
  APPROACH_RING_RATIO,
  drawSocialCard,
  setDocumentText,
} from "../site/social/draw.ts";
import { type SocialCard, socialCardFor } from "../site/social/model.ts";
import { socialCardTypesetter } from "../site/social/render.ts";
import { MissingGlyphError } from "../site/social/typeset.ts";

const ORIGIN = "https://discern.sh";

/** Every live route's card, built from the same sources the handler uses. */
async function liveCards(): Promise<SocialCard[]> {
  const site = await loadDocsSite();
  const releases = await loadReleaseCatalogue();
  return liveHtmlRoutes(site).map((route) => {
    const card = socialCardFor(route, { site, releases });
    assert(card !== undefined, `${route} has a social card`);
    return card;
  });
}

Deno.test("every card address round-trips to its route and nothing else parses as one", async () => {
  const site = await loadDocsSite();
  for (const route of liveHtmlRoutes(site)) {
    assertEquals(socialCardRoute(socialCardPath(route)), route, route);
  }
  for (
    const path of [
      "/og",
      "/og/",
      "/og/.png",
      "/og/docs",
      "/og/docs.jpg",
      "/assets/og/index.png",
      "/docs/understand/proof.png",
    ]
  ) {
    assertEquals(socialCardRoute(path), undefined, path);
  }
});

Deno.test("every marketing page, published or not, has card copy", async () => {
  const site = await loadDocsSite();
  for (const page of MARKETING_PAGES) {
    const card = socialCardFor(page.route, { site, releases: [] });
    assertEquals(card?.kind, "statement", page.route);
  }
});

Deno.test("every live page's card sets its whole title with glyphs the design system can draw", async () => {
  const type = await socialCardTypesetter();
  // Setting text fails on any character no face or drawn glyph covers.
  for (const card of await liveCards()) {
    if (card.kind === "document") {
      const text = setDocumentText(card, type);
      assert(!text.title.truncated, `${card.route} title is set in full`);
    } else {
      const svg = drawSocialCard(card, type);
      assertStringIncludes(svg, `d="${DISCERN_MARK_FILLED_PATH}"`, card.route);
      assertStringIncludes(svg, `d="${DISCERN_MARK_OUTLINE_PATH}"`, card.route);
    }
  }
});

Deno.test("a character no face or drawing covers fails loudly instead of drawing a blank", async () => {
  const type = await socialCardTypesetter();
  assertThrows(
    () => type.shape("snow ☃", { face: "serif", weight: 400, size: 20 }),
    MissingGlyphError,
    "U+2603",
  );
});

Deno.test("cards use the homepage backdrop's ring ratio", () => {
  const markup = renderToStaticMarkup(createElement(ApproachBackdrop));
  const radii = [
    ...markup.matchAll(
      /class="discern-approach-backdrop__ring" d="M[\d.-]+,([\d.-]+) L[\d.-]+,([\d.-]+)/g,
    ),
  ].map((match) => (Number(match[2]) - Number(match[1])) * 2 / 3)
    .sort((a, b) => a - b);
  assert(radii.length > 2, "the backdrop renders its rings");
  for (let index = 1; index < radii.length; index++) {
    assertAlmostEquals(
      (radii[index] ?? 0) / (radii[index - 1] ?? 1),
      APPROACH_RING_RATIO,
      0.005,
    );
  }
});

// The process smoke fetches one card of each kind over a real socket; this
// focused case pins the response headers it does not check.
Deno.test("the handler serves a card as a cacheable 1200×630 PNG", async () => {
  const response = await handler(
    new Request(`${ORIGIN}${socialCardPath("/")}`),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "image/png");
  assertEquals(response.headers.get("cache-control"), "public, max-age=3600");
  assertEquals(
    pngSize(new Uint8Array(await response.arrayBuffer())),
    SOCIAL_CARD_SIZE,
  );
});

Deno.test("only live routes have cards, and retired card images redirect to the homepage card", async () => {
  for (const path of ["/og/agents.png", "/og/docs/no-such-page.png"]) {
    const response = await handler(
      new Request(`${ORIGIN}${path}`, { headers: { accept: "text/html" } }),
    );
    assertEquals(response.status, 404, path);
    await response.body?.cancel();
  }
  for (const [retired, card] of Object.entries(RETIRED_SOCIAL_CARD_ASSETS)) {
    const response = await handler(new Request(`${ORIGIN}${retired}`));
    assertEquals(response.status, 308, retired);
    assertEquals(response.headers.get("location"), `${ORIGIN}${card}`);
  }
});
