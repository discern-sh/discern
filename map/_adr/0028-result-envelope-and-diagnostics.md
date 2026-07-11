# ADR 0028: One result envelope per verb, with normalized failure diagnostics

**Status**: accepted; **supersedes
[ADR 0004](_superseded/0004-structured-finish-json.md)**; extends
[ADR 0027](0027-plan-apply-engine-execution.md)

## Context

ADR 0027 made every effectful engine verb compute a pure plan, apply it, and
serialize `(plan, results)` to `--json` rather than re-deriving it. That was the
right seam — but it was only half-walked, and the asymmetry showed at the CLI's
agent-facing surface:

1. **No single result object.** `finish` hand-built a bespoke `GateReport`
   (`{ok, jobs[], scope_gates[], failed_stage, scopes_changed}`, the old ADR
   0004 shape). The worktree/ratchet verbs shared a _different_ generic shape
   (`{ok, steps[]}`). `scopes` emitted a bare JSON array; `skills list` a
   bespoke array; the installer verbs (`doctor`/`setup`/…) each had their own
   `Logger.jsonResult` payload. Six-plus disjoint shapes; some carried a
   top-level `ok`, some didn't. An agent couldn't even rely on `result.ok`.

2. **The result object was a `--json`-only escape hatch, not the spine.** Human
   output was produced _imperatively during execution_ (headings as groups ran,
   per-job banners from the runner), entirely separately from the JSON. The two
   presentations shared inputs but not a rendering, so they could drift.

3. **Failures carried no structured "why".** A gate job's combined stdout+stderr
   _was_ captured (the default buffered runner held it) — and then written to
   the human stream and **discarded**. `finish --json` told an agent _which
   stage_ and _which job_ failed and nothing more: no output, no command, no
   file/line. The agent's loop was act → re-run → scrape stderr → guess.

discern's whole pitch is **stack-neutral commands**. The unique thing a neutral
harness is positioned to give — that no per-tool agent integration can — is
**stack-neutral _results_**: a uniform failure shape across every language and
tool. We were one seam short of it. With no external users yet (ADR 0009's
pre-1.0 license to break), now is the time to unify rather than accrete a
seventh shape.

## Decision

**Every verb returns one typed `DiscernResult`; its human text, its `--json`,
and the MCP server's tool result are all renderings of that one object.** The
vocabulary lives in `src/shared/result.ts` — the base layer both halves of the
binary import without a cycle.

### The envelope

```ts
interface DiscernResult {
  ok: boolean; // the one field EVERY consumer can rely on
  verb: string; // "finish" | "graduate" | "doctor" | …
  plan?: EnginePlan; // a preview (dry-run): what WOULD run
  steps?: StepResult[]; // an apply: what ran and how each turned out
  diagnostics?: Diagnostic[]; // normalized failures — the structured "why"
  data?: unknown; // verb-specific payload (doctor's checks, schema versions)
  error?: string; // a machine-stable slug when the verb refused/aborted
  message?: string; // a human sentence accompanying `error`
}
```

`serializeResult` is the ONE place the wire shape is defined (undefined fields
dropped). A preview carries `plan` + `dry_run` and no `steps`; an apply carries
`steps`. For a **preview**, the human listing and the JSON are two renderings of
one object through one shared renderer (`renderPlan`), so they cannot disagree.
For an **apply**, the settled step summary is rendered from `steps[]` through
the shared `renderStepResults`; the JSON serializes those same `steps[]`. A verb
may add bespoke human _advice_ (finish's success tail, doctor's per-check fix
hints) on top, and **live streamed job/progress output stays a side-channel**
(you cannot render post-hoc bytes from a settled object) — though under `--json`
that side-channel is itself silenced (see the _Update_ below).

We deliberately did **not** force every verb's payload into one shape: a doctor
check is not a gate job, a pending migration is not a step. Per-verb data rides
in `data`. The uniformity is the _envelope_ (`ok`/`verb`/`error`/`diagnostics`)
plus the shared `plan`/`steps` machinery — not a single Procrustean record.

### Normalized diagnostics, in tiers

A `Diagnostic` is
`{tool, severity, message, reproduce_cmd, output?, truncated?,
output_path?, file?, line?, col?, rule?, fix_available?}`.
It is layered by how much discern knows about a tool — and most of it needs no
per-tool knowledge:

- **Tier 0 — capture (this ADR; stack-neutral, no parsing; refined by
  [ADR 0083](0083-normalize-and-offload-diagnostic-output.md)).** Each failed
  gate command attaches its captured combined output (terminal-normalized and
  capped) and `reproduce_cmd` — which is just the command's own string, already
  in hand. When the normalized capture is truncated, `output_path` points at a
  best-effort temp file containing the full normalized capture. This alone flips
  the loop to act → read-error → fix, for every tool in every stack. A
  fail-fast- _cancelled_ sibling is excluded (it isn't a failure to fix).
- **Tier 1 — normalize.** discern parses recognized machine formats into
  `file`/`line`/`col`/`rule` — one diagnostic per finding. The first format is
  **SARIF**, _auto-detected_: a project opts in simply by making its command
  emit SARIF (`eslint --format sarif .`), and discern recognizes the **format**,
  never the tool, so the neutral core stays neutral. Detection is unambiguous
  (valid JSON + a `runs` array + a 2.x/sarif marker), so a non-SARIF tool can
  never be misread; anything unrecognized falls back to the Tier-0 raw
  diagnostic. Declared _text_ formats (a per-check regex via a future
  `[diagnostics.<name>]` table) are the next slice — deferred because they need
  a config-surface decision, where SARIF needed none.
- **Tier 2 — derive.** `fix_available: true` is attached to a failed
  capability/check diagnostic from a non-fix stage when the executed gate plan
  has a real fix-stage job wired. It is deliberately absent for scope gates,
  generated-artifact currency diagnostics, fix-stage failures themselves, and
  configs with no fixer.

### MCP is a renderer, not a rewrite

Because every verb already returns a `DiscernResult`, an MCP server exposing the
verbs is `serializeResult` over stdio — a third rendering of the same spine.

## Consequences

- **Agents loop act → read-error → fix.** The failure's command and output are
  in the result; no re-run, no stderr scraping. This is the headline DX win and
  the reason the work was prioritized above backward compatibility.
- **Human and machine output share renderers for plans and step summaries.** A
  preview's two views cannot drift; an apply's settled step summary is rendered
  from the same `steps[]` that `--json` serializes, while live job/progress
  output remains a side-channel.
- **One contract to learn and to test.** `serializeResult` is the single wire
  definition; new verbs get the envelope automatically.
- **Breaking — every `--json` shape changed.** `finish` no longer emits
  `jobs[]`/`scope_gates[]`/`failed_stage` at top level (now `steps[]` +
  `diagnostics[]`, with `failed_stage`/`scopes_changed` under `data`); the
  worktree/installer/query verbs move onto the envelope likewise. Acceptable
  pre-1.0 (ADR 0009); there are no external consumers to migrate.
- **A capped capture costs a little memory.** Buffered mode already held full
  output; stream mode now also retains a byte-capped copy so a failed streamed
  job still carries its diagnostic. Bounded by a hard cap.
- **Tier 0 is honest about its limits.** Without a declared `format`, a
  diagnostic carries normalized output, not `file`/`line`. That's the
  stack-neutral floor; Tier 1 is the opt-in ceiling. We do not ship a per-tool
  parser library in the neutral core.

## Alternatives considered

- **A built-in per-tool parser library (eslint/tsc/pytest/cargo/…) so every
  diagnostic has `file`/`line` out of the box.** Rejected: it bakes stack
  knowledge into a stack-neutral core — the exact coupling discern exists to
  avoid — and never keeps pace with every tool. The tiered design gets ~80% of
  the value (capture) with zero parsing and offers the rest as opt-in.
- **Keep `finish`'s bespoke `GateReport` and only unify the others.** Rejected:
  the flagship verb is the one an agent consumes most; leaving it a snowflake
  defeats the "one object" goal and keeps two result systems alive.
- **Force every verb's payload into `steps[]`.** Rejected: a doctor check or a
  schema-version delta isn't a step that ran. `data` carries verb-specific
  payloads without distorting them; the envelope unifies what's genuinely
  common.

## Update — quiet `--json` (consolidates [ADR 0030](_superseded/0030-quiet-json-output.md))

ADR 0030 extended this envelope and is folded in here. The refinement: **in
`--json` mode the `DiscernResult` envelope is the _entire_ program output.** All
discern-authored narration _and_ all captured/streamed subprocess output are
**suppressed, not rerouted** — combined `stdout`+`stderr` of any `<verb> --json`
is exactly one JSON object (only an uncaught crash may still reach `stderr`).
This silences the live-output side-channel the Decision above left on `stderr`,
so the 16k diagnostic cap is no longer defeated by an uncapped parallel stream —
the agent loop _act → read-error → fix_ now works through a tool that captures
the two streams combined.

It rests on three structural commitments:

- **One silence rule.** In JSON mode every human output method is a no-op and
  the job runner withholds its sink (the child is always piped, so nothing
  reaches an fd), while `result.output` still feeds the failure diagnostic.
- **One emission chokepoint.** A single `emitResult` is the only code that
  serializes an envelope to `stdout`; every hand-rolled `console.log` emission
  is removed (`serializeResult` stays the one wire-shape definition).
- **A `hints?: string[]` field** promotes advice that was human-only — the
  gotchas-doc pointer on a failed gate, the ratchets / dev-server / docs nudges
  on a clean one — into the envelope, so going quiet loses nothing.

Agents are steered to `--json` through the **compiled guidance**, never
environment-variable detection (rejected as rot-prone, non-deterministic under
test, and a generic-surface violation; any default-on must be an explicit
`DISCERN_JSON` / `[output]` knob, not a sniff). An architectural test asserts,
for every `--json` verb, that combined output parses to exactly the envelope,
and a source guard pins the single emission chokepoint.
