/** Homepage shell: the shared site chrome around the wall island. */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { DISCERN_VERSION } from "../../../src/lib/version.ts";
import {
  DISCERN_CATEGORY_LINE,
  DISCERN_MARK,
  LANDING_DESCRIPTION,
  LANDING_HEADLINE,
  LANDING_TITLE,
} from "../../brand.ts";
import { type BuiltAssets, WALL_STYLESHEETS } from "../../wall/assets.ts";
import {
  encodeWallProps,
  WALL_HOST_ID,
  WALL_PROPS_ATTRIBUTE,
} from "../../wall/host.ts";
import { WallPage, type WallPageProps } from "../../wall/WallPage.tsx";
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
