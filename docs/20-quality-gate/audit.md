# The best-practices audit

_`discern audit` — score the project's setup against a best-practices checklist,
rank the weakest areas, and teach how to improve them._

Where [`finish`](../../src/engine/gate/finish.ts) asks _did this change pass?_
and [`doctor`](../10-installer/README.md) asks _is this install valid?_,
**`audit`** asks _is this setup any good?_ It scores the project against a
catalog of best-practice **rules** grouped into **categories**
([`src/engine/audit/`](../../src/engine/audit/rules.ts)) and ranks them
weakest-first, so a human sees where to invest and an agent gets a structured,
actionable list of what to improve. It is **advisory by default** — a completed
audit always succeeds; the score lives in the result.

## Two kinds of rule

The catalog mirrors discern's division of labour — the binary is deterministic,
the agent in the loop is the intelligence — so a rule is one of two kinds:

- a **deterministic** rule discern decides itself from the gathered facts. It
  yields a `pass` / `partial` / `fail` status, the finding, the exact **fix** (a
  command or an edit), and a **teach** (why it matters and what "good" looks
  like). Example: _is a test-stage command wired into the gate?_
- a **subjective** rule discern _cannot_ mechanically decide, so instead of
  guessing it surfaces the **question** plus the project material to judge it
  **against** — the guidance text, the `[worktree.resources]` table — as a
  **review** item. The agent reads the cited material, renders the verdict, and
  acts. Example: _does the guidance teach what an agent couldn't infer from the
  code, or is it generic filler?_

**The score is computed over the deterministic rules only** (weighted; `partial`
earns half credit). It is an honest floor — _here is what is mechanically
missing_. Subjective rules never move the number; they are open reviews, the
ceiling — _here is what still needs judgement_. The auditor never reports a
confident verdict it cannot stand behind
([ADR 0029](../_adr/0029-best-practices-audit.md)).

## The categories

A category may be gated on a feature; when that feature is off the whole
category is skipped (the same way a disabled feature's verbs and guidance
vanish). The core categories (`gate`, `setup`) always apply.

| Category    | Feature     | Checks (deterministic) and reviews (subjective)                                              |
| ----------- | ----------- | -------------------------------------------------------------------------------------------- |
| `gate`      | _core_      | tests wired · static analysis wired · formatter wired                                        |
| `setup`     | _core_      | bootstrapped · gotchas doc set & present                                                     |
| `guidance`  | `guidance`  | substantive source · agent files compiled · _review:_ is the guidance project-specific?      |
| `docs`      | `docs`      | docs tree present · ADRs recorded · _review:_ do the docs still match the code?              |
| `worktrees` | `worktrees` | session-start setup enabled · _review:_ are shared external resources declared per-worktree? |
| `ratchets`  | `ratchets`  | at least one ratchet · _review:_ any un-ratcheted metric worth holding?                      |
| `skills`    | `skills`    | _review:_ are recurring tasks captured as skills?                                            |

## Running it

```
discern audit                     # weakest-first human report; drills down interactively on a TTY
discern audit --no-interactive    # the full static report (also implied off a TTY / when piped)
discern audit --category gate     # focus one area
discern audit --json              # the DiscernResult envelope (for agents and CI)
discern audit --min-score 70      # exit non-zero when the overall score is below the floor
```

On a TTY the human report prints the ranked summary, then offers an interactive
drill-down into each area; piped or with `--no-interactive` it prints every
category's detail so nothing hides behind a prompt. A failing deterministic rule
shows its fix and teach; a review shows the question, the material to look at,
and the teach.

## The result envelope

Like every verb, `audit` computes one `DiscernResult`
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)); the human report,
`--json`, and the MCP tool are three renderings of it. The audit-specific
payload rides in `data`:

```jsonc
{
  "ok": true,
  "verb": "audit",
  "data": {
    "score": 72, // 0–100, weighted over every deterministic rule
    "weak": 3, // deterministic rules not fully passing
    "open_reviews": 5, // subjective items awaiting judgement
    "categories": [ // weakest-first
      {
        "name": "gate",
        "title": "Quality gate",
        "score": 40,
        "weight": 6,
        "weak": 2,
        "rules": [
          {
            "id": "gate.test",
            "status": "fail",
            "detail": "…",
            "fix": "…",
            "teach": "…"
          }
        ],
        "reviews": [
          {
            "id": "…",
            "ask": "…",
            "teach": "…",
            "against": { "source": "…", "excerpt": "…" }
          }
        ]
      }
    ]
  }
}
```

`--min-score` is the enforcement signal: below the floor, `ok` flips to `false`
with `error: "below_min_score"` and the process exits 1. An unknown `--category`
is a clean `error: "unknown_category"`; a disabled-feature one,
`category_disabled`.

## Surfacing improvements automatically

`audit` is exposed as the **`discern_audit`** MCP tool by
[`discern mcp`](../../src/engine/mcp/server.ts), so an agent can pull the scored
result natively, evaluate each review item against the cited material, and apply
the fixes — turning the audit into an autonomous improvement loop rather than a
report a human has to relay. Pass `category` to focus, `min_score` to mark the
result failed below a floor.

## See also

- [ADR 0029](../_adr/0029-best-practices-audit.md) — why deterministic and
  subjective rules are split, and why subjective rules are surfaced rather than
  guessed.
- [40-agent-guidance/](../40-agent-guidance/) — the guidance the `guidance`
  category audits.
