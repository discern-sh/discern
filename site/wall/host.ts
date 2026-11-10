/**
 * The seam between the server render and the browser island.
 *
 * The server renders `WallPage` into the host element and writes the props it
 * used onto that element. The island reads them back, so both sides render from
 * the same values and hydration has nothing to reconcile. This module runs in
 * the browser: it imports nothing that needs the server.
 */
import type { WallPageProps } from "./WallPage.tsx";

/** The id of the element whose children the island hydrates. */
export const WALL_HOST_ID = "wall-island";

/** The host attribute that carries the server's props to the island. */
export const WALL_PROPS_ATTRIBUTE = "data-wall-props";

/** Serialize the props the server rendered with, for the host attribute. */
export function encodeWallProps(props: WallPageProps): string {
  return JSON.stringify(props);
}

/** Read the server's props back from the host attribute, refusing a malformed value. */
export function decodeWallProps(encoded: string | null): WallPageProps {
  const parsed: unknown = JSON.parse(encoded ?? "null");
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`the wall host carries no ${WALL_PROPS_ATTRIBUTE}`);
  }
  const record: Record<string, unknown> = { ...parsed };
  const text = (name: keyof WallPageProps): string => {
    const value = record[name];
    if (typeof value !== "string") {
      throw new Error(`${WALL_PROPS_ATTRIBUTE} has no text for "${name}"`);
    }
    return value;
  };
  return {
    mark: text("mark"),
    version: text("version"),
    headline: text("headline"),
    categoryLine: text("categoryLine"),
  };
}
