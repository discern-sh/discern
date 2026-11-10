/**
 * The wall's built assets: its stylesheets, its island bundle, and how the
 * build names that bundle. Build and server code use this module; the browser
 * island has no need of it.
 */

/** The wall's stylesheets, in cascade order, copied beside the homepage's bundle. */
export const WALL_STYLESHEETS = [
  "wall.css",
  "wall-card.css",
  "wall-glyph.css",
  "wall-interactions.css",
  "wall-tuning.css",
] as const;

/** The island's browser entry, relative to the repository root. */
export const WALL_ISLAND_ENTRY = "site/wall/island.tsx";

/** Hex characters of the bundle's SHA-256 digest carried in its file name. */
export const WALL_ISLAND_HASH_LENGTH = 16;

const WALL_ISLAND_FILE = new RegExp(
  `^wall-island\\.([0-9a-f]{${WALL_ISLAND_HASH_LENGTH}})\\.js$`,
);

/**
 * Generated files a page links by a name only the build knows. The build
 * passes them to the page renderers. A render without them carries the page's
 * whole content and links none of them, which is all a reader of its prose
 * needs.
 */
export interface BuiltAssets {
  /** The homepage island bundle, by file name beside the wall's stylesheets. */
  readonly wallIsland?: string;
}

/** Name the island bundle after the digest of its own bytes. */
export function wallIslandFileName(contentHash: string): string {
  const name = `wall-island.${contentHash}.js`;
  if (!WALL_ISLAND_FILE.test(name)) {
    throw new Error(`"${contentHash}" is not a wall island content hash`);
  }
  return name;
}

/** The content hash a wall island file name carries, or nothing for any other file. */
export function wallIslandContentHash(fileName: string): string | undefined {
  return WALL_ISLAND_FILE.exec(fileName)?.[1];
}
