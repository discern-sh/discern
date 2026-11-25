/** Homepage shell: the shared site chrome around the wall island. */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import {
  providerBrandSilhouette,
  PROVIDERS,
} from "../../../src/lib/providers.ts";
import { DISCERN_VERSION } from "../../../src/lib/version.ts";
import { AGENT_NAMES } from "../../../src/shared/agent_catalogue.ts";
import {
  DISCERN_CATEGORY_LINE,
  DISCERN_MARK,
  LANDING_DESCRIPTION,
  LANDING_HEADLINE,
  LANDING_TITLE,
} from "../../brand.ts";
import { loadDocsSite } from "../../docs.tsx";
import { type BuiltAssets, WALL_STYLESHEETS } from "../../wall/assets.ts";
import { WALL_DECK } from "../../wall/deck.ts";
import {
  encodeWallProps,
  type LinkLabels,
  linkRoute,
  WALL_HOST_ID,
  WALL_PROPS_ATTRIBUTE,
  type WallAgent,
  type WallPageProps,
} from "../../wall/host.ts";
import { WallPage } from "../../wall/WallPage.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";
import { renderDocument } from "../Document.tsx";
import { MarketingLayout } from "../layouts/MarketingLayout.tsx";

/**
 * Hydration needs the island's markup byte for byte as React rendered it, and
 * the build formats every generated page. This directive tells the formatter
 * to leave the element after it alone.
 */
const FORMATTER_HOLD = "<!-- deno-fmt-ignore -->";

/**
 * The manual as the site publishes it, read once as this module loads. The
 * wall's cards link into it, and only the server can read it.
 */
const MANUAL = await loadDocsSite();

/**
 * The title of every manual page the deck links to, by route, for the opened
 * card to name its link by. A card that links to a page the manual does not
 * publish stops the render, so no page ships with a link it cannot name.
 */
function manualLinkLabels(): LinkLabels {
  const titles = new Map(
    [MANUAL.landing, ...MANUAL.pages].map((
      page,
    ) => [page.route, page.entry.title]),
  );
  const labels: Record<string, string> = {};
  for (const card of WALL_DECK) {
    if (card.href === undefined) continue;
    const route = linkRoute(card.href);
    const title = titles.get(route);
    if (title === undefined) {
      throw new Error(
        `the wall's "${card.id}" card links to ${card.href}, a page the manual does not publish`,
      );
    }
    labels[route] = title;
  }
  return labels;
}

/**
 * Every coding agent discern supports, in the provider registry's order, each
 * with its name and its mark as a one-color silhouette. The registry is the
 * list: a provider added to it joins the pool's row with no change here.
 */
function supportedAgents(): WallAgent[] {
  return AGENT_NAMES.map((name) => {
    const { label, brand } = PROVIDERS[name];
    return { label, mark: providerBrandSilhouette(brand).path };
  });
}

/**
 * Render the homepage with shared navigation around the wall. The page loads
 * the island only when the build names its bundle; without one the page is the
 * same complete document, minus the script that makes the wall interactive.
 */
export function renderLanding(built: BuiltAssets = {}): string {
  const island = built.wallIsland;
  return renderDocument({
    source: "site/ui/pages/HomePage.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    appearance: "mono",
    theme: "dark",
    styles: ["fonts.css", "discern.css", ...WALL_STYLESHEETS],
    scripts: island === undefined ? ["discern.js"] : ["discern.js", island],
    children: <HomePage />,
  });
}

/**
 * The wall as hydratable markup inside its host element. The page around it is
 * static, so only this subtree is rendered for hydration, and the host carries
 * the props it was rendered with for the island to read back.
 */
function wallIslandMarkup(): string {
  const props: WallPageProps = {
    mark: DISCERN_MARK,
    version: DISCERN_VERSION,
    headline: LANDING_HEADLINE,
    categoryLine: DISCERN_CATEGORY_LINE,
    linkLabels: manualLinkLabels(),
    agents: supportedAgents(),
  };
  return renderToString(
    <div
      id={WALL_HOST_ID}
      className="wall-host"
      {...{ [WALL_PROPS_ATTRIBUTE]: encodeWallProps(props) }}
    >
      <WallPage {...props} />
    </div>,
  );
}

/** Homepage content composed through the shared marketing layout. */
function HomePage(): ReactElement {
  return (
    <MarketingLayout currentPath="/">
      <HtmlFragment
        className="wall-frame"
        html={`${FORMATTER_HOLD}${wallIslandMarkup()}`}
      />
    </MarketingLayout>
  );
}
