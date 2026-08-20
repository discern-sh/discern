/** One projection authority for checkpoint evidence related to changed paths. */

import type { RelatedCheckpointEvidenceData } from "../../shared/result_schemas.ts";
import type { RelatedCheckpointPath } from "./types.ts";

/** Project engine-internal camelCase relations onto the public wire spelling. */
export function relatedCheckpointData(
  related: readonly RelatedCheckpointPath[],
): RelatedCheckpointEvidenceData[] {
  return related.map((relation) => ({
    kind: relation.kind,
    for_path: relation.forPath,
    path: relation.path,
  }));
}
