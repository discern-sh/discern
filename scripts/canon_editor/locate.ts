/**
 * The rung-0 jump: resolve a canon entry to its exact registry source line
 * and open the IDE there. This is also the editor's open-in-IDE plumbing —
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
 * The position as a JetBrains `phpstorm://open` URL — the scheme IDE
 * browser links use, handled by any installed PhpStorm with no launcher
 * on PATH involved. Slashes stay literal; only other characters encode.
 */
function ideUrl(file: string, line: number): string {
  const path = encodeURIComponent(join(REPO_ROOT, file))
    .replaceAll("%2F", "/");
  return `phpstorm://open?file=${path}&line=${line}`;
}

/**
 * Hand a URL to the operating system's scheme handler and report whether
 * it was accepted. Only macOS and Linux have a dependable opener; other
 * platforms fall through to the command-line launcher.
 */
async function openUrl(url: string): Promise<boolean> {
  const opener = Deno.build.os === "darwin"
    ? "open"
    : Deno.build.os === "linux"
    ? "xdg-open"
    : undefined;
  if (opener === undefined) return false;
  try {
    const output = await new Deno.Command(opener, {
      args: [url],
      stdout: "null",
      stderr: "null",
      stdin: "null",
    }).output();
    return output.success;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Jump PhpStorm to a file and line: the `phpstorm://` URL scheme first —
 * delivered whenever the application is installed — then the `phpstorm`
 * command-line launcher, detached. Returns false when neither path can
 * deliver, so the caller prints the position instead.
 */
export async function openInIde(file: string, line: number): Promise<boolean> {
  if (await openUrl(ideUrl(file, line))) return true;
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
