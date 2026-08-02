/**
 * Provider hook integration refresh/checking.
 *
 * Hook files are committed provider settings, so they are neither generated agent
 * files nor one-shot user seeds. They sit in the middle: discern owns the hook
 * groups it declares in the provider registry, while users own other settings and
 * extra hooks in the same files. This module applies the same registry-derived
 * seed merge that setup uses, so refresh/status/doctor all agree on what "wired"
 * means for every provider.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import { resolveTemplatesDir } from "./paths.ts";
import { type Provider, providerFor } from "./providers.ts";
import { mergeJsonSettingsText } from "./settings_merge.ts";

export type ProviderHookDriftReason = "missing" | "stale" | "unreadable";

export interface ProviderHookDriftEntry {
  readonly agent: string;
  readonly label: string;
  readonly path: string;
  readonly reason: ProviderHookDriftReason;
  readonly detail?: string;
}

export interface ProviderHooksRefreshResult {
  readonly written: string[];
  readonly errors: string[];
}

/** Preserve an Error's message and stringify non-Error hook failures. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve configured agents to the providers that declare hook integrations. */
function hookProvidersForConfig(config: DiscernConfig): Provider[] {
  const providers: Provider[] = [];
  for (const agent of resolveConfiguredAgents(config)) {
    const provider = providerFor(agent);
    if (provider?.hooks !== undefined) {
      providers.push(provider);
    }
  }
  return providers;
}

/** Read a hook settings file, mapping absence to `undefined`. */
async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/** Recursively sort object keys so JSON equality ignores property order. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalJson((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Compare parsed JSON values without treating object-key order as drift. */
function semanticallyEqualJson(left: string, right: string): boolean {
  const parsedLeft: unknown = JSON.parse(left);
  const parsedRight: unknown = JSON.parse(right);
  return JSON.stringify(canonicalJson(parsedLeft)) ===
    JSON.stringify(canonicalJson(parsedRight));
}

/** Merge a provider's hook seed with the current settings into desired bytes. */
async function desiredHookText(
  root: string,
  templatesDir: string,
  provider: Provider,
): Promise<{ rel: string; existing: string | undefined; desired: string }> {
  const hooks = provider.hooks;
  if (hooks === undefined) {
    throw new Error(`${provider.name} declares no hooks integration`);
  }
  const rel = hooks.settingsFile;
  const template = await Deno.readTextFile(join(templatesDir, `${rel}.tmpl`));
  const existing = await readTextIfExists(join(root, rel));
  const merge = hooks.mergeSeed ?? mergeJsonSettingsText;
  return { rel, existing, desired: merge(existing, template) };
}

/** Compare JSON hook files semantically and other formats byte for byte. */
function hookTextCurrent(
  rel: string,
  existing: string | undefined,
  desired: string,
): boolean {
  if (existing === undefined) {
    return false;
  }
  if (rel.endsWith(".json")) {
    return semanticallyEqualJson(existing, desired);
  }
  return existing === desired;
}

/**
 * Re-apply configured provider hook seeds, preserving user-owned settings through
 * the provider's merge strategy. Missing hook files are recreated; malformed
 * existing settings are reported and left untouched.
 */
export async function wireProviderHooks(
  root: string,
  config: DiscernConfig,
): Promise<ProviderHooksRefreshResult> {
  const written: string[] = [];
  const errors: string[] = [];
  const providers = hookProvidersForConfig(config);
  if (providers.length === 0) {
    return { written, errors };
  }

  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch (error) {
    return {
      written,
      errors: [`could not locate hook seed templates: ${errText(error)}`],
    };
  }

  for (const provider of providers) {
    try {
      const { rel, existing, desired } = await desiredHookText(
        root,
        templatesDir,
        provider,
      );
      if (hookTextCurrent(rel, existing, desired)) {
        continue;
      }
      const out = join(root, rel);
      await ensureDir(dirname(out));
      await Deno.writeTextFile(out, desired);
      await Deno.chmod(out, 0o644);
      written.push(rel);
    } catch (error) {
      const rel = provider.hooks?.settingsFile ?? provider.name;
      errors.push(`could not update ${rel}: ${errText(error)}`);
    }
  }
  return { written, errors };
}

/**
 * Read-only check for provider hook files. The predicate is the same one refresh
 * uses: applying the registry-declared seed merge would be a no-op.
 */
export async function checkProviderHooksCurrent(
  root: string,
  config: DiscernConfig,
): Promise<ProviderHookDriftEntry[]> {
  const providers = hookProvidersForConfig(config);
  if (providers.length === 0) {
    return [];
  }

  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch (error) {
    const detail = `could not locate hook seed templates: ${errText(error)}`;
    return providers.map((provider) => ({
      agent: provider.name,
      label: provider.label,
      path: provider.hooks?.settingsFile ?? provider.name,
      reason: "unreadable",
      detail,
    }));
  }

  const drift: ProviderHookDriftEntry[] = [];
  for (const provider of providers) {
    const rel = provider.hooks?.settingsFile ?? provider.name;
    try {
      const { existing, desired } = await desiredHookText(
        root,
        templatesDir,
        provider,
      );
      if (hookTextCurrent(rel, existing, desired)) {
        continue;
      }
      drift.push({
        agent: provider.name,
        label: provider.label,
        path: rel,
        reason: existing === undefined ? "missing" : "stale",
      });
    } catch (error) {
      drift.push({
        agent: provider.name,
        label: provider.label,
        path: rel,
        reason: "unreadable",
        detail: errText(error),
      });
    }
  }
  return drift;
}
