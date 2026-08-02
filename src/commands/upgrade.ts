/**
 * `discern upgrade` — bring an install forward to the current kit.
 *
 * discern keeps no managed copy of the engine — it lives in the binary, with
 * nothing committed to keep in sync — so upgrade is narrow and additive:
 *
 *   1. run any pending config-schema migrations (ADR 0014/0020);
 *   2. prove the migrated config still parses and validates;
 *   3. reconcile the fixed `discern.toml` scaffold against the current
 *      template, adding missing documented sections/keys without rewriting
 *      existing values;
 *   4. reconcile the discern-owned `.gitignore` block against the current
 *      fragment, preserving project ignore rules outside it;
 *   5. recompile the guidelines — which re-materializes the bundled skills into
 *      `.claude/skills/` and writes the per-provider agent files;
 *   6. stamp the new `[meta].schema_version` into the config.
 *
 * Your config values, guidance sources, authored skills, and project scripts are never
 * rewritten. The clean-tree git guard keeps the upgrade revertible.
 */

import { Logger } from "../lib/log.ts";
import { worktreeState } from "../lib/git.ts";
import { notInitializedResult } from "../shared/env.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { KIT_VERSION, SCHEMA_VERSION, UPDATE_CHANNEL } from "../lib/version.ts";
import {
  isRecordedSchemaNewer,
  newerSchemaRefusalMessage,
  resolveRecordedSchema,
  stampSchemaVersion,
} from "../lib/schema.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyMigrations,
  type Migration,
  pendingMigrations,
} from "../lib/migrations.ts";
import {
  type ConfigReconcileOperation,
  reconcileConfigText,
} from "../lib/config_reconcile.ts";
import {
  type ConfigIssue,
  ConfigValidationError,
  parseConfig,
} from "../shared/config_schema.ts";
import {
  compileGuidelines,
  guidanceRefreshErrors,
  type GuidelinesResult,
} from "../engine/guidelines.ts";
import {
  ensureDiscernGitignoreBlock,
  type GitignoreReconcileOperation,
  planDiscernGitignoreBlock,
} from "../lib/agent_gitignore.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../shared/hints.ts";
import { observeResult } from "../shared/result_capture.ts";
import { TomlFormatError, writeDiscernToml } from "../lib/tidy_format.ts";

/** Options accepted by the `upgrade` command. */
export interface UpgradeOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Report whether config migrations are pending and exit; write nothing. */
  check: boolean;
  /** Upgrade even with uncommitted tracked changes (skip the clean-tree guard). */
  allowDirty: boolean;
  /**
   * The migration chain to run. Defaults to the production chain (`MIGRATIONS`);
   * overridable so tests can drive the fold with synthetic steps without a real
   * `SCHEMA_VERSION` bump.
   */
  registry?: Migration[] | undefined;
  /**
   * Schema target paired with an injected registry. Production callers use
   * `SCHEMA_VERSION`; tests can exercise a future migration without changing
   * the public baseline.
   */
  currentSchema?: number | undefined;
  /**
   * Project root to operate on; defaults to `Deno.cwd()`. Tests pass it directly
   * so they never chdir the process — a process-global change that races across
   * test files running concurrently under `deno test --parallel`.
   */
  cwd?: string | undefined;
}

/** Read a text file, or undefined if absent. */
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

/** Return the newer discern hint. */
function newerDiscernHint(): FiredHint {
  return fire(HINTS["upgrade-newer-discern"], {
    updateChannel: UPDATE_CHANNEL,
  });
}

/** Return the pending upgrade hint. */
function pendingUpgradeHint(): FiredHint {
  return fire(HINTS["upgrade-check-pending"]);
}

/** Return the restart agents hint. */
function restartAgentsHint(): FiredHint {
  return fire(HINTS["upgrade-restart-session"]);
}

/** Run `discern upgrade`. Returns a process exit code. */
export async function runUpgrade(options: UpgradeOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = options.cwd ?? Deno.cwd();
  const currentSchema = options.currentSchema ?? SCHEMA_VERSION;

  // Must be inside an initialized project.
  const configPath = await resolveConfigPath(destDir);
  const tomlText = configPath === undefined
    ? undefined
    : await readTextIfExists(configPath);
  if (tomlText === undefined) {
    const message =
      "no discern install here — run `discern setup` first. `upgrade` refreshes an existing install.";
    if (options.json) {
      log.result(notInitializedResult("upgrade", message));
    } else {
      log.error(message);
    }
    return 1;
  }

  let toml: ReturnType<typeof parseDiscernToml>;
  try {
    toml = parseDiscernToml(tomlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "invalid_toml",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // The migration chain to run: every step from the install's recorded schema
  // (read from `[meta].schema_version`, defaulting to schema 1) up to this
  // build's current schema.
  const migrateFrom = resolveRecordedSchema(toml.raw);
  if (isRecordedSchemaNewer(migrateFrom, currentSchema)) {
    return refuseNewerSchema(log, migrateFrom, currentSchema);
  }
  const pending = pendingMigrations(
    migrateFrom,
    currentSchema,
    options.registry,
  );
  const pendingJson = pending.map((m) => ({
    from: m.from,
    to: m.from + 1,
    describe: m.describe,
  }));
  const currentReconciliation = pending.length === 0
    ? await reconcileConfigText(tomlText)
    : { operations: [] as ConfigReconcileOperation[], templateAvailable: true };
  const pendingReconciliationJson = currentReconciliation.operations.map(
    operationToJson,
  );
  const currentGitignoreReconciliation = await planDiscernGitignoreBlock(
    destDir,
  );
  const pendingGitignoreReconciliationJson = currentGitignoreReconciliation
    .operations.map(gitignoreOperationToJson);

  // --check: report whether config migrations are pending. There is no managed
  // scaffold drift once the schema is current — an install is current iff its
  // schema, fixed config scaffold, managed banners, and discern-owned .gitignore
  // block match this build.
  if (options.check) {
    const ok = pending.length === 0 &&
      currentReconciliation.operations.length === 0 &&
      currentReconciliation.templateAvailable &&
      currentGitignoreReconciliation.operations.length === 0 &&
      currentGitignoreReconciliation.templateAvailable;
    if (options.json) {
      log.result({
        ok,
        verb: "upgrade",
        hints: hintTexts([
          ok ? newerDiscernHint() : pendingUpgradeHint(),
        ]),
        data: {
          check: true,
          kit_version: KIT_VERSION,
          schema: { recorded: migrateFrom, current: currentSchema },
          pending_migrations: pendingJson,
          pending_reconciliation: pendingReconciliationJson,
          config_template_available: currentReconciliation.templateAvailable,
          pending_gitignore_reconciliation: pendingGitignoreReconciliationJson,
          gitignore_template_available:
            currentGitignoreReconciliation.templateAvailable,
        },
      });
    } else if (ok) {
      log.ok(
        `Install is up to date (discern ${KIT_VERSION}, schema ${currentSchema}).`,
      );
      log.info(newerDiscernHint().text);
    } else {
      if (pending.length > 0) {
        log.error(
          `Install schema is v${migrateFrom}, but this build expects v${currentSchema}.`,
        );
        for (const m of pending) {
          log.detail(`migration ${m.from}→${m.from + 1}: ${m.describe}`);
        }
      }
      if (currentReconciliation.operations.length > 0) {
        log.error(
          "Install config scaffold or managed banners differ from the current template.",
        );
        for (const op of currentReconciliation.operations) {
          log.detail(operationLabel(op));
        }
      }
      if (!currentReconciliation.templateAvailable) {
        log.error(
          "Could not resolve the config template to check scaffold drift.",
        );
      }
      if (currentGitignoreReconciliation.operations.length > 0) {
        log.error("Install .gitignore is missing the current discern block.");
        for (const op of currentGitignoreReconciliation.operations) {
          log.detail(gitignoreOperationLabel(op));
        }
      }
      if (!currentGitignoreReconciliation.templateAvailable) {
        log.error(
          "Could not resolve the .gitignore fragment to check scaffold drift.",
        );
      }
      log.line();
      log.info("Apply it: run `discern upgrade`.");
    }
    return ok ? 0 : 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "upgrade",
        dry_run: true,
        data: {
          pending_migrations: pendingJson,
          pending_reconciliation: pendingReconciliationJson,
          config_template_available: currentReconciliation.templateAvailable,
          pending_gitignore_reconciliation: pendingGitignoreReconciliationJson,
          gitignore_template_available:
            currentGitignoreReconciliation.templateAvailable,
        },
      });
    } else {
      if (pending.length > 0) {
        log.info(`Would run ${pending.length} migration(s):`);
        for (const m of pending) {
          log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
        }
        log.line();
      }
      if (currentReconciliation.operations.length > 0) {
        log.info(
          `Would reconcile ${currentReconciliation.operations.length} config scaffold item(s):`,
        );
        for (const op of currentReconciliation.operations) {
          log.detail(operationLabel(op));
        }
        log.line();
      }
      if (currentGitignoreReconciliation.operations.length > 0) {
        log.info("Would reconcile the discern .gitignore block:");
        for (const op of currentGitignoreReconciliation.operations) {
          log.detail(gitignoreOperationLabel(op));
        }
        log.line();
      }
      log.info(
        "Would recompile the agent guidance and re-materialize the bundled skills.",
      );
      log.line();
      log.info("No files were written (--dry-run).");
    }
    return 0;
  }

  // Clean-tree guard (ADR 0014): an upgrade must stay revertible with
  // `git checkout`, so refuse a tree carrying uncommitted *tracked* changes
  // unless --allow-dirty. Only the mutating path reaches here — `--check` and
  // `--dry-run` returned above, so neither is ever blocked. A non-repo cannot
  // offer the net, so it proceeds with a note rather than failing.
  if (!options.allowDirty) {
    const state = await worktreeState(destDir);
    if (state.kind === "dirty") {
      const message =
        "working tree has uncommitted changes; commit or stash them so the upgrade stays revertible, or re-run with --allow-dirty.";
      if (options.json) {
        log.result({
          ok: false,
          verb: "upgrade",
          error: "dirty_worktree",
          message,
          data: { changes: state.changes },
        });
      } else {
        log.error(message);
        for (const c of state.changes.slice(0, 10)) {
          log.detail(c);
        }
        if (state.changes.length > 10) {
          log.detail(`… and ${state.changes.length - 10} more`);
        }
      }
      return 1;
    }
    if (state.kind === "not-a-repo" && !options.json) {
      log.warn(
        "not a git repository — upgrading without a clean-tree safety net.",
      );
    }
  }

  // 1. Run the migration chain. Steps are idempotent.
  let applied: Awaited<ReturnType<typeof applyMigrations>>;
  try {
    applied = await applyMigrations({
      destDir,
      from: migrateFrom,
      to: currentSchema,
      registry: options.registry,
      onNote: (m) => log.detail(m),
    });
  } catch (error) {
    if (!(error instanceof TomlFormatError)) {
      throw error;
    }
    const message =
      `a migration produced invalid TOML; schema was not stamped: ${error.message}`;
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "invalid_migrated_config",
        message,
        data: { schema: { from: migrateFrom, current: currentSchema } },
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // 1b. Prove the migrated config parses and validates BEFORE any softer
  // refresh work. Guideline compilation remains best-effort (ADR 0065), but a
  // broken config would brick every later command if we stamped it as current.
  const newConfigPath = (await resolveConfigPath(destDir)) ?? configPath;
  if (newConfigPath === undefined) {
    throw new Error("config path could not be resolved after migration");
  }
  const validity = await validateMigratedConfig(newConfigPath);
  if (!validity.ok) {
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "invalid_migrated_config",
        message: validity.message,
        data: {
          schema: { from: migrateFrom, current: currentSchema },
          ...(validity.issues === undefined ? {} : { issues: validity.issues }),
        },
      });
    } else {
      log.error(validity.message);
    }
    return 1;
  }

  const reconciliation = await reconcileConfigFile(newConfigPath);
  if (!reconciliation.templateAvailable) {
    const message =
      "could not resolve the config template; schema was not stamped because config scaffold reconciliation could not run.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "config_template_unavailable",
        message,
        data: {
          schema: { from: migrateFrom, current: currentSchema },
          config_reconciled: [],
        },
      });
    } else {
      log.error(message);
    }
    return 1;
  }
  const reconciledValidity = await validateMigratedConfig(newConfigPath);
  if (!reconciledValidity.ok) {
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "invalid_migrated_config",
        message: reconciledValidity.message,
        data: {
          schema: { from: migrateFrom, current: currentSchema },
          config_reconciled: reconciliation.operations.map(operationToJson),
          ...(reconciledValidity.issues === undefined
            ? {}
            : { issues: reconciledValidity.issues }),
        },
      });
    } else {
      log.error(reconciledValidity.message);
    }
    return 1;
  }

  // 1c. Reconcile the discern-owned .gitignore block to the CURRENT shipped
  // fragment (with registry-derived agent artifacts), absorbing old one-off
  // `# discern:` sections into one canonical block. It runs after config
  // scaffold reconciliation so a missing templates dir still reports the
  // config-template failure first, but before the schema stamp so an install is
  // not marked current until this co-managed block is current too.
  const gitignoreReconciliation = await ensureDiscernGitignoreBlock(destDir);
  if (!gitignoreReconciliation.templateAvailable) {
    const message =
      "could not resolve the .gitignore fragment; schema was not stamped because .gitignore reconciliation could not run.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "gitignore_template_unavailable",
        message,
        data: {
          schema: { from: migrateFrom, current: currentSchema },
          config_reconciled: reconciliation.operations.map(operationToJson),
          gitignore_reconciled: [],
        },
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // 2. Recompile the guidelines (re-materializes skills + writes agent files).
  // A failure here is non-fatal to the upgrade — the
  // schema is still stamped — but it is reported.
  let guidelines: GuidelinesResult | undefined;
  let thrownGuidelinesError: string | undefined;
  try {
    // Pass upgrade's own logger so its narration follows upgrade's stream
    // discipline (suppressed in --json, stderr in human mode) — never polluting
    // the stdout JSON object.
    guidelines = await compileGuidelines(destDir, log);
  } catch (error) {
    thrownGuidelinesError = `could not recompile guidelines: ${
      error instanceof Error ? error.message : String(error)
    }`;
    log.warn(thrownGuidelinesError);
  }
  // A per-artifact failure inside the compile is isolated, not thrown (ADR 0065):
  // the per-job detail was already warned by compileGuidelines, so surface only an
  // aggregate here and treat the compile as incomplete.
  const guidelinesErrors = guidelines === undefined
    ? (thrownGuidelinesError === undefined ? [] : [thrownGuidelinesError])
    : guidanceRefreshErrors(guidelines);
  if (guidelinesErrors.length > 0) {
    log.warn(
      `guideline refresh did not fully complete: ${guidelinesErrors.length} artifact(s) failed.`,
    );
  }
  const fullyCompiled = guidelines !== undefined &&
    guidelinesErrors.length === 0;

  // 3. Stamp the new schema version into the config (now at its migrated path).
  await stampSchema(newConfigPath, currentSchema);

  if (options.json) {
    log.result({
      ok: fullyCompiled,
      verb: "upgrade",
      ...(fullyCompiled ? {} : {
        error: "partial_refresh",
        message:
          `${guidelinesErrors.length} artifact(s) failed to refresh; see data.guidelines_errors.`,
      }),
      hints: mergeHintTexts(
        guidelines?.hints ?? [],
        hintTexts([newerDiscernHint(), restartAgentsHint()]),
      ),
      data: {
        kit_version: KIT_VERSION,
        // `from` is the pre-upgrade schema; the install now records `current`
        // (the stamp ran above), so reporting it as still "recorded" would mislead.
        schema: { from: migrateFrom, current: currentSchema },
        migrations_applied: applied.map((m) => ({
          from: m.from,
          to: m.from + 1,
          describe: m.describe,
        })),
        config_reconciled: reconciliation.operations.map(operationToJson),
        config_template_available: reconciliation.templateAvailable,
        gitignore_reconciled: gitignoreReconciliation.operations.map(
          gitignoreOperationToJson,
        ),
        gitignore_template_available: gitignoreReconciliation.templateAvailable,
        skills: guidelines === undefined ? null : {
          copied: guidelines.skillsCopied,
          linked: guidelines.skillsLinked,
          pruned: guidelines.skillsPruned,
        },
        agents_written: guidelines?.agentsWritten ?? [],
        mcp_wired: guidelines?.mcpWired ?? [],
        hooks_wired: guidelines?.hooksWired ?? [],
        worktree_app_wired: guidelines?.worktreeAppWired ?? [],
        project_rules_wired: guidelines?.projectRulesWired ?? [],
        guidelines_compiled: fullyCompiled,
        guidelines_errors: guidelinesErrors,
      },
    });
    return 0;
  }

  if (applied.length > 0) {
    log.ok(`migrations applied: ${applied.length}`);
    for (const m of applied) {
      log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
    }
  }
  observeResult({
    ok: fullyCompiled,
    verb: "upgrade",
    hints: mergeHintTexts(
      guidelines?.hints ?? [],
      hintTexts([newerDiscernHint(), restartAgentsHint()]),
    ),
  });
  renderUpgradeSummary(
    log,
    guidelines,
    applied.length,
    reconciliation.operations,
    gitignoreReconciliation.operations,
    currentSchema,
  );
  return 0;
}

/** Return the refuse newer schema. */
function refuseNewerSchema(
  log: Logger,
  recorded: number,
  currentSchema: number,
): number {
  const message = newerSchemaRefusalMessage(recorded, currentSchema);
  if (log.json) {
    log.result({
      ok: false,
      verb: "upgrade",
      error: "schema_version_too_new",
      message,
      data: { schema: { recorded, current: currentSchema } },
    });
  } else {
    log.error(message);
  }
  return 1;
}

type ConfigValidity =
  | { ok: true }
  | { ok: false; message: string; issues?: ConfigIssue[] };

/** Validate the migrated config. */
async function validateMigratedConfig(
  configPath: string,
): Promise<ConfigValidity> {
  const text = await Deno.readTextFile(configPath);
  try {
    const { issues } = parseConfig(text);
    if (issues.length === 0) {
      return { ok: true };
    }
    const error = new ConfigValidationError(issues);
    return {
      ok: false,
      message:
        `migrated discern.toml is invalid; schema was not stamped.\n${error.message}`,
      issues,
    };
  } catch (error) {
    return {
      ok: false,
      message: `migrated discern.toml is invalid; schema was not stamped.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Render the human upgrade summary: how many skills were re-materialized and
 * whether guidelines recompiled. The schema stamp is implicit (it always runs).
 */
function renderUpgradeSummary(
  log: Logger,
  guidelines: GuidelinesResult | undefined,
  migrationCount: number,
  reconciliation: ConfigReconcileOperation[],
  gitignoreReconciliation: GitignoreReconcileOperation[],
  currentSchema: number,
): void {
  log.heading("Upgrade summary");
  if (migrationCount > 0) {
    log.info(`migrations applied: ${migrationCount}`);
  }
  if (reconciliation.length > 0) {
    log.ok(`config scaffold reconciled: ${reconciliation.length}`);
    for (const op of reconciliation) {
      log.detail(operationLabel(op));
    }
  }
  if (gitignoreReconciliation.length > 0) {
    log.ok("gitignore block reconciled");
    for (const op of gitignoreReconciliation) {
      log.detail(gitignoreOperationLabel(op));
    }
  }
  if (guidelines !== undefined) {
    log.ok(
      `skills re-materialized: ${
        guidelines.skillsCopied + guidelines.skillsLinked
      } (${guidelines.skillsCopied} bundled, ${guidelines.skillsLinked} authored)`,
    );
    log.ok(
      guidelines.agentsWritten.length > 0
        ? `guidelines recompiled: ${guidelines.agentsWritten.join(", ")}`
        : "guidelines: nothing to compile",
    );
  }
  log.ok(`install stamped at schema ${currentSchema}`);
  // R6: keep the two upgrade axes distinct — `discern upgrade` refreshed THIS
  // project to match the installed binary; getting a NEWER binary is separate.
  log.line();
  log.info(
    `This refreshed your project to match the installed discern (${KIT_VERSION}). ${newerDiscernHint().text}`,
  );
  log.info(restartAgentsHint().text);
}

/** Stamp `[meta].schema_version` into the config at `configPath`, in place. */
async function stampSchema(
  configPath: string,
  version: number,
): Promise<void> {
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  stampSchemaVersion(editor, version);
  await writeDiscernToml(configPath, editor.toString());
}

/** Return the operation to JSON. */
function operationToJson(op: ConfigReconcileOperation): {
  kind: ConfigReconcileOperation["kind"];
  path: string;
} {
  return { kind: op.kind, path: op.path };
}

/** Return the gitignore operation to JSON. */
function gitignoreOperationToJson(op: GitignoreReconcileOperation): {
  kind: GitignoreReconcileOperation["kind"];
  path: string;
} {
  return { kind: op.kind, path: op.path };
}

/** Return the operation label. */
function operationLabel(op: ConfigReconcileOperation): string {
  switch (op.kind) {
    case "section":
      return `add [${op.path}]`;
    case "banner":
      return `refresh [${op.path}] banner`;
    case "marker":
      return `refresh ${op.path} provenance marker`;
    case "key":
      return `add ${op.path}`;
  }
}

/** Return the gitignore operation label. */
function gitignoreOperationLabel(op: GitignoreReconcileOperation): string {
  return op.kind === "create-block"
    ? "create .gitignore discern block"
    : "replace .gitignore discern block";
}

/** Return the reconcile config file. */
async function reconcileConfigFile(
  configPath: string,
): Promise<{
  operations: ConfigReconcileOperation[];
  templateAvailable: boolean;
}> {
  const before = await Deno.readTextFile(configPath);
  const result = await reconcileConfigText(before);
  if (!result.templateAvailable) {
    return {
      operations: [],
      templateAvailable: false,
    };
  }
  if (result.text !== before) {
    await writeDiscernToml(configPath, result.text);
  }
  return {
    operations: result.operations,
    templateAvailable: result.templateAvailable,
  };
}
