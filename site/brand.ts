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
  "discern — keep AI-built software working as it grows";
export const LANDING_DESCRIPTION =
  "Install discern once, and your coding agent works each change in a separate workspace, runs your project's checks, and waits for your say before landing.";

/** Canonical 100-unit geometry for drawn derivatives of the Unicode mark. */
export const DISCERN_MARK_FILLED_PATH = "M50 12 90 84H50Z";
export const DISCERN_MARK_OUTLINE_PATH = "M50 12 90 84H10Z";
