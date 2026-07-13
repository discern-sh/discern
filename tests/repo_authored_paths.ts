/**
 * The live, configured authored-source paths for discern's own checkout.
 *
 * Repository-wide guards scan these sources as they exist in this project, so
 * they must follow discern.toml rather than repeat the shipped defaults. Tests
 * of fresh-project defaults belong to the paths-registry and installer suites.
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  resolveGuidanceSources,
  resolveMapDir,
  resolveScriptsDir,
  resolveSkillsDir,
  resolveTodoPath,
} from "../src/lib/paths.ts";

export const REPO_ROOT: string = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
);

export interface RepoAuthoredPaths {
  guidance: string[];
  map: string;
  mapRel: string;
  scripts: string;
  skills: string;
  todo: string;
}

const config = await loadConfig(REPO_ROOT);
const map = resolveMapDir(REPO_ROOT, config).abs;

export const REPO_AUTHORED_PATHS: RepoAuthoredPaths = {
  guidance: await resolveGuidanceSources(REPO_ROOT, config),
  map,
  mapRel: relative(REPO_ROOT, map),
  scripts: resolveScriptsDir(REPO_ROOT, config).abs,
  skills: resolveSkillsDir(REPO_ROOT, config).abs,
  todo: resolveTodoPath(REPO_ROOT, config).abs,
};

/** Whether `rel` is the configured map subtree named by `segments`. */
export function isRepoMapPath(rel: string, ...segments: string[]): boolean {
  const prefix = join(REPO_AUTHORED_PATHS.mapRel, ...segments);
  return rel === prefix || rel.startsWith(`${prefix}/`);
}
