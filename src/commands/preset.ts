/**
 * `discern preset <name>` — overlay a preset from `presets/<name>/` onto
 * the current project (ADR 0007, ADR 0018).
 *
 * A preset is a **file overlay plus config fills**: every file in the preset dir
 * is scaffolded with the same token/merge/exec-bit machinery as `setup`
 * (the seed-scaffolding rules apply — create-or-skip, never overwrite a present
 * file), and an optional `preset.json` at its root —
 * metadata, never scaffolded — is a discern config document (the same shape
 * `setup --config` reads) whose jobs / scopes / standards are
 * written into the project's `discern.toml` via the comment-preserving
 * editor. So a preset overlays both files (project scripts, skills, guideline fragments,
 * docs) and config (jobs, scopes).
 *
 * The config half honors the same rule as the file half: **fill-if-absent,
 * never overwrite** — a value already set in `discern.toml` is the user's and
 * stands; the preset's fill for it is skipped. Every key is disclosed per
 * outcome (filled vs kept) in the dry-run, the confirm review, and the result.
 *
 * This ships the *mechanism* only: no preset is bundled (the example that
 * exercises the contract lives under tests/fixtures/presets/).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { notInitializedResult } from "../shared/env.ts";
import { Logger } from "../lib/log.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { DEFAULTS, type SetupConfig, tokensFromConfig } from "../lib/config.ts";
import { applyPlan, buildPlan } from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";
import { canPrompt, confirmProceed } from "../lib/prompts.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyConfigDoc,
  assertSupportedVersion,
  type ConfigFillReport,
  type DiscernConfigDoc,
  docHasFills,
} from "../lib/config_doc.ts";
import { writeDiscernToml } from "../lib/tidy_format.ts";

/** The reserved metadata filename at a preset root (never scaffolded). */
const PRESET_MANIFEST = "preset.json";

/**
 * Load a preset's `preset.json`, or undefined if absent. It is a discern config
 * document (its jobs/scopes/standards are the fills); a
 * `description` field, if present, is metadata only. Its `version`, if present,
 * is validated the same way `setup --config` validates one.
 */
async function loadPresetFills(
  presetDir: string,
): Promise<DiscernConfigDoc | undefined> {
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
  assertSupportedVersion(parsed as DiscernConfigDoc);
  return parsed as DiscernConfigDoc;
}

/** Options accepted by `preset`. */
export interface PresetOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  yes: boolean;
}

/** Locate the `presets/` directory (sibling of `templates/`), if it exists. */
async function resolvePresetsDir(): Promise<string | undefined> {
  const override = Deno.env.get("DISCERN_PRESETS_DIR");
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

/** Run `discern preset <name>`. Returns a process exit code. */
export async function runPreset(
  name: string,
  options: PresetOptions,
): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Must be inside an initialized project.
  const configPath = await resolveConfigPath(destDir);
  let toml: ReturnType<typeof parseDiscernToml>;
  try {
    if (configPath === undefined) {
      throw new Deno.errors.NotFound("no discern config");
    }
    toml = parseDiscernToml(await Deno.readTextFile(configPath));
  } catch {
    const message =
      "no discern install here — run `discern setup` before adding a preset.";
    if (options.json) {
      log.result(notInitializedResult("preset", message));
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
      log.result({
        ok: false,
        verb: "preset",
        error: "unknown_preset",
        message,
        data: { available },
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // Past the guarded read above, the config path is known to exist.
  if (configPath === undefined) return 1;

  // A preset is scaffolded exactly like the base templates tree.
  const config: SetupConfig = {
    projectName: (toml.project.name?.trim() || toml.project.slug) ?? "app",
    slug: toml.project.slug ?? "app",
    branchPrefix: toml.repository.branch_prefix ?? DEFAULTS.branchPrefix,
    sourceGlobs: [...DEFAULTS.sourceGlobs],
    brief: "",
    agents:
      (toml.project.agents && toml.project.agents.length > 0
        ? toml.project.agents
        : [...DEFAULTS.agents]) as SetupConfig["agents"],
  };
  const tokens = tokensFromConfig(config);
  // A preset's files overlay exactly like the base templates tree: every file is
  // a write-once seed (a changed preset file on re-apply is skipped as a present
  // seed). Unlike `setup`, a preset's `skills/`/`guidance/` ARE intended overlays,
  // so they are scaffolded (excludeNonSeed defaults off).
  const plan = await buildPlan({ templatesDir: presetDir, destDir, tokens });
  // preset.json is metadata (config fills), not a scaffolded file.
  plan.ops = plan.ops.filter((op) => op.targetRel !== PRESET_MANIFEST);

  // Load the preset's config fills and pre-compute the edited config, so a bad
  // preset.json fails before anything is written and dry-run reports it.
  let fills: DiscernConfigDoc | undefined;
  let filledToml: string | undefined;
  let fillReport: ConfigFillReport | undefined;
  try {
    fills = await loadPresetFills(presetDir);
    if (fills !== undefined && docHasFills(fills)) {
      const editor = new TomlEditor(
        await Deno.readTextFile(configPath),
      );
      // Fill-if-absent: a value already set in discern.toml is the user's; the
      // preset's fill for it is skipped and disclosed, mirroring the file
      // half's create-or-skip rule.
      fillReport = applyConfigDoc(editor, fills, { skipExisting: true });
      if (fillReport.filled.length > 0) {
        filledToml = editor.toString();
      }
    }
  } catch (error) {
    const message = `preset "${name}" has invalid config fills: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (options.json) {
      log.result({
        ok: false,
        verb: "preset",
        error: "invalid_preset",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "preset",
        dry_run: true,
        data: {
          preset: name,
          plan: planToJson(plan),
          config_fills: filledToml !== undefined,
          ...fillDisclosure(fillReport),
        },
      });
    } else {
      renderPlan(log, plan, `Dry run — preset "${name}" would overlay:`);
      if (fillReport !== undefined && fillReport.filled.length > 0) {
        log.info(
          `Would fill discern.toml: ${fillReport.filled.join(", ")}.`,
        );
      }
      if (fillReport !== undefined && fillReport.skipped.length > 0) {
        log.info(
          `Would keep your existing discern.toml values (already set): ${
            fillReport.skipped.join(", ")
          }.`,
        );
      }
    }
    return 0;
  }

  if (!options.json) {
    renderReview(log, plan, destDir);
    for (const key of fillReport?.filled ?? []) {
      log.line(`  discern.toml  fill ${key}`);
    }
    for (const key of fillReport?.skipped ?? []) {
      log.line(`  discern.toml  keep ${key} (already set — yours stands)`);
    }
    log.group("confirmation");
  }
  if (!options.yes && !options.json && !canPrompt(false)) {
    log.error(
      `Applying preset "${name}" needs confirmation. Review the plan above, then re-run with --yes in CI, under --plain, or without terminal input.`,
    );
    return 1;
  }
  if (
    !(await confirmProceed(
      `Overlay preset "${name}" now?`,
      options.yes,
      options.json,
    ))
  ) {
    log.info("Aborted; nothing was written.");
    return 0;
  }

  const changed = await applyPlan(plan);
  if (filledToml !== undefined) {
    await writeDiscernToml(configPath, filledToml);
  }
  if (options.json) {
    log.result({
      ok: true,
      verb: "preset",
      data: {
        preset: name,
        written: changed.map((op) => op.targetRel),
        config_fills: filledToml !== undefined,
        ...fillDisclosure(fillReport),
      },
    });
    return 0;
  }
  for (const op of changed) {
    log.ok(op.targetRel);
  }
  if (fillReport !== undefined && filledToml !== undefined) {
    log.ok(`discern.toml (filled: ${fillReport.filled.join(", ")})`);
  }
  if (fillReport !== undefined && fillReport.skipped.length > 0) {
    log.info(
      `discern.toml kept your existing values: ${
        fillReport.skipped.join(", ")
      }.`,
    );
  }
  log.ok(`Preset "${name}" applied.`);
  return 0;
}

/** The per-key config-fill disclosure for the `--json` payloads: which dotted
 * paths the preset fills (or would fill) and which it keeps as the user's.
 * Empty when the preset carries no fills at all. */
function fillDisclosure(
  report: ConfigFillReport | undefined,
): {
  config_fills_applied?: string[];
  config_fills_skipped?: string[];
} {
  if (report === undefined) {
    return {};
  }
  return {
    config_fills_applied: report.filled,
    config_fills_skipped: report.skipped,
  };
}
