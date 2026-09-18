/** Static renderers for every registry-owned marketing route. */

import type { MarketingRoute } from "./marketing_pages.ts";
import { renderAgents } from "./ui/pages/AgentsPage.tsx";
import { renderLanding } from "./ui/pages/HomePage.tsx";

const MARKETING_RENDERERS = {
  "/": renderLanding,
  "/agents": renderAgents,
} as const satisfies Record<MarketingRoute, () => string>;

/** Render one canonical route from the exhaustive marketing renderer table. */
export function renderMarketingPage(route: MarketingRoute): string {
  return MARKETING_RENDERERS[route]();
}
