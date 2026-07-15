import foundationCss from "./styles/foundation.css" with { type: "text" };
import utilitiesCss from "./styles/utilities.css" with { type: "text" };
import { embeddedRuntimeAssets } from "./generated/assets.ts";
import { componentRegistry } from "./generated/component-registry.ts";
import {
  type IntegrityFile,
  type ManifestComponent,
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  type RuntimeManifest,
} from "./manifest.ts";
import {
  type RuntimeAssetSelection,
  runtimeAssetSelections,
} from "./runtime-assets.ts";
import { discernThemeCss } from "./theme/discern.ts";
import { allTokens, baseTokens, themeTokens } from "./tokens/tokens.ts";
import {
  type ComponentGroup,
  componentGroups,
} from "./types/component-meta.ts";
import type { ComponentRegistryEntry } from "./registry-types.ts";

const LAYER_ORDER =
  "@layer discern.reset, discern.tokens, discern.theme, discern.foundation, discern.components, discern.utilities;";
const textEncoder = new TextEncoder();

export interface RuntimeOptions {
  /** A dedicated directory URL. Existing contents are replaced. */
  readonly outputRoot: URL;
  readonly components?: readonly string[];
  readonly groups?: readonly ComponentGroup[];
  readonly all?: boolean;
  readonly assets?: readonly RuntimeAssetSelection[];
  readonly theme?: "discern" | "none";
}

export interface BuildSummary {
  readonly components: number;
  readonly tokens: number;
  readonly manifest: RuntimeManifest;
}

function generateTokenCss(): string {
  const primitiveLines = baseTokens.map(({ name, value }) =>
    `    ${name}: ${value};`
  ).join("\n");
  const lightLines = themeTokens.map(({ name, light }) =>
    `    ${name}: ${light};`
  ).join("\n");
  const darkLines = themeTokens.map(({ name, dark }) => `    ${name}: ${dark};`)
    .join("\n");
  return `@layer discern.tokens {
  :where([data-discern-root]) {
    color-scheme: light;
${primitiveLines}
${lightLines}
  }

  :where([data-discern-root][data-discern-theme="dark"]) {
    color-scheme: dark;
${darkLines}
  }
}`;
}

function canonicalIndex(id: string): number {
  return componentRegistry.findIndex((entry) => entry.meta.slug === id);
}

function canonicalIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].toSorted((a, b) =>
    canonicalIndex(a) - canonicalIndex(b)
  );
}

function resolveSelection(options: RuntimeOptions): {
  readonly requestedComponents: string[];
  readonly requestedGroups: ComponentGroup[];
  readonly entries: ComponentRegistryEntry[];
} {
  const requestedGroups = componentGroups.filter((group) =>
    options.groups?.includes(group)
  );
  for (const group of options.groups ?? []) {
    if (!componentGroups.includes(group)) {
      throw new Error(`Unknown component group: ${group}`);
    }
  }
  const requestedComponents = canonicalIds(options.components ?? []);
  for (const id of options.components ?? []) {
    if (canonicalIndex(id) < 0) throw new Error(`Unknown component: ${id}`);
  }
  const seeds = new Set<string>(requestedComponents);
  for (const entry of componentRegistry) {
    if (options.all || requestedGroups.includes(entry.meta.group)) {
      seeds.add(entry.meta.slug);
    }
  }
  if (seeds.size === 0) {
    throw new Error(
      "Select components, groups, or the explicit all option before emitting a runtime",
    );
  }

  const resolved: ComponentRegistryEntry[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Component dependency cycle at ${id}`);
    }
    const entry = componentRegistry.find((candidate) =>
      candidate.meta.slug === id
    );
    if (entry === undefined) {
      throw new Error(`Unknown component dependency: ${id}`);
    }
    visiting.add(id);
    for (const dependency of canonicalIds(entry.dependencies)) {
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
    resolved.push(entry);
  };
  for (const id of canonicalIds(seeds)) visit(id);
  return { requestedComponents, requestedGroups, entries: resolved };
}

function selectedAssets(
  requested: readonly RuntimeAssetSelection[] = [],
): RuntimeAssetSelection[] {
  for (const asset of requested) {
    if (!runtimeAssetSelections.includes(asset)) {
      throw new Error(`Unknown runtime asset selection: ${asset}`);
    }
  }
  return runtimeAssetSelections.filter((asset) => requested.includes(asset));
}

function decodeAsset(
  asset: (typeof embeddedRuntimeAssets)[number],
): Uint8Array {
  if (asset.encoding === "utf8") return textEncoder.encode(asset.contents);
  const binary = atob(asset.contents);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function digest(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", input.buffer),
  );
  return `sha256:${
    [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}

async function removeIfPresent(url: URL): Promise<void> {
  try {
    await Deno.remove(url, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function writeOutput(
  outputRoot: URL,
  path: string,
  mediaType: string,
  bytes: Uint8Array,
): Promise<IntegrityFile> {
  const url = new URL(path, outputRoot);
  await Deno.mkdir(new URL("./", url), { recursive: true });
  await Deno.writeFile(url, bytes);
  return {
    path,
    bytes: bytes.byteLength,
    integrity: await digest(bytes),
    mediaType,
  };
}

/** Emit deterministic CSS, a consumer manifest, and only requested assets. */
export async function emitDesignSystemRuntime(
  options: RuntimeOptions,
): Promise<BuildSummary> {
  if (!options.outputRoot.pathname.endsWith("/")) {
    throw new Error("outputRoot must be a directory URL ending in /");
  }
  const selection = resolveSelection(options);
  const assets = selectedAssets(options.assets);
  const theme = options.theme ?? "discern";
  await removeIfPresent(options.outputRoot);
  await Deno.mkdir(options.outputRoot, { recursive: true });

  const css = [
    LAYER_ORDER,
    generateTokenCss(),
    theme === "discern" ? discernThemeCss : "",
    foundationCss,
    utilitiesCss,
    ...selection.entries.map((entry) => entry.css),
  ].filter((section) => section.trim().length > 0)
    .map((section) => section.trim()).join("\n\n") + "\n";

  const files: IntegrityFile[] = [
    await writeOutput(
      options.outputRoot,
      "discern.css",
      "text/css; charset=utf-8",
      textEncoder.encode(css),
    ),
  ];
  const assetPaths: string[] = [];
  for (
    const asset of embeddedRuntimeAssets.filter((candidate) =>
      assets.includes(candidate.selection)
    )
  ) {
    files.push(
      await writeOutput(
        options.outputRoot,
        asset.path,
        asset.mediaType,
        decodeAsset(asset),
      ),
    );
    assetPaths.push(asset.path);
  }

  const components: ManifestComponent[] = selection.entries.map((entry) => ({
    id: entry.meta.slug,
    name: entry.meta.name,
    group: entry.meta.group,
    dependencies: entry.dependencies,
    ownedClasses: entry.ownedClasses,
    publicTokenNames: entry.publicTokenNames,
  }));
  const manifest: RuntimeManifest = {
    schemaVersion: RUNTIME_MANIFEST_SCHEMA_VERSION,
    package: "discern-design-system",
    selection: {
      all: options.all === true,
      requestedComponents: selection.requestedComponents,
      requestedGroups: selection.requestedGroups,
      resolvedComponents: components.map((component) => component.id),
      assets,
      theme,
    },
    groups: componentGroups.map((name) => ({
      name,
      components: componentRegistry.filter((entry) => entry.meta.group === name)
        .map((entry) => entry.meta.slug),
    })),
    components,
    publicTokenNames: allTokens.map((token) => token.name),
    outputs: {
      css: "discern.css",
      manifest: "manifest.json",
      assets: assetPaths,
    },
    integrity: { algorithm: "sha256", files },
  };
  await Deno.writeTextFile(
    new URL("manifest.json", options.outputRoot),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return {
    components: components.length,
    tokens: allTokens.length,
    manifest,
  };
}
