/** Product defaults for the package-owned site header. */
import type { ComponentProps, ReactElement } from "react";
import { SiteHeader as PackageSiteHeader } from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";

type SiteHeaderProps =
  & Omit<ComponentProps<typeof PackageSiteHeader>, "brand">
  & {
    readonly brand?: ComponentProps<typeof PackageSiteHeader>["brand"];
  };

/** Pass component anatomy and accessibility through the published adapter. */
export function SiteHeader(
  { brand = "discern", ...props }: SiteHeaderProps,
): ReactElement {
  return (
    <PackageSiteHeader
      brand={brand}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      variant="campaign"
      {...props}
    />
  );
}
