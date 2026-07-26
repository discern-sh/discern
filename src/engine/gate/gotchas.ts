/**
 * The "a gate step failed" failure pointer. ALWAYS written to stderr, so it
 * never pollutes the gate's stdout. Aims an agent at the project's gotchas doc
 * (`[project].gotchas_doc`); an empty gotchas_doc disables the doc line.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { canonicalDocTargetFromPath } from "../../lib/docs.ts";
import { resolveMapDir } from "../../lib/paths.ts";
import { isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { palette, writeStderr } from "../output.ts";

/** True when `candidate` is nested below `directory` (not the directory itself). */
function isNestedWithin(directory: string, candidate: string): boolean {
  const rel = relative(directory, candidate);
  return rel !== "" && rel !== ".." &&
    !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel);
}

/** Quote one positional for the POSIX shells discern supports. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith("-")
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Render the structured map fetch for one canonical target. */
function mapFetchCommand(target: string): string {
  return target.startsWith("-")
    ? `discern map --json -- ${shellWord(target)}`
    : `discern map ${shellWord(target)} --json`;
}

/**
 * Build the registered gotchas pointer shared by stderr and result envelopes.
 * A Markdown doc below `[map].dir` uses the map verb's canonical target; every
 * other configured path keeps the filesystem fallback.
 */
export function gateFailureGotchasHint(
  config: DiscernConfig,
  root: string,
): FiredHint | undefined {
  const doc = config.project.gotchas_doc;
  if (doc === "") {
    return undefined;
  }

  const docPath = resolve(root, doc);
  const mapDir = resolve(resolveMapDir(root, config).abs);
  if (isNestedWithin(mapDir, docPath)) {
    const rel = relative(mapDir, docPath).replaceAll(SEPARATOR, "/");
    if (/\.md$/i.test(rel)) {
      const target = canonicalDocTargetFromPath(rel);
      return fire(HINTS["gate-failure-gotchas"], {
        command: mapFetchCommand(target),
      });
    }
  }

  return fire(HINTS["gate-failure-gotchas"], { path: docPath });
}

/** Print the failure pointer to stderr. */
export function gotchasHint(
  config: DiscernConfig,
  root: string,
  color: boolean,
): void {
  const c = palette(color);
  const lead = `\n${c.dim}── a gate step failed.${c.reset}`;
  const hint = gateFailureGotchasHint(config, root);
  writeStderr(
    hint !== undefined
      ? `${lead} ${hint.text}\n`
      : `${lead} If it isn't self-explanatory, record the fix in a gotchas doc and point ${c.cyan}[project].gotchas_doc${c.reset} in discern.toml at it.\n`,
  );
}
