/**
 * The id discipline every canon guard shares: ids are unique within the
 * canon, kebab-case, and absent from the sets the canon sits beside, so a
 * citation can never resolve to the wrong registry. Each guard supplies the
 * taken set and a label; the check itself lives in one place.
 */

import { assert } from "@std/assert";

/** The kebab-case id form every canon uses. */
export const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Assert every id is fresh: unique among `ids`, kebab-case, and absent from
 * `taken`. `label` names the canon in each failure message.
 */
export function assertFreshCanonIds(
  label: string,
  ids: Iterable<string>,
  taken: ReadonlySet<string>,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    assert(!seen.has(id), `duplicate ${label} id: ${id}`);
    assert(
      !taken.has(id),
      `${label} id collides with a set it sits beside: ${id}`,
    );
    assert(KEBAB.test(id), `${label} id is not kebab-case: ${id}`);
    seen.add(id);
  }
}
