/** Brand primitives shared by the site's generated and request-time shells. */
export { DISCERN_MARK } from "../src/shared/brand.ts";

/** One theme-aware, drawn favicon shared by every public page. */
export const DISCERN_FAVICON_PATH = "/assets/favicon.svg";

/** Homepage metadata shared by its renderer, SEO checks, and smoke crawl. */
export const LANDING_TITLE =
  "discern — A Software Engineering Tool for Coding Agents";
export const LANDING_DESCRIPTION =
  "Give coding agents a consistent way to handle substantial software tasks, work in isolation, run project checks, and return exact evidence while you keep control of what ships.";

/** Exact metadata for the public agent-ergonomics composition. */
export const AGENTS_TITLE =
  "discern for coding agents — Finally, software where you are the user";
export const AGENTS_DESCRIPTION =
  "discern gives coding agents explicit project state, bounded results, isolated work, project-specific instructions, useful refusals, and Proof tied to the exact completed change.";

/** Route-specific social copy, which can address an out-of-context human share. */
export const SOCIAL_PAGE_METADATA: Readonly<
  Record<string, { title: string; description: string; image: string }>
> = {
  "/agents": {
    title: "Finally, software where your coding agent is the user.",
    description:
      "Developer software designed around the machine doing the work, while the person responsible keeps the final decision.",
    image: "/assets/agents-og.png",
  },
};

/**
 * Routes that carry their own exact titles. Serving appends the docs suffix to
 * every other page; the SEO test and smoke crawl hold each listed route to
 * its value.
 */
export const SELF_TITLED_PAGES: Readonly<Record<string, string>> = {
  "/": LANDING_TITLE,
  "/agents": AGENTS_TITLE,
};

/** Canonical 100-unit geometry for drawn derivatives of the Unicode mark. */
export const DISCERN_MARK_FILLED_PATH = "M50 12 90 84H50Z";
export const DISCERN_MARK_OUTLINE_PATH = "M50 12 90 84H10Z";
