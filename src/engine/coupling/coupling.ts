/**
 * `coupling`: the co-change advisory — mine git history for the files that change
 * *together*, so a touched file's habitual sibling isn't forgotten.
 *
 * A coding agent has near-perfect LOCAL recall and almost no GLOBAL recall: it fixes
 * the file in front of it and misses the sibling that, by the project's own history,
 * almost always moves with it. This reconstructs that "I bet there's another one"
 * instinct from data — a directional co-change graph over a bounded commit window.
 *
 * Strictly ADVISORY (ADR 0084): it points at where to look and the human/agent decides
 * essential (lock it with a forcing-function — ADR 0051) or incidental (ignore). It
 * never blocks. Three modes, one verb (modelled on `scopes`):
 *  - **diff-aware** (no path) — the current change set's partners that are MISSING from
 *    it (the primary surface, and what the gate appends when `[coupling].in_gate`);
 *  - **query** (`coupling <path>`) — one file's top co-change partners (its blast radius);
 *  - **evidence** (`coupling <a> <b>`) — the shared co-change history of TWO files: the
 *    commits in which both changed, the raw material to judge a coupling essential or not.
 *
 * It is **zero-config and self-calibrating** — there are no thresholds to tune, because
 * absolute thresholds don't transfer across repos of wildly different size and shape.
 * Each non-merge commit is a basket of the files it changed; from a bounded window:
 *  - NEUTRAL paths are dropped (docs, generated artifacts) so they create no edges;
 *  - a SWEEPING commit is skipped — `max_commit_size` is derived per-repo as the upper
 *    outlier fence (Q3 + 1.5·IQR) of this repo's own commit-size distribution, so a
 *    "format everything" or dependency bump can't manufacture coupling;
 *  - an edge A→B is kept only when the two co-changed in at least {@link MIN_COCHANGES}
 *    commits (a fluke guard), MORE than chance, and the association is statistically
 *    SIGNIFICANT — Dunning's log-likelihood ratio (a G-test) over raw commit counts,
 *    which is unit-free and so transfers across any repo scale, unlike a raw support
 *    floor. The strongest are surfaced, ranked, and capped to {@link MAX_PARTNERS}.
 *
 * Evidence is reported in plain counts — "B changed in N of the M recent commits that
 * touched A" — not an abstract score. Recompute on demand, bounded by the window — no
 * cache in v1 (ADR 0084).
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { CouplingData } from "../../shared/result_schemas.ts";
import type { EnvReader } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  collectPaths,
  isNeutralPath,
  repoPathPrefix,
  stripRepoPathPrefix,
} from "../scopes/scopes.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";

/** How many recent non-merge commits to mine — a bounded window, the one resource
 * bound. A name-only log over this many commits is cheap even on a large repo. */
const WINDOW = 500;
/** A pair must co-change in at least this many commits to be considered — the fluke
 * guard. A raw COUNT (not a weighted score), so it means the same in any repo. */
const MIN_COCHANGES = 2;
/** A partner must follow the source at least this often (`cochanges / of`) to be worth
 * mentioning — so a statistically-real but rate-weak pull ("follows 1-in-8 times") stays
 * quiet. A ratio in [0,1], so it is scale-free: it means the same in any repo, unlike an
 * absolute support floor. */
const MIN_CONFIDENCE = 0.2;
/** The log-likelihood-ratio floor an edge must clear to count as a real association — a
 * χ²₁ significance level (≈ p < 0.01). Unit-free, so it transfers across repo scale
 * where an absolute support threshold cannot. A SIGNIFICANCE level, not a per-repo
 * tuning knob; it answers "is this association real?", while {@link MIN_CONFIDENCE}
 * answers "is the pull strong enough to mention?". */
const LLR_CUTOFF = 6.63;
/** Never derive a `max_commit_size` below this — so a repo of tiny commits doesn't cap
 * out legitimate small multi-file changes. */
const MAX_BASKET_FLOOR = 8;
/** An absolute ceiling on basket size, regardless of the derived fence — a pure O(n²)
 * cost/safety guard against a pathologically large commit. */
const MAX_BASKET_HARD_CAP = 150;
/** Below this many baskets, the size distribution is too thin for a stable fence, so
 * fall back to the hard cap (don't over-cap a young repo). */
const MIN_BASKETS_FOR_FENCE = 12;
/** Cap on the partners carried in `data` (both modes) — an advisory points at the
 * likeliest siblings, not an exhaustive list (top-k keeps the volume sane on any repo).
 * Exported so a test can assert the cap without hard-coding the number. */
export const MAX_PARTNERS = 10;
/** Cap on the per-partner hint LINES — the advisory text stays tight (the full ranked
 * set lives in `data.partners` / a direct `discern coupling` call). */
const HINT_PARTNERS = 5;
/** Cap on automatic gate hint partner lines. The gate is unsolicited context, so it is
 * terser than the direct `coupling` result (which stays exploratory). */
const GATE_HINT_PARTNERS = 3;
/** Cap on the evidence-mode commit list — a coupled pair's shared history is usually
 * short, but a hub pair can run long; show the most recent this many and report the full
 * `together` count alongside, so the list never floods a caller's context. */
const EVIDENCE_COMMIT_CAP = 25;
/** Confidence at or above which a pair is treated as a near-invariant, triggering the
 * single discovery→enforcement pointer. */
const STRONG_CONFIDENCE = 0.85;
/** Automatic gate hints must clear a stricter presentation bar than the underlying model:
 * either the partner follows the source at a high rate, or it has repeated evidence and a
 * moderate follow-rate. Direct `discern coupling` keeps the broader discovery set. */
const GATE_HINT_STRONG_CONFIDENCE = 0.75;
const GATE_HINT_REPEATED_COCHANGES = 3;
const GATE_HINT_REPEATED_CONFIDENCE = 0.4;
/** The ASCII Record-Separator byte (0x1E) git is told to emit between commit records,
 * via the `%x1e` pretty-format directive ({@link RECORD_SEP_DIRECTIVE}) — a control
 * char that can't occur in a path, so splitting the OUTPUT on it never collides with
 * content. (A NUL byte can't be used: it is rejected inside an argv string, so it must
 * be git's OUTPUT that carries the separator, not the arg.) */
const RECORD_SEP = "\x1e";
/** The git pretty-format directive that emits {@link RECORD_SEP} — the literal four
 * characters `%x1e`, NOT the byte itself (which can't ride in an argv string). Kept
 * beside RECORD_SEP so the emit directive and the split byte stay the same code point. */
const RECORD_SEP_DIRECTIVE = "%x1e";

/** One co-change partner edge with its evidence — the {@link CouplingData} partner wire
 * shape. The log-likelihood ratio is computed and tested for inclusion, but not stored:
 * ranking is by the displayed confidence, so the order matches what a reader sees. */
type Partner = CouplingData["partners"][number];

/** One mined commit: its identity (for the evidence view) and the paths it changed (the
 * basket the model and the evidence view both read). `sha`/`date`/`subject` come from the
 * `%h`/`%ad`/`%s` pretty-format; `files` from `--name-only`. */
interface Commit {
  sha: string;
  date: string;
  subject: string;
  files: string[];
}

/** The raw co-occurrence model over the mined window: `commits` is each file's count of
 * commits it appears in, `cooc` holds the pair counts ONLY for the sources of interest
 * (the query target / the change set), and `total` is the commit count. All RAW integer
 * counts — the significance test is over a contingency table of commits, which only
 * counts make sense for. */
interface CouplingModel {
  commits: Map<string, number>;
  cooc: Map<string, Map<string, number>>;
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
 * Dunning's log-likelihood ratio (a G-test) for a 2×2 contingency table of commit
 * counts: `k11` commits touched both files, `k12` only the first, `k21` only the
 * second, `k22` neither. It measures how surprising the observed co-occurrence is given
 * each file's own frequency, is robust at the low counts a young repo has (where a raw
 * χ² over-fires), and is UNIT-FREE — so one cutoff transfers across repos of any scale,
 * which is the whole point. A cell contributes nothing when its observed count is zero.
 */
function logLikelihoodRatio(
  k11: number,
  k12: number,
  k21: number,
  k22: number,
): number {
  const n = k11 + k12 + k21 + k22;
  if (n === 0) {
    return 0;
  }
  const r1 = k11 + k12;
  const r2 = k21 + k22;
  const c1 = k11 + k21;
  const c2 = k12 + k22;
  const term = (k: number, e: number): number =>
    k > 0 && e > 0 ? k * Math.log(k / e) : 0;
  return 2 * (
    term(k11, (r1 * c1) / n) +
    term(k12, (r1 * c2) / n) +
    term(k21, (r2 * c1) / n) +
    term(k22, (r2 * c2) / n)
  );
}

/** A linear-interpolated percentile of an ascending-sorted numeric array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sortedAsc[lo] ?? 0;
  const b = sortedAsc[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

/**
 * The per-repo `max_commit_size`: the upper-outlier fence (Q3 + 1.5·IQR) of THIS repo's
 * own basket-size distribution, clamped to a sane floor and an absolute cost ceiling. A
 * repo of tiny focused commits caps low; one of habitually larger commits caps higher —
 * the cap adapts so a "sweeping change" is judged relative to what's normal here. Falls
 * back to the hard cap when the distribution is too thin to trust.
 */
export function deriveMaxBasket(sizesAsc: number[]): number {
  if (sizesAsc.length < MIN_BASKETS_FOR_FENCE) {
    return MAX_BASKET_HARD_CAP;
  }
  const q1 = percentile(sizesAsc, 0.25);
  const q3 = percentile(sizesAsc, 0.75);
  const fence = q3 + 1.5 * (q3 - q1);
  return Math.min(
    MAX_BASKET_HARD_CAP,
    Math.max(MAX_BASKET_FLOOR, Math.round(fence)),
  );
}

/**
 * Mine the last {@link WINDOW} non-merge commits into {@link Commit}s — each commit's
 * identity (short sha, short date, subject) and the paths it changed. `-M` follows
 * renames to the new path (so a renamed file's history stays continuous); `--name-only`
 * lists one path per change, NUL-terminated under `-z` so a path git would C-quote in
 * line output (non-ASCII, quotes, control characters) arrives verbatim; the `%x1e`
 * record format prefixes each commit with a Record-Separator byte so splitting the
 * output delimits commits without colliding with a path, and the `%h<TAB>%ad<TAB>%s`
 * header carries the identity the evidence view shows
 * (the same `git log` pretty-format `update` mines — ADR 0064). A git failure yields an
 * empty mine — the advisory simply stays silent (it never fails open into noise).
 *
 * Log paths are toplevel-relative whatever the cwd, so they are normalized to
 * ROOT-relative (a project rooted below its repo's toplevel would otherwise mine
 * baskets no root-relative query path can ever match) — and a commit touching only
 * paths outside the project subtree drops out, keeping the significance population
 * the project's own history.
 */
async function mineCommits(root: string): Promise<Commit[]> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return [];
  }
  const r = await runGit(
    [
      "log",
      "--no-merges",
      "-M",
      "--name-only",
      "-z",
      `--format=${RECORD_SEP_DIRECTIVE}%h%x09%ad%x09%s`,
      "--date=short",
      `--max-count=${WINDOW}`,
    ],
    { cwd: root },
  );
  if (!r.success) {
    return [];
  }
  const commits: Commit[] = [];
  for (const chunk of r.stdout.split(RECORD_SEP)) {
    if (chunk === "") {
      continue;
    }
    // Under -z the `%h<TAB>%ad<TAB>%s` header is the first NUL field (git still
    // separates it from the paths with a newline, which we strip); the rest are the
    // changed paths, one NUL field each. A subject can in principle carry a tab, so
    // keep everything past the first two fields as the subject.
    const [header = "", ...rest] = chunk.split("\0");
    const meta = header.split("\t");
    const files = stripRepoPathPrefix(
      rest
        .map((f) => f.startsWith("\n") ? f.slice(1) : f)
        .filter((f) => f !== ""),
      prefix,
    );
    if (files.length === 0) {
      continue;
    }
    commits.push({
      sha: meta[0] ?? "",
      date: meta[1] ?? "",
      subject: meta.slice(2).join("\t"),
      files,
    });
  }
  return commits;
}

/** One surviving basket: a commit and its pairable file set (neutral paths dropped, paths
 * de-duplicated). */
interface SurvivingBasket {
  commit: Commit;
  files: Set<string>;
}

/**
 * The commits that survive basket construction — the ONE definition of "which commits
 * count", shared by {@link buildModel} (which counts) and the evidence view (which keeps
 * each surviving commit's identity). Neutral paths are dropped (so generated artifacts and
 * docs create no edges), paths de-duplicated, a no-pair commit (<2 files) skipped, and a
 * sweeping commit (> the per-repo size fence {@link deriveMaxBasket}) skipped so a "format
 * everything" change can't manufacture coupling.
 */
function survivingBaskets(
  commits: Commit[],
  config: DiscernConfig,
): SurvivingBasket[] {
  const pairable = commits
    .map((commit) => ({
      commit,
      files: new Set(commit.files.filter((f) => !isNeutralPath(config, f))),
    }))
    .filter((b) => b.files.size >= 2);
  const maxBasket = deriveMaxBasket(
    pairable.map((b) => b.files.size).sort((a, b) => a - b),
  );
  return pairable.filter((b) => b.files.size <= maxBasket);
}

/**
 * Build the raw co-occurrence model over the {@link survivingBaskets}: count each file's
 * commits and — for the sources in `interest` — each directional pair's co-occurrence.
 * All counts are raw integers (the significance test is over commits).
 */
function buildModel(
  baskets: SurvivingBasket[],
  interest: ReadonlySet<string>,
): CouplingModel {
  const commits = new Map<string, number>();
  const cooc = new Map<string, Map<string, number>>();
  let total = 0;
  for (const { files } of baskets) {
    total += 1;
    for (const a of files) {
      commits.set(a, (commits.get(a) ?? 0) + 1);
      if (!interest.has(a)) {
        continue;
      }
      let row = cooc.get(a);
      if (row === undefined) {
        row = new Map<string, number>();
        cooc.set(a, row);
      }
      for (const b of files) {
        if (b !== a) {
          row.set(b, (row.get(b) ?? 0) + 1);
        }
      }
    }
  }
  return { commits, cooc, total };
}

/**
 * The kept partners of source `from`: every B that co-changed with it in at least
 * {@link MIN_COCHANGES} commits, MORE than chance, and significantly so
 * ({@link logLikelihoodRatio} ≥ {@link LLR_CUTOFF}), excluding anything in `exclude`
 * (the source itself, and — in diff mode — the rest of the change set). Each carries the
 * plain-count evidence; the significance test gates inclusion but is not stored.
 */
function partnersOf(
  model: CouplingModel,
  from: string,
  exclude: ReadonlySet<string>,
): Partner[] {
  const row = model.cooc.get(from);
  const nFrom = model.commits.get(from) ?? 0;
  const n = model.total;
  if (row === undefined || nFrom === 0 || n === 0) {
    return [];
  }
  const out: Partner[] = [];
  for (const [to, k11] of row) {
    if (exclude.has(to) || k11 < MIN_COCHANGES) {
      continue;
    }
    const nTo = model.commits.get(to) ?? 0;
    if (nTo === 0) {
      continue;
    }
    const confidence = k11 / nFrom;
    if (confidence < MIN_CONFIDENCE) {
      continue;
    }
    const expected = (nFrom * nTo) / n;
    // Positive association only — co-occurring LESS than chance is not coupling.
    if (k11 <= expected) {
      continue;
    }
    const llr = logLikelihoodRatio(
      k11,
      nFrom - k11,
      nTo - k11,
      n - nFrom - nTo + k11,
    );
    if (llr < LLR_CUTOFF) {
      continue;
    }
    out.push({
      path: to,
      from,
      cochanges: k11,
      of: nFrom,
      confidence: round(confidence, 3),
      lift: round(k11 * n / (nFrom * nTo), 2),
    });
  }
  return out;
}

/** Rank partners strongest-first by the displayed confidence (so the order matches the
 * percentages a reader sees), breaking ties by the raw co-change count (more evidence),
 * then lift, then the path as a stable final tiebreak. Every survivor already cleared the
 * significance gate, so this orders among genuine couplings. Capped to {@link MAX_PARTNERS}. */
function rank(partners: Partner[]): Partner[] {
  return [...partners]
    .sort((a, b) =>
      b.confidence - a.confidence ||
      b.cochanges - a.cochanges ||
      b.lift - a.lift ||
      a.path.localeCompare(b.path)
    )
    .slice(0, MAX_PARTNERS);
}

/** Query mode: the top co-change partners of one `target` file (its blast radius). */
async function queryCoupling(
  root: string,
  config: DiscernConfig,
  target: string,
): Promise<CouplingData> {
  const baskets = survivingBaskets(await mineCommits(root), config);
  const model = buildModel(baskets, new Set([target]));
  const partners = rank(partnersOf(model, target, new Set([target])));
  return { mode: "query", target, partners };
}

/**
 * Diff-aware mode: the partners that co-change with the current change set but are
 * MISSING from it. The change set is read through the SAME {@link collectPaths} the
 * scope classifier uses (committed since the merge-base, plus the working tree), then
 * neutral-filtered. A git hiccup / no diff base yields no change set and no advice —
 * fail SILENT, never fail-open into noise. A partner reached from several changed files
 * is reported once, via its strongest (highest-co-change) edge.
 */
async function diffCoupling(
  root: string,
  config: DiscernConfig,
  env: EnvReader,
): Promise<CouplingData> {
  const mainBranch = env.get("DISCERN_MAIN_BRANCH") ||
    config.repository.trunk;
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
  const model = buildModel(
    survivingBaskets(await mineCommits(root), config),
    changedSet,
  );
  const best = new Map<string, Partner>();
  for (const from of changed) {
    for (const partner of partnersOf(model, from, changedSet)) {
      const prev = best.get(partner.path);
      if (prev === undefined || partner.cochanges > prev.cochanges) {
        best.set(partner.path, partner);
      }
    }
  }
  return { mode: "diff", changed, partners: rank([...best.values()]) };
}

/**
 * Evidence mode: the shared co-change history of two files — the commits in which BOTH
 * `a` and `b` changed (most-recent first, {@link EVIDENCE_COMMIT_CAP}), with each file's
 * own commit count in the window (the "of N" denominators). It reads the SAME
 * {@link survivingBaskets} the model counts, so the numbers corroborate what
 * `coupling <a>` reports for the pair: a sweeping commit or a neutral path is excluded
 * here too. This is the raw material to judge a coupling — one deliberate decision, or a
 * few incidental rides-along — so it lists actual commits, not a score. Fails silent (an
 * empty mine yields a zero-history result; the verb never throws).
 */
async function evidenceCoupling(
  root: string,
  config: DiscernConfig,
  a: string,
  b: string,
): Promise<CouplingData> {
  const baskets = survivingBaskets(await mineCommits(root), config);
  let ofA = 0;
  let ofB = 0;
  const shared: Commit[] = [];
  for (const { commit, files } of baskets) {
    const hasA = files.has(a);
    const hasB = files.has(b);
    if (hasA) {
      ofA += 1;
    }
    if (hasB) {
      ofB += 1;
    }
    if (hasA && hasB) {
      shared.push(commit);
    }
  }
  return {
    mode: "evidence",
    a,
    b,
    of_a: ofA,
    of_b: ofB,
    together: shared.length,
    commits: shared.slice(0, EVIDENCE_COMMIT_CAP).map((c) => ({
      sha: c.sha,
      date: c.date,
      subject: c.subject,
    })),
    partners: [],
  };
}

/** `together` as a share of `of` — a whole-percent string, or "" when `of` is 0 (a file
 * with no history in the window). */
function share(together: number, of: number): string {
  return of > 0 ? ` (${pct(together / of)})` : "";
}

/**
 * Evidence-mode hint lines: the shared history of two files in plain counts, then the
 * actual commits (sha, date, subject) where both changed. No verdict — the reader judges
 * one decision vs incidental from the dates and subjects. When the two never co-changed
 * it still reports each file's own count, so "no shared history" is an answer, not silence.
 */
function evidenceHints(data: CouplingData): string[] {
  const a = data.a ?? "";
  const b = data.b ?? "";
  const together = data.together ?? 0;
  const ofA = data.of_a ?? 0;
  const ofB = data.of_b ?? 0;
  if (together === 0) {
    return [
      `\`${a}\` and \`${b}\` have not changed together in recent history ` +
      `(from git history; \`${a}\`: ${ofA} commit(s), \`${b}\`: ${ofB} commit(s)).`,
    ];
  }
  const hints = [
    `\`${a}\` and \`${b}\` changed together in ${together} commit(s) — ${together} of ` +
    `\`${a}\`'s ${ofA}${
      share(together, ofA)
    } and ${together} of \`${b}\`'s ${ofB}` +
    `${share(together, ofB)} recent commits (from git history):`,
  ];
  const commits = data.commits ?? [];
  for (const c of commits) {
    hints.push(`  ${c.sha}  ${c.date}  ${c.subject}`);
  }
  const more = together - commits.length;
  if (more > 0) {
    hints.push(`… and ${more} more shared commit(s).`);
  }
  return hints;
}

/**
 * The advisory hint lines for a co-change result — the ONE human-facing surface
 * (rendered to human text, `--json`, and MCP alike). Flat, no severity tiers (ADR
 * 0063): each partner is shown with its evidence in plain counts ("N of the M recent
 * commits"), the framing states the list is NOT exhaustive, and every line is
 * observation-plus-suggestion, never a verdict. A single discovery→enforcement pointer
 * is appended when the strongest pair is a near-invariant. Empty when there are no
 * partners (the advisory stays quiet). Evidence mode delegates to {@link evidenceHints}.
 */
function couplingHints(
  data: CouplingData,
  maxPartners = HINT_PARTNERS,
): string[] {
  if (data.mode === "evidence") {
    return evidenceHints(data);
  }
  if (data.partners.length === 0) {
    return [];
  }
  const hints: string[] = [];
  const shown = data.partners.slice(0, maxPartners);
  if (data.mode === "diff") {
    hints.push(
      "Co-change advisory (from git history; advisory only, never blocks, and NOT " +
        "exhaustive) — files that usually change with what you've changed on this branch " +
        "(vs the trunk, the shared landing branch) but aren't among those changes:",
    );
    for (const p of shown) {
      hints.push(
        `You changed \`${p.from}\` but not \`${p.path}\` — which changed in ${p.cochanges} ` +
          `of the ${p.of} recent commits that touched \`${p.from}\` (${
            pct(p.confidence)
          }). ` +
          `Worth a look, or intentional?`,
      );
    }
  } else {
    const target = data.target ?? "";
    hints.push(
      `Files that usually change with \`${target}\` (from git history; advisory, NOT ` +
        "exhaustive):",
    );
    for (const p of shown) {
      hints.push(
        `\`${p.path}\` — changed together in ${p.cochanges} of \`${target}\`'s ${p.of} ` +
          `recent commits (${pct(p.confidence)}).`,
      );
    }
  }
  const remaining = data.partners.length - shown.length;
  if (remaining > 0) {
    const arg = data.mode === "query" && data.target !== undefined
      ? ` ${data.target}`
      : "";
    // The gate is the consumer that benefits from this pointer (it surfaces only the
    // terse hints, not the full data); the standalone verb renders every partner itself.
    hints.push(
      `… and ${remaining} more — \`discern coupling${arg}\` lists them all.`,
    );
  }
  const strongest = data.partners[0];
  if (strongest !== undefined && strongest.confidence >= STRONG_CONFIDENCE) {
    hints.push(
      `\`${strongest.from}\` and \`${strongest.path}\` change together almost every time. ` +
        "If that reflects an essential invariant, consider locking it with a forcing-function " +
        "(see the `discern-cure-a-bug` skill) rather than relying on memory.",
    );
  }
  return hints;
}

/** Whether a mined partner is strong enough to interrupt a green gate run. This is
 * intentionally stricter than model inclusion: on-demand coupling is discovery; the gate
 * should nudge only when the evidence is already pretty loud. */
function isGateHintPartner(p: Partner): boolean {
  return p.confidence >= GATE_HINT_STRONG_CONFIDENCE ||
    (p.cochanges >= GATE_HINT_REPEATED_COCHANGES &&
      p.confidence >= GATE_HINT_REPEATED_CONFIDENCE);
}

/**
 * Compute the `coupling` {@link DiscernResult} without printing — the entry point the
 * MCP server renders and the CLI's `--json` serializes. The path count selects the mode:
 * none → diff-aware; one → query that file's partners; two (distinct) → the evidence view
 * of the pair. `env` is injected (defaulting to the process env) so the integration branch
 * resolves without touching process-global state. Always `ok: true`: an advisory has no
 * failure mode — at worst it advises nothing.
 */
export async function couplingResult(
  root: string,
  opts: { paths?: string[] } = {},
  env: EnvReader = Deno.env,
): Promise<DiscernResult<CouplingData>> {
  const config = await loadConfig(root);
  const paths = (opts.paths ?? [])
    .map((p) => normalizePath(p))
    .filter((p) => p !== "");
  const a = paths[0];
  const b = paths[1];
  const data = a !== undefined && b !== undefined && a !== b
    ? await evidenceCoupling(root, config, a, b)
    : a !== undefined
    ? await queryCoupling(root, config, a)
    : await diffCoupling(root, config, env);
  const hints = couplingHints(data);
  return {
    ok: true,
    verb: "coupling",
    data,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

/** Options for the `coupling` subcommand surface. The positional `paths` select the mode:
 * none → diff-aware; one → query; two → the pair's evidence view. */
export interface CouplingOptions {
  json?: boolean;
  paths?: string[];
}

/** One rendered partner row: `<confidence>  <N of M commits>  <file>`, the confidence
 * colour-cued by strength and the count column aligned to `countWidth` so the trailing
 * file paths line up across every row and group. */
function partnerRow(
  p: Partner,
  indent: string,
  countWidth: number,
  c: Out["c"],
): string {
  const strength = p.confidence >= 0.5
    ? c.green
    : p.confidence >= 0.3
    ? c.cyan
    : c.dim;
  const pctStr = `${Math.round(p.confidence * 100)}%`.padStart(4);
  const count = `${p.cochanges} of ${p.of}`.padStart(countWidth);
  return `${indent}${c.bold}${strength}${pctStr}${c.reset}  ` +
    `${c.dim}${count} commits${c.reset}  ${p.path}\n`;
}

/** One evidence commit row: `<sha>  <date>  <subject>` — the same `  sha  subject` shape
 * `update` narrates (ADR 0064), plus the date, the sha cyan and the date dim. */
function evidenceRow(
  commit: NonNullable<CouplingData["commits"]>[number],
  c: Out["c"],
): string {
  return `  ${c.cyan}${commit.sha}${c.reset}  ${c.dim}${commit.date}${c.reset}  ` +
    `${commit.subject}\n`;
}

/**
 * Evidence mode's human view: the two files' shared-history headline in plain counts, then
 * the actual commits (sha, date, subject) where both changed — strongest signal a reader
 * can weigh for "one decision vs incidental". When the two never co-changed it still
 * reports each file's own count, so "no shared history" is the answer, not a blank.
 */
function renderEvidenceHuman(data: CouplingData, out: Out): void {
  const { c } = out;
  const a = data.a ?? "";
  const b = data.b ?? "";
  const together = data.together ?? 0;
  const ofA = data.of_a ?? 0;
  const ofB = data.of_b ?? 0;
  if (together === 0) {
    out.raw(
      `${a} and ${b} have not changed together in recent history.\n` +
        `  ${c.dim}${a}: ${ofA} commit(s) · ${b}: ${ofB} commit(s)${c.reset}\n`,
    );
    return;
  }
  out.heading(`Shared history of ${a} and ${b}`);
  out.raw(
    `  ${c.dim}advisory — from git history; recent window${c.reset}\n` +
      `  Changed together in ${c.bold}${together}${c.reset} commit(s) — ` +
      `${together} of ${ofA}${share(together, ofA)} touching ${a}, ` +
      `${together} of ${ofB}${share(together, ofB)} touching ${b}.\n\n`,
  );
  for (const commit of data.commits ?? []) {
    out.raw(evidenceRow(commit, c));
  }
  const more = together - (data.commits?.length ?? 0);
  if (more > 0) {
    out.raw(`  ${c.dim}… and ${more} more shared commit(s).${c.reset}\n`);
  }
}

/**
 * Render a co-change result as first-class human output: a heading, a dim "advisory"
 * subtitle, and every partner in `data.partners` (the FULL ranked list — NOT the terse
 * gate hints, so a direct `discern coupling` shows everything it found) as an aligned,
 * strength-coloured row, strongest first. The diff-aware view groups partners under the
 * file you changed. A near-invariant pair earns the discovery→enforcement tip. Evidence
 * mode delegates to {@link renderEvidenceHuman}. The gate surfaces the terse
 * {@link couplingHints} instead; this is the standalone verb's view.
 */
function renderCouplingHuman(data: CouplingData, out: Out): void {
  const { c } = out;
  if (data.mode === "evidence") {
    renderEvidenceHuman(data, out);
    return;
  }
  // The diff-aware change set is "what this branch changed" — committed since the fork
  // from the integration branch, PLUS any uncommitted edits — so it is non-empty even
  // on a clean tree if the branch is ahead. Name it precisely so "this change" can't be
  // mistaken for the latest commit or a single uncommitted edit.
  const n = data.changed?.length ?? 0;
  const changedPhrase = `the ${
    n === 1 ? "file" : `${n} files`
  } you've changed on this branch`;

  if (data.partners.length === 0) {
    if (data.mode === "query") {
      out.raw(`No co-change partners found for \`${data.target ?? ""}\`.\n`);
    } else if (n === 0) {
      out.raw("Nothing changed on this branch — no co-change advisory.\n");
    } else {
      out.raw(`No co-change partners found for ${changedPhrase}.\n`);
    }
    return;
  }
  const countWidth = Math.max(
    ...data.partners.map((p) => `${p.cochanges} of ${p.of}`.length),
  );
  const subtitle =
    `${c.dim}advisory — from git history; never blocks, not exhaustive${c.reset}`;

  if (data.mode === "query") {
    out.heading(`Files that usually change with ${data.target ?? ""}`);
    out.raw(`  ${subtitle}\n\n`);
    for (const p of data.partners) {
      out.raw(partnerRow(p, "  ", countWidth, c));
    }
  } else {
    out.heading("Co-change advisory");
    out.raw(
      `  ${c.dim}Files that usually change with ${changedPhrase} (vs ` +
        `the trunk, the shared landing branch), but aren't among them.${c.reset}\n  ${subtitle}\n`,
    );
    // Group partners under the file that drew them, in ranked order (the Map keeps
    // first-seen order, and data.partners is already ranked strongest-first).
    const groups = new Map<string, CouplingData["partners"]>();
    for (const p of data.partners) {
      const arr = groups.get(p.from) ?? [];
      arr.push(p);
      groups.set(p.from, arr);
    }
    for (const [from, partners] of groups) {
      out.raw(`\n  You changed ${c.bold}${from}${c.reset}, but not:\n`);
      for (const p of partners) {
        out.raw(partnerRow(p, "     ", countWidth, c));
      }
    }
  }

  const strongest = data.partners[0];
  if (strongest !== undefined && strongest.confidence >= STRONG_CONFIDENCE) {
    out.raw(
      `\n  ${c.dim}\`${strongest.from}\` and \`${strongest.path}\` change together ` +
        `almost every time — if that's an essential invariant, lock it with a ` +
        `forcing-function (the discern-cure-a-bug skill).${c.reset}\n`,
    );
  }
}

/**
 * The `coupling` subcommand: render the full advisory as formatted human output, or the
 * JSON DiscernResult (`--json`). With nothing to advise it prints a single "nothing
 * found" line and still exits 0 — the advisory never fails.
 */
export async function runCoupling(
  root: string,
  opts: CouplingOptions,
  env: EnvReader = Deno.env,
): Promise<number> {
  const result = await couplingResult(
    root,
    opts.paths !== undefined ? { paths: opts.paths } : {},
    env,
  );
  if (opts.json) {
    emitResult(result);
    return 0;
  }
  const data = result.data;
  if (data !== undefined) {
    renderCouplingHuman(data, makeOut(colorEnabled()));
  }
  return 0;
}

/**
 * The diff-aware co-change advisory as gate hints, or `[]`. The gate appends these at
 * its TAIL (with strand detection — it reads the diff, so it is dependency-bearing,
 * never a fail-fast precondition; ADR 0084). Gated by the caller on
 * `[coupling].in_gate` and a bootstrapped install. Best-effort: any failure yields
 * `[]`, so the advisory can NEVER affect the gate's `ok` / exit / `failed_stage`.
 * Uses a stricter presentation filter than direct `discern coupling`: explicit queries
 * are exploratory, while automatic gate hints should be rarer and higher-confidence.
 */
export async function couplingGateHints(
  root: string,
  env: EnvReader = Deno.env,
): Promise<string[]> {
  try {
    const data = (await couplingResult(root, {}, env)).data;
    if (data === undefined || data.mode !== "diff") {
      return [];
    }
    return couplingHints({
      ...data,
      partners: data.partners.filter(isGateHintPartner),
    }, GATE_HINT_PARTNERS);
  } catch {
    return [];
  }
}
