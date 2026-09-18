/** Discern's site-wide browser Appearance and the roots that activate it. */

import {
  ACCENT_ATTRIBUTE,
  ACCENT_NONE_VALUE,
  type AppearanceProjection,
} from "discern-design-system";
import { DISCERN_ACCENT_HUE } from "../src/shared/brand.ts";

/**
 * Appearance axes the site holds away from the package defaults, keyed by
 * their public custom property. Darkness is never listed: the package's theme
 * contract moves it from the theme toggle.
 */
export const SITE_APPEARANCE_AXES = {
  "--discern-ink-tint": 1,
  "--discern-ink-tint-hue": DISCERN_ACCENT_HUE,
} as const satisfies Readonly<Record<`--discern-${string}`, number>>;

export const SITE_APPEARANCE = {
  appearanceScopes: true,
  accentHue: DISCERN_ACCENT_HUE,
  accentHueProperty: "--discern-accent-hue",
  axes: SITE_APPEARANCE_AXES,
  rootAttributes: {
    "data-discern-root": "",
    [ACCENT_ATTRIBUTE]: "",
  },
} as const;

/** The custom properties a document root declares for one projection. */
export function siteAppearanceDeclarations(
  projection: AppearanceProjection,
): Record<`--discern-${string}`, number> {
  return projection === "accent"
    ? {
      ...SITE_APPEARANCE.axes,
      [SITE_APPEARANCE.accentHueProperty]: SITE_APPEARANCE.accentHue,
    }
    : { ...SITE_APPEARANCE.axes };
}

/** Render the shared Appearance contract on a document root. */
export function siteAppearanceRootAttributes(
  projection: AppearanceProjection = "accent",
): string {
  const attributes = Object.keys(SITE_APPEARANCE.rootAttributes).map((name) =>
    name === ACCENT_ATTRIBUTE && projection === "mono"
      ? `${name}="${ACCENT_NONE_VALUE}"`
      : name
  ).join(" ");
  const style = Object.entries(siteAppearanceDeclarations(projection)).map((
    [property, value],
  ) => `${property}: ${value}`).join("; ");
  return `${attributes} style="${style}"`;
}
