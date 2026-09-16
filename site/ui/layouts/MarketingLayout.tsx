/** Shared public navigation and landmarks around page-owned content. */
import type { ReactElement, ReactNode } from "react";
import { SkipLink } from "discern-design-system/react";
import { SiteHeader } from "../components/SiteHeader.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";

interface MarketingLayoutProps {
  /** The route being rendered, so the header can state where the reader is. */
  readonly currentPath: string;
  readonly children: ReactNode;
  readonly mainClassName?: string;
}

/** A new page inherits the same header, footer, and working skip destination. */
export function MarketingLayout(
  { currentPath, children, mainClassName }: MarketingLayoutProps,
): ReactElement {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <SiteHeader currentPath={currentPath} />
      <main id="main" className={mainClassName}>{children}</main>
      <SiteFooter />
    </>
  );
}
