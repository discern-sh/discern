/** Static renderers for every registry-owned marketing route. */

import type { MarketingRoute } from "../marketing_pages.ts";
import { AGENTS_MARKDOWN } from "./agents-content.ts";
import { renderAgents } from "./agents.tsx";
import { renderLanding } from "./landing.tsx";

const MARKETING_RENDERERS = {
  "/": renderLanding,
  "/agents": renderAgents,
} as const satisfies Record<MarketingRoute, () => string>;

/** Render one canonical route from the exhaustive marketing renderer table. */
export function renderMarketingPage(route: MarketingRoute): string {
  return MARKETING_RENDERERS[route]();
}

const MARKETING_MARKDOWN_RENDERERS: Partial<
  Record<MarketingRoute, () => string>
> = {
  "/agents": () => AGENTS_MARKDOWN,
};

/** Render a route's authored Markdown companion when it declares one. */
export function renderMarketingMarkdown(
  route: MarketingRoute,
): string | undefined {
  return MARKETING_MARKDOWN_RENDERERS[route]?.();
}
