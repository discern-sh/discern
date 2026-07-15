import type { EmbeddedRuntimeAsset } from "../src/runtime-assets.ts";
import {
  componentGroups,
  type ComponentMeta,
} from "../src/types/component-meta.ts";

const COMPONENT_ROOT = new URL("../src/components/", import.meta.url);
const ASSET_ROOT = new URL("../assets/", import.meta.url);
const GENERATED_ROOT = new URL("../src/generated/", import.meta.url);

interface ComponentSource {
  readonly metaUrl: URL;
  readonly implementationUrl: URL;
  readonly cssUrl: URL;
  readonly meta: ComponentMeta;
}

export interface GeneratedSources {
  readonly registry: string;
  readonly assets: string;
  readonly react: string;
}

async function walk(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) files.push(...await walk(url));
    else files.push(url);
  }
  return files.toSorted((a, b) => a.pathname.localeCompare(b.pathname));
}

function relativeImport(fromDirectory: URL, target: URL): string {
  const fromParts = decodeURIComponent(fromDirectory.pathname).split("/")
    .filter(Boolean);
  const toParts = decodeURIComponent(target.pathname).split("/").filter(
    Boolean,
  );
  while (fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return `${"../".repeat(fromParts.length)}${toParts.join("/")}`;
}

async function componentSources(): Promise<ComponentSource[]> {
  const files = await walk(COMPONENT_ROOT);
  const sources: ComponentSource[] = [];
  for (
    const metaUrl of files.filter((url) => url.pathname.endsWith(".meta.ts"))
  ) {
    const implementationUrl = new URL(
      metaUrl.pathname.replace(/\.meta\.ts$/, ".tsx"),
      metaUrl,
    );
    const cssUrl = new URL(
      metaUrl.pathname.replace(/\.meta\.ts$/, ".css"),
      metaUrl,
    );
    if (!files.some((url) => url.pathname === implementationUrl.pathname)) {
      throw new Error(`Missing implementation for ${metaUrl.pathname}`);
    }
    if (!files.some((url) => url.pathname === cssUrl.pathname)) {
      throw new Error(`Missing stylesheet for ${metaUrl.pathname}`);
    }
    const module = await import(metaUrl.href) as { default: ComponentMeta };
    sources.push({ metaUrl, implementationUrl, cssUrl, meta: module.default });
  }
  return sources.toSorted((a, b) =>
    componentGroups.indexOf(a.meta.group) -
      componentGroups.indexOf(b.meta.group) ||
    a.meta.order - b.meta.order || a.meta.slug.localeCompare(b.meta.slug)
  );
}

function cssClassNames(source: string): `discern-${string}`[] {
  return [
    ...new Set(
      [...source.matchAll(/\.((?:discern-)[_a-zA-Z0-9-]+)/g)]
        .map((match) => match[1] as `discern-${string}`),
    ),
  ].toSorted();
}

function cssTokenNames(source: string): `--discern-${string}`[] {
  return [
    ...new Set(
      [...source.matchAll(/(?<![-_a-zA-Z0-9])(--discern-[_a-zA-Z0-9-]+)/g)]
        .map((match) => match[1] as `--discern-${string}`),
    ),
  ].toSorted();
}

function implementationDependencies(
  source: string,
  implementationUrl: URL,
  components: readonly ComponentSource[],
): string[] {
  const dependencies = new Set<string>();
  for (
    const match of source.matchAll(
      /(?:from\s+|import\s*)["']([^"']+\.tsx)["']/g,
    )
  ) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    const target = new URL(specifier, implementationUrl).href;
    const dependency = components.find((component) =>
      component.implementationUrl.href === target
    );
    if (dependency !== undefined) dependencies.add(dependency.meta.slug);
  }
  const canonical = new Map(
    components.map((component, index) => [component.meta.slug, index]),
  );
  return [...dependencies].toSorted((a, b) =>
    (canonical.get(a) ?? 0) - (canonical.get(b) ?? 0)
  );
}

async function generateComponentRegistry(): Promise<string> {
  const components = await componentSources();
  const imports: string[] = [
    'import type { ComponentRegistryEntry } from "../registry-types.ts";',
  ];
  const entries: string[] = [];
  for (const [index, component] of components.entries()) {
    imports.push(
      `import meta${index} from ${
        JSON.stringify(relativeImport(GENERATED_ROOT, component.metaUrl))
      };`,
      `import css${index} from ${
        JSON.stringify(relativeImport(GENERATED_ROOT, component.cssUrl))
      } with { type: "text" };`,
    );
    const css = await Deno.readTextFile(component.cssUrl);
    const implementation = await Deno.readTextFile(component.implementationUrl);
    entries.push(`  {
    meta: meta${index},
    css: css${index},
    dependencies: ${
      JSON.stringify(
        implementationDependencies(
          implementation,
          component.implementationUrl,
          components,
        ),
      )
    },
    ownedClasses: ${JSON.stringify(cssClassNames(css))},
    publicTokenNames: ${JSON.stringify(cssTokenNames(css))},
  },`);
  }
  return `/* Generated by scripts/generate.ts. Do not edit. */
${imports.join("\n")}

export const componentRegistry = [
${entries.join("\n")}
] satisfies readonly ComponentRegistryEntry[];
`;
}

async function generateReactModule(): Promise<string> {
  const components = await componentSources();
  const exports = components.map((component) => {
    const modUrl = new URL("mod.ts", component.metaUrl);
    return `export * from ${
      JSON.stringify(relativeImport(GENERATED_ROOT, modUrl))
    };`;
  });
  return `/* Generated by scripts/generate.ts. Do not edit. */
${exports.join("\n")}
`;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
    );
  }
  return btoa(chunks.join(""));
}

function mediaType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function assetFiles(
  selection: EmbeddedRuntimeAsset["selection"],
  roots: readonly string[],
): Promise<EmbeddedRuntimeAsset[]> {
  const urls: URL[] = [];
  for (const root of roots) {
    const url = new URL(root, ASSET_ROOT);
    const info = await Deno.stat(url);
    if (info.isDirectory) urls.push(...await walk(url));
    else urls.push(url);
  }
  const assets: EmbeddedRuntimeAsset[] = [];
  for (const url of urls) {
    const path = decodeURIComponent(url.pathname).slice(
      decodeURIComponent(ASSET_ROOT.pathname).length,
    );
    const text = path.endsWith(".css") || path.endsWith(".txt");
    assets.push({
      selection,
      path,
      mediaType: mediaType(path),
      encoding: text ? "utf8" : "base64",
      contents: text
        ? await Deno.readTextFile(url)
        : encodeBase64(await Deno.readFile(url)),
    });
  }
  return assets.toSorted((a, b) => a.path.localeCompare(b.path));
}

async function generateAssets(): Promise<string> {
  const assets = [
    ...await assetFiles("fonts", ["fonts.css", "fonts/", "licenses/"]),
    ...await assetFiles("grain", ["grain.css", "textures/"]),
  ];
  const entries = assets.map((asset) => `  ${JSON.stringify(asset)},`).join(
    "\n",
  );
  return `/* Generated by scripts/generate.ts. Do not edit. */
import type { EmbeddedRuntimeAsset } from "../runtime-assets.ts";

export const embeddedRuntimeAssets = [
${entries}
] satisfies readonly EmbeddedRuntimeAsset[];
`;
}

/** Generate the stable source modules used by cached package consumers. */
export async function generateSources(): Promise<GeneratedSources> {
  return {
    registry: await generateComponentRegistry(),
    assets: await generateAssets(),
    react: await generateReactModule(),
  };
}

/** Refresh generated modules after component metadata, CSS, or assets change. */
export async function writeGeneratedSources(): Promise<void> {
  const generated = await generateSources();
  await Deno.mkdir(GENERATED_ROOT, { recursive: true });
  await Deno.writeTextFile(
    new URL("component-registry.ts", GENERATED_ROOT),
    generated.registry,
  );
  await Deno.writeTextFile(
    new URL("assets.ts", GENERATED_ROOT),
    generated.assets,
  );
  await Deno.writeTextFile(
    new URL("react.ts", GENERATED_ROOT),
    generated.react,
  );
}

if (import.meta.main) await writeGeneratedSources();
