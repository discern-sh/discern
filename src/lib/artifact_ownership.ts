/**
 * Canonical project-tree artifact enumeration.
 *
 * The ADR 0099 write boundary, the ownership forcing function, and the
 * install-surface inventory all consume this one normalized list. Configurable
 * sources and provider artifacts keep their declarations in their existing
 * registries; this module combines them with fixed project shims and the
 * configured worktree environment paths.
 */

import { AGENT_NAMES, type DiscernConfig } from "../shared/config_schema.ts";
import {
  ARTIFACT_PROVENANCE_SOURCES,
  commentCapableNonContextArtifact,
  declaredFileOwnership,
  declaredWrittenArtifactClass,
  discernProjectPayloadLicense,
  FILE_OWNERSHIP_BUCKETS,
  type FileOwnershipDeclaration,
  type FileOwnershipKind,
  PROVIDER_LOCAL,
  type WrittenArtifactClass,
  type WrittenArtifactClassDeclaration,
} from "../shared/file_ownership.ts";
import {
  guidanceSeedRel,
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathEntry,
} from "../shared/paths_registry.ts";
import { PROVIDERS, wiredMcp } from "./providers.ts";

/** Whether one declaration admits one file or every file below a directory. */
export type ArtifactPathKind = "file" | "directory";

/** One project-relative path declaration and its File ownership answer. */
export interface ArtifactPathEntry {
  readonly id: string;
  readonly path: string;
  readonly pathKind: ArtifactPathKind;
  readonly ownership: FileOwnershipDeclaration;
  /** Required for Shared and Generated entries; absent on sources and provider state. */
  readonly writtenArtifact?: WrittenArtifactClassDeclaration;
  readonly description: string;
}

/** A path discern continues to write or maintain after setup. */
interface WrittenArtifactPathEntry extends ArtifactPathEntry {
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
}

/** Fixed project-tree paths outside the source and provider registries. */
export const FIXED_PROJECT_ARTIFACTS: readonly WrittenArtifactPathEntry[] = [
  {
    id: "fixed:config",
    path: "discern.toml",
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE_SOURCES.config,
    ),
    description:
      "Project configuration. discern maintains its fixed scaffold and ruled banners.",
  },
  {
    id: "fixed:gitignore",
    path: ".gitignore",
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE_SOURCES.gitignore,
    ),
    description: "Project ignore rules. discern maintains its marked block.",
  },
];

/** Return the environment artifacts. */
function environmentArtifacts(
  config: DiscernConfig,
): WrittenArtifactPathEntry[] {
  return config.worktree.env_files.map((path, index) => ({
    id: `fixed:environment:${index}`,
    path,
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    ),
    description:
      "Worktree environment file. discern maintains inherited entries plus DISCERN_* identity and resource entries; inheritance may create the first configured file.",
  }));
}

/** Return the value at. */
function valueAt(config: DiscernConfig, dotted: string): unknown {
  let value: unknown = config;
  for (const segment of dotted.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Return the source artifact path. */
function sourceArtifactPath(
  entry: SourcePathEntry,
  config: DiscernConfig,
): string {
  switch (entry.resolution) {
    case "default":
      return entry.defaultPath;
    case "guidance-seed":
      return guidanceSeedRel(config.guidance.sources);
    case "configured": {
      if (entry.key === null) {
        throw new Error(
          `${entry.defaultPath} uses configured resolution without a config key`,
        );
      }
      const value = valueAt(config, entry.key);
      if (typeof value !== "string") {
        throw new Error(`${entry.key} must resolve to one path`);
      }
      return value;
    }
  }
}

/** Return the source artifacts. */
function sourceArtifacts(config: DiscernConfig): ArtifactPathEntry[] {
  return SOURCE_PATH_NAMES.map((name) => {
    const entry = SOURCE_PATHS[name];
    return {
      id: `source:${name}`,
      path: sourceArtifactPath(entry, config),
      pathKind: entry.pathKind,
      ownership: entry.ownership,
      description: entry.description,
    };
  });
}

/** Return the provider artifacts. */
function providerArtifacts(): ArtifactPathEntry[] {
  const entries: ArtifactPathEntry[] = [];
  for (const name of AGENT_NAMES) {
    const provider = PROVIDERS[name];
    entries.push({
      id: `provider:${name}:guidance`,
      path: provider.guidanceFile.path,
      pathKind: "file",
      ownership: provider.guidanceFile.ownership,
      writtenArtifact: provider.guidanceFile.writtenArtifact,
      description: "Agent file compiled from the configured guidance sources.",
    });
    if (provider.skillsDir !== undefined) {
      entries.push({
        id: `provider:${name}:skills`,
        path: provider.skillsDir.path,
        pathKind: "directory",
        ownership: provider.skillsDir.ownership,
        writtenArtifact: provider.skillsDir.writtenArtifact,
        description:
          "Materialized skills directory rebuilt by `discern refresh`.",
      });
    }
    const mcp = wiredMcp(provider);
    if (mcp !== undefined) {
      entries.push({
        id: `provider:${name}:mcp`,
        path: mcp.configFile,
        pathKind: "file",
        ownership: mcp.ownership,
        writtenArtifact: mcp.writtenArtifact,
        description:
          "Provider configuration. discern maintains its registered entries.",
      });
    }
    if (provider.hooks !== undefined) {
      entries.push({
        id: `provider:${name}:hooks`,
        path: provider.hooks.settingsFile,
        pathKind: "file",
        ownership: provider.hooks.ownership,
        writtenArtifact: provider.hooks.writtenArtifact,
        description:
          "Provider configuration. discern maintains its registered entries.",
      });
    }
    if (provider.worktreeApp !== undefined) {
      entries.push({
        id: `provider:${name}:worktree-app`,
        path: provider.worktreeApp.configFile,
        pathKind: "file",
        ownership: provider.worktreeApp.ownership,
        writtenArtifact: provider.worktreeApp.writtenArtifact,
        description:
          "Provider app configuration. discern maintains its setup and cleanup entries.",
      });
    }
    if (provider.projectRules !== undefined) {
      entries.push({
        id: `provider:${name}:project-rules`,
        path: provider.projectRules.rulesFile,
        pathKind: "file",
        ownership: provider.projectRules.ownership,
        writtenArtifact: provider.projectRules.writtenArtifact,
        description:
          "Provider rules entry maintained by discern. Neighboring rules remain the project's.",
      });
    }
    for (const local of provider.localState ?? []) {
      entries.push({
        id: `provider:${name}:local:${local.path}`,
        path: local.path,
        pathKind: "file",
        ownership: local.ownership,
        description: local.ownership[PROVIDER_LOCAL] ??
          "Provider-created machine-local state.",
      });
    }
  }
  return entries;
}

/** Merge the description. */
function mergeDescription(current: string, incoming: string): string {
  if (current === incoming || current.includes(incoming)) {
    return current;
  }
  return `${current} ${incoming}`;
}

/** Normalize the artifacts. */
function normalizeArtifacts(
  declarations: readonly ArtifactPathEntry[],
): ArtifactPathEntry[] {
  const byPath = new Map<string, ArtifactPathEntry>();
  for (const declaration of declarations) {
    const kind = declaredFileOwnership(declaration);
    const writtenClass = writtenArtifactClass(declaration);
    const key = declaration.path;
    const current = byPath.get(key);
    if (current === undefined) {
      byPath.set(key, declaration);
      continue;
    }
    const currentKind = declaredFileOwnership(current);
    const currentWrittenClass = writtenArtifactClass(current);
    if (current.pathKind !== declaration.pathKind) {
      throw new Error(
        `${declaration.path} is declared as both a file and a directory`,
      );
    }
    if (currentKind !== kind) {
      throw new Error(
        `${declaration.path} has conflicting ownership declarations: ` +
          `${currentKind} and ${kind}`,
      );
    }
    if (currentWrittenClass !== writtenClass) {
      throw new Error(
        `${declaration.path} has conflicting written-artifact classes: ` +
          `${currentWrittenClass ?? "none"} and ${writtenClass ?? "none"}`,
      );
    }
    byPath.set(key, {
      ...current,
      id: `${current.id},${declaration.id}`,
      description: mergeDescription(
        current.description,
        declaration.description,
      ),
    });
  }
  return [...byPath.values()];
}

/**
 * Every project-tree path discern writes or maintains, plus declared
 * provider-local state that discern only keeps outside Git.
 */
export function projectArtifactPaths(
  config: DiscernConfig,
): ArtifactPathEntry[] {
  return normalizeArtifacts([
    ...sourceArtifacts(config),
    ...FIXED_PROJECT_ARTIFACTS,
    ...environmentArtifacts(config),
    ...providerArtifacts(),
  ]);
}

/** True when `rel` is inside one registered file or directory path. */
export function artifactPathMatches(
  entry: ArtifactPathEntry,
  rel: string,
): boolean {
  if (entry.pathKind === "file") {
    return rel === entry.path;
  }
  const prefix = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
  return rel.startsWith(prefix);
}

/** Whether discern may write this registered entry. */
export function isDiscernWriteTarget(entry: ArtifactPathEntry): boolean {
  return declaredFileOwnership(entry) !== PROVIDER_LOCAL;
}

/**
 * The provenance class for an artifact discern continues to write or maintain.
 * Project-owned seeds and provider-local state return undefined and must not
 * carry a declaration.
 */
export function writtenArtifactClass(
  entry: ArtifactPathEntry,
): WrittenArtifactClass | undefined {
  const ownership = declaredFileOwnership(entry);
  const isWritten = ownership === "shared" || ownership === "generated";
  if (!isWritten) {
    if (entry.writtenArtifact !== undefined) {
      throw new Error(
        `${entry.id} is ${ownership} and must not declare a written-artifact class`,
      );
    }
    return undefined;
  }
  if (entry.writtenArtifact === undefined) {
    return declaredWrittenArtifactClass({
      id: entry.id,
      writtenArtifact: {},
    });
  }
  return declaredWrittenArtifactClass({
    id: entry.id,
    writtenArtifact: entry.writtenArtifact,
  });
}

/** Marker delimiting the generated inventory within the development page. */
export const ARTIFACT_INVENTORY_START =
  "<!-- BEGIN GENERATED: project artifact ownership -->";
export const ARTIFACT_INVENTORY_END =
  "<!-- END GENERATED: project artifact ownership -->";

const OWNERSHIP_LABELS: Readonly<Record<FileOwnershipKind, string>> = {
  "project-owned": "Project-owned",
  shared: "Shared",
  generated: "Generated",
  "provider-local": "Provider-local",
};

const WRITTEN_ARTIFACT_LABELS: Readonly<Record<WrittenArtifactClass, string>> =
  {
    "context-loaded": "Context-loaded",
    "comment-incapable": "Comment-incapable",
    "comment-capable-non-context": "Comment-capable non-context",
  };

/** Return the markdown cell. */
function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Return the displayed path. */
function displayedPath(entry: ArtifactPathEntry): string {
  const path = entry.pathKind === "directory"
    ? `${entry.path.replace(/\/$/, "")}/**`
    : entry.path;
  return `\`${path}\``;
}

/** Render the markdown table. */
function renderMarkdownTable(
  headings: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  const widths = headings.map((heading, index) =>
    Math.max(
      heading.length,
      ...rows.map((row) => row[index]?.length ?? 0),
    )
  );
  const line = (cells: readonly string[]): string =>
    `| ${
      cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
        .join(
          " | ",
        )
    } |`;
  return [
    line(headings),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
  ];
}

/** Render the exhaustive registry-derived Markdown inventory. */
export function renderArtifactInventory(
  entries: readonly ArtifactPathEntry[],
): string {
  const order: readonly FileOwnershipKind[] = [
    ...FILE_OWNERSHIP_BUCKETS,
    PROVIDER_LOCAL,
  ];
  const sorted = [...entries].sort((a, b) => {
    const ownershipOrder = order.indexOf(declaredFileOwnership(a)) -
      order.indexOf(declaredFileOwnership(b));
    return ownershipOrder !== 0 ? ownershipOrder : a.path.localeCompare(b.path);
  });
  const rows = sorted.map((entry) => {
    const artifactClass = writtenArtifactClass(entry);
    const payloadLicense = discernProjectPayloadLicense(entry);
    return [
      displayedPath(entry),
      OWNERSHIP_LABELS[declaredFileOwnership(entry)],
      artifactClass === undefined
        ? "—"
        : WRITTEN_ARTIFACT_LABELS[artifactClass],
      payloadLicense ?? "—",
      markdownCell(entry.description),
    ];
  });
  return [
    ARTIFACT_INVENTORY_START,
    "<!-- Generated by `deno task codegen` from the source-path and provider registries. -->",
    "",
    ...renderMarkdownTable(
      [
        "Path",
        "Ownership",
        "Provenance class",
        "Discern-authored portions",
        "What discern maintains",
      ],
      rows,
    ),
    "",
    ARTIFACT_INVENTORY_END,
  ].join("\n");
}

/** Replace the generated inventory block without changing the rest of the page. */
export function replaceArtifactInventory(
  document: string,
  inventory: string,
): string {
  const start = document.indexOf(ARTIFACT_INVENTORY_START);
  const end = document.indexOf(ARTIFACT_INVENTORY_END);
  if (start < 0 || end < start) {
    throw new Error(
      "install-surface.md is missing the generated artifact inventory markers",
    );
  }
  const after = end + ARTIFACT_INVENTORY_END.length;
  return `${document.slice(0, start)}${inventory}${document.slice(after)}`;
}
