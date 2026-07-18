/** Measure the four docs-shell byte budgets without a running server. */

import { fromFileUrl, join, toFileUrl } from "@std/path";
import { emitDesignSystemRuntime } from "discern-design-system/runtime";
import { DESIGN_SYSTEM_BUNDLES } from "../site/design_system.ts";
import { loadDocsSite } from "../site/docs.ts";
import { handler } from "../site/serve.ts";

export type SiteAssetMetric =
  | "docs_page_bytes"
  | "docs_css_bytes"
  | "docs_js_bytes"
  | "docs_search_index_bytes";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 site asset budget",
};

async function responseBytes(path: string): Promise<Uint8Array> {
  const response = await handler(
    new Request(`https://discern.sh${path}`, { headers: BROWSER_HEADERS }),
  );
  if (!response.ok) {
    throw new Error(`site asset budget: ${path} returned ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function largestDocsPage(): Promise<number> {
  const site = await loadDocsSite();
  let largest = 0;
  for (const route of site.sitemapRoutes) {
    largest = Math.max(largest, (await responseBytes(route)).byteLength);
  }
  if (largest === 0) throw new Error("site asset budget: no docs pages found");
  return largest;
}

async function walkCssBytes(directory: string): Promise<number> {
  let total = 0;
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) total += await walkCssBytes(path);
    else if (entry.isFile && entry.name.endsWith(".css")) {
      total += (await Deno.stat(path)).size;
    }
  }
  return total;
}

async function docsCssBytes(): Promise<number> {
  const temporary = await Deno.makeTempDir({ prefix: "discern-docs-css-" });
  try {
    const output = join(temporary, "docs");
    const selection = DESIGN_SYSTEM_BUNDLES.docs;
    await emitDesignSystemRuntime({
      outputRoot: toFileUrl(`${output}/`),
      components: selection.components,
      groups: selection.groups,
      assets: selection.assets,
      theme: selection.theme,
    });
    const siteCss = (await Deno.stat(join(ROOT, "site/pages/assets/docs.css")))
      .size;
    const total = siteCss + await walkCssBytes(output);
    if (total === 0) throw new Error("site asset budget: no docs CSS found");
    return total;
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

function localModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (
    const match of source.matchAll(
      /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm,
    )
  ) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith(".")) specifiers.push(specifier);
  }
  return specifiers;
}

async function docsJsBytes(): Promise<number> {
  const pending = ["/assets/docs.js"];
  const visited = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const path = pending.shift();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const bytes = await responseBytes(path);
    total += bytes.byteLength;
    const source = new TextDecoder().decode(bytes);
    for (const specifier of localModuleSpecifiers(source)) {
      pending.push(new URL(specifier, `https://discern.sh${path}`).pathname);
    }
  }
  if (visited.size < 2 || total === 0) {
    throw new Error("site asset budget: docs JavaScript graph is incomplete");
  }
  return total;
}

/** Measure one budget named by its discern metric. */
export async function measureSiteAsset(
  metric: SiteAssetMetric,
): Promise<number> {
  switch (metric) {
    case "docs_page_bytes":
      return await largestDocsPage();
    case "docs_css_bytes":
      return await docsCssBytes();
    case "docs_js_bytes":
      return await docsJsBytes();
    case "docs_search_index_bytes":
      return (await responseBytes("/docs/index.json")).byteLength;
  }
}

if (import.meta.main) {
  const metric = Deno.args[0] as SiteAssetMetric | undefined;
  if (
    metric === undefined ||
    ![
      "docs_page_bytes",
      "docs_css_bytes",
      "docs_js_bytes",
      "docs_search_index_bytes",
    ].includes(metric)
  ) {
    throw new Error(
      "usage: site_asset_size.ts <docs_page_bytes|docs_css_bytes|docs_js_bytes|docs_search_index_bytes>",
    );
  }
  console.log(`DISCERN_METRIC ${metric} ${await measureSiteAsset(metric)}`);
}
