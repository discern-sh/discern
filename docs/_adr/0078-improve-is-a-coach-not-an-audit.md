# ADR 0078: `improve` is a coach, not an audit

**Status**: accepted. Extends [ADR 0029](0029-best-practices-audit.md): its
deterministic-rule and qualitative-review split remains; this decision changes
the product frame and adds a priority above the report.

## Context

`discern audit` already separated facts the binary could score from reviews that
needed an agent's judgement. Its output still looked like a compliance snapshot:
a green `Overall 100/100` headline followed by a dim parenthetical review count.
The number was honest, but the presentation made an objectively complete
baseline read as "nothing left to do." Users then had to turn the weakest-first
report into their own priority queue.

The catalog also needs to teach practice quality, not reward file existence.
Tests can exist but be coupled, serial, or shallow; docs can exist but drift or
be impossible to navigate; guidance can exist but repeat code; a raw ceiling
count can punish healthy growth. Those questions require judgement and must not
be smuggled into the deterministic score.

Renaming a CLI verb and MCP tool is a hard-to-reverse public-surface decision.
An alias would ease the transition, but it would permanently preserve the
compliance-flavoured name in help, documentation, parity exceptions, and user
muscle memory. The project is under the breaking-change policy of
[ADR 0009](0009-one-point-zero-drop-backward-compat.md), so this is the point at
which to choose one vocabulary.

## Decision

Hard-rename the verb to **`improve`** and its MCP tool to **`discern_improve`**.
There is no `audit` alias. The CLI verb registry remains the canonical set; the
existing parity guards force the command registration, recipe-name surface, MCP
table, grouped help, schemas, and tests to move in lockstep.

Position `improve` as a continuous-improvement coach:

- The score is presented as **Baseline health**, followed by separate, non-dim
  lines for the number of objectively weak rules and the number of open
  improvement reviews. `100/100` therefore means only "nothing objectively
  weak."
- Every successful result carries one structured `next_action`, rendered near
  the top in human output and returned unchanged through `--json` and MCP.
- Objective gaps lead, ordered by recoverable weighted score credit. A failed
  weight-three rule outranks a failed weight-one rule; a failure outranks a
  partial at the same weight. Ties retain catalog order.
- When the objective baseline is clear, the first applicable qualitative review
  leads. Catalog order is the deliberate coaching priority.

Keep deterministic rules and qualitative reviews distinct. Broaden the latter to
describe the shape of good practice—behavioural and isolated tests, actionable
failure memory, current and navigable docs, non-inferable guidance,
rate-normalized ratchets, isolated worktree resources, and executable
skills—without moving those judgements into the score.

## Consequences

- A run answers "what should improve next?" before presenting the full report.
  Agents no longer need to invent prioritization from a list of findings.
- A perfect baseline remains useful as an objective signal while visibly
  coexisting with judgement work. The score is less likely to terminate the
  improvement conversation prematurely.
- CLI scripts and MCP clients using `audit` / `discern_audit` break and must
  move to `improve` / `discern_improve`. This is intentional; maintaining two
  names would keep the rejected frame alive and double the surface that parity
  guards must account for.
- The priority algorithm is intentionally simple and explainable. Deterministic
  weight is a proxy for value, and catalog order is editorial judgement for
  qualitative reviews; neither claims to know project-specific effort or
  urgency.
- Subjective reviews remain stateless. The agent lands its judgement as a real
  project change, then reruns `improve`, preserving ADR 0029's model.

## Alternatives considered

- **Keep `audit`, change only the headline.** Rejected: the noun still frames a
  periodic inspection, while the product behaviour is an ongoing coaching loop.
- **Add `improve` as an alias.** Rejected: it avoids a short migration at the
  cost of two permanent public names, stale examples, and ambiguity about which
  tool an agent should prefer.
- **Remove the score.** Rejected: deterministic baseline health is a useful,
  enforceable signal through `--min-score`. The problem was presenting it as
  completeness, not measuring objective wiring.
- **Score qualitative reviews.** Rejected: the binary cannot render those
  verdicts honestly. Assigning points would turn judgement into fabricated
  precision and violate ADR 0029's central split.
