/** Product defaults for the package-owned site footer. */
import type { ComponentProps, ReactElement } from "react";
import { SiteFooter as PackageSiteFooter } from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";

type SiteFooterProps =
  & Omit<ComponentProps<typeof PackageSiteFooter>, "brand">
  & {
    readonly brand?: ComponentProps<typeof PackageSiteFooter>["brand"];
  };

/** Keep shared branding in one adapter while pages supply their destinations. */
export function SiteFooter(
  { brand = "discern", ...props }: SiteFooterProps,
): ReactElement {
  return (
    <PackageSiteFooter
      brand={brand}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      {...props}
    />
  );
}
