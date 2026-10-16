/**
 * Where each page's social card lives. Every HTML route owns exactly one
 * card, addressed by mirroring the route under one prefix, so metadata,
 * dispatch, and tests derive the same URL without a second list of pages.
 * This module stays free of the renderer so metadata can import it cheaply.
 */

/** The public prefix that every card address shares. */
export const SOCIAL_CARD_PREFIX = "/og";

/** The size every major link-preview surface accepts for a large card. */
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

const EXTENSION = ".png";
const ROOT_SEGMENT = "/index";

/** The card address for one HTML route: `/docs/x` → `/og/docs/x.png`. */
export function socialCardPath(route: string): string {
  return `${SOCIAL_CARD_PREFIX}${
    route === "/" ? ROOT_SEGMENT : route
  }${EXTENSION}`;
}

/** The HTML route a card address belongs to, or `undefined` for any other path. */
export function socialCardRoute(path: string): string | undefined {
  if (
    !path.startsWith(`${SOCIAL_CARD_PREFIX}/`) || !path.endsWith(EXTENSION)
  ) {
    return undefined;
  }
  const route = path.slice(SOCIAL_CARD_PREFIX.length, -EXTENSION.length);
  if (route === ROOT_SEGMENT) return "/";
  return route.length > 1 && socialCardPath(route) === path ? route : undefined;
}

/**
 * Card images published before generated cards existed. Links shared since
 * then can still re-fetch them, so each answers with a redirect to the card
 * that replaced it.
 */
export const RETIRED_SOCIAL_CARD_ASSETS: Readonly<Record<string, string>> = {
  "/assets/og-card.png": socialCardPath("/"),
  "/assets/agents-og.png": socialCardPath("/"),
};
