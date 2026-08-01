/**
 * The registry atlas's nested member bullets are definitions, not prose or
 * citations. Lexical guards scan the rest of the generated page through this
 * projection so a literal identifier cannot acquire a second meaning merely
 * by appearing in the inventory.
 */

import { join } from "@std/path";
import { REGISTRY_ATLAS_PAGE_REL } from "../scripts/canonical_sets.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

export const REGISTRY_ATLAS_REL: string = join(
  REPO_AUTHORED_PATHS.mapRel,
  REGISTRY_ATLAS_PAGE_REL,
).replaceAll("\\", "/");

/** Remove only generated member-name bullets from an atlas semantic scan. */
export function withoutRegistryAtlasMembers(
  rel: string,
  text: string,
): string {
  if (rel !== REGISTRY_ATLAS_REL) return text;
  let beneathMemberCount = false;
  return text.split("\n").map((line) => {
    if (line.startsWith("- Members:")) {
      beneathMemberCount = true;
      return line;
    }
    if (beneathMemberCount && line.startsWith("  - ")) return "";
    beneathMemberCount = false;
    return line;
  }).join("\n");
}
