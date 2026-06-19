/**
 * `icculus add-preset <name>` — overlay a preset from `presets/<name>/` onto
 * the current project (ADR 0007, ADR 0018).
 *
 * A preset is a **file overlay plus config fills**: every file in the preset dir
 * is scaffolded with the same token/merge/exec-bit machinery as `init`
 * (seed/managed rules apply), and an optional `preset.json` at its root —
 * metadata, never scaffolded — is an icculus config document (the same shape
 * `init --config` reads) whose capabilities / checks / scopes / ratchets are
 * written into the project's `.icculus/config.toml` via the comment-preserving
 * editor. So a preset overlays both files (recipes, skills, guideline fragments,
 * docs) and config (capabilities, checks, scopes).
 *
 * This ships the *mechanism* only: no preset is bundled (the example used to
 * exercise the contract lives under tests/fixtures/presets/).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { applyPlan, buildPlan } from "../lib/fs_plan.ts";
import {
  DEFAULT_MANAGED_SPEC,
  loadManagedSpec,
  mergeManagedSpecs,
} from "../lib/manifest.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";
import { confirmProceed } from "../lib/prompts.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyConfigDoc,
  assertSupportedVersion,
  type IcculusConfigDoc,
} from "../lib/config_doc.ts";

/** The reserved metadata filename at a preset root (never scaffolded). */
const PRESET_MANIFEST = "preset.json";

/**
 * Load a preset's `preset.json`, or undefined if absent. It is an icculus config
 * document (its capabilities/checks/scopes/ratchets are the fills); a
 * `description` field, if present, is metadata only. Its `version`, if present,
 * is validated the same way `init --config` validates one.
 */
async function loadPresetFills(
  presetDir: string,
): Promise<IcculusConfigDoc | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(presetDir, PRESET_MANIFEST));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${PRESET_MANIFEST} must be a JSON object`);
  }
  assertSupportedVersion(parsed as IcculusConfigDoc);
  return parsed as IcculusConfigDoc;
}

/** True when a preset's document carries any config to apply. */
function hasFills(fills: IcculusConfigDoc | undefined): boolean {
  return !!fills &&
    !!(fills.capabilities || fills.checks || fills.scopes || fills.ratchets);
}

/** Options accepted by `add-preset`. */
export interface AddPresetOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  yes: boolean;
}

/** Locate the `presets/` directory (sibling of `templates/`), if it exists. */
async function resolvePresetsDir(): Promise<string | undefined> {
  const override = Deno.env.get("ICCULUS_PRESETS_DIR");
  if (override) {
    return (await isDir(override)) ? override : undefined;
  }
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "presets");
    if (await isDir(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/** True when `path` is an existing directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/** List the available preset names (subdirectories of `presets/`). */
async function listPresets(
  presetsDir: string | undefined,
): Promise<string[]> {
  if (presetsDir === undefined) {
    return [];
  }
  const names: string[] = [];
  for await (const entry of Deno.readDir(presetsDir)) {
    if (entry.isDirectory) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/** Run `icculus add-preset <name>`. Returns a process exit code. */
export async function runAddPreset(
  name: string,
  options: AddPresetOptions,
): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Must be inside an initialized project (either layout — see resolveConfigPath).
  const configPath = await resolveConfigPath(destDir);
  let toml: ReturnType<typeof parseIcculusToml>;
  try {
    if (configPath === undefined) {
      throw new Deno.errors.NotFound("no icculus config");
    }
    toml = parseIcculusToml(await Deno.readTextFile(configPath));
  } catch {
    const message =
      "no icculus install here — run `icculus init` before adding a preset.";
    if (options.json) {
      log.jsonResult({ ok: false, error: "not_initialized", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  const presetsDir = await resolvePresetsDir();
  const available = await listPresets(presetsDir);
  const presetDir = presetsDir ? join(presetsDir, name) : undefined;

  if (presetDir === undefined || !(await isDir(presetDir))) {
    const message = available.length > 0
      ? `unknown preset "${name}". Available: ${available.join(", ")}.`
      : `unknown preset "${name}". This build ships no presets yet.`;
    if (options.json) {
      log.jsonResult({
        ok: false,
        error: "unknown_preset",
        message,
        available,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // A preset is scaffolded exactly like the base templates tree.
  const config: InitConfig = {
    projectName: toml.project.slug ?? "app",
    slug: toml.project.slug ?? "app",
    branchPrefix: toml.project.branch_prefix ?? DEFAULTS.branchPrefix,
    sourceGlobs: [...DEFAULTS.sourceGlobs],
    brief: "",
    agents:
      (toml.project.agents && toml.project.agents.length > 0
        ? toml.project.agents
        : [...DEFAULTS.agents]) as InitConfig["agents"],
  };
  const tokens = tokensFromConfig(config);
  // A preset's files are classified by the base managed-set plus any the preset
  // declares in its own managed.json (so it can own managed overlay files); the
  // declaration itself is never scaffolded.
  const presetSpec = await loadManagedSpec(presetDir);
  const plan = await buildPlan({
    templatesDir: presetDir,
    destDir,
    tokens,
    mode: "init",
    managedSpec: presetSpec
      ? mergeManagedSpecs(DEFAULT_MANAGED_SPEC, presetSpec)
      : DEFAULT_MANAGED_SPEC,
  });
  // preset.json is metadata (config fills), not a scaffolded file.
  plan.ops = plan.ops.filter((op) => op.targetRel !== PRESET_MANIFEST);

  // Load the preset's config fills and pre-compute the edited config, so a bad
  // preset.json fails before anything is written and dry-run reports it.
  let fills: IcculusConfigDoc | undefined;
  let filledToml: string | undefined;
  try {
    fills = await loadPresetFills(presetDir);
    if (hasFills(fills)) {
      const editor = new TomlEditor(
        await Deno.readTextFile(configPath!),
      );
      applyConfigDoc(editor, fills!);
      filledToml = editor.toString();
    }
  } catch (error) {
    const message = `preset "${name}" has invalid config fills: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (options.json) {
      log.jsonResult({ ok: false, error: "invalid_preset", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        preset: name,
        plan: planToJson(plan),
        config_fills: filledToml !== undefined,
      });
    } else {
      renderPlan(log, plan, `Dry run — preset "${name}" would overlay:`);
      if (filledToml !== undefined) {
        log.info("Would also apply config fills to .icculus/config.toml.");
      }
    }
    return 0;
  }

  if (!options.json) {
    renderReview(log, plan, destDir);
    if (filledToml !== undefined) {
      log.line("  .icculus/config.toml  apply preset config fills");
    }
    log.line();
  }
  if (!(await confirmProceed(`Overlay preset "${name}" now?`, options.yes))) {
    log.info("Aborted; nothing was written.");
    return 0;
  }

  const changed = await applyPlan(plan);
  if (filledToml !== undefined) {
    await Deno.writeTextFile(configPath!, filledToml);
  }
  if (options.json) {
    log.jsonResult({
      ok: true,
      preset: name,
      written: changed.map((op) => op.targetRel),
      config_fills: filledToml !== undefined,
    });
    return 0;
  }
  for (const op of changed) {
    log.ok(op.targetRel);
  }
  if (filledToml !== undefined) {
    log.ok(".icculus/config.toml (config fills applied)");
  }
  log.ok(`Preset "${name}" applied.`);
  return 0;
}
