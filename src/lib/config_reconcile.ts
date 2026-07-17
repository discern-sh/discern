/**
 * Reconcile a project's `discern.toml` scaffold against the current shipped
 * template without clobbering project-owned values.
 *
 * Versioned migrations transform behaviour. This pass handles the quieter class
 * of drift: a current-schema config can still be missing a documented section or
 * fixed key, or carry a stale ruled banner. The template remains the source of
 * managed banner prose and scaffold placement; existing values and comments
 * outside ruled regions are never rewritten.
 */

import { parseDiscernToml, renderTomlStringList } from "./toml_render.ts";
import { TomlEditor } from "./toml_edit.ts";
import {
  fixedSectionBannersFromTemplate,
  keyBlockFromTemplate,
  managedBannersFromTemplate,
  readConfigTemplate,
  scanManagedBanners,
  scanRuledBanners,
  sectionBlockFromTemplate,
  sectionKeyNamesFromTemplate,
  sectionNamesFromTemplate,
} from "./config_template.ts";
import { substituteTokens, type TokenMap } from "./template.ts";
import { defaultNeutralScopes, DEFAULTS } from "./config.ts";
import { KIT_VERSION } from "./version.ts";
import type { EnvReader } from "../shared/env.ts";
import {
  type DiscernConfig,
  parseConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";

export type ConfigReconcileOperation =
  | { kind: "section"; path: string }
  | { kind: "key"; path: string }
  | { kind: "banner"; path: string };

export interface ConfigReconcileResult {
  text: string;
  operations: ConfigReconcileOperation[];
  templateAvailable: boolean;
}

/** The user-populated record tables whose named entries are project-owned
 * population — never key-backfilled by scaffold reconciliation, and the families
 * whose shape-doc banners it manages instead (ADR 0138). */
export const RECORD_CONFIG_PATHS = [
  "checks",
  "scopes",
  "standards",
  "worktree.resources",
] as const;

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a path belongs to a user-populated record table. */
function isUnderRecordPath(path: string): boolean {
  return RECORD_CONFIG_PATHS.some((record) =>
    path === record || path.startsWith(`${record}.`)
  );
}

/** The section path that owns a dotted key path. */
function sectionForKey(path: string): string {
  return path.slice(0, path.lastIndexOf("."));
}

/** Whether a raw parsed config literally carries `path`. */
function hasRawPath(raw: Record<string, unknown>, path: string): boolean {
  let node: unknown = raw;
  for (const segment of path.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, segment)) {
      return false;
    }
    node = node[segment];
  }
  return true;
}

/** Active section headers literally present in a config file. */
function sectionHeaders(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim();
    if (section !== undefined) {
      out.add(section);
    }
  }
  return out;
}

/** Active section headers and their first line index. */
function sectionHeaderLines(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [index, line] of text.split("\n").entries()) {
    const section = line.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim();
    if (section !== undefined && !out.has(section)) {
      out.set(section, index);
    }
  }
  return out;
}

/** True for a blank (whitespace-only) line. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Active scalar/array key paths from the rendered template, skipping records. */
function fixedTemplateKeyPaths(
  node: unknown,
  prefix = "",
): string[] {
  if (!isRecord(node)) {
    return [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isUnderRecordPath(path)) {
      continue;
    }
    if (isRecord(value)) {
      out.push(...fixedTemplateKeyPaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** A defaulted config, used only when the current file is schema-invalid. */
function emptyDefaultConfig(): DiscernConfig {
  const parsed = parseConfig("");
  if (parsed.config === undefined) {
    throw new Error("empty config did not produce schema defaults");
  }
  return parsed.config;
}

/** Render the template with values derived from the current config. */
export function renderConfigTemplateForConfig(
  templateText: string,
  config: DiscernConfig,
): string {
  const tokens: TokenMap = {
    project_name: config.project.slug || "project",
    project_slug: config.project.slug,
    branch_prefix: config.repository.branch_prefix,
    agents_array: renderTomlStringList(resolveConfiguredAgents(config)),
    map_dir: config.map.dir,
    gotchas_doc: config.project.gotchas_doc,
    scopes_neutral: defaultNeutralScopes().join(", "),
    scopes_web: renderTomlStringList([...DEFAULTS.sourceGlobs]),
    scopes_previewable: DEFAULTS.scopesPreviewable.join(", "),
    kit_version: KIT_VERSION,
  };
  return substituteTokens(templateText, tokens).text;
}

/**
 * Reconcile the discern-owned managed banners: refresh each record family's
 * shape-doc banner to the current template. The named tables a banner documents —
 * and their own comments — live OUTSIDE the banner rules, so they are never
 * touched; only discern's documentation prose between the `# ───` rules is
 * refreshed (ADR 0138). Splices bottom-up so earlier spans' line indices stay
 * valid; reports the resulting operations top-down for readable output.
 */
function reconcileManagedBanners(
  configText: string,
  banners: Map<string, string>,
): { text: string; operations: ConfigReconcileOperation[] } {
  if (banners.size === 0) {
    return { text: configText, operations: [] };
  }
  const lines = configText.split("\n");
  const spans = scanManagedBanners(configText, RECORD_CONFIG_PATHS);
  const refreshed: number[] = [];
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    const canonical = banners.get(span.family);
    if (canonical === undefined) {
      continue; // the current template documents no banner for this family
    }
    if (lines.slice(span.start, span.end + 1).join("\n") === canonical) {
      continue; // already current
    }
    lines.splice(
      span.start,
      span.end - span.start + 1,
      ...canonical.split("\n"),
    );
    refreshed.push(span.start);
  }
  const byFamily = new Map(spans.map((s) => [s.start, s.family]));
  const operations = refreshed
    .sort((a, b) => a - b)
    .map((start): ConfigReconcileOperation => ({
      kind: "banner",
      path: byFamily.get(start) ?? "",
    }));
  return { text: lines.join("\n"), operations };
}

/**
 * Reconcile every ruled banner that belongs to a fixed section. Existing regions
 * are associated by the live section immediately following their closing rule,
 * not by their possibly-stale identity, so a renamed banner still converges. A
 * missing region is inserted directly before the section. Comments outside the
 * rules — including comments attached to keys inside the section — are untouched.
 */
function reconcileFixedSectionBanners(
  configText: string,
  banners: Map<string, string>,
): { text: string; operations: ConfigReconcileOperation[] } {
  if (banners.size === 0) {
    return { text: configText, operations: [] };
  }
  const lines = configText.split("\n");
  const headerLines = sectionHeaderLines(configText);
  const bannerSections = new Set(banners.keys());
  const attached = new Map<string, { start: number; end: number }>();
  for (const span of scanRuledBanners(configText)) {
    if (isUnderRecordPath(span.identity)) {
      continue; // a missing fixed banner must not consume an adjacent record banner
    }
    if (bannerSections.has(span.identity)) {
      if (!attached.has(span.identity)) {
        attached.set(span.identity, { start: span.start, end: span.end });
      }
      continue; // a current identity owns its region even if section order drifted
    }
    let next = span.end + 1;
    while (next < lines.length && isBlank(lines[next] ?? "")) {
      next++;
    }
    const section = (lines[next] ?? "").match(/^\s*\[([^\]]+)\]/)?.[1]
      ?.trim();
    if (
      section !== undefined && bannerSections.has(section) &&
      !attached.has(section)
    ) {
      attached.set(section, { start: span.start, end: span.end });
    }
  }

  const changes: Array<{
    section: string;
    position: number;
    header: number;
    span?: { start: number; end: number };
    canonical: string;
  }> = [];
  for (const [section, canonical] of banners) {
    const header = headerLines.get(section);
    if (header === undefined) {
      continue; // the structural pass owns a wholly missing section
    }
    const span = attached.get(section);
    if (
      span !== undefined &&
      lines.slice(span.start, span.end + 1).join("\n") === canonical
    ) {
      continue;
    }
    changes.push({
      section,
      position: span?.start ?? header,
      header,
      ...(span === undefined ? {} : { span }),
      canonical,
    });
  }

  for (const change of [...changes].sort((a, b) => b.position - a.position)) {
    const canonical = change.canonical.split("\n");
    if (change.span !== undefined) {
      lines.splice(
        change.span.start,
        change.span.end - change.span.start + 1,
        ...canonical,
      );
      continue;
    }
    const prefix = change.header > 0 && !isBlank(lines[change.header - 1] ?? "")
      ? [""]
      : [];
    lines.splice(change.header, 0, ...prefix, ...canonical, "");
  }

  return {
    text: lines.join("\n"),
    operations: changes
      .sort((a, b) => a.position - b.position)
      .map((change) => ({ kind: "banner", path: change.section })),
  };
}

/** Reconcile `configText` using an already-rendered current template. */
export function reconcileConfigTextWithTemplate(
  configText: string,
  renderedTemplate: string,
): ConfigReconcileResult {
  // Pass 0: refresh discern-owned managed banners. Raw comment surgery — it
  // changes no parsed value, so the structural passes below read the same config.
  const banners = managedBannersFromTemplate(
    renderedTemplate,
    RECORD_CONFIG_PATHS,
  );
  const bannerPass = reconcileManagedBanners(configText, banners);
  const fixedBannerPass = reconcileFixedSectionBanners(
    bannerPass.text,
    fixedSectionBannersFromTemplate(renderedTemplate),
  );
  const baseText = fixedBannerPass.text;

  const currentRaw = parseDiscernToml(baseText).raw;
  const templateRaw = parseDiscernToml(renderedTemplate).raw;
  const currentSections = sectionHeaders(baseText);
  const activeSections = sectionNamesFromTemplate(renderedTemplate).filter(
    (section) => !isUnderRecordPath(section),
  );

  const missingSections = activeSections.filter((section) =>
    !currentSections.has(section) &&
    sectionBlockFromTemplate(renderedTemplate, section) !== undefined
  );
  const missingSectionSet = new Set(missingSections);
  const missingKeys = fixedTemplateKeyPaths(templateRaw).filter((path) => {
    const section = sectionForKey(path);
    return !missingSectionSet.has(section) &&
      currentSections.has(section) &&
      !hasRawPath(currentRaw, path) &&
      keyBlockFromTemplate(renderedTemplate, path) !== undefined;
  });

  const operations: ConfigReconcileOperation[] = [
    ...bannerPass.operations,
    ...fixedBannerPass.operations,
    ...missingSections.map((path) => ({ kind: "section" as const, path })),
    ...missingKeys.map((path) => ({ kind: "key" as const, path })),
  ];
  if (missingSections.length === 0 && missingKeys.length === 0) {
    return { text: baseText, operations, templateAvailable: true };
  }

  const editor = new TomlEditor(baseText);
  const placedSections = new Set(currentSections);
  for (const section of missingSections) {
    const block = sectionBlockFromTemplate(renderedTemplate, section);
    if (block === undefined) {
      continue;
    }
    if (section === "meta") {
      editor.insertSectionBlockAtTop(block);
    } else {
      const index = activeSections.indexOf(section);
      const anchor = [...activeSections.slice(0, index)].reverse().find((s) =>
        placedSections.has(s)
      );
      if (anchor === undefined) {
        editor.insertSectionBlockAtTop(block);
      } else {
        editor.insertSectionBlockAfter(anchor, block);
      }
    }
    placedSections.add(section);
  }

  for (const path of missingKeys) {
    const block = keyBlockFromTemplate(renderedTemplate, path);
    if (block === undefined) {
      continue;
    }
    const section = sectionForKey(path);
    const key = path.slice(path.lastIndexOf(".") + 1);
    editor.insertKeyBlock(
      section,
      key,
      block,
      sectionKeyNamesFromTemplate(renderedTemplate, section),
    );
  }

  return {
    text: editor.toString(),
    operations,
    templateAvailable: true,
  };
}

/** Read, render, and apply the current template reconciliation pass. */
export async function reconcileConfigText(
  configText: string,
  env: EnvReader = Deno.env,
): Promise<ConfigReconcileResult> {
  const template = await readConfigTemplate(env);
  if (template === undefined) {
    return { text: configText, operations: [], templateAvailable: false };
  }
  const parsed = parseConfig(configText);
  const config = parsed.config ?? emptyDefaultConfig();
  return reconcileConfigTextWithTemplate(
    configText,
    renderConfigTemplateForConfig(template, config),
  );
}
