/** Exact-source authority values for read-only desk and storage fixtures. */
import {
  type EffortGrant,
  EffortGrantSchema,
} from "../src/engine/worktree/effort_grant.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
/** Give mocked desk operations the same canonical shape as the real writer. */
export function fixtureEffortGrant(branch: string): EffortGrant {
  return EffortGrantSchema.parse({
    id: "00000000-0000-4000-8000-000000000073",
    version: ON_DISK_FORMATS.effortGrant.version,
    branch,
    granted_at: "2026-07-11T12:00:00.000Z",
  });
}
