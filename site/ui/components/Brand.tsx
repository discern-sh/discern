/** Discern's canonical design-system lockup for public site chrome. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brand } from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";

export interface DiscernBrandProps {
  /** Optional context set beneath the product name, such as a publication. */
  readonly tagline?: ReactNode;
}

/** Pair the canonical decorative mark with the monospaced product name. */
export function DiscernBrand({ tagline }: DiscernBrandProps) {
  return (
    <Brand
      mark={DISCERN_MARK}
      name="discern"
      size="md"
      tagline={tagline}
      typeface="mono"
    />
  );
}

/** Render the shared, tagline-free lockup for build-emitted static fragments. */
export function renderDiscernBrand(): string {
  return renderToStaticMarkup(<DiscernBrand />);
}
