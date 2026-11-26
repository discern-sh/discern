/** One public header, rendered through the published design-system adapter. */
import type { ReactElement } from "react";
import { SiteHeader as PackageSiteHeader } from "discern-design-system/react";
import { DISCERN_VERSION } from "../../../src/lib/version.ts";
import { DISCERN_MARK } from "../../brand.ts";
import { siteNavigation } from "../../navigation.ts";
import { useThemeToggle } from "./ThemeToggle.tsx";

/**
 * The stylesheet for the parts this header places in the package header's
 * slots. Every page that renders the header loads it.
 */
export const SITE_HEADER_STYLESHEET = "site-header.css";

/**
 * Pages share destinations and controls rather than supplying navigation
 * slots. The released version sits beside the product name, inside the link
 * home.
 */
export function SiteHeader(
  { currentPath }: { readonly currentPath: string },
): ReactElement {
  const themeToggle = useThemeToggle();
  return (
    <PackageSiteHeader
      brand={
        <>
          discern{" "}
          <span className="site-header-version">{`v${DISCERN_VERSION}`}</span>
        </>
      }
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      variant="campaign"
      navLabel="Site"
      navItems={siteNavigation(currentPath)}
      actions={themeToggle}
    />
  );
}
