/**
 * `discern doctor` — verify the install. Every check returns an actionable
 * diagnostic: not just pass/fail, but the exact fix when something is wrong.
 *
 * With the engine compiled into the binary, the checks are in-process and few:
 * the config parses, the recorded schema is current, and the declared jobs
 * resolve through the engine's own config reader.
 */

import { join } from "@std/path";
import {
  resolveConfigPath,
  resolveGuidanceSources,
  resolveScriptsDir,
  resolveSkillsDir,
} from "../lib/paths.ts";
import { CONFIG_REL, crossedRepoBoundaries, findRoot } from "../shared/env.ts";
import { Logger } from "../lib/log.ts";
import { terminalWidth, wrapText } from "../lib/text.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { isRecordedSchemaNewer, resolveRecordedSchema } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION, UPDATE_CHANNEL } from "../lib/version.ts";
import {
  AGENT_NAMES,
  type DiscernConfig,
  loadConfig,
  parseConfig,
  resolveConfiguredAgents,
  toCommandList,
} from "../shared/config_schema.ts";
import { buildExecutionModel } from "../engine/doctor/execution_model.ts";
import { renderAgentFiles } from "../engine/guidance_render.ts";
import { checkProviderHooksCurrent } from "../lib/provider_hooks.ts";
import {
  allGuidanceFilePaths,
  providerFor,
  providersWithHooks,
} from "../lib/providers.ts";
import { isKnownJob, KNOWN_JOBS } from "../shared/capabilities.ts";
import { classifyKnownJob } from "../shared/setup_assurance.ts";
import {
  commandExists,
  leadingCommandWord,
  runGit,
} from "../shared/subprocess.ts";
import { splitNulRecords } from "../shared/git_paths.ts";
import {
  generatedGroupForPath,
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../shared/generated_artifacts.ts";
import {
  gitVersion,
  hasAnyCommit,
  repoToplevel,
  resolveCommonGitDir,
} from "../engine/worktree/git.ts";
import { logbookDir } from "../engine/logbook/store.ts";
import { z } from "@zod/zod";
import type { DiscernResult } from "../shared/result.ts";
import type {
  Check,
  DoctorData,
  DoctorEnvironment,
  VerbPlan,
} from "../shared/result_schemas.ts";
import { fire, HINTS, hintTexts } from "../shared/hints.ts";
import { observeResult } from "../shared/result_capture.ts";
import { inDeskSession } from "../engine/desk/session.ts";

/** Options accepted by the `doctor` command. */
export interface DoctorOptions {
  json: boolean;
  noColor: boolean;
  /** Show the per-step execution-model hints (the human render hides them by default,
   * pointing at `--verbose`; the `--json` model always carries them). */
  verbose: boolean;
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
    ...(inDeskSession() ? { desk_session: true as const } : {}),
  };
}

/** One doctor diagnostic — defined as `CheckSchema` in `result_schemas.ts` (the
 * SSOT) and re-exported here. */
export type { Check };

type DraftCheck = Omit<Check, "status"> & { status?: Check["status"] };

/** Fill doctor's severity grade from the compatibility booleans. The envelope stays
 * green for warnings (`ok: true`), but every check now carries a first-class status so
 * machine consumers do not have to infer severity from `ok` + `warn`. */
function checkStatus(check: DraftCheck): Check["status"] {
  return check.status ?? (!check.ok ? "fail" : check.warn ? "warn" : "ok");
}

/** Normalize the check. */
function normalizeCheck(check: DraftCheck): Check {
  const status = checkStatus(check);
  return {
    name: check.name,
    status,
    detail: check.detail,
    ok: status !== "fail",
    ...(check.fix !== undefined ? { fix: check.fix } : {}),
    ...(status === "warn" ? { warn: true } : {}),
  };
}

/** Normalize the checks. */
function normalizeChecks(checks: DraftCheck[]): Check[] {
  return checks.map(normalizeCheck);
}

/** Whether a format-job command invokes bare or type-selected `discern tidy`. */
function invokesDiscernTidy(command: string): boolean {
  return /(?:^|[\s;&|/])discern[\t ]+tidy(?=$|[\s;&|])/.test(command);
}

/** `git --version` trimmed for a compact display ("git version 2.5.0" → "2.5.0").
 * The full string is preserved verbatim in the `--json` environment block. */
function gitDisplayVersion(raw: string): string {
  return raw.replace(/^git version\s+/, "");
}

/** Month files present in the logbook directory that hold at least one byte —
 * evidence that recording writes actually land. */
async function recordedMonthFiles(dir: string): Promise<number> {
  let months = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !/^\d{4}-\d{2}\.jsonl$/.test(entry.name)) {
        continue;
      }
      const stat = await Deno.stat(join(dir, entry.name)).catch(() =>
        undefined
      );
      if (stat !== undefined && stat.size > 0) {
        months += 1;
      }
    }
  } catch {
    return 0; // no directory yet — indistinguishable from never-recorded
  }
  return months;
}

/** The logbook health check: recording on and provably landing events. Off is
 * advice (a deliberate choice, but history can't be back-filled); on with no
 * events ever recorded is a failure — writes are broken, or the install is so
 * new no verb has completed, and this very doctor run settles which. */
async function logbookCheck(
  config: DiscernConfig,
  commonGitDir: string,
): Promise<DraftCheck> {
  if (!config.project.logbook) {
    return {
      name: "logbook",
      ok: true,
      status: "warn",
      detail:
        "recording is off ([project].logbook = false) — discern keeps no memory of how it is driven",
      fix:
        "consider re-enabling it: gate thrash, flaky tests, and guidance gaps only become visible in this local history, it never leaves the machine, and it cannot be recorded retroactively",
    };
  }
  const dir = logbookDir(commonGitDir);
  const months = await recordedMonthFiles(dir);
  if (months === 0) {
    return {
      name: "logbook",
      ok: false,
      detail:
        "recording is on, but no events have ever landed — writes may be failing (or no verb has completed here yet)",
      fix:
        `this doctor run itself records one event as it finishes — re-run \`discern doctor\`, and if this stays red, check that ${dir} is writable`,
    };
  }
  return {
    name: "logbook",
    ok: true,
    detail: `recording — ${months} month${
      months === 1 ? "" : "s"
    } of local history under the git admin area`,
  };
}

/** Whether a regular file exists at `path`. */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Git's file classes needed to verify a generated-artifact declaration without
 * running its generator. `undefined` means Git could not answer; the dedicated
 * Git/repository checks report that prerequisite failure, so the path probes stay
 * silent rather than inventing a verdict. */
interface GeneratedFileInventory {
  readonly tracked: readonly string[];
  readonly untrackedOrIgnored: readonly string[];
}

/** Return the generated file inventory. */
async function generatedFileInventory(
  root: string,
): Promise<GeneratedFileInventory | undefined> {
  const [tracked, untracked, ignored] = await Promise.all([
    runGit(["ls-files", "-z", "--cached"], { cwd: root }),
    runGit(["ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: root,
    }),
    runGit([
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
    ], { cwd: root }),
  ]);
  if (!tracked.success || !untracked.success || !ignored.success) {
    return undefined;
  }
  return {
    tracked: splitNulRecords(tracked.stdout).sort(),
    untrackedOrIgnored: [
      ...new Set([
        ...splitNulRecords(untracked.stdout),
        ...splitNulRecords(ignored.stdout),
      ]),
    ].sort(),
  };
}

/** Match through the shared generated-artifact accessor so doctor uses the same
 * scope-glob dialect as every other `[generated]` consumer. */
function generatedGroupMatchesPath(
  group: ResolvedGeneratedGroup,
  path: string,
): boolean {
  return generatedGroupForPath([group], path) !== undefined;
}

/** Return the generated field. */
function generatedField(
  group: ResolvedGeneratedGroup,
  field: "paths" | "run",
): string {
  return `\`[generated.${group.name}] ${field}\``;
}

/** Run the installer-level checks against `destDir`. `cwd` is where the caller
 * was invoked from (defaults to the process cwd) — the start of the root-discovery
 * walk, which the boundary check below compares against the resolved root. */
export async function runChecks(
  destDir: string,
  opts: {
    cwd?: string;
    /** Test seam for exercising an older valid install at schema-1 baseline. */
    currentSchema?: number;
  } = {},
): Promise<Check[]> {
  const checks: DraftCheck[] = [];
  const currentSchema = opts.currentSchema ?? SCHEMA_VERSION;

  // 0. root discovery crossed a repository boundary — findRoot roots at the
  // NEAREST discern.toml and does not stop at a `.git`, so a working directory
  // inside a nested repository (a vendored checkout, a submodule, a sibling
  // project folded under this one) that has no config of its own resolves
  // outward to this project. Doing that on purpose is legitimate; believing the
  // nested repo is the project is the trap — so the crossing is disclosed as
  // advice, never a failure, and only when one actually happened. Needs no
  // config, so it runs even when discern.toml is unreadable.
  {
    const crossed = await crossedRepoBoundaries(
      opts.cwd ?? Deno.cwd(),
      destDir,
    );
    const nearest = crossed[0];
    if (nearest !== undefined) {
      checks.push({
        name: "root discovery",
        ok: true,
        status: "warn" as const,
        detail:
          `the working directory sits inside a nested git repository (${nearest}) that has no discern.toml — discern commands run from there operate on this project at ${destDir}`,
        fix:
          `working on this project? cd to ${destDir}. Working on the nested repository? Run \`discern setup\` inside it to give it its own config`,
      });
    }
  }

  // 1. discern.toml exists and is syntactically valid TOML.
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
        ? "run `discern setup` to configure discern here"
        : "fix the TOML syntax in discern.toml",
    });
    // Without a parseable config the remaining checks have nothing to read.
    return normalizeChecks(checks);
  }

  // 2. schema currency — the recorded `[meta].schema_version` matches this build.
  // The two mismatch directions need opposite remedies, and only one of them is
  // `discern upgrade`: that verb migrates an OLDER install forward, but REFUSES a
  // config newer than the binary (see `isRecordedSchemaNewer`/upgrade's own guard),
  // so advising it there would send the user at a command that rejects their exact
  // state. A newer install means the BINARY is behind — re-run the installer.
  const recorded = resolveRecordedSchema(toml.raw);
  if (recorded === currentSchema) {
    checks.push({
      name: "schema version",
      ok: true,
      detail: `schema ${currentSchema} (current)`,
    });
  } else if (isRecordedSchemaNewer(recorded, currentSchema)) {
    checks.push({
      name: "schema version",
      ok: false,
      detail:
        `install schema v${recorded} is newer than this build's v${currentSchema} — the project was upgraded by a newer discern`,
      fix:
        `get a newer discern (${UPDATE_CHANNEL}) — \`discern upgrade\` refuses a newer-than-binary config`,
    });
  } else {
    checks.push({
      name: "schema version",
      ok: false,
      detail:
        `install schema v${recorded}, this build expects v${currentSchema}`,
      fix: "run `discern upgrade` to migrate the install",
    });
  }

  // 3. config schema — validate the WHOLE config against the typed schema, in ONE
  // parse. The one schema pass covers every structural check (an
  // malformed job, a dead [worktree.db]/[worktree.dev_server] adapter, an unknown
  // section…): each surfaces as a path-qualified issue
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
    return normalizeChecks(checks);
  }

  // Setup provenance (ADR 0075) — informational, shown only when recorded: which model
  // and discern version ran setup, for support triage. Advisory; discern can't verify a
  // self-declared model, so this is evidence for a maintainer, never a health verdict.
  {
    const model = config.meta.setup_model;
    const version = config.meta.setup_version;
    const parts = [
      model !== "" ? `model ${model}` : undefined,
      version !== "" ? `discern ${version}` : undefined,
    ].filter((s): s is string => s !== undefined);
    if (parts.length > 0) {
      checks.push({
        name: "setup provenance",
        ok: true,
        detail: `set up by ${
          parts.join(", ")
        } (self-declared; for support triage)`,
      });
    }
  }

  // 4. known jobs — informational: which built-in names are wired, while naming
  // custom jobs separately so the closed readiness vocabulary stays visible.
  // "Wired" means the SAME thing the gate, status, and improve mean: the command
  // survives `toCommandList` (a `""`, `[]`, or `:` no-op runs nothing, so it is not
  // wired). Re-deriving that with a looser predicate would let doctor call a no-op
  // job healthy while `discern done` runs nothing for it. The WARN keys on the
  // stricter shared classifier: a job whose only commands are discern's own
  // (the seeded `format = "discern tidy"`) runs, but protects nothing of the
  // project's — without that distinction the seed would silence this warning
  // on every fresh install.
  const wiredKnownJobs = Object.keys(KNOWN_JOBS).filter((name) =>
    toCommandList(config.jobs[name as keyof typeof KNOWN_JOBS]).length > 0
  );
  const enforcedKnownJobs =
    (Object.keys(KNOWN_JOBS) as Array<keyof typeof KNOWN_JOBS>).filter(
      (name) => classifyKnownJob(config, name) === "enforced",
    );
  const wiredCustomJobs = Object.entries(config.jobs)
    .filter(([name, value]) =>
      !isKnownJob(name) && toCommandList(value).length > 0
    )
    .map(([name]) => name);
  const customDetail = wiredCustomJobs.length === 0
    ? "no custom jobs"
    : `custom jobs: ${wiredCustomJobs.join(", ")}`;
  checks.push({
    name: "known jobs",
    ok: wiredKnownJobs.length > 0,
    detail: wiredKnownJobs.length === 0
      ? `none wired yet (gate may pass without the built-in protections); ${customDetail}`
      : enforcedKnownJobs.length === 0
      ? `only discern's own upkeep is wired (${
        wiredKnownJobs.join(", ")
      }) — no check of the project's own yet; ${customDetail}`
      : `wired: ${wiredKnownJobs.join(", ")}; ${customDetail}`,
    ...(enforcedKnownJobs.length === 0
      ? {
        status: "warn" as const,
        fix:
          "wire at least one known name under [jobs] (format, build, lint, typecheck, test, or smoke)",
      }
      : {}),
  });

  // The template prewires discern's own formatter into the project's format job.
  // Before setup completes, its absence almost certainly means the setup agent
  // replaced the seed while adding a stack formatter, so fail loudly. Afterwards,
  // removal is the documented opt-out: report the fact without warning or failure.
  const tidyInFormatJob = toCommandList(config.jobs.format).some(
    invokesDiscernTidy,
  );
  checks.push(
    tidyInFormatJob
      ? {
        name: "tidy format job",
        ok: true,
        detail: "the format job includes `discern tidy`",
      }
      : config.meta.bootstrapped
      ? {
        name: "tidy format job",
        ok: true,
        detail:
          "not in the format job (the project has opted out of automatic formatting for discern surfaces)",
      }
      : {
        name: "tidy format job",
        ok: false,
        detail: "the format job does not invoke `discern tidy` during setup",
        fix:
          "restore `discern tidy` as the last format command; put the project's formatter before it",
      },
  );

  // 5. job commands resolve — the leading command word of each
  // declared command (the word `sh -c` would execute, past any env-assignment
  // prefix, quotes resolved) resolves from the project root, so the gate will
  // not die with "command not found" (including a relative `./tool`).
  {
    const commands: { label: string; word: string }[] = [];
    for (const [name, value] of Object.entries(config.jobs)) {
      for (const c of toCommandList(value)) {
        const word = leadingCommandWord(c);
        if (word !== undefined) {
          commands.push({ label: name, word });
        }
      }
    }
    const missing: string[] = [];
    for (const { label, word } of commands) {
      if (!(await commandExists(word, { cwd: destDir }))) {
        missing.push(`${label} → ${word}`);
      }
    }
    checks.push(
      missing.length === 0
        ? {
          name: "job commands",
          ok: true,
          // Honest about scope: only the LEADING command of each is probed, not
          // every word of a piped/`&&`-chained command, and a command whose
          // leading word is dynamic (`$TOOL …`) is skipped rather than judged
          // (doctor is an advisory).
          detail: commands.length === 0
            ? "none to check"
            : "each command's leading binary resolves on PATH",
        }
        : {
          name: "job commands",
          ok: false,
          detail: `command not found: ${missing.join(", ")}`,
          fix: "install the tool, or fix the command under [jobs]",
        },
    );
  }

  // 5b. generated-artifact declarations — probe the command and Git ownership
  // facts the gate and update rely on, without running a generator or writing a
  // file. The block emits nothing when `[generated]` is unused. Its file lists
  // come from Git once, then every group is matched through the shared accessor.
  {
    const groups = resolveGeneratedGroups(config);
    if (groups.length > 0) {
      for (const group of groups) {
        const word = leadingCommandWord(group.run);
        if (word === undefined) {
          checks.push({
            name: `generated: ${group.name} run`,
            ok: true,
            detail:
              "`run` has no static leading word, so doctor did not probe it",
          });
        } else if (await commandExists(word, { cwd: destDir })) {
          checks.push({
            name: `generated: ${group.name} run`,
            ok: true,
            detail:
              `\`run\` leading word \`${word}\` resolves from the project root`,
          });
        } else {
          checks.push({
            name: `generated: ${group.name} run`,
            ok: false,
            detail:
              `\`run\` leading word \`${word}\` does not resolve from the project root`,
            fix: `edit ${
              generatedField(group, "run")
            } in discern.toml to name a command whose leading word resolves from the project root`,
          });
        }
      }

      const inventory = await generatedFileInventory(destDir);
      if (inventory !== undefined) {
        for (const group of groups) {
          const tracked = inventory.tracked.filter((path) =>
            generatedGroupMatchesPath(group, path)
          );
          const outsideIndex = inventory.untrackedOrIgnored.filter((path) =>
            generatedGroupMatchesPath(group, path)
          );
          const patterns = JSON.stringify(group.paths);
          if (tracked.length > 0) {
            checks.push({
              name: `generated: ${group.name} paths`,
              ok: true,
              detail:
                `paths ${patterns} match ${tracked.length} git-tracked file${
                  tracked.length === 1 ? "" : "s"
                }`,
            });
          } else if (outsideIndex.length > 0) {
            checks.push({
              name: `generated: ${group.name} paths`,
              ok: true,
              status: "warn" as const,
              detail: `paths ${patterns} match ${outsideIndex.length} file${
                outsideIndex.length === 1 ? "" : "s"
              }, all untracked or ignored. This group is inert because untracked artifacts never conflict and never drift. Track them or drop the group`,
              fix: `edit ${
                generatedField(group, "paths")
              } in discern.toml to name committed artifacts, or remove \`[generated.${group.name}]\` if its outputs should remain untracked`,
            });
          } else {
            checks.push({
              name: `generated: ${group.name} paths`,
              ok: true,
              status: "warn" as const,
              detail:
                `paths ${patterns} match no git-tracked, untracked, or ignored files`,
              fix: `check ${
                generatedField(group, "paths")
              } in discern.toml for a typo, or keep this warning until the first generated artifacts are committed`,
            });
          }
        }

        for (const path of inventory.tracked) {
          const owners = groups.filter((group) =>
            generatedGroupMatchesPath(group, path)
          );
          if (owners.length < 2) {
            continue;
          }
          checks.push({
            name: `generated ownership: ${path}`,
            ok: true,
            status: "warn" as const,
            detail: `git-tracked path \`${path}\` is claimed by ${
              owners.map((group) => `\`[generated.${group.name}]\``).join(
                ", ",
              )
            }`,
            fix: `edit ${
              owners.map((group) => generatedField(group, "paths")).join(
                " or ",
              )
            } in discern.toml so their ownership does not overlap`,
          });
        }
      }
    }
  }

  // 6. Project script contract — a script reads config via `discern config get`,
  // not by sourcing a helper library: `DISCERN_LIB` is not part of the script
  // environment, so a script that does `. "$DISCERN_LIB/bootstrap.sh"` for
  // config/output helpers breaks at runtime. Flag it and point at the contract.
  // The needle is the retired contract's OWN identifier (`DISCERN_LIB`), never a
  // generic filename — a project script running its own `bootstrap.sh` is
  // healthy. README.md is documentation, not an executable, so it is skipped.
  {
    const { abs: scriptsDir } = resolveScriptsDir(destDir, config);
    const offenders: string[] = [];
    let scanned = 0;
    try {
      for await (const entry of Deno.readDir(scriptsDir)) {
        if (!entry.isFile || entry.name === "README.md") {
          continue;
        }
        scanned++;
        const body = await Deno.readTextFile(join(scriptsDir, entry.name));
        if (body.includes("DISCERN_LIB")) {
          offenders.push(entry.name);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // No project scripts directory — nothing to check.
    }
    checks.push(
      offenders.length === 0
        ? {
          name: "script contract",
          ok: true,
          detail: scanned === 0
            ? "no project scripts to check"
            : `${scanned} script(s); none source the retired shell library`,
        }
        : {
          name: "script contract",
          ok: false,
          detail: `script(s) source the removed shell library: ${
            offenders.join(", ")
          }`,
          fix:
            "Project scripts are standalone executables — read config with `discern config get` instead of sourcing the retired `$DISCERN_LIB` shell library",
        },
    );
  }

  // 7. `sh` resolves — the job runner executes configured commands via `sh -c`.
  if (await commandExists("sh")) {
    checks.push({ name: "sh", ok: true, detail: "present on PATH" });
  } else {
    checks.push({
      name: "sh",
      ok: false,
      detail: "`sh` is not on PATH",
      fix:
        "install a POSIX shell — the gate runs configured commands via `sh -c`",
    });
  }

  // 7b. `git` resolves — discern shells out to git pervasively (the worktree
  // workflow, standards' base comparison, acceptance, scope diffing, status), so a
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
            "install git — discern's worktrees, standards, acceptance, and status all shell out to it",
        },
    );
  }

  // 7c. repository shape — the two layouts the worktree lifecycle cannot work
  // from, caught here at health-check time rather than as a failed `start`:
  // an unborn repo (no first commit — nothing to branch a worktree from), and a
  // discern.toml living in a SUBDIRECTORY of its git repo (a worktree is a
  // whole-repository checkout, so the new copy would nest inside the repo and
  // carry its discern.toml somewhere setup doesn't look).
  {
    const toplevel = await repoToplevel(destDir);
    if (toplevel === undefined) {
      checks.push({
        name: "repository shape",
        ok: true,
        status: "warn" as const,
        detail: "not a git repository — the worktree workflow is unavailable",
        fix: "run `git init` and make a first commit to enable worktrees",
      });
    } else if (!(await hasAnyCommit(destDir))) {
      checks.push({
        name: "repository shape",
        ok: false,
        detail:
          "this repository has no commits yet — a worktree has nothing to branch from, so `discern start` will refuse",
        fix: "make your first commit, then worktrees work normally",
      });
    } else {
      const projectRoot = await Deno.realPath(destDir).catch(() => destDir);
      if (projectRoot !== toplevel) {
        checks.push({
          name: "repository shape",
          ok: false,
          detail:
            `discern.toml lives at ${projectRoot}, but the git repository's root is ${toplevel} — worktrees are whole-repository checkouts, so \`discern start\` will refuse`,
          fix:
            `move discern.toml (and its authored files) to ${toplevel}, or make ${projectRoot} its own repository`,
        });
      } else {
        checks.push({
          name: "repository shape",
          ok: true,
          detail: "project root is the repository root, with commit history",
        });
      }
    }
  }

  // 7d. the logbook is recording — discern's local memory of its own use, and
  // the only place a whole class of agent-driven faults (gate thrash, flaky
  // tests, guidance gaps) ever becomes visible. Off is a deliberate choice,
  // surfaced as advice because history can never be recorded retroactively.
  // On-but-empty is red: either writes are failing, or the install is so new
  // that no verb has completed yet — and since this doctor run itself appends
  // an event on completion, a healthy install turns the re-run green.
  if (config !== undefined && (await repoToplevel(destDir)) !== undefined) {
    const commonGitDir = await resolveCommonGitDir(destDir);
    if (commonGitDir !== undefined) {
      checks.push(await logbookCheck(config, commonGitDir));
    }
  }

  // 8. guidance/skills config resolves — if [guidance].sources or [skills].dir is
  // configured, report what it resolves to. Both are present-only (an absent
  // match/dir is fine), so this is informational: it surfaces a typo'd path
  // before the user wonders why their guidance/skills aren't picked up.
  {
    const sources = await resolveGuidanceSources(destDir, config);
    // A configured source that IS an agent file would feed the compiler
    // its own output; resolution refuses those (see resolveGuidanceSources), so
    // an explicit listing deserves a named diagnostic, not a silent zero-match.
    const outputs = allGuidanceFilePaths();
    const listedOutputs = config.guidance.sources
      .filter((p) => outputs.includes(p));
    if (listedOutputs.length > 0) {
      checks.push({
        name: "guidance sources",
        ok: false,
        detail:
          `[guidance].sources names agent file(s) discern itself writes: ${
            listedOutputs.join(", ")
          } — an output can never be a source, so these entries resolve to nothing`,
        fix:
          "point [guidance].sources at your authored guidance instead (the agent files are generated outputs, overwritten on every refresh)",
      });
    } else {
      checks.push({
        name: "guidance sources",
        ok: true,
        detail: sources.length === 0
          ? "no source files match [guidance].sources yet (built-in guidance still compiles)"
          : `${sources.length} source file(s) resolve`,
      });
    }
  }
  {
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

  let renderedGuidanceFiles = new Set<string>();
  let guidanceRenderError: string | undefined;
  try {
    renderedGuidanceFiles = new Set(
      (await renderAgentFiles(destDir, config)).keys(),
    );
  } catch (error) {
    guidanceRenderError = error instanceof Error
      ? error.message
      : String(error);
  }

  const providerHookDrift = await checkProviderHooksCurrent(destDir, config);
  const hookDriftByAgent = new Map(
    providerHookDrift.map((entry) => [entry.agent, entry]),
  );

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
    const mcp = provider.mcp;
    const guidancePath = provider.guidanceFile.path;
    const guidanceWired = guidanceRenderError === undefined &&
      renderedGuidanceFiles.has(guidancePath);
    const hookDrift = hookDriftByAgent.get(name);
    const hooksWired = provider.hooks !== undefined &&
      hookDrift === undefined;
    const wired = [
      guidanceWired ? `guidance ${guidancePath}` : undefined,
      provider.skillsDir ? `skills ${provider.skillsDir.path}` : undefined,
      mcp.kind === "wired" ? "mcp" : undefined,
      hooksWired ? "hooks" : undefined,
    ].filter((s): s is string => s !== undefined);
    // Surfaces NOT wired, each stated explicitly so a gap is visible, not silent:
    // a `pending` MCP is committable and names the file discern will write into once
    // authored; an absent hooks surface uses the agent's own mechanism.
    const notWired = [
      guidanceRenderError !== undefined
        ? `guidance ${guidancePath} (render error)`
        : !guidanceWired
        ? `guidance ${guidancePath} (not rendered)`
        : undefined,
      mcp.kind === "pending"
        ? `mcp → ${mcp.targetFile} (committable; not yet wired)`
        : undefined,
      provider.hooks === undefined
        ? "hooks (own mechanism)"
        : hookDrift !== undefined
        ? `hooks ${hookDrift.path} (${hookDrift.reason})`
        : undefined,
    ].filter((s): s is string => s !== undefined);
    let detail = `wired: ${wired.join(", ")}`;
    if (notWired.length > 0) {
      detail += `; not wired: ${notWired.join(", ")}`;
    }
    // One-time trust: discern can wire everything into the repo, but several agents
    // gate committed MCP/hooks behind trusting the folder — so the tools won't appear
    // until then. Surface it for an agent with a committable surface (wired/pending
    // MCP, or hooks), naming the exact action, so the gap between "wired" and "active"
    // is visible (deliverable 5). An agent with no committable surface has nothing to
    // trust, so the clause is omitted.
    const hasCommittableSurface = mcp.kind !== "none" ||
      provider.hooks !== undefined;
    if (hasCommittableSurface) {
      detail += provider.trust.required
        ? `; trust: one-time — ${provider.trust.hint}`
        : `; trust: not required — ${provider.trust.hint}`;
    }
    checks.push({ name: `agent: ${provider.label}`, ok: true, detail });
  }

  for (const drift of providerHookDrift) {
    checks.push({
      name: `agent hooks: ${drift.label}`,
      ok: false,
      detail: drift.detail === undefined
        ? `${drift.path} is ${drift.reason}`
        : `${drift.path} is ${drift.reason}: ${drift.detail}`,
      fix: drift.reason === "unreadable"
        ? `repair ${drift.path}, then run \`discern refresh\``
        : `run \`discern refresh\` to re-seed ${drift.path}`,
    });
  }

  // 9. gotchas doc resolves — if [project].gotchas_doc is set, the file the gate
  // points a failing agent at must exist.
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

  // 10. worktree-automation layering (advisory). If a hooks provider's settings file
  // carries a worktree-lifecycle hook whose command does not invoke the discern CLI,
  // a different tool also automates worktrees here and would double setup/teardown.
  // Advisory only (a warn, still healthy): the install is fine, but the operator
  // should reconcile the hooks. "Ours" = the command calls `discern` (an install) or
  // `deno task dev` (this repo self-hosting from source). The provider's settings file
  // and the worktree-command needle are read FROM the registry (every provider that
  // declares a hooks surface), so a second hooks-provider is covered without editing
  // this check.
  {
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

  // 11. worktree-resource commands resolve (advisory). The leading command word
  // of each declared create/destroy/ensure should resolve from the project
  // root, so a worktree round won't die with "command not found".
  {
    const missing: string[] = [];
    for (const [name, r] of Object.entries(config.worktree.resources)) {
      for (const cmd of [r.create, r.destroy, r.ensure]) {
        const word = leadingCommandWord(cmd);
        if (
          word !== undefined &&
          !(await commandExists(word, { cwd: destDir }))
        ) {
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

  return normalizeChecks(checks);
}

/** Load the typed config for the execution model, or `undefined` when none can be
 * read (a missing or invalid discern.toml). The model is omitted in that case — the
 * failing checks are the actionable report; a model derived from defaults would
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
 * install checks and folds them into the envelope (`ok` = no failed checks; warnings
 * keep exit 0 but surface as `status: "warn"` in `data.checks`, and the per-verb
 * execution model rides in `data.execution_model`).
 */
export async function doctorResult(
  destDir: string,
): Promise<DiscernResult<DoctorData>> {
  const checks = await runChecks(destDir);
  const cfg = await loadModelConfig(destDir);
  const ok = checks.every((c) => c.status !== "fail");
  const hints = [
    ...(midSetup(cfg) ? [fire(HINTS["setup-unfinished-doctor"])] : []),
    ...(!ok ? [fire(HINTS["doctor-failed-checks"])] : []),
  ];
  return {
    ok,
    verb: "doctor",
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
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

/** True while the one-time setup is unfinished: a config exists but
 * `[meta].bootstrapped` is still unset. A missing/unparseable config is not
 * mid-setup — the failing checks are the actionable report there. */
function midSetup(cfg: DiscernConfig | undefined): boolean {
  return cfg !== undefined && !cfg.meta.bootstrapped;
}

/** The width to wrap the execution model to: the terminal's, or a sane default when
 * output is piped/redirected (not a TTY). Capped so lines stay readable on a very wide
 * terminal, and floored so the hanging indents still leave room for text. */
function modelWidth(): number {
  return Math.max(56, Math.min(terminalWidth({ fallback: 100 }), 110));
}

/** The opt-in pointer shown at the top and foot of the human execution-model section
 * when `--verbose` is off: the step list stays scannable, and the reader is told —
 * twice, because the model is long — how to surface the per-step hints. */
const VERBOSE_HINT_POINTER =
  "Run `discern doctor --verbose` to show hints explaining each execution step.";

/**
 * Render the execution-model section for the human (non-`--json`) path — what runs,
 * in order, when each verb is called. Wraps to the terminal width with hanging indents
 * (so the actor column stays legible) and colours each step's actor tag — green
 * `[project]` (your configured command) vs cyan `[discern]` (a built-in step).
 *
 * Hints (the class-level expectation behind each step) are VERBOSE-ONLY. By default the
 * section is a clean, scannable step list with {@link VERBOSE_HINT_POINTER} at its top
 * and foot to opt in; with `--verbose` every step's hint is shown, undeduplicated, so
 * each line carries its own explanation. The `--json` model always carries every hint,
 * for machine consumers. Routed through the narration stream (stderr for the installer),
 * like the rest of doctor's human output. discern shows the facts and the expectations;
 * the reader draws conclusions.
 */
function renderExecutionModel(
  log: Logger,
  model: VerbPlan[],
  verbose: boolean,
): void {
  const width = modelWidth();
  const LABEL_COL = 12; // 2 (indent) + 9 (padded actor tag) + 1 (space)
  const HINT_COL = 14; // hints nest one notch under the label column
  const labelIndent = " ".repeat(LABEL_COL);
  const hintIndent = " ".repeat(HINT_COL);
  // The opt-in pointer, emitted at the top and foot of the section when hints are off.
  const showPointer = (): void => {
    log.humanLine("");
    log.humanLine(`  ${log.cyan("→")} ${log.bold(VERBOSE_HINT_POINTER)}`);
  };

  log.heading("Execution model");
  // An aligned legend, rather than one long sentence that would itself wrap.
  log.humanLine(`  ${log.dim("What runs when you call each verb:")}`);
  log.humanLine(
    `    ${log.green("[project]".padEnd(9))} ${
      log.dim("your configured command")
    }`,
  );
  log.humanLine(
    `    ${log.cyan("[discern]".padEnd(9))} ${log.dim("a built-in step")}`,
  );
  if (!verbose) {
    showPointer();
  }

  for (const vp of model) {
    log.heading(vp.verb);
    for (const line of wrapText(vp.when, width - 2)) {
      log.humanLine(`  ${log.dim(line)}`);
    }
    if (vp.steps.length === 0) {
      log.humanLine(`  ${log.dim("(nothing configured)")}`);
      continue;
    }
    for (const s of vp.steps) {
      const tag = (s.actor === "project" ? "[project]" : "[discern]").padEnd(9);
      const tagColored = s.actor === "project" ? log.green(tag) : log.cyan(tag);
      const note = s.note !== undefined ? ` — ${s.note}` : "";
      const cond = s.condition !== undefined ? ` (${s.condition})` : "";
      // Wrap the headline body (label + note + condition) to the room right of the
      // label column; bold the label portion of line 1 and keep the command + any
      // condition at normal weight (legible) — only the hint below it is dimmed.
      const bodyLines = wrapText(`${s.label}${note}${cond}`, width - LABEL_COL);
      bodyLines.forEach((bl, i) => {
        if (i === 0) {
          const boldLen = Math.min(s.label.length, bl.length);
          log.humanLine(
            `  ${tagColored} ${log.bold(bl.slice(0, boldLen))}${
              bl.slice(boldLen)
            }`,
          );
        } else {
          log.humanLine(`${labelIndent}${bl}`);
        }
      });
      // Hints are verbose-only and never deduplicated there — every step carries its
      // own explanation, so the meaning of a line is never deferred to an earlier one.
      if (verbose && s.hint !== undefined) {
        for (const hl of wrapText(s.hint, width - HINT_COL)) {
          log.humanLine(`${hintIndent}${log.dim(hl)}`);
        }
      }
    }
  }

  // The model is long; repeat the pointer at the foot so a reader who scrolled past the
  // top one still sees how to surface the explanations.
  if (!verbose) {
    showPointer();
  }
}

/** Render the actionable install checks for the human (non-`--json`) path. */
function renderDoctorChecks(log: Logger, checks: Check[]): void {
  log.heading("Doctor checks");
  for (const check of checks) {
    if (check.status === "warn") {
      log.warn(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    } else if (check.status === "ok") {
      log.ok(`${check.name}: ${check.detail}`);
    } else {
      log.error(`${check.name}: ${check.detail}`);
      if (check.fix) {
        log.detail(`fix: ${check.fix}`);
      }
    }
  }
}

/** Run `discern doctor`. Returns a process exit code (0 = healthy). */
export async function runDoctor(options: DoctorOptions): Promise<number> {
  const log = new Logger(options);
  // Resolve the project root the way every other verb (and the `discern_doctor`
  // MCP tool) does — walk up from the cwd via `findRoot` — so doctor run from any
  // subdirectory diagnoses the same install the gate, status, and finish would,
  // not a phantom "broken" one at the cwd. Falls back to the cwd when there is no
  // project in the ancestry, so the "discern.toml not found" check still fires.
  const destDir = (await findRoot()) ?? Deno.cwd();
  const result = await doctorResult(destDir);
  observeResult(result);

  if (options.json) {
    log.result(result);
    return result.ok ? 0 : 1;
  }

  const checks = result.data?.checks ?? [];
  const healthy = checks.every((c) => c.status !== "fail");
  log.heading("discern doctor");
  const env = result.data?.environment ?? await doctorEnvironment();
  log.detail(
    `discern ${env.discern} · ${env.platform} · git ${
      env.git !== undefined ? gitDisplayVersion(env.git) : "not found"
    }`,
  );
  if (env.desk_session === true) {
    log.detail(
      "desk session: active — this process was launched by discern desk",
    );
  }
  const cfg = await loadModelConfig(destDir);
  if (cfg !== undefined) {
    renderExecutionModel(log, buildExecutionModel(cfg), options.verbose);
  }
  renderDoctorChecks(log, checks);
  log.line();
  if (healthy) {
    const advisories = checks.filter((c) => c.status === "warn").length;
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
  // Mid-setup, an unqualified all-clear reads as "setup worked" — the exact
  // misreading `status` guards against. Qualify the verdict, naming the next step.
  if (midSetup(cfg)) {
    log.line();
    log.warn(fire(HINTS["setup-unfinished-doctor"]).text);
  }
  return healthy ? 0 : 1;
}
