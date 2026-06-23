# ADR 0028: One result envelope per verb, with normalized failure diagnostics

**Status**: accepted; **supersedes [ADR 0004](0004-structured-finish-json.md)**;
extends [ADR 0027](0027-plan-apply-engine-execution.md)

## Context

ADR 0027 made every effectful engine verb compute a pure plan, apply it, and
serialize `(plan, results)` to `--json` rather than re-deriving it. That was the
right seam — but it was only half-walked, and the asymmetry showed at the CLI's
agent-facing surface:

1. **No single result object.** `finish` hand-built a bespoke `GateReport`
   (`{ok, jobs[], scope_gates[], failed_stage, scopes_changed}`, the old ADR
   0004 shape). The worktree/ratchet verbs shared a _different_ generic shape
   (`{ok, steps[]}`). `changed-scopes` emitted a bare JSON array; `skills list`
   a bespoke array; the installer verbs (`doctor`/`init`/`migrate`/…) each had
   their own `Logger.jsonResult` payload. Six-plus disjoint shapes; some carried
   a top-level `ok`, some didn't. An agent couldn't even rely on `result.ok`.

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
`steps`. How tightly human and machine output are bound differs by path, and the
ADR is precise about it: for a **preview**, the human listing and the JSON are
two renderings of one object through one shared renderer (`renderPlan`), so they
cannot disagree. For an **apply**, the JSON is the serialized result while the
human narration is produced _during execution_ — kept consistent because both
read the same run, a convention rather than a structural invariant (there is no
shared `steps[]` renderer yet; unifying that is future work). A verb may add
bespoke human _advice_ (finish's success tail, doctor's per-check fix hints) on
top, and **live streamed job output stays a side-channel** (you cannot render
post-hoc bytes from a settled object).

We deliberately did **not** force every verb's payload into one shape: a doctor
check is not a gate job, a pending migration is not a step. Per-verb data rides
in `data`. The uniformity is the _envelope_ (`ok`/`verb`/`error`/`diagnostics`)
plus the shared `plan`/`steps` machinery — not a single Procrustean record.

### Normalized diagnostics, in tiers

A `Diagnostic` is
`{tool, severity, message, reproduce_cmd, output?, truncated?,
file?, line?, col?, rule?, fix_available?}`.
It is layered by how much discern knows about a tool — and the lion's share
needs no per-tool knowledge:

- **Tier 0 — capture (this ADR; stack-neutral, no parsing).** Each failed gate
  command attaches its captured combined output (tail-capped) and
  `reproduce_cmd` — which is just the command's own string, already in hand.
  This alone flips the loop to act → read-error → fix, for every tool in every
  stack. A fail-fast- _cancelled_ sibling is excluded (it isn't a failure to
  fix).
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
- **Tier 2 — derive (planned).** `fix_available` will follow from whether a
  fixer is wired for the failing capability; the field exists on the
  `Diagnostic` but is not yet populated (see TODO.md).

### MCP is a renderer, not a rewrite

Because every verb already returns a `DiscernResult`, an MCP server exposing the
verbs is `serializeResult` over stdio — a third rendering of the same spine.

## Consequences

- **Agents loop act → read-error → fix.** The failure's command and output are
  in the result; no re-run, no stderr scraping. This is the headline DX win and
  the reason the work was prioritized above backward compatibility.
- **Human and machine output share a renderer for previews** (and are parallel
  renderings of the same run for applies). A preview's two views cannot drift;
  an apply's are kept consistent by construction until a shared `steps[]`
  renderer lands.
- **One contract to learn and to test.** `serializeResult` is the single wire
  definition; new verbs get the envelope for free.
- **Breaking — every `--json` shape changed.** `finish` no longer emits
  `jobs[]`/`scope_gates[]`/`failed_stage` at top level (now `steps[]` +
  `diagnostics[]`, with `failed_stage`/`scopes_changed` under `data`); the
  worktree/installer/query verbs move onto the envelope likewise. Acceptable
  pre-1.0 (ADR 0009); there are no external consumers to migrate.
- **A capped capture costs a little memory.** Buffered mode already held full
  output; stream mode now also retains a byte-capped copy so a failed streamed
  job still carries its diagnostic. Bounded by a hard cap.
- **Tier 0 is honest about its limits.** Without a declared `format`, a
  diagnostic carries raw output, not `file`/`line`. That's the stack-neutral
  floor; Tier 1 is the opt-in ceiling. We do not ship a per-tool parser library
  in the neutral core.

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
