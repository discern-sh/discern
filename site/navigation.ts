/** Shared navigation for the public React pages. */
import type {
  SiteHeaderNavCurrent,
  SiteHeaderNavItem,
} from "discern-design-system/react";
import {
  DISCERN_REPOSITORY_URL,
  RELEASE_ROUTES,
} from "../src/shared/product_identity.ts";

export const SITE_NAVIGATION = [
  { label: "Manual", href: "/docs" },
  { label: "Releases", href: RELEASE_ROUTES.html },
  { label: "Trust", href: "/trust" },
] as const;

export const SITE_FOOTER_GROUPS = [
  { title: "Explore discern", links: SITE_NAVIGATION },
  {
    title: "Project",
    links: [
      { label: "For coding agents", href: "/agents" },
      { label: "Project map", href: "/map" },
      { label: "Project decisions", href: "/docs/decisions" },
      { label: "Source repository", href: DISCERN_REPOSITORY_URL },
    ],
  },
] as const;

/**
 * Relate one destination to the page being read. Route matching belongs to the
 * site; the package renders the resulting state and styles it.
 */
export function navigationCurrent(
  href: string,
  path: string,
): SiteHeaderNavCurrent | undefined {
  if (href === path) return "page";
  if (href === "/" || !href.startsWith("/")) return undefined;
  return path.startsWith(`${href}/`) ? "section" : undefined;
}

/** The shared destinations, with the one the reader is on marked as current. */
export function siteNavigation(path: string): readonly SiteHeaderNavItem[] {
  return SITE_NAVIGATION.map((item) => {
    const current = navigationCurrent(item.href, path);
    return current === undefined ? item : { ...item, current };
  });
}
