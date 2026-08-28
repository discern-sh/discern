/**
 * Resolve the {@link TempArtifactScope} a checkout's OS-temp artifacts are
 * labeled with — the project slug plus worktree id that keep one machine's
 * concurrent discern projects attributable in the shared temp dir.
 *
 * Identity resolution costs git subprocesses, so results are memoized per
 * root for the process lifetime: a checkout's identity is stable while it
 * exists, and a long-lived server resolving many roots caches each one.
 * Every designed failure (no repository, no derivable identity) resolves to
 * `undefined` — the artifact mints unlabeled, because a naming concern must
 * never decide a verb outcome. Only a non-`IdentityError` defect rejects,
 * and surfaces loudly at the minting call site: identity's whole failure
 * vocabulary is `IdentityError`, so anything else is a bug worth a crash.
 */

import type { TempArtifactScope } from "../shared/temp_artifacts.ts";
import {
  IdentityError,
  loadIdentitySettings,
  resolveIdentity,
} from "./worktree/identity.ts";

const SCOPES = new Map<string, Promise<TempArtifactScope | undefined>>();

/** The artifact scope for the checkout at `root`; `undefined` when it has
 * none (see the module doc for the rejection contract). */
export function tempArtifactScopeFor(
  root: string,
): Promise<TempArtifactScope | undefined> {
  let pending = SCOPES.get(root);
  if (pending === undefined) {
    pending = resolveScope(root);
    SCOPES.set(root, pending);
  }
  return pending;
}

/** One uncached resolution: identity settings plus the checkout's derived id.
 * An `IdentityError` is the designed no-identity answer (no repository, no
 * project slug), so those checkouts mint unlabeled; anything else is a real
 * defect and propagates into the caller's own artifact boundary. */
async function resolveScope(
  root: string,
): Promise<TempArtifactScope | undefined> {
  try {
    const settings = await loadIdentitySettings(root);
    const identity = await resolveIdentity(root, root);
    return { project: settings.slug, worktree: identity.id };
  } catch (error) {
    if (error instanceof IdentityError) {
      return undefined;
    }
    throw error;
  }
}
