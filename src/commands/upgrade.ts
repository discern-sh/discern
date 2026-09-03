/**
 * `discern upgrade` — bring an install forward to the current discern release.
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
 *   5. reconcile the config-derived `.gitattributes` block;
 *   6. recompile the instructions — which re-materializes the bundled skills into
 *      `.claude/skills/` and writes the per-provider agent files;
 *   7. stamp the new `[meta].schema_version` into the config.
 *
 * Your config values, instruction sources, authored skills, and project scripts are never
 * rewritten. The clean-tree git guard keeps the upgrade revertible.
 */

import { Logger } from "../lib/log.ts";
import { worktreeState } from "../lib/git.ts";
import { notInitializedResult } from "../shared/env.ts";
import { readTextIfExists } from "../shared/fs_presence.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import {
  DISCERN_VERSION,
  SCHEMA_VERSION,
  UPDATE_CHANNEL,
} from "../lib/version.ts";
import {
  inspectRecordedSchema,
  isRecordedSchemaNewer,
  newerSchemaRefusalMessage,
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
  parseConfigOrThrow,
} from "../shared/config_schema.ts";
import {
  compileInstructions,
  instructionRefreshErrors,
  type InstructionsResult,
} from "../engine/instructions.ts";
import { agentFilePaths } from "../engine/instruction_render.ts";
import {
  ensureDiscernGitignoreBlock,
  type GitignoreReconcileOperation,
  planDiscernGitignoreBlock,
} from "../lib/agent_gitignore.ts";
import {
  ensureDiscernGitattributesBlock,
  type GitattributesReconcileOperation,
  planDiscernGitattributesBlock,
  type RefusedGitattributesPattern,
  refusedGitattributesPatternLabel,
} from "../lib/agent_gitattributes.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../shared/hints.ts";
import { observeResult } from "../shared/result_capture.ts";
import type { DiscernResult } from "../shared/result.ts";
import {
  instructionRefreshData,
  type UpgradeData,
} from "../shared/result_schemas.ts";
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

/** Fire the advisory for a project created by a newer discern release. */
function newerDiscernHint(): FiredHint {
  return fire(HINTS["upgrade-newer-discern"], {
    updateChannel: UPDATE_CHANNEL,
  });
}

/** Fire the advisory that a checked upgrade still needs to be applied. */
function pendingUpgradeHint(): FiredHint {
  return fire(HINTS["upgrade-check-pending"]);
}

/** Fire the advisory that running agents still hold pre-upgrade instructions. */
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
      "no discern install here — run `discern setup begin` first. `upgrade` refreshes an existing install.";
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

  // Migration starts only from an explicit valid version. Setup may stamp an
  // incomplete install as it completes; upgrade never guesses a source schema.
  const recordedSchema = inspectRecordedSchema(toml.raw);
  if (recordedSchema.status !== "valid") {
    return refuseInvalidSchemaVersion(log, recordedSchema, currentSchema);
  }
  const migrateFrom = recordedSchema.value;
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
  const initialConfig = parseConfig(tomlText).config;
  const currentGitignoreReconciliation = await planDiscernGitignoreBlock(
    destDir,
    initialConfig,
  );
  const pendingGitignoreReconciliationJson = currentGitignoreReconciliation
    .operations.map(gitignoreOperationToJson);
  const currentGitattributesReconciliation = initialConfig === undefined
    ? { operations: [], patterns: [], refused: [] }
    : await planDiscernGitattributesBlock(
      destDir,
      initialConfig,
      agentFilePaths(initialConfig),
    );
  const pendingGitattributesReconciliationJson =
    currentGitattributesReconciliation.operations.map(
      gitattributesOperationToJson,
    );

  // --check: report whether config migrations are pending. There is no managed
  // scaffold drift once the schema is current — an install is current iff its
  // schema, fixed config scaffold, managed banners, and discern-owned Git file
  // blocks match this build.
  if (options.check) {
    const ok = pending.length === 0 &&
      currentReconciliation.operations.length === 0 &&
      currentReconciliation.templateAvailable &&
      currentGitignoreReconciliation.operations.length === 0 &&
      currentGitignoreReconciliation.templateAvailable &&
      currentGitattributesReconciliation.operations.length === 0;
    if (options.json) {
      const resultFields = {
        verb: "upgrade",
        hints: hintTexts([
          ok ? newerDiscernHint() : pendingUpgradeHint(),
        ]),
        data: {
          check: true,
          discern_version: DISCERN_VERSION,
          schema: { recorded: migrateFrom, current: currentSchema },
          pending_migrations: pendingJson,
          pending_reconciliation: pendingReconciliationJson,
          config_template_available: currentReconciliation.templateAvailable,
          pending_gitignore_reconciliation: pendingGitignoreReconciliationJson,
          gitignore_template_available:
            currentGitignoreReconciliation.templateAvailable,
          pending_gitattributes_reconciliation:
            pendingGitattributesReconciliationJson,
          untranslated_gitattributes_patterns:
            currentGitattributesReconciliation.refused.map(
              refusedGitattributesPatternToJson,
            ),
        },
      };
      log.result(
        ok ? { ok: true, ...resultFields } : { ok: false, ...resultFields },
      );
    } else if (ok) {
      log.ok(
        `Install is up to date (discern ${DISCERN_VERSION}, schema ${currentSchema}).`,
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
      if (
        currentGitattributesReconciliation.operations.length > 0 ||
        currentGitattributesReconciliation.refused.length > 0
      ) {
        log.group("gitattributes-reconciliation");
      }
      if (currentGitattributesReconciliation.operations.length > 0) {
        log.error("Install .gitattributes has a stale discern block.");
        for (const op of currentGitattributesReconciliation.operations) {
          log.detail(gitattributesOperationLabel(op));
        }
      }
      renderUntranslatedGitattributes(
        log,
        currentGitattributesReconciliation.refused,
      );
      log.group("upgrade-action");
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
          pending_gitattributes_reconciliation:
            pendingGitattributesReconciliationJson,
          untranslated_gitattributes_patterns:
            currentGitattributesReconciliation.refused.map(
              refusedGitattributesPatternToJson,
            ),
        },
      });
    } else {
      if (pending.length > 0) {
        log.group("migrations");
        log.info(`Would run ${pending.length} migration(s):`);
        for (const m of pending) {
          log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
        }
      }
      if (currentReconciliation.operations.length > 0) {
        log.group("config-reconciliation");
        log.info(
          `Would reconcile ${currentReconciliation.operations.length} config scaffold item(s):`,
        );
        for (const op of currentReconciliation.operations) {
          log.detail(operationLabel(op));
        }
      }
      if (currentGitignoreReconciliation.operations.length > 0) {
        log.group("gitignore-reconciliation");
        log.info("Would reconcile the discern .gitignore block:");
        for (const op of currentGitignoreReconciliation.operations) {
          log.detail(gitignoreOperationLabel(op));
        }
      }
      if (currentGitattributesReconciliation.operations.length > 0) {
        log.group("gitattributes-reconciliation");
        log.info("Would reconcile the discern .gitattributes block:");
        for (const op of currentGitattributesReconciliation.operations) {
          log.detail(gitattributesOperationLabel(op));
        }
      }
      if (currentGitattributesReconciliation.refused.length > 0) {
        log.group("gitattributes-omissions");
      }
      renderUntranslatedGitattributes(
        log,
        currentGitattributesReconciliation.refused,
      );
      log.group("agent-files");
      log.info(
        "Would recompile the agent instructions and re-materialize the bundled skills.",
      );
      log.group("dry-run-verdict");
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
  // refresh work. Instruction compilation remains best-effort (ADR 0065), but a
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
  // fragment (with registry-derived agent artifacts), reconciling one exact
  // marked block. It runs after config
  // scaffold reconciliation so a missing templates dir still reports the
  // config-template failure first, but before the schema stamp so an install is
  // not marked current until this co-managed block is current too.
  const reconciledConfig = parseConfigOrThrow(
    await Deno.readTextFile(newConfigPath),
  );
  const gitignoreReconciliation = await ensureDiscernGitignoreBlock(
    destDir,
    reconciledConfig,
  );
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

  // 1d. Reconcile the generated-path merge attributes from the validated,
  // migrated config. The refresh below repeats the same convergence as a no-op;
  // keeping this step explicit makes upgrade's result account for the file.
  const gitattributesReconciliation = await ensureDiscernGitattributesBlock(
    destDir,
    reconciledConfig,
    agentFilePaths(reconciledConfig),
  );
  renderUntranslatedGitattributes(
    log,
    gitattributesReconciliation.refused,
  );

  // 2. Recompile the instructions (re-materializes skills + writes agent files).
  // A failure here does not roll back applied migrations or the schema stamp,
  // but it makes the completion contract false and reports a safe refresh retry.
  let instructions: InstructionsResult | undefined;
  let thrownInstructionsError: string | undefined;
  try {
    // Pass upgrade's own logger so its narration follows upgrade's stream
    // discipline (suppressed in --json, stderr in human mode) — never polluting
    // the stdout JSON object.
    instructions = await compileInstructions(destDir, log);
  } catch (error) {
    thrownInstructionsError = `could not recompile instructions: ${
      error instanceof Error ? error.message : String(error)
    }`;
    log.warn(thrownInstructionsError);
  }
  // A per-artifact failure inside the compile is isolated, not thrown (ADR 0065):
  // the per-job detail was already warned by compileInstructions, so surface only an
  // aggregate here and treat the compile as incomplete.
  const instructionsErrors = instructions === undefined
    ? (thrownInstructionsError === undefined ? [] : [thrownInstructionsError])
    : instructionRefreshErrors(instructions);
  if (instructionsErrors.length > 0) {
    log.warn(
      `instruction refresh did not fully complete: ${instructionsErrors.length} artifact(s) failed.`,
    );
  }
  const instructionRefresh = instructionRefreshData(
    instructions?.writtenPaths ?? [],
    instructionsErrors,
  );
  const fullyCompiled = instructions !== undefined &&
    instructionRefresh.status === "complete";

  // 3. Stamp the new schema version into the config (now at its migrated path).
  await stampSchema(newConfigPath, currentSchema);

  const resultFields = {
    verb: "upgrade" as const,
    hints: mergeHintTexts(
      instructions?.hints ?? [],
      hintTexts([newerDiscernHint(), restartAgentsHint()]),
    ),
    data: {
      discern_version: DISCERN_VERSION,
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
      gitattributes_reconciled: gitattributesReconciliation.operations.map(
        gitattributesOperationToJson,
      ),
      untranslated_gitattributes_patterns: gitattributesReconciliation.refused
        .map(
          refusedGitattributesPatternToJson,
        ),
      skills: instructions === undefined ? null : {
        copied: instructions.skillsCopied,
        linked: instructions.skillsLinked,
        pruned: instructions.skillsPruned,
      },
      instruction_refresh: instructionRefresh,
      mcp_wired: instructions?.mcpWired ?? [],
      hooks_wired: instructions?.hooksWired ?? [],
      worktree_app_wired: instructions?.worktreeAppWired ?? [],
      project_rules_wired: instructions?.projectRulesWired ?? [],
    } satisfies UpgradeData,
  };
  const result: DiscernResult<UpgradeData> = fullyCompiled
    ? { ok: true, ...resultFields }
    : {
      ok: false,
      error: "partial_refresh",
      message:
        `${instructionsErrors.length} required instruction artifact(s) failed; applied migrations and the schema stamp remain, and data.instruction_refresh names the safe retry.`,
      ...resultFields,
    };
  if (options.json) {
    log.result(result);
    return result.ok ? 0 : 1;
  }

  if (applied.length > 0) {
    log.ok(`migrations applied: ${applied.length}`);
    for (const m of applied) {
      log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
    }
  }
  observeResult(result);
  renderUpgradeSummary(
    log,
    instructions,
    applied.length,
    reconciliation.operations,
    gitignoreReconciliation.operations,
    gitattributesReconciliation.operations,
    currentSchema,
    instructionsErrors,
  );
  return result.ok ? 0 : 1;
}

/** Emit the surface-appropriate refusal for a config schema newer than this binary. */
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

/** Refuse absent or invalid migration metadata with setup-aware recovery. */
function refuseInvalidSchemaVersion(
  log: Logger,
  inspection:
    | { status: "missing" }
    | { status: "invalid"; value: unknown },
  currentSchema: number,
): number {
  const problem = inspection.status === "missing"
    ? "is missing"
    : `must be a positive integer (found ${JSON.stringify(inspection.value)})`;
  const message =
    `[meta].schema_version ${problem}. Upgrade cannot choose a migration source without it. ` +
    "If setup is incomplete, run `discern setup begin` to resume and stamp the field; otherwise restore the recorded value from version control before retrying.";
  if (log.json) {
    log.result({
      ok: false,
      verb: "upgrade",
      error: "invalid_config",
      message,
      data: {
        schema: { current: currentSchema },
        issues: [{ path: "meta.schema_version", message: problem }],
      },
    });
  } else {
    log.error(message);
  }
  return 1;
}

type ConfigValidity =
  | { ok: true }
  | { ok: false; message: string; issues?: ConfigIssue[] };

/** Re-read migrated TOML and retain structured schema issues for the refusal. */
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
 * whether instructions recompiled. The schema stamp is implicit (it always runs).
 */
function renderUpgradeSummary(
  log: Logger,
  instructions: InstructionsResult | undefined,
  migrationCount: number,
  reconciliation: ConfigReconcileOperation[],
  gitignoreReconciliation: GitignoreReconcileOperation[],
  gitattributesReconciliation: GitattributesReconcileOperation[],
  currentSchema: number,
  instructionErrors: readonly string[],
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
  if (gitattributesReconciliation.length > 0) {
    log.ok("managed gitattributes fragment reconciled");
    for (const op of gitattributesReconciliation) {
      log.detail(gitattributesOperationLabel(op));
    }
    log.detail(
      "effective generated-path protection is verified separately by discern doctor",
    );
  }
  if (instructions !== undefined) {
    log.ok(
      `skills re-materialized: ${
        instructions.skillsCopied + instructions.skillsLinked
      } (${instructions.skillsCopied} bundled, ${instructions.skillsLinked} authored)`,
    );
    if (instructionErrors.length === 0) {
      log.ok(
        instructions.agentsWritten.length > 0
          ? `instructions recompiled: ${instructions.agentsWritten.join(", ")}`
          : "instructions: already current",
      );
    }
  }
  if (instructionErrors.length > 0) {
    log.error(
      "Upgrade is partial: required instruction compilation did not complete.",
    );
    for (const error of instructionErrors) log.detail(error);
    log.info(
      "Applied migrations and the schema stamp remain. Fix the reported artifact failure, then run `discern refresh` safely.",
    );
  }
  log.ok(`install stamped at schema ${currentSchema}`);
  // R6: keep the two upgrade axes distinct — `discern upgrade` refreshed THIS
  // project to match the installed binary; getting a NEWER binary is separate.
  log.group("upgrade-next-steps");
  log.info(
    `This refreshed your project to match the installed discern (${DISCERN_VERSION}). ${newerDiscernHint().text}`,
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

/** Project a config reconciliation operation onto its public JSON fields. */
function operationToJson(op: ConfigReconcileOperation): {
  kind: ConfigReconcileOperation["kind"];
  path: string;
} {
  return { kind: op.kind, path: op.path };
}

/** Project a `.gitignore` reconciliation operation onto its public JSON fields. */
function gitignoreOperationToJson(op: GitignoreReconcileOperation): {
  kind: GitignoreReconcileOperation["kind"];
  path: string;
} {
  return { kind: op.kind, path: op.path };
}

/** Project a `.gitattributes` reconciliation operation onto its public JSON fields. */
function gitattributesOperationToJson(op: GitattributesReconcileOperation): {
  kind: GitattributesReconcileOperation["kind"];
  path: string;
} {
  return { kind: op.kind, path: op.path };
}

/** Preserve a refused generated-path declaration as stable public evidence. */
function refusedGitattributesPatternToJson(
  refused: RefusedGitattributesPattern,
): { group: string; pattern: string; reason: string } {
  return {
    group: refusedGitattributesPatternLabel(refused),
    pattern: refused.pattern,
    reason: refused.reason,
  };
}

/** Describe a config reconciliation operation for the human upgrade summary. */
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

/** Describe a managed `.gitignore` block change for the human summary. */
function gitignoreOperationLabel(op: GitignoreReconcileOperation): string {
  return op.kind === "create-block"
    ? "create .gitignore discern block"
    : "replace .gitignore discern block";
}

/** Describe a managed `.gitattributes` block change for the human summary. */
function gitattributesOperationLabel(
  op: GitattributesReconcileOperation,
): string {
  switch (op.kind) {
    case "create-block":
      return "create .gitattributes discern block";
    case "replace-block":
      return "replace .gitattributes discern block";
    case "remove-block":
      return "remove .gitattributes discern block";
  }
}

/** Warn about declared paths that cannot map to .gitattributes. */
function renderUntranslatedGitattributes(
  log: Logger,
  refused: readonly RefusedGitattributesPattern[],
): void {
  for (const pattern of refused) {
    log.warn(
      `${refusedGitattributesPatternLabel(pattern)} pattern ${
        JSON.stringify(pattern.pattern)
      } was omitted from .gitattributes: ${pattern.reason}.`,
    );
  }
}

/** Apply template reconciliation to config bytes when the template is available. */
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
