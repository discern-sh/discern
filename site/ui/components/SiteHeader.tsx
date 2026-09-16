/** One public header, rendered through the published design-system adapter. */
import type { ReactElement } from "react";
import { SiteHeader as PackageSiteHeader } from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";
import { siteNavigation } from "../../navigation.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** Pages share destinations and controls rather than supplying navigation slots. */
export function SiteHeader(
  { currentPath }: { readonly currentPath: string },
): ReactElement {
  return (
    <PackageSiteHeader
      brand="discern"
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      variant="campaign"
      navLabel="Site"
      navItems={siteNavigation(currentPath)}
      actions={<ThemeToggle />}
    />
  );
}
