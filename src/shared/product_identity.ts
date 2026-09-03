/** Stable product, repository, and installer identity authorities. */

/** The product name used in protocol and generated-file identity. */
export const DISCERN_NAME = "discern";

/** The canonical product URL used in generated-file identity. */
export const DISCERN_URL = "https://discern.sh";

/** The canonical online manual landing page. */
export const DISCERN_DOCS_URL = `${DISCERN_URL}/docs`;

/** The stable first-party installer endpoint. */
export const DISCERN_INSTALL_ROUTE = "/install";

/**
 * The current GitHub repository identity.
 *
 * The launch transfer changes this one value from the private owner slug to
 * the permanent organization slug. Every compiled repository URL and generated
 * projection derives from it.
 */
export const DISCERN_REPOSITORY_SLUG = "jackwh/discern";

/** The current GitHub repository root. */
export const DISCERN_REPOSITORY_URL =
  `https://github.com/${DISCERN_REPOSITORY_SLUG}`;

/** The current public issue tracker. */
export const DISCERN_ISSUES_URL = `${DISCERN_REPOSITORY_URL}/issues`;

/** The current GitHub release collection. */
export const DISCERN_RELEASES_URL = `${DISCERN_REPOSITORY_URL}/releases`;

/** The private vulnerability-report route for the current repository. */
export const DISCERN_ADVISORY_URL =
  `${DISCERN_REPOSITORY_URL}/security/advisories/new`;

/** Build a link to one repository file on the default branch. */
export function repositoryBlobUrl(path: string, fragment = ""): string {
  return `${DISCERN_REPOSITORY_URL}/blob/main/${path}${fragment}`;
}

/** Build a link to one repository tree on the default branch. */
export function repositoryTreeUrl(path: string, fragment = ""): string {
  return `${DISCERN_REPOSITORY_URL}/tree/main/${path}${fragment}`;
}

/** The raw installer URL retained as a documented fallback. */
export const DISCERN_RAW_INSTALL_URL =
  `https://raw.githubusercontent.com/${DISCERN_REPOSITORY_SLUG}/main/install.sh`;

/** The one canonical public install command. */
export const INSTALL_COMMAND =
  `curl -fsSL ${DISCERN_URL}${DISCERN_INSTALL_ROUTE} | sh`;
