/** Shared public navigation and landmarks around page-owned content. */
import type { ReactElement, ReactNode } from "react";
import { SkipLink } from "discern-design-system/react";
import { SiteHeader } from "../components/SiteHeader.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";

interface MarketingLayoutProps {
  readonly children: ReactNode;
  readonly mainClassName?: string;
}

/** A new page inherits the same header, footer, and working skip destination. */
export function MarketingLayout(
  { children, mainClassName }: MarketingLayoutProps,
): ReactElement {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <SiteHeader />
      <main id="main" className={mainClassName}>{children}</main>
      <SiteFooter />
    </>
  );
}
