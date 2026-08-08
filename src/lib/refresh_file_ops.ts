/**
 * File effects shared by tracked refresh writers and their read-only planner.
 *
 * Live refreshes use {@link LIVE_REFRESH_FILE_OPS}. Currency checks use
 * {@link PlanningRefreshFileOps}: the same writer functions read and write an
 * in-memory overlay, so their proposed bytes and modes can be inspected without
 * touching the checkout. Later writers see earlier proposed writes, preserving
 * refresh ordering for files co-managed by more than one integration.
 */

import { ensureDir } from "@std/fs";
import { relative } from "@std/path";

/** The small filesystem surface tracked refresh writers are allowed to use. */
export interface RefreshFileOps {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, text: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  ensureDir(path: string): Promise<void>;
}

/** Read-only base state underneath a planning overlay. */
export interface RefreshFileSnapshot {
  readTextFile(path: string): Promise<string>;
  mode(path: string): Promise<number | undefined>;
}

const LIVE_REFRESH_FILE_SNAPSHOT: RefreshFileSnapshot = {
  readTextFile: async (path: string): Promise<string> =>
    await Deno.readTextFile(path),
  mode: async (path: string): Promise<number | undefined> =>
    (await Deno.stat(path)).mode ?? undefined,
};

/** Real on-disk effects used by an ordinary `discern refresh`. */
export const LIVE_REFRESH_FILE_OPS: RefreshFileOps = {
  readTextFile: async (path: string): Promise<string> =>
    await Deno.readTextFile(path),
  writeTextFile: async (path: string, text: string): Promise<void> => {
    await Deno.writeTextFile(path, text);
  },
  chmod: async (path: string, mode: number): Promise<void> => {
    await Deno.chmod(path, mode);
  },
  ensureDir: async (path: string): Promise<void> => {
    await ensureDir(path);
  },
};

interface PlanningFileState {
  readonly existed: boolean;
  readonly initialText?: string;
  readonly initialMode?: number;
  text?: string;
  mode?: number;
}

/** One file the tracked-refresh writer would change. */
export interface PlannedRefreshFileChange {
  readonly path: string;
  readonly bytesChanged: boolean;
  readonly modeChanged: boolean;
}

/**
 * An in-memory filesystem overlay for invoking the real refresh writers without
 * applying their effects. Reads fall through to disk once, writes remain in the
 * overlay, and later reads observe those proposed writes.
 */
export class PlanningRefreshFileOps implements RefreshFileOps {
  readonly #root: string;
  readonly #snapshot: RefreshFileSnapshot;
  readonly #states = new Map<string, PlanningFileState>();

  constructor(
    root: string,
    snapshot: RefreshFileSnapshot = LIVE_REFRESH_FILE_SNAPSHOT,
  ) {
    this.#root = root;
    this.#snapshot = snapshot;
  }

  async #load(path: string): Promise<PlanningFileState> {
    const cached = this.#states.get(path);
    if (cached !== undefined) {
      return cached;
    }
    let text: string;
    let mode: number | undefined;
    try {
      text = await this.#snapshot.readTextFile(path);
      mode = await this.#snapshot.mode(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      const missing: PlanningFileState = { existed: false };
      this.#states.set(path, missing);
      return missing;
    }
    const present: PlanningFileState = {
      existed: true,
      initialText: text,
      ...(mode === undefined ? {} : { initialMode: mode, mode }),
      text,
    };
    this.#states.set(path, present);
    return present;
  }

  async readTextFile(path: string): Promise<string> {
    const state = await this.#load(path);
    if (state.text === undefined) {
      throw new Deno.errors.NotFound(`No such file: ${path}`);
    }
    return state.text;
  }

  async writeTextFile(path: string, text: string): Promise<void> {
    const state = await this.#load(path);
    state.text = text;
    if (state.mode === undefined) {
      state.mode = 0o644;
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    const state = await this.#load(path);
    if (state.text === undefined) {
      throw new Deno.errors.NotFound(`No such file: ${path}`);
    }
    state.mode = mode;
  }

  ensureDir(_path: string): Promise<void> {
    return Promise.resolve();
  }

  /** The final net effects, after every co-owner has run, in path order. */
  changes(): PlannedRefreshFileChange[] {
    const changes: PlannedRefreshFileChange[] = [];
    for (const [absolute, state] of this.#states) {
      const bytesChanged = !state.existed || state.text !== state.initialText;
      const modeChanged = state.existed && state.mode !== undefined &&
        state.initialMode !== undefined && state.mode !== state.initialMode;
      if (!bytesChanged && !modeChanged) {
        continue;
      }
      changes.push({
        path: relative(this.#root, absolute),
        bytesChanged,
        modeChanged,
      });
    }
    return changes.sort((left, right) => left.path.localeCompare(right.path));
  }
}
