/**
 * `icculus add-adapter <name>` — overlay a reference adapter from
 * `adapters/<name>/` onto the current project.
 *
 * This ships the *mechanism* only: v1 bundles no adapters, so the common case is
 * a friendly error that lists whatever adapter directories do exist. When an
 * adapter dir is present it is scaffolded with the same token/merge/exec-bit
 * machinery as `init` (an adapter is just another template tree).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { applyPlan, buildPlan } from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";
import { confirmProceed } from "../lib/prompts.ts";

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

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        adapter: name,
        plan: planToJson(plan),
      });
    } else {
      renderPlan(log, plan, `Dry run — adapter "${name}" would overlay:`);
    }
    return 0;
  }

  if (!options.json) {
    renderReview(log, plan, destDir);
    log.line();
  }
  if (!(await confirmProceed(`Overlay adapter "${name}" now?`, options.yes))) {
    log.info("Aborted; nothing was written.");
    return 0;
  }

  const changed = await applyPlan(plan);
  if (options.json) {
    log.jsonResult({
      ok: true,
      adapter: name,
      written: changed.map((op) => op.targetRel),
    });
    return 0;
  }
  for (const op of changed) {
    log.ok(op.targetRel);
  }
  log.ok(`Adapter "${name}" applied.`);
  return 0;
}
