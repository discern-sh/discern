/**
 * `icculus add-adapter <name>` — overlay an adapter from `adapters/<name>/` onto
 * the current project (ADR 0007).
 *
 * An adapter is a **file overlay plus config fills**: every file in the adapter
 * dir is scaffolded with the same token/merge/exec-bit machinery as `init`
 * (seed/managed rules apply), and an optional `adapter.json` at its root —
 * metadata, never scaffolded — is an icculus config document (the same shape
 * `init --config` reads) whose slots / scopes / side_gates / ratchets are
 * written into the project's `icculus.toml` via the comment-preserving editor.
 * So an adapter overlays both files (recipes, skills, guideline fragments, docs)
 * and config (slots, scopes, side-gates).
 *
 * This ships the *mechanism* only: no adapter is bundled (the example used to
 * exercise the contract lives under tests/fixtures/adapters/).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { applyPlan, buildPlan } from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";
import { confirmProceed } from "../lib/prompts.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyConfigDoc,
  assertSupportedVersion,
  type IcculusConfigDoc,
} from "../lib/config_doc.ts";

/** The reserved metadata filename at an adapter root (never scaffolded). */
const ADAPTER_MANIFEST = "adapter.json";

/**
 * Load an adapter's `adapter.json`, or undefined if absent. It is an icculus
 * config document (its slots/scopes/side_gates/ratchets are the fills); a
 * `description` field, if present, is metadata only. Its `version`, if present,
 * is validated the same way `init --config` validates one.
 */
async function loadAdapterFills(
  adapterDir: string,
): Promise<IcculusConfigDoc | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(adapterDir, ADAPTER_MANIFEST));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${ADAPTER_MANIFEST} must be a JSON object`);
  }
  assertSupportedVersion(parsed as IcculusConfigDoc);
  return parsed as IcculusConfigDoc;
}

/** True when an adapter's document carries any config to apply. */
function hasFills(fills: IcculusConfigDoc | undefined): boolean {
  return !!fills &&
    !!(fills.slots || fills.scopes || fills.side_gates || fills.ratchets);
}

/** Options accepted by `add-adapter`. */
export interface AddAdapterOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  yes: boolean;
}

/** Locate the `adapters/` directory (sibling of `templates/`), if it exists. */
async function resolveAdaptersDir(): Promise<string | undefined> {
  const override = Deno.env.get("ICCULUS_ADAPTERS_DIR");
  if (override) {
    return (await isDir(override)) ? override : undefined;
  }
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "adapters");
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

/** List the available adapter names (subdirectories of `adapters/`). */
async function listAdapters(
  adaptersDir: string | undefined,
): Promise<string[]> {
  if (adaptersDir === undefined) {
    return [];
  }
  const names: string[] = [];
  for await (const entry of Deno.readDir(adaptersDir)) {
    if (entry.isDirectory) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/** Run `icculus add-adapter <name>`. Returns a process exit code. */
export async function runAddAdapter(
  name: string,
  options: AddAdapterOptions,
): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Must be inside an initialized project.
  let toml: ReturnType<typeof parseIcculusToml>;
  try {
    toml = parseIcculusToml(
      await Deno.readTextFile(join(destDir, "icculus.toml")),
    );
  } catch {
    const message =
      "no icculus.toml here — run `icculus init` before adding an adapter.";
    if (options.json) {
      log.jsonResult({ ok: false, error: "not_initialized", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  const adaptersDir = await resolveAdaptersDir();
  const available = await listAdapters(adaptersDir);
  const adapterDir = adaptersDir ? join(adaptersDir, name) : undefined;

  if (adapterDir === undefined || !(await isDir(adapterDir))) {
    const message = available.length > 0
      ? `unknown adapter "${name}". Available: ${available.join(", ")}.`
      : `unknown adapter "${name}". This build ships no adapters yet.`;
    if (options.json) {
      log.jsonResult({
        ok: false,
        error: "unknown_adapter",
        message,
        available,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // An adapter is scaffolded exactly like the base templates tree.
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
  const plan = await buildPlan({
    templatesDir: adapterDir,
    destDir,
    tokens,
    mode: "init",
  });
  // adapter.json is metadata (config fills), not a scaffolded file.
  plan.ops = plan.ops.filter((op) => op.targetRel !== ADAPTER_MANIFEST);

  // Load the adapter's config fills and pre-compute the edited icculus.toml, so
  // a bad adapter.json fails before anything is written and dry-run reports it.
  let fills: IcculusConfigDoc | undefined;
  let filledToml: string | undefined;
  try {
    fills = await loadAdapterFills(adapterDir);
    if (hasFills(fills)) {
      const editor = new TomlEditor(
        await Deno.readTextFile(join(destDir, "icculus.toml")),
      );
      applyConfigDoc(editor, fills!);
      filledToml = editor.toString();
    }
  } catch (error) {
    const message = `adapter "${name}" has invalid config fills: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (options.json) {
      log.jsonResult({ ok: false, error: "invalid_adapter", message });
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
        adapter: name,
        plan: planToJson(plan),
        config_fills: filledToml !== undefined,
      });
    } else {
      renderPlan(log, plan, `Dry run — adapter "${name}" would overlay:`);
      if (filledToml !== undefined) {
        log.info("Would also apply config fills to icculus.toml.");
      }
    }
    return 0;
  }

  if (!options.json) {
    renderReview(log, plan, destDir);
    if (filledToml !== undefined) {
      log.line("  icculus.toml          apply adapter config fills");
    }
    log.line();
  }
  if (!(await confirmProceed(`Overlay adapter "${name}" now?`, options.yes))) {
    log.info("Aborted; nothing was written.");
    return 0;
  }

  const changed = await applyPlan(plan);
  if (filledToml !== undefined) {
    await Deno.writeTextFile(join(destDir, "icculus.toml"), filledToml);
  }
  if (options.json) {
    log.jsonResult({
      ok: true,
      adapter: name,
      written: changed.map((op) => op.targetRel),
      config_fills: filledToml !== undefined,
    });
    return 0;
  }
  for (const op of changed) {
    log.ok(op.targetRel);
  }
  if (filledToml !== undefined) {
    log.ok("icculus.toml (config fills applied)");
  }
  log.ok(`Adapter "${name}" applied.`);
  return 0;
}
