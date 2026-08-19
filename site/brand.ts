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

/** Unique metadata title for the complete homepage preserved at /old. */
export const OLD_LANDING_TITLE = "discern · Previous homepage";

/** Metadata for the copy-neutral design-review twin of the homepage. */
export const LIPSUM_TITLE = "Lorem ipsum dolor sit amet · discern";
export const LIPSUM_DESCRIPTION =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

/**
 * Landing-family routes that carry their own exact titles. Serving appends
 * the docs suffix to every other page; the SEO test and smoke crawl hold
 * each of these routes to its listed title, so a new landing variant
 * auto-enrolls by adding one entry here.
 */
export const SELF_TITLED_PAGES: Readonly<Record<string, string>> = {
  "/": LANDING_TITLE,
  "/old": OLD_LANDING_TITLE,
  "/lipsum": LIPSUM_TITLE,
};

/** Canonical 100-unit geometry for drawn derivatives of the Unicode mark. */
export const DISCERN_MARK_FILLED_PATH = "M50 12 90 84H50Z";
export const DISCERN_MARK_OUTLINE_PATH = "M50 12 90 84H10Z";
