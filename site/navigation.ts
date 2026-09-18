/** Shared navigation for the public React pages. */
import type {
  SiteHeaderNavCurrent,
  SiteHeaderNavItem,
} from "discern-design-system/react";
import { RELEASE_ROUTES } from "../src/shared/product_identity.ts";

export const SITE_NAVIGATION = [
  { label: "Docs", href: "/docs" },
  { label: "Releases", href: RELEASE_ROUTES.html },
] as const;

/** Four reading paths into the manual: begin, explore, accelerate, and trust. */
export const SITE_FOOTER_GROUPS = [
  {
    title: "Begin",
    links: [
      { label: "What is discern?", href: "/docs/start/evaluate-discern" },
      { label: "Install discern", href: "/docs/start/installation-and-setup" },
      { label: "Understand discern", href: "/docs/understand" },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "The Practice", href: "/docs/understand/practice-and-roles" },
      { label: "Proof", href: "/docs/understand/proof" },
      { label: "Checkpoints", href: "/docs/understand/checkpoints" },
      { label: "Reference and glossary", href: "/docs/reference" },
    ],
  },
  {
    title: "Accelerate",
    links: [
      { label: "Delegate work", href: "/docs/guides/delegate-work" },
      {
        label: "Raise your standards",
        href: "/docs/guides/set-and-raise-standards",
      },
      {
        label: "Work in parallel",
        href: "/docs/guides/coordinate-parallel-tasks",
      },
      {
        label: "Increase productivity",
        href: "/docs/guides/improve-the-practice",
      },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Offline only", href: "/docs/understand/local-control" },
      { label: "Backwards compatible", href: "/docs/reference/compatibility" },
      { label: "Source available", href: "/docs/reference/licenses" },
      {
        label: "No commitment",
        href:
          "/docs/guides/maintain-or-remove-discern#remove-discern-from-the-repository",
      },
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
