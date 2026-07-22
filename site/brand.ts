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

/** The /v2 editorial edition's exact title and description. */
export const V2_TITLE = "On keeping software changeable · a discern essay";
export const V2_DESCRIPTION =
  "An essay on building with coding agents: why projects decay as prompts accumulate, and how discern gives your agent the habits that keep change safe.";

/**
 * Landing-family routes that carry their own exact titles. Serving appends
 * the docs suffix to every other page; the SEO test and smoke crawl hold
 * each of these routes to its listed title, so a new landing variant
 * auto-enrolls by adding one entry here.
 */
export const SELF_TITLED_PAGES: Readonly<Record<string, string>> = {
  "/": LANDING_TITLE,
  "/v2": V2_TITLE,
};

/** Canonical 100-unit geometry for drawn derivatives of the Unicode mark. */
export const DISCERN_MARK_FILLED_PATH = "M50 12 90 84H50Z";
export const DISCERN_MARK_OUTLINE_PATH = "M50 12 90 84H10Z";
