/** One public footer, rendered through the published design-system adapter. */
import type { ReactElement } from "react";
import { SiteFooter as PackageSiteFooter } from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";
import { SITE_FOOTER_GROUPS } from "../../navigation.ts";

/** Keep navigation, attribution, and legal destinations consistent across pages. */
export function SiteFooter(): ReactElement {
  return (
    <PackageSiteFooter
      brand="discern"
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      description="The details are in the manual."
      groups={SITE_FOOTER_GROUPS}
      legal={<a href="/docs/reference/licenses">Licenses</a>}
      meta="© 2026 Jack Webb-Heller"
    />
  );
}
