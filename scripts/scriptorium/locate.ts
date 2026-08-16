/**
 * The rung-0 jump: resolve a canon entry to its exact registry source line
 * and open the IDE there. This is also the studio's open-in-IDE plumbing —
 * the server routes its jump links through the same resolution.
 */

import { join } from "@std/path";
import { REPO_ROOT } from "./root.ts";
import {
  type CanonEntryRef,
  findEntries,
  openRegistryProject,
  registryEntries,
} from "./registry_ast.ts";

/** One resolved jump target. */
export interface LocatedEntry {
  readonly registry: string;
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  /** Repo-relative source module. */
  readonly file: string;
  readonly line: number;
}

/** Strip the live AST node off an entry, leaving the serializable position. */
export function toLocated(entry: CanonEntryRef): LocatedEntry {
  return {
    registry: entry.registry,
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    file: entry.file,
    line: entry.line,
  };
}

/** Resolve a query against the live registries, freshly parsed from disk. */
export function locateEntries(query: string): LocatedEntry[] {
  const project = openRegistryProject(REPO_ROOT);
  return findEntries(registryEntries(project, REPO_ROOT), query).map(
    toLocated,
  );
}

/**
 * Launch the JetBrains `phpstorm` command-line launcher at a file and line,
 * detached so a launcher that lingers with the application never blocks the
 * caller. Returns false when no launcher is on PATH — the caller prints the
 * position instead, so the jump degrades to a clickable location.
 */
export function openInIde(file: string, line: number): boolean {
  try {
    const child = new Deno.Command("phpstorm", {
      args: ["--line", String(line), join(REPO_ROOT, file)],
      stdout: "null",
      stderr: "null",
      stdin: "null",
    }).spawn();
    child.unref();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
