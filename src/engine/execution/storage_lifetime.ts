/** Writers share storage exclusion; reclamation alone requires all writers absent. */
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import { dirname } from "@std/path";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import { resolveContainedProjectWritePath } from "../../shared/project_path.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";

interface StorageLease {
  readonly common: string;
  readonly exclusive: boolean;
}
const storageLeases = new AsyncLocalStorage<
  ReadonlyMap<string, StorageLease>
>();

/** Content storage shares the registered artifact lifetime without impersonating an attempt id. */
export async function recoveryStoragePath(
  root: string,
  path: string,
): Promise<string> {
  const common = storageLeases.getStore()?.get(root)?.common ??
    await resolveCommonGitDir(root);
  if (common === undefined) {
    throw new Error(
      "Recovery storage has no common Git administration; preserve the checkout.",
    );
  }
  return await resolveContainedProjectWritePath(
    common,
    `${GIT_ADMIN_STATE.completionArtifacts.path}/recovery-payloads/${path}`,
    "recovery storage",
  );
}

/** Hold from payload observation through manifest publication. Reclamation never waits on an active writer. */
export async function withRecoveryStorage<T>(
  root: string,
  operation: () => Promise<T>,
  exclusive = false,
): Promise<T> {
  const held = storageLeases.getStore();
  const common = held?.get(root)?.common ?? await resolveCommonGitDir(root);
  if (common === undefined) {
    throw new Error(
      "Recovery storage has no common Git administration; preserve the checkout.",
    );
  }
  const current = held?.get(root) ??
    [...(held?.values() ?? [])].find((lease) => lease.common === common);
  if (current !== undefined) {
    if (exclusive && !current.exclusive) {
      throw new Error(
        "Recovery storage is in use; finish capture and reference publication before reclaiming storage.",
      );
    }
    return await storageLeases.run(
      new Map([...(held ?? []), [root, current]]),
      operation,
    );
  }
  const path = await resolveContainedProjectWritePath(
    common,
    `${GIT_ADMIN_STATE.completionArtifacts.path}/recovery-payloads/lifetime.lock`,
    "recovery storage",
  );
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await Deno.open(path, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  });
  try {
    if (!await lock.tryLock(exclusive)) {
      throw new Error(
        "Recovery storage is in use; preserve all artifacts and retry this storage operation after the active operation finishes.",
      );
    }
    return await storageLeases.run(
      new Map([...(held ?? []), [root, { common, exclusive }]]),
      operation,
    );
  } finally {
    lock.close();
  }
}
