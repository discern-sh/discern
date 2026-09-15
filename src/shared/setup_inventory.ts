/**
 * Derived completion account for setup's closing relay.
 *
 * The agent must not reconstruct project context, Map and ledger counts, or job
 * states from memory. This module derives those facts from configured authorities
 * after the final setup tree has been proved, so every presentation quotes one
 * qualitative and mechanical account.
 */

import { join } from "@std/path";
import { discoverDocs, docRegions } from "../lib/docs.ts";
import type { DiscernConfig } from "./config_schema.ts";
import type { SetupAssurance } from "./setup_assurance.ts";
import {
  deriveSetupProjectContext,
  type SetupProjectContext,
} from "./setup_project_context.ts";
import { readTextIfExists } from "./fs_presence.ts";

export interface SetupCompletionInventory {
  project_context: SetupProjectContext;
  map_regions: { count: number; items: string[] };
  ledger_items: { count: number; items: string[] };
  jobs: {
    enforced: string[];
    deferred: string[];
    absent: string[];
    not_applicable: string[];
  };
}

/** Use the same region inventory as map browsing and compiled instructions. */
async function mapRegions(root: string, mapDir: string): Promise<string[]> {
  const tree = await discoverDocs({ cwd: root, dir: mapDir });
  return docRegions(tree?.entries ?? []).map((region) => region.name);
}

/** Extract every open checkbox from the configured ledger in source order. */
function openLedgerItems(markdown: string): string[] {
  const items: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*-\s+\[\s\]\s+(.+?)\s*$/);
    if (match === null) continue;
    const body = match[1] ?? "";
    const title = body.match(/^\*\*(.+?)\*\*/)?.[1] ?? body;
    items.push(title.trim());
  }
  return items;
}

/** Read open ledger items, treating a missing configured ledger as empty. */
async function ledgerItems(root: string, todoRel: string): Promise<string[]> {
  const text = await readTextIfExists(join(root, todoRel));
  return text === undefined ? [] : openLedgerItems(text);
}

/** Derive the exact project context, counts, and lists used by every closing surface. */
export async function deriveSetupCompletionInventory(
  root: string,
  config: DiscernConfig,
  assurance: SetupAssurance,
): Promise<SetupCompletionInventory> {
  const [regions, ledger, projectContext] = await Promise.all([
    mapRegions(root, config.map.dir),
    ledgerItems(root, config.project.todo),
    deriveSetupProjectContext(
      root,
      config.map.dir,
      config.instructions.sources,
    ),
  ]);
  const notApplicable = assurance.known_jobs.filter((job) =>
    job.not_applicable === true
  ).map((job) => job.name);
  const applicable = assurance.known_jobs.filter((job) =>
    job.not_applicable !== true
  );
  return {
    project_context: projectContext,
    map_regions: { count: regions.length, items: regions },
    ledger_items: { count: ledger.length, items: ledger },
    jobs: {
      enforced: applicable.filter((job) => job.state === "enforced").map((
        job,
      ) => job.name),
      deferred: applicable.filter((job) => job.state === "deferred").map((
        job,
      ) => job.name),
      absent: applicable.filter((job) => job.state === "absent").map((job) =>
        job.name
      ),
      not_applicable: notApplicable,
    },
  };
}
