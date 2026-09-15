/** Shared landmarks for public compositions; pages supply navigation and content. */
import type { ReactElement, ReactNode } from "react";
import { SkipLink } from "discern-design-system/react";

interface MarketingLayoutProps {
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
  readonly mainClassName?: string;
}

/** Keep one main landmark and a working skip destination on every composition. */
export function MarketingLayout(
  { header, footer, children, mainClassName }: MarketingLayoutProps,
): ReactElement {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      {header}
      <main id="main" className={mainClassName}>{children}</main>
      {footer}
    </>
  );
}
