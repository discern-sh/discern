/** Exact-source authority values for read-only desk and storage fixtures. */
import {
  type EffortGrant,
  EffortGrantSchema,
  type EffortGrantSubject,
  EffortGrantSubjectSchema,
} from "../src/engine/worktree/effort_grant.ts";
import { completionId } from "./completion_fixtures.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
/** Supply a deterministic reviewed subject for a scripted desk. */
export function fixtureEffortGrantSubject(branch: string): EffortGrantSubject {
  return EffortGrantSubjectSchema.parse({
    source: {
      effort_id: "fixture",
      branch: `refs/heads/${branch}`,
      head: "a".repeat(40),
      tree: "b".repeat(40),
    },
    composition_procedure: "c".repeat(64),
  });
}
/** Give mocked desk operations the same canonical shape as the real writer. */
export function fixtureEffortGrant(branch: string): EffortGrant {
  return EffortGrantSchema.parse({
    ...fixtureEffortGrantSubject(branch),
    id: completionId(73),
    version: ON_DISK_FORMATS.effortGrant.version,
    branch,
    granted_at: "2026-07-11T12:00:00.000Z",
  });
}
