/** Static renderers for every registry-owned marketing route. */

import type { MarketingRoute } from "../marketing_pages.ts";
import { renderAgents } from "./agents.tsx";
import { renderLanding } from "./landing.tsx";
import { renderTrust } from "./trust.tsx";

const MARKETING_RENDERERS = {
  "/": renderLanding,
  "/agents": renderAgents,
  "/trust": renderTrust,
} as const satisfies Record<MarketingRoute, () => string>;

/** Render one canonical route from the exhaustive marketing renderer table. */
export function renderMarketingPage(route: MarketingRoute): string {
  return MARKETING_RENDERERS[route]();
}
