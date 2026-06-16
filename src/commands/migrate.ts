/**
 * `icculus migrate` — rewrite a pre-1.0 `icculus.toml` to the 1.0 shape (ADR
 * 0009). 1.0 removed three things this fixes up, comment-preserving and in place:
 *
 *   - `[ratchets].coverage_min` (a scalar) → a `[ratchets.coverage]` table.
 *   - the `coverage` slot phase → a measurement slot (no phase).
 *   - the worktree runtime tokens `{{db}}` … → the `@db@` … delimiter.
 *
 * It is idempotent (a clean 1.0 file reports "nothing to migrate") and honours
 * `--dry-run` / `--json`. It touches only `icculus.toml`; run `icculus upgrade`
 * afterwards to refresh the engine itself.
 */

import { join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { TomlEditor } from "../lib/toml_edit.ts";

/** Options accepted by `migrate` (global flags folded in). */
export interface MigrateOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
}

/** The worktree runtime tokens whose delimiter changed from `{{x}}` to `@x@`. */
const RUNTIME_TOKENS = ["db", "site", "port", "project_slug", "dir"];

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compute the migrated `icculus.toml` text and the list of changes made. Pure:
 * the caller decides whether to write it. Throws only if the input is not valid
 * TOML.
 */
export function planMigration(
  text: string,
): { result: string; changes: string[] } {
  const changes: string[] = [];
  const raw = parseIcculusToml(text).raw;
  const editor = new TomlEditor(text);

  // Slots that declared the removed "coverage" phase: they become measurement
  // slots (no phase). Collected first so the coverage ratchet can reference one.
  const slots = isRecord(raw.slots) ? raw.slots : {};
  const coverageSlots: string[] = [];
  for (const [name, val] of Object.entries(slots)) {
    if (isRecord(val) && val.phase === "coverage") {
      coverageSlots.push(name);
    }
  }

  // [ratchets].coverage_min (scalar) → [ratchets.coverage] table.
  const ratchets = isRecord(raw.ratchets) ? raw.ratchets : {};
  const coverageMin = ratchets.coverage_min;
  const hasCoverageRatchet = isRecord(ratchets.coverage);
  if (typeof coverageMin === "number") {
    if (coverageMin > 0 && !hasCoverageRatchet) {
      const slot = coverageSlots[0] ?? "coverage";
      editor.setString("ratchets.coverage.direction", "up");
      editor.setNumber("ratchets.coverage.limit", coverageMin);
      editor.setString("ratchets.coverage.slot", slot);
      changes.push(
        `converted [ratchets].coverage_min = ${coverageMin} into a [ratchets.coverage] table (slot = "${slot}")`,
      );
    } else if (coverageMin > 0) {
      changes.push(
        "removed the obsolete [ratchets].coverage_min scalar ([ratchets.coverage] already present)",
      );
    } else {
      changes.push(
        `removed the disabled [ratchets].coverage_min = ${coverageMin} (the coverage ratchet was off)`,
      );
    }
    editor.deleteKey("ratchets.coverage_min");
  }

  // Strip phase = "coverage" from the affected slots (the gate has no such phase).
  for (const name of coverageSlots) {
    if (editor.deleteKey(`slots.${name}.phase`)) {
      changes.push(
        `made [slots.${name}] a measurement slot (removed phase = "coverage")`,
      );
    }
  }

  // Worktree runtime tokens moved from {{x}} to @x@. A global replace is safe:
  // the installer already substituted content tokens at init, so any remaining
  // {{token}} in an installed icculus.toml is one of these runtime tokens.
  let result = editor.toString();
  for (const tok of RUNTIME_TOKENS) {
    const from = `{{${tok}}}`;
    if (result.includes(from)) {
      result = result.replaceAll(from, `@${tok}@`);
      changes.push(`rewrote the worktree token ${from} to @${tok}@`);
    }
  }

  return { result, changes };
}

/**
 * True when `text` is a pre-1.0 `icculus.toml` that `migrate` would change —
 * i.e. it still carries `coverage_min`, a `coverage` slot phase, or `{{…}}`
 * worktree tokens. Unparseable text returns false (not this detector's call).
 * Used by `upgrade` and `doctor` to nudge a 0.x user toward `icculus migrate`.
 */
export function needsMigration(text: string): boolean {
  try {
    return planMigration(text).changes.length > 0;
  } catch {
    return false;
  }
}

/** Run `icculus migrate`. Returns a process exit code. */
export async function runMigrate(options: MigrateOptions): Promise<number> {
  const log = new Logger(options);
  const path = join(Deno.cwd(), "icculus.toml");

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    const isMissing = error instanceof Deno.errors.NotFound;
    const message = isMissing
      ? "no icculus.toml here — run `icculus init` first, or cd into the project root."
      : `could not read icculus.toml: ${
        error instanceof Error ? error.message : String(error)
      }`;
    if (options.json) {
      log.jsonResult({
        ok: false,
        error: isMissing ? "not_initialized" : "read_error",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  let plan: { result: string; changes: string[] };
  try {
    plan = planMigration(text);
  } catch (error) {
    const message = `could not migrate icculus.toml: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (options.json) {
      log.jsonResult({ ok: false, error: "migrate_error", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  if (plan.changes.length === 0) {
    if (options.json) {
      log.jsonResult({ ok: true, migrated: false, changes: [] });
    } else {
      log.ok("icculus.toml is already on the 1.0 shape — nothing to migrate.");
    }
    return 0;
  }

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        migrated: true,
        changes: plan.changes,
      });
    } else {
      log.info("Dry run — `migrate` would make these changes:");
      for (const c of plan.changes) {
        log.line(`  • ${c}`);
      }
    }
    return 0;
  }

  await Deno.writeTextFile(path, plan.result);
  if (options.json) {
    log.jsonResult({ ok: true, migrated: true, changes: plan.changes });
    return 0;
  }
  log.ok("Migrated icculus.toml to the 1.0 shape:");
  for (const c of plan.changes) {
    log.line(`  • ${c}`);
  }
  log.line();
  log.info("Next: run `icculus upgrade` to refresh the engine to 1.0.");
  return 0;
}
