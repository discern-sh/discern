# Co-change coupling

_`discern coupling` — surface the files that change together, so the sibling you
would otherwise forget gets named._

A coding agent has near-perfect recall of the file in front of it and almost
none of the file that, by the project's own history, almost always moves with it
— the schema and its validator, the registry and the switch over it, the verb
and its test. The `coupling` verb reconstructs a senior's "I bet there's another
one" instinct from data: it mines git history for files that change in the same
commits and reports the ones a change is likely missing. It is the **discovery**
layer that pairs with the **enforcement** discipline of
[ADR 0051](../_adr/0051-canonical-set-parity.md) — and the two are kept
deliberately apart ([ADR 0069](../_adr/0069-co-change-coupling-advisory.md)).

It is **purely advisory**. It points at where to look and **never blocks** —
never touches a gate's pass/fail, exit code, or `failed_stage`. The whole output
rides in the `DiscernResult` `hints[]` (the one advisory channel — human,
`--json`, and MCP alike), with each partner's evidence shown for transparency
and the list stated to be **not exhaustive**.

## Two modes

`coupling` is one verb with two modes, mirroring `changed-scopes`:

- **diff-aware** (no argument) — the primary surface. It reads the current
  change set (committed since the merge-base, plus the working tree — the same
  set the scope classifier uses) and names the files that co-change with what
  you touched but are **missing** from the change. _"You changed `result.ts`,
  but not `result_schemas.ts` — which co-changed with it in 39% of `result.ts`'s
  recent history. Intentional, or a sibling worth updating too?"_
- **query** (`discern coupling <path>`) — one file's top co-change partners, its
  blast radius. Useful before a change: _what tends to move when I touch this?_

Both render the advisory as `hints[]`; `--json` adds `data.partners`, the ranked
list, each entry an edge `{ path, from, support, confidence, lift }`. The MCP
tool `discern_coupling` takes an optional `file` argument for query mode (the
working-root override keeps the name `path`).

## The metric

Each non-merge commit is a **basket** of the files it changed. From a bounded
window of recent commits:

- **neutral paths are dropped** (the same classification
  `[scopes.<name>].neutral` drives), so docs, generated agent files, and
  materialized skills never create edges;
- **each commit is weighted by `1 / basket_size`**, and **skipped** when the
  basket exceeds `max_commit_size` — a focused two-file commit is strong
  evidence of coupling; a sweeping "format everything" or dependency bump is
  near-zero evidence per pair, and this is the single most important filter
  against O(n²) noise;
- **co-occurrence is decayed by recency** (`half_life_days`), so a coupling a
  refactor already dissolved fades out;
- for a directional pair A→B the model accumulates weighted `support`
  (co-occurrence), `confidence(A→B) = w(A∧B) / w(A)`, and
  `lift = P(A∧B) / (P(A)·P(B))`, and keeps the edge only when
  `support ≥ min_support` **and** `confidence ≥ min_confidence` **and**
  `lift > 1`. Lift is the discriminator that drops a high-churn file which
  co-occurs with everything.

The model is **recomputed on demand**, bounded by `window` — there is no cache
in v1 (see [ADR 0069](../_adr/0069-co-change-coupling-advisory.md) for why a
persisted store is deferred). When git can't answer, the advisory stays
**silent** rather than failing into noise.

## Configuration

The `[coupling]` section tunes the metric; every key has a default, so a fresh
install needs no configuration. The full reference is in
[config-reference.md](../10-installer/config-reference.md#coupling).

| Key               | Default | Meaning                                                                                        |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `window`          | `500`   | How many recent non-merge commits to mine.                                                     |
| `min_support`     | `1.0`   | The weighted co-occurrence floor (a score, not a raw count — a focused two-file commit ≈ 0.5). |
| `min_confidence`  | `0.3`   | The directional floor: A→B is kept only when A's changes also touched B this often.            |
| `max_commit_size` | `25`    | Skip a commit touching more than this many (non-neutral) files.                                |
| `half_life_days`  | `90`    | Recency half-life: a co-change this old counts half as much.                                   |
| `in_gate`         | `false` | Append the diff-aware advisory to `discern finish` (see below).                                |

The whole subsystem is the `coupling`
[Feature](../00-orientation/glossary.md#feature), inert when
`[features].coupling = false`.

## In the gate

With `[coupling].in_gate = true`, `discern finish` appends the diff-aware
advisory to its result as `hints[]`, at the **tail** of the run — alongside
strand detection, because it reads the diff and is therefore dependency-bearing,
never a fail-fast precondition. It is suppressed entirely until the install is
bootstrapped, so an agent's in-session setup stays uncluttered. It **never**
changes the gate's verdict — only adds advice. The flag is off by default: opt
in when you want the nudge in the gate as well as on demand.

## Discovery, not enforcement

A strong coupling is a finding, not a verdict. The advisory names one path back
to enforcement — _"if this is an essential invariant, lock it with a forcing
function (the
[`fix-a-bug-class`](../../templates/skills/fix-a-bug-class/SKILL.md) skill / ADR
0051)"_ — but the decision is yours: an **essential** invariant earns a forcing
function, an **incidental** co-change earns nothing. Promoting a coupling to an
enforced rule is always a separate, deliberate step
([ADR 0069](../_adr/0069-co-change-coupling-advisory.md)).

## See also

- [ADR 0069](../_adr/0069-co-change-coupling-advisory.md) — why the advisory is
  non-blocking and recomputed on demand.
- [ADR 0051](../_adr/0051-canonical-set-parity.md) — the enforcement discipline
  this feeds.
- [the-result-envelope.md](the-result-envelope.md) — the `hints[]` and `data`
  the verb returns.
