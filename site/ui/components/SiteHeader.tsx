/** One public header, rendered through the published design-system adapter. */
import type { ReactElement } from "react";
import {
  SiteHeader as PackageSiteHeader,
  type SiteHeaderNavItem,
} from "discern-design-system/react";
import { DISCERN_VERSION } from "../../../src/lib/version.ts";
import { DISCERN_MARK } from "../../brand.ts";
import { siteNavigation } from "../../navigation.ts";
import { useThemeToggle } from "./ThemeToggle.tsx";

/**
 * The stylesheet for the parts this header places in the package header's
 * slots. Every page that renders the header loads it.
 */
export const SITE_HEADER_STYLESHEET = "site-header.css";

/** The version beside the product name. */
const VERSION_CLASS = "site-header-version";

/**
 * Marks the version in a header that also holds the theme control. A narrow
 * room has less to spare there, so the stylesheet drops the version sooner.
 */
export const VERSION_BESIDE_CONTROL_CLASS =
  "site-header-version--beside-control";

/** What assistive technology calls the header's navigation. */
const NAV_LABEL = "Site";

/** How the package states a destination's relation to the page, as `aria-current`. */
const NAV_CURRENT = { page: "page", section: "true" } as const;

/**
 * The destinations again, as a short row for the header's actions slot. In a
 * narrow room the package header hides its own navigation and leaves the
 * route into it to an action. Two destinations fit beside the brand, so the
 * action is the links themselves, and the stylesheet shows them only there.
 */
function CompactNav(
  { label, items }: {
    readonly label: string;
    readonly items: readonly SiteHeaderNavItem[];
  },
): ReactElement {
  return (
    <nav className="site-header-compact" aria-label={label}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.current === undefined
            ? undefined
            : NAV_CURRENT[item.current]}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Pages share destinations and controls rather than supplying navigation
 * slots. The released version sits beside the product name, inside the link
 * home. A phone gets the brand and the destinations on one row.
 */
export function SiteHeader(
  { currentPath }: { readonly currentPath: string },
): ReactElement {
  const themeToggle = useThemeToggle();
  const destinations = siteNavigation(currentPath);
  return (
    <PackageSiteHeader
      brand={
        <>
          discern{" "}
          <span
            className={themeToggle === undefined
              ? VERSION_CLASS
              : `${VERSION_CLASS} ${VERSION_BESIDE_CONTROL_CLASS}`}
          >
            {`v${DISCERN_VERSION}`}
          </span>
        </>
      }
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      variant="campaign"
      navLabel={NAV_LABEL}
      navItems={destinations}
      collapseNavOnNarrow
      actions={
        <>
          <CompactNav label={NAV_LABEL} items={destinations} />
          {themeToggle}
        </>
      }
    />
  );
}
