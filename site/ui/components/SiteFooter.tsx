/** One public footer, rendered through the published design-system adapter. */
import type { ReactElement } from "react";
import { SiteFooter as PackageSiteFooter } from "discern-design-system/react";
import { DISCERN_AUTHOR_URL, DISCERN_MARK } from "../../brand.ts";
import { SITE_FOOTER_GROUPS } from "../../navigation.ts";
import { DISCERN_REPOSITORY_URL } from "../../../src/shared/product_identity.ts";

/** Keep navigation, attribution, and legal destinations consistent across pages. */
export function SiteFooter(): ReactElement {
  return (
    <PackageSiteFooter
      frame="wide"
      columns={SITE_FOOTER_GROUPS.length}
      brand="discern"
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      description="An engineering practice for agent-built software."
      groups={SITE_FOOTER_GROUPS}
      legal={
        <>
          <a href={DISCERN_REPOSITORY_URL} target="_blank" rel="noopener">
            GitHub
          </a>{" "}
          ·{" "}
          <a href="/docs/reference/licenses" target="_blank" rel="noopener">
            Licenses
          </a>
        </>
      }
      meta={
        <>
          © 2026{" "}
          <a href={DISCERN_AUTHOR_URL} target="_blank" rel="noopener">
            Jack Webb-Heller
          </a>
        </>
      }
    />
  );
}
