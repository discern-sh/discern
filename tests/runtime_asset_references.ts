import { wallIslandContentHash } from "../site/wall/assets.ts";

const ASSET_LINK_RELS = new Set([
  "apple-touch-icon",
  "icon",
  "manifest",
  "mask-icon",
  "modulepreload",
  "preload",
  "stylesheet",
]);

/** Extract browser-loaded assets without mistaking ordinary navigation for code. */
export function runtimeAssetReferences(html: string): readonly string[] {
  const references = [
    ...[...html.matchAll(/\s(?:poster|src)="([^"]+)"/g)]
      .map((match) => match[1] ?? ""),
    ...[...html.matchAll(/\ssrcset="([^"]+)"/g)]
      .flatMap((match) =>
        (match[1] ?? "").split(",").map((candidate) =>
          candidate.trim().split(/\s+/, 1)[0] ?? ""
        )
      ),
    ...[...html.matchAll(/<object\b[^>]*\sdata="([^"]+)"[^>]*>/g)]
      .map((match) => match[1] ?? ""),
  ];

  for (const match of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    const rels = (tag.match(/\srel="([^"]+)"/)?.[1] ?? "")
      .toLowerCase()
      .split(/\s+/);
    if (!rels.some((rel) => ASSET_LINK_RELS.has(rel))) continue;
    references.push(tag.match(/\shref="([^"]+)"/)?.[1] ?? "");
  }

  return references.filter((value) =>
    value.length > 0 && !value.startsWith("#") &&
    !value.startsWith("data:")
  );
}

const SCRIPT_PATH = /\.m?js$/;

/** The site paths one script imports, statically or dynamically. */
function importedScriptPaths(path: string, source: string): string[] {
  const specifiers = [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(?\s*["']([^"']+)["']/g),
  ].map((match) => match[1] ?? "");
  return specifiers
    .filter((specifier) => /^\.{0,2}\//.test(specifier))
    .map((specifier) => new URL(specifier, `https://site.invalid${path}`))
    .map((url) => url.pathname)
    .filter((imported) => SCRIPT_PATH.test(imported));
}

/**
 * Every script a page makes the browser load: the scripts its markup names and
 * everything they import, by site path, each with its text. `read` returns a
 * script's text, or nothing when the site does not serve that path.
 */
export async function loadedScripts(
  html: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const scripts = new Map<string, string>();
  const pending = runtimeAssetReferences(html)
    .map((reference) => reference.replace(/[?#].*$/, ""))
    .filter((reference) => SCRIPT_PATH.test(reference));
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (scripts.has(path)) continue;
    const source = await read(path);
    if (source === undefined) continue;
    scripts.set(path, source);
    pending.push(...importedScriptPaths(path, source));
  }
  return scripts;
}

/** One wall island a page loads: its site path and its content-hashed file name. */
export interface WallIslandReference {
  readonly path: string;
  readonly file: string;
}

/** The wall islands a page's markup references, recognized by the build's own naming. */
export function wallIslandReferences(html: string): WallIslandReference[] {
  return runtimeAssetReferences(html).flatMap((path) => {
    const file = path.slice(path.lastIndexOf("/") + 1);
    return wallIslandContentHash(file) === undefined ? [] : [{ path, file }];
  });
}
