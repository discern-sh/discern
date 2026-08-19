/** Brand primitives shared by the site's generated and request-time shells. */
export { DISCERN_MARK } from "../src/shared/brand.ts";

/** One theme-aware, drawn favicon shared by every public page. */
export const DISCERN_FAVICON_PATH = "/assets/favicon.svg";

/**
 * The homepage's exact title and description. The landing page renders them,
 * and the SEO test and smoke crawl verify the served page against the same
 * values, so the public identity line has one source.
 */
export const LANDING_TITLE =
  "discern — A Software Engineering Tool for Coding Agents";
export const LANDING_DESCRIPTION =
  "Give coding agents a consistent way to handle substantial software tasks, work in isolation, run project checks, and return exact evidence while you keep control of what ships.";

/**
 * Routes that carry their own exact titles. Serving appends the docs suffix to
 * every other page; the SEO test and smoke crawl hold the homepage to this
 * value.
 */
export const SELF_TITLED_PAGES: Readonly<Record<string, string>> = {
  "/": LANDING_TITLE,
};

/** Canonical 100-unit geometry for drawn derivatives of the Unicode mark. */
export const DISCERN_MARK_FILLED_PATH = "M50 12 90 84H50Z";
export const DISCERN_MARK_OUTLINE_PATH = "M50 12 90 84H10Z";
