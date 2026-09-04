/** Discern's site-wide browser Appearance and the roots that activate it. */

import { DISCERN_ACCENT_HUE } from "../src/shared/brand.ts";

export const SITE_APPEARANCE = {
  appearanceScopes: true,
  accentHue: DISCERN_ACCENT_HUE,
  accentHueProperty: "--discern-accent-hue",
  rootAttributes: {
    "data-discern-root": "",
    "data-discern-accent": "",
  },
} as const;

/** Render the shared Appearance contract on a document root. */
export function siteAppearanceRootAttributes(): string {
  const attributes = Object.keys(SITE_APPEARANCE.rootAttributes).join(" ");
  return `${attributes} style="${SITE_APPEARANCE.accentHueProperty}: ${SITE_APPEARANCE.accentHue}"`;
}
