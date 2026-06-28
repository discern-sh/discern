/**
 * `coupling`: the co-change advisory — mine git history for the files that change
 * *together*, so a touched file's habitual sibling isn't forgotten.
 *
 * Coding agents have near-perfect LOCAL recall and almost no GLOBAL recall: they fix
 * the file in front of them and miss the sibling that, by the project's own history,
 * almost always moves with it. This reconstructs that "I bet there's another one"
 * instinct from data — a directional co-change graph over a bounded commit window.
 *
 * Strictly ADVISORY (ADR 0069): it points at where to look and the human/agent
 * decides essential (lock it with a forcing-function — ADR 0051) or incidental
 * (ignore). It never blocks. Two modes, one verb (modelled on `changed-scopes`):
 *  - **diff-aware** (no path) — the current change set's partners that are MISSING
 *    from it (the primary surface, and what the gate appends when `[coupling].in_gate`);
 *  - **query** (`coupling <path>`) — one file's top co-change partners (its blast radius).
 *
 * The metric (per non-merge commit, treated as a basket of the files it changed):
 *  - drop NEUTRAL paths (docs, generated artifacts, …) so they never create edges;
 *  - weight each commit by `1 / basket_size` (and SKIP a basket over `max_commit_size`)
 *    — a focused 2-file commit is strong evidence; a sweeping change is near-zero per pair;
 *  - decay by recency (`half_life_days`) so a dissolved coupling fades;
 *  - for a directional pair A→B accumulate weighted `support` (co-occurrence),
 *    `confidence = w(A∧B)/w(A)`, and `lift = P(A∧B)/(P(A)·P(B))`; keep an edge only when
 *    `support ≥ min_support` AND `confidence ≥ min_confidence` AND `lift > 1` (lift drops
 *    a high-churn file that co-occurs with everything).
 *
 * Recompute on demand, bounded by `window` — no cache in v1 (ADR 0069).
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { CouplingData } from "../../shared/result_schemas.ts";
import type { EnvReader } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { runGit } from "../../shared/subprocess.ts";
import { collectPaths, isNeutralPath } from "../scopes/changed.ts";

/** Cap on the partners carried in `data` (both modes) — an advisory points at the
 * likeliest siblings, not an exhaustive list. */
const MAX_PARTNERS = 10;
/** Cap on the per-partner hint LINES — the advisory text stays tight (the full ranked
 * set lives in `data.partners` / a direct `discern coupling` call). */
const HINT_PARTNERS = 5;
/** Confidence at or above which a pair is treated as a near-invariant, triggering the
 * single discovery→enforcement pointer. */
const STRONG_CONFIDENCE = 0.85;
/** Seconds in a day, for the recency-decay half-life. */
const SECONDS_PER_DAY = 86_400;
/** The ASCII Record-Separator byte (0x1E) git is told to emit between commit records,
 * via the `%x1e` pretty-format directive ({@link RECORD_SEP_DIRECTIVE}) — a control
 * char that can't occur in a path or a timestamp, so splitting the OUTPUT on it never
 * collides with content. (A NUL byte can't be used: it is rejected inside an argv
 * string, so it must be git's OUTPUT that carries the separator, not the arg.) */
const RECORD_SEP = "\x1e";
/** The git pretty-format directive that emits {@link RECORD_SEP} — the literal four
 * characters `%x1e`, NOT the byte itself (which can't ride in an argv string). Kept
 * beside RECORD_SEP so the emit directive and the split byte stay the same code point. */
const RECORD_SEP_DIRECTIVE = "%x1e";

/** One mined commit: its committer timestamp (unix seconds, for decay) and the paths
 * it changed (the raw basket, before neutral filtering). */
interface CommitBasket {
  ts: number;
  files: string[];
}

/** One co-change partner edge with the evidence behind it — the {@link CouplingData}
 * partner shape, computed for a single directional pair `from`→`path`. */
interface Partner {
  path: string;
  from: string;
  support: number;
  confidence: number;
  lift: number;
}

/** The accumulated weighted model over the mined window: `marginal` is each file's
 * total weight `w(X)`, `co` holds `w(A∧B)` rows ONLY for the sources of interest (the
 * query target / the change set), and `total` is the weight sum `W` for lift. */
interface CouplingModel {
  marginal: Map<string, number>;
  co: Map<string, Map<string, number>>;
  total: number;
}

/** Round `n` to `dp` decimal places — keeps the wire numbers legible, not 17-digit floats. */
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Normalise a path to the bracket-free, no-leading-slash form the matcher expects —
 * the same normalisation the scope classifier applies to a changed path. */
function normalizePath(raw: string): string {
  return raw.trim().replace(/^\//, "");
}

/** A confidence as a whole-percent string, for the human-facing advisory text. */
function pct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Mine the last `window` non-merge commits into baskets — each its committer
 * timestamp plus the files it changed. `-M` follows renames to the new path (so a
 * renamed file's coupling history stays continuous); `--name-only` lists one path per
 * change; the `%x1e%ct` record format prefixes each commit with a Record-Separator byte
 * so splitting the output delimits commits without colliding with a path. A git failure
 * yields an empty mine — the advisory simply stays silent (it never fails open into noise).
 */
async function mineCommits(
  root: string,
  window: number,
): Promise<CommitBasket[]> {
  const max = Math.max(0, Math.trunc(window));
  if (max === 0) {
    return [];
  }
  const r = await runGit(
    [
      "log",
      "--no-merges",
      "-M",
      "--name-only",
      `--format=${RECORD_SEP_DIRECTIVE}%ct`,
      `--max-count=${max}`,
    ],
    { cwd: root },
  );
  if (!r.success) {
    return [];
  }
  const commits: CommitBasket[] = [];
  for (const chunk of r.stdout.split(RECORD_SEP)) {
    if (chunk === "") {
      continue;
    }
    const lines = chunk.split("\n");
    const ts = Number((lines[0] ?? "").trim());
    if (!Number.isFinite(ts)) {
      continue;
    }
    const files = lines.slice(1).map((l) => l.trim()).filter((l) => l !== "");
    commits.push({ ts, files });
  }
  return commits;
}

/**
 * Build the weighted co-change model over `commits`. For each commit: drop neutral
 * paths, skip a basket smaller than 2 (no pair) or larger than `max_commit_size`
 * (sweeping change), then add `decay / basket_size` to every file's marginal and —
 * for the sources in `interest` — to each directional pair's co-occurrence. Decay is
 * anchored to the NEWEST commit in the window (a constant factor that cancels in
 * confidence/lift but keeps `support` meaningful for a repo idle since its last burst
 * of work, and makes the result deterministic for tests — no clock to inject).
 */
function buildModel(
  commits: CommitBasket[],
  config: DiscernConfig,
  interest: ReadonlySet<string>,
): CouplingModel {
  const c = config.coupling;
  const maxSize = Math.max(2, Math.trunc(c.max_commit_size));
  const halfLifeSecs = c.half_life_days > 0
    ? c.half_life_days * SECONDS_PER_DAY
    : 0;
  let refTs = 0;
  for (const commit of commits) {
    if (commit.ts > refTs) {
      refTs = commit.ts;
    }
  }

  const marginal = new Map<string, number>();
  const co = new Map<string, Map<string, number>>();
  let total = 0;
  for (const commit of commits) {
    const basket = [
      ...new Set(commit.files.filter((f) => !isNeutralPath(config, f))),
    ];
    if (basket.length < 2 || basket.length > maxSize) {
      continue;
    }
    const ageSecs = Math.max(0, refTs - commit.ts);
    const decay = halfLifeSecs > 0 ? 0.5 ** (ageSecs / halfLifeSecs) : 1;
    const weight = decay / basket.length;
    total += weight;
    for (const a of basket) {
      marginal.set(a, (marginal.get(a) ?? 0) + weight);
      if (!interest.has(a)) {
        continue;
      }
      let row = co.get(a);
      if (row === undefined) {
        row = new Map<string, number>();
        co.set(a, row);
      }
      for (const b of basket) {
        if (b !== a) {
          row.set(b, (row.get(b) ?? 0) + weight);
        }
      }
    }
  }
  return { marginal, co, total };
}

/**
 * The kept partners of source `from`: every B with an edge `from`→B whose `support`,
 * `confidence`, and `lift` clear the configured thresholds, excluding anything in
 * `exclude` (the source itself, and — in diff mode — the rest of the change set). The
 * raw metric is tested against the thresholds; the numbers are rounded only for output.
 */
function partnersOf(
  model: CouplingModel,
  from: string,
  config: DiscernConfig,
  exclude: ReadonlySet<string>,
): Partner[] {
  const c = config.coupling;
  const row = model.co.get(from);
  const wFrom = model.marginal.get(from) ?? 0;
  if (row === undefined || wFrom <= 0) {
    return [];
  }
  const out: Partner[] = [];
  for (const [to, wCo] of row) {
    if (exclude.has(to)) {
      continue;
    }
    const wTo = model.marginal.get(to) ?? 0;
    if (wTo <= 0) {
      continue;
    }
    const confidence = wCo / wFrom;
    const lift = (wCo * model.total) / (wFrom * wTo);
    if (wCo >= c.min_support && confidence >= c.min_confidence && lift > 1) {
      out.push({
        path: to,
        from,
        support: round(wCo, 2),
        confidence: round(confidence, 3),
        lift: round(lift, 2),
      });
    }
  }
  return out;
}

/** Rank partners strongest-first: by weighted support, then confidence, then lift,
 * with the path as a stable final tiebreaker (so equal evidence reads deterministically). */
function sortPartners(partners: Partner[]): Partner[] {
  return [...partners].sort((a, b) =>
    b.support - a.support ||
    b.confidence - a.confidence ||
    b.lift - a.lift ||
    a.path.localeCompare(b.path)
  );
}

/** Query mode: the top co-change partners of one `target` file (its blast radius). */
async function queryCoupling(
  root: string,
  config: DiscernConfig,
  target: string,
): Promise<CouplingData> {
  const commits = await mineCommits(root, config.coupling.window);
  const model = buildModel(commits, config, new Set([target]));
  const partners = sortPartners(
    partnersOf(model, target, config, new Set([target])),
  ).slice(0, MAX_PARTNERS);
  return { mode: "query", target, partners };
}

/**
 * Diff-aware mode: the partners that co-change with the current change set but are
 * MISSING from it. The change set is read through the SAME {@link collectPaths} the
 * scope classifier uses (committed since the merge-base, plus the working tree), then
 * neutral-filtered. A git hiccup / no diff base yields no change set and no advice —
 * fail SILENT, never fail-open into noise. A partner reached from several changed
 * files is reported once, via its strongest edge.
 */
async function diffCoupling(
  root: string,
  config: DiscernConfig,
  env: EnvReader,
): Promise<CouplingData> {
  const mainBranch = env.get("MAIN_BRANCH") || config.project.main_branch;
  const raw = await collectPaths(root, mainBranch);
  const changed = [
    ...new Set(
      (raw ?? []).map(normalizePath).filter((p) =>
        p !== "" && !isNeutralPath(config, p)
      ),
    ),
  ];
  if (changed.length === 0) {
    return { mode: "diff", changed, partners: [] };
  }
  const changedSet = new Set(changed);
  const commits = await mineCommits(root, config.coupling.window);
  const model = buildModel(commits, config, changedSet);
  const best = new Map<string, Partner>();
  for (const from of changed) {
    for (const partner of partnersOf(model, from, config, changedSet)) {
      const prev = best.get(partner.path);
      if (prev === undefined || partner.support > prev.support) {
        best.set(partner.path, partner);
      }
    }
  }
  const partners = sortPartners([...best.values()]).slice(0, MAX_PARTNERS);
  return { mode: "diff", changed, partners };
}

/**
 * The advisory hint lines for a co-change result — the ONE human-facing surface
 * (rendered to human text, `--json`, and MCP alike). Flat, no severity tiers (ADR
 * 0063): each partner is shown with its evidence as transparency, the framing states
 * the list is NOT exhaustive, and every line is observation-plus-suggestion, never a
 * verdict. A single discovery→enforcement pointer is appended when the strongest pair
 * is a near-invariant. Empty when there are no partners (the advisory stays quiet).
 */
function couplingHints(data: CouplingData): string[] {
  if (data.partners.length === 0) {
    return [];
  }
  const hints: string[] = [];
  const shown = data.partners.slice(0, HINT_PARTNERS);
  if (data.mode === "diff") {
    hints.push(
      "Co-change advisory (from git history; advisory only, never blocks, and NOT " +
        "exhaustive) — files that have historically moved with your change but aren't in it:",
    );
    for (const p of shown) {
      hints.push(
        `You changed \`${p.from}\`, but not \`${p.path}\` — which co-changed with it in ` +
          `${
            pct(p.confidence)
          } of \`${p.from}\`'s recent history (support ${p.support}, ` +
          `lift ${p.lift}). Intentional, or a sibling worth updating too?`,
      );
    }
  } else {
    const target = data.target ?? "";
    hints.push(
      `Co-change partners of \`${target}\` (from git history; advisory, NOT exhaustive) ` +
        "— files that have historically moved with it:",
    );
    for (const p of shown) {
      hints.push(
        `\`${p.path}\` co-changed with \`${target}\` in ${
          pct(p.confidence)
        } of its recent ` +
          `history (support ${p.support}, lift ${p.lift}).`,
      );
    }
  }
  const remaining = data.partners.length - shown.length;
  if (remaining > 0) {
    const arg = data.mode === "query" && data.target !== undefined
      ? ` ${data.target}`
      : "";
    hints.push(
      `… and ${remaining} more — run \`discern coupling${arg}\` for the full ranked list.`,
    );
  }
  const strongest = data.partners[0];
  if (strongest !== undefined && strongest.confidence >= STRONG_CONFIDENCE) {
    hints.push(
      `\`${strongest.from}\` and \`${strongest.path}\` co-change very consistently. If that ` +
        "reflects an essential invariant, consider locking it with a forcing-function (see " +
        "the `fix-a-bug-class` skill / ADR 0051) rather than relying on memory.",
    );
  }
  return hints;
}

/**
 * Compute the `coupling` {@link DiscernResult} without printing — the entry point the
 * MCP server renders and the CLI's `--json` serializes. Query mode when `opts.path` is
 * a non-empty file; diff-aware otherwise. `env` is injected (defaulting to the process
 * env) so the integration branch resolves without touching process-global state.
 * Always `ok: true`: an advisory has no failure mode — at worst it advises nothing.
 */
export async function couplingResult(
  root: string,
  opts: { path?: string } = {},
  env: EnvReader = Deno.env,
): Promise<DiscernResult<CouplingData>> {
  const config = await loadConfig(root);
  const path = opts.path?.trim();
  const data = path !== undefined && path !== ""
    ? await queryCoupling(root, config, normalizePath(path))
    : await diffCoupling(root, config, env);
  const hints = couplingHints(data);
  return {
    ok: true,
    verb: "coupling",
    data,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

/** Options for the `coupling` subcommand surface. */
export interface CouplingOptions {
  json?: boolean;
  /** Query a single file's partners; absent → the diff-aware change-set view. */
  path?: string;
}

/**
 * The `coupling` subcommand: print the advisory (one hint per line), or the JSON
 * DiscernResult (`--json`). With nothing to advise it prints a single "nothing
 * found" line and still exits 0 — the advisory never fails.
 */
export async function runCoupling(
  root: string,
  opts: CouplingOptions,
  env: EnvReader = Deno.env,
): Promise<number> {
  const result = await couplingResult(
    root,
    opts.path !== undefined ? { path: opts.path } : {},
    env,
  );
  if (opts.json) {
    emitResult(result);
    return 0;
  }
  const hints = result.hints ?? [];
  if (hints.length === 0) {
    const data = result.data;
    const subject = data?.mode === "query" && data.target !== undefined
      ? `\`${data.target}\``
      : "your current change set";
    console.log(`No strong co-change partners found for ${subject}.`);
    return 0;
  }
  for (const hint of hints) {
    console.log(hint);
  }
  return 0;
}

/**
 * The diff-aware co-change advisory as gate hints, or `[]`. The gate appends these at
 * its TAIL (with strand detection — it reads the diff, so it is dependency-bearing,
 * never a fail-fast precondition; ADR 0069). Gated by the caller on `[features].coupling`,
 * `[coupling].in_gate`, and a bootstrapped install. Best-effort: any failure yields
 * `[]`, so the advisory can NEVER affect the gate's `ok` / exit / `failed_stage`.
 */
export async function couplingGateHints(
  root: string,
  env: EnvReader = Deno.env,
): Promise<string[]> {
  try {
    return (await couplingResult(root, {}, env)).hints ?? [];
  } catch {
    return [];
  }
}
