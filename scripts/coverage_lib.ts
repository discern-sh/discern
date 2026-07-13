/**
 * Pure lcov analysis behind `scripts/coverage.ts` — parse a `deno coverage
 * --lcov` report and compute line coverage over the repo's OWN `src/` tree.
 *
 * The filter anchors each record's `SF:` path to `<repoRoot>/src/`. Anchoring
 * matters: a bare `/src/` substring also matches dependency and workspace
 * files (a `src/` directory inside `node_modules`, the site workspace's
 * `site/design-system/src/`), letting code outside the measured tree drag the
 * engine's number around. Extracted as a module so that definition is tested
 * and single-sourced — the metric and the operator table both derive from
 * this one parse.
 */

/** Line coverage for one file under the repo's `src/`. */
export interface FileCoverage {
  /** Path relative to the repo root (e.g. `src/engine/dispatch.ts`). */
  path: string;
  hit: number;
  found: number;
}

/** Aggregate line coverage over the repo's `src/` tree. */
export interface SrcCoverage {
  pct: number;
  hit: number;
  found: number;
  /** Per-file breakdown, sorted by path. */
  files: FileCoverage[];
}

function pct(hit: number, found: number): number {
  return found === 0 ? 0 : (hit / found) * 100;
}

/**
 * Sum lcov `LF:`/`LH:` (lines found / lines hit) across records whose `SF:`
 * source path lives under `<repoRoot>/src/`, and return the line-coverage
 * percentage plus the per-file breakdown.
 */
export function srcLineCoverage(lcov: string, repoRoot: string): SrcCoverage {
  const root = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  const prefix = `${root}src/`;
  const files: FileCoverage[] = [];
  let current: FileCoverage | undefined;
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      const path = line.slice(3);
      current = path.startsWith(prefix)
        ? { path: path.slice(root.length), hit: 0, found: 0 }
        : undefined;
    } else if (current !== undefined && line.startsWith("LF:")) {
      current.found += Number(line.slice(3)) || 0;
    } else if (current !== undefined && line.startsWith("LH:")) {
      current.hit += Number(line.slice(3)) || 0;
    } else if (current !== undefined && line === "end_of_record") {
      files.push(current);
      current = undefined;
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const found = files.reduce((sum, f) => sum + f.found, 0);
  const hit = files.reduce((sum, f) => sum + f.hit, 0);
  return { pct: pct(hit, found), hit, found, files };
}
