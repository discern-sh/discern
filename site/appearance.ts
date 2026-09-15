/** Discern's site-wide browser Appearance and the roots that activate it. */

import {
  ACCENT_ATTRIBUTE,
  ACCENT_NONE_VALUE,
  type AppearanceProjection,
} from "discern-design-system";
import { DISCERN_ACCENT_HUE } from "../src/shared/brand.ts";

export const SITE_APPEARANCE = {
  appearanceScopes: true,
  accentHue: DISCERN_ACCENT_HUE,
  accentHueProperty: "--discern-accent-hue",
  rootAttributes: {
    "data-discern-root": "",
    [ACCENT_ATTRIBUTE]: "",
  },
} as const;

/** Render the shared Appearance contract on a document root. */
export function siteAppearanceRootAttributes(
  projection: AppearanceProjection = "accent",
): string {
  const attributes = Object.keys(SITE_APPEARANCE.rootAttributes).map((name) =>
    name === ACCENT_ATTRIBUTE && projection === "mono"
      ? `${name}="${ACCENT_NONE_VALUE}"`
      : name
  ).join(" ");
  if (projection === "mono") return attributes;
  return `${attributes} style="${SITE_APPEARANCE.accentHueProperty}: ${SITE_APPEARANCE.accentHue}"`;
}
