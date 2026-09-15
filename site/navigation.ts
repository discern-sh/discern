/** Shared navigation for the public React pages. */
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
