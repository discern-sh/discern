/**
 * `discern doctor` — verify the install. Every check returns an actionable
 * diagnostic: not just pass/fail, but the exact fix when something is wrong.
 *
 * With the engine compiled into the binary, the checks are in-process and few:
 * the config parses, the recorded schema is current, and the capabilities
 * resolve through the engine's own config reader.
 */

import { join } from "@std/path";
import {
  resolveConfigPath,
  resolveGuidanceSources,
  resolveRecipesDir,
  resolveSkillsDir,
} from "../lib/paths.ts";
import { CONFIG_REL } from "../shared/env.ts";
import { Logger } from "../lib/log.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { resolveRecordedSchema } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import {
  AGENT_NAMES,
  type DiscernConfig,
  loadConfig,
  parseConfig,
  resolveConfiguredAgents,
  toCommandList,
} from "../shared/config_schema.ts";
import { buildExecutionModel } from "../engine/doctor/execution_model.ts";
import { providerFor, providersWithHooks } from "../lib/providers.ts";
import {
  enabledFeatures,
  FEATURES,
  isFeatureEnabled,
} from "../shared/features.ts";
import { capStage, isKnownCapability } from "../shared/capabilities.ts";
import { commandExists } from "../shared/subprocess.ts";
import { gitVersion } from "../engine/worktree/git.ts";
import { z } from "@zod/zod";
import type { DiscernResult } from "../shared/result.ts";
import type {
  Check,
  DoctorData,
  DoctorEnvironment,
  VerbPlan,
} from "../shared/result_schemas.ts";

/** Options accepted by the `doctor` command. */
export interface DoctorOptions {
  json: boolean;
  noColor: boolean;
}

/** The slice of an agent's settings file the worktree-automation check reads: the
 * hook groups whose inner `command` strings it scans for a foreign worktree hook.
 * Deliberately lenient — unknown keys are stripped (a settings file carries far more
 * than `hooks`), and a wrong-typed value degrades to `undefined` (`.catch`), so a
 * settings file in any shape validates to what can be read rather than being trusted
 * via an `as`-cast over untrusted JSON. */
const hookSettingsSchema = z.object({
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        hooks: z.array(
          z.object({ command: z.string().optional().catch(undefined) }),
        ).optional().catch(undefined),
      }),
    ).optional().catch(undefined),
  ).optional().catch(undefined),
});

/** The runtime-environment summary doctor reports — triage context a user can paste
 * into a bug report (which discern build, on what platform, against which git).
 * Defined as `DoctorEnvironmentSchema` in `result_schemas.ts` (the SSOT) and
 * re-exported here. */
export type { DoctorEnvironment };

/** Gather the {@link DoctorEnvironment} — the shared source for the human header
 * line and the `--json` `data.environment` block. */
export async function doctorEnvironment(): Promise<DoctorEnvironment> {
  const git = await gitVersion();
  return {
    discern: KIT_VERSION,
    platform: `${Deno.build.os}/${Deno.build.arch}`,
    ...(git !== undefined ? { git } : {}),
  };
}

/** One doctor diagnostic — defined as `CheckSchema` in `result_schemas.ts` (the
 * SSOT) and re-exported here. */
export type { Check };

/** `git --version` trimmed for a compact display ("git version 2.5.0" → "2.5.0").
 * The full string is preserved verbatim in the `--json` environment block. */
function gitDisplayVersion(raw: string): string {
  return raw.replace(/^git version\s+/, "");
}

/** The first whitespace-delimited word of a command, or undefined for an empty
 * command or the `:` no-op. */
function firstWord(command: string): string | undefined {
  const word = command.trim().split(/\s+/)[0];
  return word === undefined || word === "" || word === ":" ? undefined : word;
}

/** Whether a regular file exists at `path`. */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Run the installer-level checks against `destDir`. */
export async function runChecks(destDir: string): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. the config (discern.toml, or a legacy .discern/config.toml) exists and is
  // syntactically valid TOML.
  const tomlPath = (await resolveConfigPath(destDir)) ??
    join(destDir, CONFIG_REL);
  let toml: ReturnType<typeof parseDiscernToml>;
  let tomlText: string;
  try {
    tomlText = await Deno.readTextFile(tomlPath);
    toml = parseDiscernToml(tomlText);
    checks.push({
      name: "discern.toml",
      ok: true,
      detail: "present and valid TOML",
    });
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    checks.push({
      name: "discern.toml",
      ok: false,
      detail: isMissing
        ? "not found in this directory"
        : `invalid: ${error instanceof Error ? error.message : String(error)}`,
      fix: isMissing
        ? "run `discern setup` to scaffold the harness here"
        : "fix the TOML syntax in discern.toml",
    });
    // Without a parseable config the remaining checks have nothing to read.
    return checks;
  }

  // 2. schema currency — the recorded `[meta].schema_version` matches this build.
  const recorded = await resolveRecordedSchema(toml.raw, destDir);
  if (recorded === SCHEMA_VERSION) {
    checks.push({
      name: "schema version",
      ok: true,
      detail: `schema ${SCHEMA_VERSION} (current)`,
    });
  } else {
    checks.push({
      name: "schema version",
      ok: false,
      detail:
        `install schema v${recorded}, this build expects v${SCHEMA_VERSION}`,
      fix: "run `discern upgrade` to migrate the install",
    });
  }

  // 3. config schema — validate the WHOLE config against the typed schema, in ONE
  // parse. The one schema pass covers every structural check (an
  // unknown capability key, a dead [worktree.db]/[worktree.dev_server] adapter, a
  // bad check stage, an unknown section…): each surfaces as a path-qualified issue
  // straight from the schema's own validator. The syntax was already verified
  // above, so `parseConfig` returns issues here rather than throwing.
  const { config, issues } = parseConfig(tomlText);
  if (issues.length === 0) {
    checks.push({
      name: "config schema",
      ok: true,
      detail: "all sections and keys recognized",
    });
  } else {
    for (const issue of issues) {
      checks.push({
        name: "config schema",
        ok: false,
        detail: issue.path === ""
          ? issue.message
          : `[${issue.path}] ${issue.message}`,
        fix:
          "fix the flagged key in discern.toml (or run `discern upgrade` if it is leftover from an older schema)",
      });
    }
  }

  // The remaining checks read the typed, fully-defaulted config. When the schema
  // failed it is undefined and they are skipped — the issues above are the
  // actionable report, and re-deriving them from a half-valid config would only
  // add noise.
  if (config === undefined) {
    return checks;
  }

  // 4. capabilities — informational: which are wired (the unknown-key case is now
  // a schema issue above, so a valid config only ever lists known capabilities).
  const wiredCaps = Object.entries(config.capabilities)
    .filter(([, v]) => v !== undefined).map(([k]) => k);
  checks.push({
    name: "capabilities",
    ok: true,
    detail: wiredCaps.length === 0
      ? "none wired yet (gate passes without checking)"
      : `wired: ${wiredCaps.join(", ")}`,
  });

  // 5. capability/check commands resolve — the first word of each declared
  // command is on PATH, so the gate will not die with "command not found".
  {
    const commands: { label: string; word: string }[] = [];
    for (const [cap, value] of Object.entries(config.capabilities)) {
      for (const c of toCommandList(value)) {
        const word = firstWord(c);
        if (word !== undefined) {
          commands.push({ label: cap, word });
        }
      }
    }
    for (const [chk, spec] of Object.entries(config.checks)) {
      for (const c of toCommandList(spec.run)) {
        const word = firstWord(c);
        if (word !== undefined) {
          commands.push({ label: chk, word });
        }
      }
    }
    const missing: string[] = [];
    for (const { label, word } of commands) {
      if (!(await commandExists(word))) {
        missing.push(`${label} → ${word}`);
      }
    }
    checks.push(
      missing.length === 0
        ? {
          name: "capability commands",
          ok: true,
          // Honest about scope: only the LEADING command of each is probed, not
          // every word of a piped/`&&`-chained command (doctor is an advisory).
          detail: commands.length === 0
            ? "none to check"
            : "each command's leading binary resolves on PATH",
        }
        : {
          name: "capability commands",
          ok: false,
          detail: `command not found: ${missing.join(", ")}`,
          fix:
            "install the tool, or fix the command in [capabilities]/[checks]",
        },
    );
  }

  // 6. recipe contract — a recipe reads config via `discern config get`, not by
  // sourcing a helper library: `DISCERN_LIB` is not part of the recipe
  // environment, so a recipe that does `. "$DISCERN_LIB/bootstrap.sh"` for
  // config/output helpers breaks at runtime. Flag it and point at the contract.
  // README.md is documentation, not a recipe, so it is skipped.
  {
    const { abs: recipesDir } = resolveRecipesDir(destDir, config);
    const offenders: string[] = [];
    let scanned = 0;
    try {
      for await (const entry of Deno.readDir(recipesDir)) {
        if (!entry.isFile || entry.name === "README.md") {
          continue;
        }
        scanned++;
        const body = await Deno.readTextFile(join(recipesDir, entry.name));
        if (body.includes("DISCERN_LIB") || body.includes("bootstrap.sh")) {
          offenders.push(entry.name);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // No recipes directory — nothing to check.
    }
    checks.push(
      offenders.length === 0
        ? {
          name: "recipe contract",
          ok: true,
          detail: scanned === 0
            ? "no project recipes to check"
            : `${scanned} recipe(s); none source the retired shell library`,
        }
        : {
          name: "recipe contract",
          ok: false,
          detail: `recipe(s) source the removed shell library: ${
            offenders.join(", ")
          }`,
          fix:
            "recipes are standalone executables now — read config with `discern config get` instead of sourcing the retired `$DISCERN_LIB` shell library",
        },
    );
  }

  // 7. `sh` resolves — the job runner and the recipe fallthrough both exec via
  // `sh -c`, so a missing `sh` would break the gate and every project recipe.
  if (await commandExists("sh")) {
    checks.push({ name: "sh", ok: true, detail: "present on PATH" });
  } else {
    checks.push({
      name: "sh",
      ok: false,
      detail: "`sh` is not on PATH",
      fix:
        "install a POSIX shell — the gate and project recipes run commands via `sh -c`",
    });
  }

  // 7b. `git` resolves — discern shells out to git pervasively (the worktree
  // workflow, ratchets' base comparison, graduation, scope diffing, status), so a
  // missing git breaks the core of the tool. Required (not advisory): the version
  // string doubles as triage context in a bug report.
  {
    const version = await gitVersion();
    checks.push(
      version !== undefined
        ? { name: "git", ok: true, detail: gitDisplayVersion(version) }
        : {
          name: "git",
          ok: false,
          detail: "`git` is not on PATH (or is not runnable)",
          fix:
            "install git — discern's worktrees, ratchets, graduation, and status all shell out to it",
        },
    );
  }

  // 8. guidance/skills config resolves — if [guidance].sources or [skills].dir is
  // configured, report what it resolves to. Both are present-only (an absent
  // match/dir is fine), so this is informational: it surfaces a typo'd path
  // before the user wonders why their guidance/skills aren't picked up.
  if (isFeatureEnabled(config, "guidance")) {
    const sources = await resolveGuidanceSources(destDir, config);
    checks.push({
      name: "guidance sources",
      ok: true,
      detail: sources.length === 0
        ? "no source files match [guidance].sources yet (built-in guidance still compiles)"
        : `${sources.length} source file(s) resolve`,
    });
  }
  if (isFeatureEnabled(config, "skills")) {
    const { rel, abs } = resolveSkillsDir(destDir, config);
    let authored = 0;
    try {
      for await (const e of Deno.readDir(abs)) {
        if (e.isDirectory) authored++;
      }
    } catch { /* absent dir — fine, built-ins still apply */ }
    checks.push({
      name: "skills",
      ok: true,
      detail: authored === 0
        ? `no authored skills in ${rel}/ yet (built-ins still apply)`
        : `${authored} authored skill(s) in ${rel}/`,
    });
  }

  // 8b. agent integrations — per CONFIGURED agent, the integration surfaces the
  // provider registry wires today (guidance file, skills dir, MCP, worktree hooks).
  // Makes per-agent coverage EXPLICIT rather than a silent gap: MCP/hooks are
  // Claude-only because Codex/Gemini use different mechanisms (their config files /
  // the absence of a worktree-hook event), so an operator can SEE why an agent lacks
  // a surface instead of suspecting a bug. An unknown agent name is a real error.
  for (const name of resolveConfiguredAgents(config)) {
    const provider = providerFor(name);
    if (provider === undefined) {
      checks.push({
        name: `agent: ${name}`,
        ok: false,
        detail: `configured agent "${name}" is not one discern knows`,
        fix: `use a known agent (${AGENT_NAMES.join(", ")}) or remove it`,
      });
      continue;
    }
    const wired = [
      `guidance ${provider.guidanceFile.path}`,
      provider.skillsDir ? `skills ${provider.skillsDir}` : undefined,
      provider.mcp ? "mcp" : undefined,
      provider.hooks ? "hooks" : undefined,
    ].filter((s): s is string => s !== undefined);
    const todo = [
      provider.mcp ? undefined : "mcp",
      provider.hooks ? undefined : "hooks",
    ].filter((s): s is string => s !== undefined);
    checks.push({
      name: `agent: ${provider.label}`,
      ok: true,
      detail: todo.length === 0
        ? `wired: ${wired.join(", ")}`
        : `wired: ${wired.join(", ")}; uses its own mechanism (not wired): ${
          todo.join(", ")
        }`,
    });
  }

  // 9. features — surface the [features] toggle state, so a user can SEE which
  // subsystems are on without inferring it from missing `--help` verbs.
  {
    const on = new Set(enabledFeatures(config));
    const off = FEATURES.filter((f) => !on.has(f));
    checks.push({
      name: "features",
      ok: true,
      detail: off.length === 0
        ? `all on (${[...on].join(", ")})`
        : `on: ${[...on].join(", ") || "none"}; off: ${off.join(", ")}`,
    });
  }

  // 10. gotchas doc resolves — if [project].gotchas_doc is set, the file the gate
  // points a failing agent at must exist (a 5→6 migration of a `.discern/`-pointed
  // doc, or a typo, can leave it dangling).
  {
    const doc = config.project.gotchas_doc.trim();
    if (doc !== "") {
      const abs = doc.startsWith("/") ? doc : join(destDir, doc);
      const exists = await fileExists(abs);
      checks.push(
        exists
          ? { name: "gotchas doc", ok: true, detail: `${doc} resolves` }
          : {
            name: "gotchas doc",
            ok: false,
            detail:
              `[project].gotchas_doc points at "${doc}", which does not exist`,
            fix:
              "point [project].gotchas_doc at an existing file, or clear it (empty disables the pointer)",
          },
      );
    }
  }

  // 11. worktree-automation layering (advisory). If a hooks provider's settings file
  // carries a worktree-lifecycle hook whose command does not invoke the harness CLI,
  // a different tool also automates worktrees here and would double setup/teardown.
  // Advisory only (a warn, still healthy): the install is fine, but the operator
  // should reconcile the hooks. "Ours" = the command calls `discern` (an install) or
  // `deno task dev` (this repo self-hosting from source). The provider's settings file
  // and the worktree-command needle are read FROM the registry (every provider that
  // declares a hooks surface), so a second hooks-provider is covered without editing
  // this check. Skipped when worktrees is off (the hooks are inert / not our concern).
  if (isFeatureEnabled(config, "worktrees")) {
    const foreignFiles: string[] = [];
    for (const provider of providersWithHooks()) {
      const integ = provider.hooks;
      if (integ === undefined) {
        continue; // providersWithHooks guarantees this, but narrow for the checker.
      }
      try {
        const raw = await Deno.readTextFile(join(destDir, integ.settingsFile));
        // Untrusted JSON in any shape — validate it through the lenient schema rather
        // than asserting a type and walking it; a wrong-shaped file yields no hooks.
        const parsed = hookSettingsSchema.safeParse(JSON.parse(raw));
        const hooks = parsed.success ? parsed.data.hooks ?? {} : {};
        // Scan EVERY hook group for a worktree-touching command (the registry's
        // needle) that isn't discern's — no hardcoded event-name list to fall behind.
        const needle = new RegExp(integ.sessionHookNeedle, "i");
        const foreign = Object.values(hooks)
          .flatMap((g) => g ?? [])
          .flatMap((g) => g.hooks ?? [])
          .map((h) => h.command ?? "")
          .filter((c) => needle.test(c))
          .filter((c) =>
            !c.includes("discern") && !c.includes("deno task dev")
          );
        if (foreign.length > 0) {
          foreignFiles.push(integ.settingsFile);
        }
      } catch {
        // No settings file, a malformed one, or unreadable: this advisory is
        // best-effort, so skip it silently (install validity is checked above).
      }
    }
    if (foreignFiles.length > 0) {
      checks.push({
        name: "worktree automation",
        ok: true,
        warn: true,
        detail: `another tool also automates worktrees in ${
          foreignFiles.join(", ")
        } (a worktree hook does not call \`discern\`)`,
        fix:
          "reconcile the hooks by hand so worktree setup/teardown isn't doubled",
      });
    }
  }

  // 12. capability-shaped checks (advisory). A [checks.<name>] whose name IS a
  // standard capability and whose stage is that capability's canonical stage is
  // almost certainly meant to be a [capabilities] entry — which doctor reports and
  // `discern setup` fills, and a check does not. Nudge toward the free
  // capability slot. Advisory only (still healthy): a custom-named check with a
  // standard stage is legitimate when the label is the point.
  {
    const wired = new Set(wiredCaps.filter(isKnownCapability));
    const misfiled = Object.entries(config.checks)
      .filter(([chk, spec]) =>
        isKnownCapability(chk) && !wired.has(chk) &&
        spec.stage === capStage(chk)
      )
      .map(([chk]) => chk);
    if (misfiled.length > 0) {
      checks.push({
        name: "capability-shaped checks",
        ok: true,
        warn: true,
        detail: `${
          misfiled.map((c) => `[checks.${c}]`).join(", ")
        } match a standard capability at its canonical stage`,
        fix: `wire as a capability instead (e.g. [capabilities].${
          misfiled[0]
        } = "…"), so doctor reports it and \`discern setup\` can fill it — unless the [checks.${
          misfiled[0]
        }] name is deliberate`,
      });
    }
  }

  // 13. worktree-resource commands resolve (advisory). The first word of each
  // declared create/destroy/ensure should be on PATH, so a worktree round won't
  // die with "command not found".
  {
    const missing: string[] = [];
    for (const [name, r] of Object.entries(config.worktree.resources)) {
      for (const cmd of [r.create, r.destroy, r.ensure]) {
        const word = firstWord(cmd);
        if (word !== undefined && !(await commandExists(word))) {
          missing.push(`${name} → ${word}`);
        }
      }
    }
    if (missing.length > 0) {
      checks.push({
        name: "worktree resource commands",
        ok: true,
        warn: true,
        detail: `command not found: ${missing.join(", ")}`,
        fix:
          "install the tool, or fix the command in [worktree.resources.<name>]",
      });
    }
  }

  return checks;
}

/** Load the typed config for the execution model, or `undefined` when none can be
 * read (a missing or invalid discern.toml). The model is omitted in that case — the
 * failing checks above are the actionable report; a model derived from defaults would
 * only add noise to a broken install. */
async function loadModelConfig(
  destDir: string,
): Promise<DiscernConfig | undefined> {
  try {
    return await loadConfig(destDir);
  } catch {
    return undefined;
  }
}

/**
 * Compute the `doctor` {@link DiscernResult} without printing — the entry point the
 * MCP server renders, and the source the CLI's `--json` serializes. Runs the
 * install checks and folds them into the envelope (`ok` = every check passed; the
 * per-check detail + fix ride in `data.checks`, the per-verb execution model in
 * `data.execution_model`).
 */
export async function doctorResult(
  destDir: string,
): Promise<DiscernResult<DoctorData>> {
  const checks = await runChecks(destDir);
  const cfg = await loadModelConfig(destDir);
  return {
    ok: checks.every((c) => c.ok),
    verb: "doctor",
    data: {
      kit_version: KIT_VERSION,
      environment: await doctorEnvironment(),
      checks,
      ...(cfg !== undefined
        ? { execution_model: buildExecutionModel(cfg) }
        : {}),
    } satisfies DoctorData,
  };
}

/**
 * Render the execution-model section for the human (non-`--json`) path — what runs,
 * in order, when each verb is called, with every step marked `[you]` (a command from
 * your config) or `[discern]` (a built-in step), its class-level expectation, and a
 * visual flag on a destructive step. Routed through the narration stream (stderr for
 * the installer), like the rest of doctor's human output. discern shows the facts and
 * the expectations; the reader draws the conclusions.
 */
function renderExecutionModel(log: Logger, model: VerbPlan[]): void {
  log.heading("Execution model");
  log.detail(
    "What runs when you call each verb. [you] = your configured command; " +
      "[discern] = a built-in step. ⚠ marks a destructive step (may delete data).",
  );
  for (const vp of model) {
    log.heading(vp.verb);
    log.detail(vp.when);
    if (vp.steps.length === 0) {
      log.detail("(nothing configured)");
      continue;
    }
    for (const s of vp.steps) {
      const actor = (s.actor === "you" ? "[you]" : "[discern]").padEnd(9);
      const note = s.note !== undefined ? ` — ${s.note}` : "";
      const cond = s.condition !== undefined ? ` (${s.condition})` : "";
      const headline = `${actor} ${s.label}${note}${cond}`;
      // A destructive step is surfaced as a warning so it visibly stands out rather
      // than being dimmed like the rest; everything else is a dim detail line.
      if (s.destructive === true) {
        log.warn(`${headline}  ⚠ DESTRUCTIVE`);
      } else {
        log.detail(headline);
      }
      if (s.hint !== undefined) {
        log.detail(`            ${s.hint}`);
      }
    }
  }
}

/** Run `discern doctor`. Returns a process exit code (0 = healthy). */
export async function runDoctor(options: DoctorOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  if (options.json) {
    const result = await doctorResult(destDir);
    log.result(result);
    return result.ok ? 0 : 1;
  }

  const checks = await runChecks(destDir);
  const healthy = checks.every((c) => c.ok);
  log.heading("discern doctor");
  const env = await doctorEnvironment();
  log.detail(
    `discern ${env.discern} · ${env.platform} · git ${
      env.git !== undefined ? gitDisplayVersion(env.git) : "not found"
    }`,
  );
  for (const check of checks) {
    if (check.warn) {
      log.warn(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    } else if (check.ok) {
      log.ok(`${check.name}: ${check.detail}`);
    } else {
      log.error(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    }
  }
  log.line();
  if (healthy) {
    const advisories = checks.filter((c) => c.warn).length;
    log.ok(
      advisories > 0
        ? "All checks passed (see the advisory above)."
        : "All checks passed.",
    );
  } else {
    const failed = checks.filter((c) => !c.ok).length;
    log.error(
      `${failed} check${failed === 1 ? "" : "s"} failed — see the fixes above.`,
    );
  }
  const cfg = await loadModelConfig(destDir);
  if (cfg !== undefined) {
    renderExecutionModel(log, buildExecutionModel(cfg));
  }
  return healthy ? 0 : 1;
}
