# The continuous-improvement coach

_`discern improvement` — show the project's objective baseline, keep qualitative
reviews visible, and point at the highest-value improvement to make now._

Where [`done`](../../src/engine/gate/finish.ts) asks _did this change pass?_ and
[`doctor`](../10-installer/README.md) asks _is this install valid?_,
**`improvement`** asks _what should get better next?_ It evaluates a catalog of
best-practice rules grouped into categories
([`src/engine/improve/`](../../src/engine/improve/rules.ts)), ranks the weakest
areas, and selects one prioritized next action. It is advisory by default: a
completed review succeeds, while its baseline and open work live in the result.

## Baseline rules and qualitative reviews

The catalog mirrors discern's division of labour: the binary is deterministic;
the agent in the loop supplies judgement.

- A **deterministic rule** yields `pass`, `partial`, or `fail`, the finding, the
  exact **fix**, and a **teach** explaining why the practice matters.
- A **subjective rule** cannot be decided safely from config or file existence.
  It becomes an open **review** with a question, the material to judge it
  against, and a teach describing what good looks like.

**Automated practice health is computed from deterministic rules only**
(weighted; `partial` earns half credit). It says how much is objectively weak,
not how complete or mature the project is. A `100/100` baseline can—and normally
does—sit beside open improvement reviews. Those reviews cover questions such as:

- are tests isolated enough for parallel execution, and do they protect
  behaviour, boundaries, and failure paths?
- does the failure-memory document capture symptoms, causes, and proven recovery
  rather than generic advice?
- does guidance contain load-bearing knowledge that code cannot reveal?
- do docs match the code, and can a new reader navigate from overview to detail?
- are shared external resources isolated per worktree?
- are growing-tree ceiling counts normalized to rates rather than loosened as
  the project grows?
- are recurring workflows captured as executable, verifiable skills?

This split preserves the decision in
[ADR 0029](../_adr/0029-best-practices-audit.md): discern never claims a
confident verdict it cannot prove.

## The next action

Every successful result carries one `next_action`.

1. Objective gaps lead. The coach selects the fix that recovers the most
   weighted baseline credit; ties keep the catalog's deliberate coaching order.
2. Once no objective gap remains, the first applicable qualitative review leads.
   Catalog order is therefore priority order for judgement work.

A qualitative review travels as one unit: its question, the `against` material
to inspect, and its teaching. JSON carries the citation on
`next_action.against`; the piped and terminal next-action blocks print the same
material on a `look:` line. The expanded category view uses the same review-unit
renderer, so no surface can leave “below” or “the cited material” pointing at
evidence it lost.

The human report places that action directly below **Automated practice health**
and the explicit **N improvement reviews open** line. The full weakest-first
detail remains available for context, but the user does not have to turn a
checklist into a priority queue themselves.

## Categories

Every category applies to every install — every subsystem is core
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

| Category    | Objective baseline and qualitative coaching                                          |
| ----------- | ------------------------------------------------------------------------------------ |
| `gate`      | tests, static analysis, formatter · test depth, isolation, parallelism               |
| `setup`     | setup complete, gotchas doc present · failure memory is actionable                   |
| `guidance`  | substantive source, compiled files · knowledge is project-specific and non-inferable |
| `docs`      | docs tree, ADRs · pages match code and form a navigable tree                         |
| `worktrees` | (no objective rule) · shared external resources are declared per worktree            |
| `standards` | at least one standard · missing signals and raw growing-tree counts are reviewed     |
| `skills`    | recurring-task opportunities · authored skills are executable, verifiable playbooks  |

## Running it

```sh
discern improvement                     # summary + interactive detail on a TTY
discern improvement --plain             # full static report, never prompts
discern improvement --category gate     # focus one area
discern improvement --json              # the DiscernResult envelope
discern improvement --min-score 70      # fail below a baseline-health floor
```

The command was a hard rename from `audit`; there is no `audit` alias. `improve`
is accepted only as a grammatical variant and normalizes silently to
`improvement`. See
[ADR 0079](../_adr/0079-improvement-is-a-coach-not-an-audit.md) for the
trade-off.

## Result envelope

The human report, `--json`, and MCP tool render one `DiscernResult`
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)):

```jsonc
{
  "ok": true,
  "verb": "improvement",
  "data": {
    "score": 100, // baseline health over deterministic rules only
    "weak": 0,
    "open_reviews": 11,
    "next_action": {
      "kind": "review",
      "category": "gate",
      "id": "gate.fast-feedback",
      "title": "The gate stays fast enough to run every time",
      "action": "Given the test command below, ...",
      "why": "Isolated, order-independent tests are ...",
      "against": {
        "source": "the configured test command",
        "excerpt": "deno task test"
      }
    },
    "categories": [
      {
        "name": "gate",
        "score": 100,
        "rules": [],
        "reviews": []
      }
    ]
  }
}
```

`--min-score` remains the optional enforcement signal. Below the floor, `ok`
becomes `false` with `error: "below_min_score"`. An unknown `--category` is
`unknown_category`.

## MCP

`improvement` is exposed as **`discern_improvement`** by
[`discern mcp`](../../src/engine/mcp/server.ts). The tool is read-only and
returns the same baseline, reviews, and next action as the CLI, so an agent can
apply the action, rerun the coach, and continue the improvement loop.

## See also

- [ADR 0079](../_adr/0079-improvement-is-a-coach-not-an-audit.md) — why the verb
  is a hard rename and how next-action priority works.
- [ADR 0029](../_adr/0029-best-practices-audit.md) — why deterministic and
  subjective rules remain distinct.
- [ADR 0057](../_adr/0057-rate-standards.md) — why growing-tree counts should be
  normalized into rates.
