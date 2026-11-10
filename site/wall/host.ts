/**
 * The seam between the server render and the browser island.
 *
 * The server renders the wall page into the host element and writes the props
 * it used onto that element. The island reads them back, so both sides render
 * from the same values and hydration has nothing to reconcile. This module
 * runs in the browser, and it imports nothing: the server and the build read
 * it without loading any of the wall behind it.
 */

/** The id of the element whose children the island hydrates. */
export const WALL_HOST_ID = "wall-island";

/** The host attribute that carries the server's props to the island. */
export const WALL_PROPS_ATTRIBUTE = "data-wall-props";

/** What an opened card calls its link, by the manual route the link leads to. */
export type LinkLabels = Readonly<Record<string, string>>;

/**
 * Everything the wall page takes from the server. Each value is plain text,
 * or a table of plain text, because the server hands these props to the
 * island on the host element.
 */
export interface WallPageProps {
  /** The brand mark shown beside the product name. */
  readonly mark: string;
  /** The released version in the eyebrow, without its "v". */
  readonly version: string;
  /** The page's one headline. */
  readonly headline: string;
  /** The category line under the headline. */
  readonly categoryLine: string;
  /**
   * The title of each manual page a card links to, by that page's route. Only
   * the server can read the manual, and the deck names a page by its address
   * alone, so an opened card's link takes its words from here.
   */
  readonly linkLabels: LinkLabels;
}

/**
 * The manual route a card's link leads to: its address without the section
 * of the page it may name. A link to a section is labelled by its page.
 */
export function linkRoute(href: string): string {
  const [route = href] = href.split("#");
  return route;
}

/** Serialize the props the server rendered with, for the host attribute. */
export function encodeWallProps(props: WallPageProps): string {
  return JSON.stringify(props);
}

/** Read `value` as a table of text, or as nothing when it is anything else. */
function textTable(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const table: Record<string, string> = {};
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, text] of entries) {
    if (typeof text !== "string") return undefined;
    table[key] = text;
  }
  return table;
}

/** Read the server's props back from the host attribute, refusing a malformed value. */
export function decodeWallProps(encoded: string | null): WallPageProps {
  const parsed: unknown = JSON.parse(encoded ?? "null");
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`the wall host carries no ${WALL_PROPS_ATTRIBUTE}`);
  }
  const record: Record<string, unknown> = { ...parsed };
  const text = (name: Exclude<keyof WallPageProps, "linkLabels">): string => {
    const value = record[name];
    if (typeof value !== "string") {
      throw new Error(`${WALL_PROPS_ATTRIBUTE} has no text for "${name}"`);
    }
    return value;
  };
  const linkLabels = textTable(record.linkLabels);
  if (linkLabels === undefined) {
    throw new Error(`${WALL_PROPS_ATTRIBUTE} has no table of link labels`);
  }
  return {
    mark: text("mark"),
    version: text("version"),
    headline: text("headline"),
    categoryLine: text("categoryLine"),
    linkLabels,
  };
}
