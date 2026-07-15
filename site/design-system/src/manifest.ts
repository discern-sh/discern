import { componentRegistry } from "./generated/component-registry.ts";
import { allTokens } from "./tokens/tokens.ts";
import {
  type ComponentGroup,
  componentGroups,
} from "./types/component-meta.ts";
import type { RuntimeAssetSelection } from "./runtime-assets.ts";

export const RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface ManifestComponent {
  readonly id: string;
  readonly name: string;
  readonly group: ComponentGroup;
  readonly dependencies: readonly string[];
  readonly ownedClasses: readonly string[];
  readonly publicTokenNames: readonly string[];
}

export interface ManifestGroup {
  readonly name: ComponentGroup;
  readonly components: readonly string[];
}

export interface IntegrityFile {
  readonly path: string;
  readonly bytes: number;
  readonly integrity: `sha256:${string}`;
  readonly mediaType: string;
}

export interface RuntimeManifest {
  readonly schemaVersion: typeof RUNTIME_MANIFEST_SCHEMA_VERSION;
  readonly package: "discern-design-system";
  readonly selection: {
    readonly all: boolean;
    readonly requestedComponents: readonly string[];
    readonly requestedGroups: readonly ComponentGroup[];
    readonly resolvedComponents: readonly string[];
    readonly assets: readonly RuntimeAssetSelection[];
    readonly theme: "discern" | "none";
  };
  readonly groups: readonly ManifestGroup[];
  readonly components: readonly ManifestComponent[];
  readonly publicTokenNames: readonly string[];
  readonly outputs: {
    readonly css: "discern.css";
    readonly manifest: "manifest.json";
    readonly assets: readonly string[];
  };
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly files: readonly IntegrityFile[];
  };
}

/** Package identity and ownership facts without catalogue descriptions or React. */
export const packageManifest = {
  schemaVersion: RUNTIME_MANIFEST_SCHEMA_VERSION,
  package: "discern-design-system",
  groups: componentGroups.map((name) => ({
    name,
    components: componentRegistry.filter((entry) => entry.meta.group === name)
      .map((entry) => entry.meta.slug),
  })),
  components: componentRegistry.map((entry) => ({
    id: entry.meta.slug,
    name: entry.meta.name,
    group: entry.meta.group,
    dependencies: entry.dependencies,
    ownedClasses: entry.ownedClasses,
    publicTokenNames: entry.publicTokenNames,
  })),
  publicTokenNames: allTokens.map((token) => token.name),
} as const;
