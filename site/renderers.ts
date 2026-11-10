/** Static renderers for every registry-owned marketing route. */

import type { MarketingRoute } from "./marketing_pages.ts";
import { renderAgents } from "./ui/pages/AgentsPage.tsx";
import { renderLanding } from "./ui/pages/HomePage.tsx";
import type { BuiltAssets } from "./wall/assets.ts";

const MARKETING_RENDERERS = {
  "/": renderLanding,
  "/agents": renderAgents,
} as const satisfies Record<MarketingRoute, (built: BuiltAssets) => string>;

/**
 * Render one canonical route from the exhaustive marketing renderer table.
 * The build passes the generated files a page links by name; every other
 * caller reads the page's content and omits them.
 */
export function renderMarketingPage(
  route: MarketingRoute,
  built: BuiltAssets = {},
): string {
  return MARKETING_RENDERERS[route](built);
}
