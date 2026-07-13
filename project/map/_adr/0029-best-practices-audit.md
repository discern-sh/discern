# ADR 0029: A best-practices audit that splits deterministic from subjective rules

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`, `docs` → `map` where it names the
> command, config, or tree, the retired product-category wording → `discern`,
> the gate, or the bar; the decision and reasoning are unchanged.

**Status**: accepted; renders off
[ADR 0028](0028-result-envelope-and-diagnostics.md)

## Context

`discern doctor` answers _is this install valid and runnable?_ — a pass/fail
health check (the config parses, the schema is current, the commands resolve).
It deliberately says nothing about whether a project actually **follows** the
discern's best practices: tests wired into the gate, substantive guidance, a
docs tree with ADRs, a quality standard, per-worktree resources for anything
shared. A fresh discern install is a green gate you grow into — but nothing
pointed at _where_ to grow, taught an agent _how_, or let an agent **surface
those improvements on its own**.

The hard part is that "best practice" is only half mechanical. Some of it is
crisply decidable from the config and the tree (_is a test command wired? does
`map/_adr` hold a real ADR?_). The rest needs **judgement**: is the guidance
genuinely project-specific, or generic filler an agent could infer from the
code? Do the docs still match the code? Is there a metric worth holding to a
standard? discern is **one self-contained, deterministic binary** — no model, no
network, runs offline in CI — so it cannot answer those itself. The temptation
is to approximate them with heuristics (word counts, keyword presence), but that
buys false precision: a 400-character `guidance.md` can still be vacuous.

## Decision

Add **`discern audit`** — a core engine verb that scores a project against a
catalog of best-practice **rules** grouped into **categories**, ranked
weakest-first. A rule is one of two kinds, mirroring discern's standing division
of labour (the binary is deterministic; the agent in the loop is the
intelligence):

- a **deterministic** rule discern decides itself from gathered facts → a
  `pass`/`partial`/`fail` status, the finding, the exact `fix`, and a `teach`.
- a **subjective** rule discern _cannot_ mechanically decide. Rather than guess,
  it surfaces the **question** plus the project material to judge it **against**
  (e.g. the guidance text, the `[worktree.resources]` table) as a review item,
  for the agent to evaluate and act on. This is how a deterministic binary
  "analyses subjective rules against guidance": it does the gathering and the
  framing; the agent does the judging.

**The score is computed over the deterministic rules only** — an honest floor
("here is what is mechanically missing"). Subjective rules never inflate or
deflate it; they are open reviews, the ceiling ("here is what still needs
judgement"). The auditor therefore never reports a confident verdict it cannot
stand behind.

The verb is **three renderings of one `DiscernResult`** (ADR 0028): a
weakest-first human report — interactive on a TTY, full static report otherwise
— `--json` for agents and CI, and the `discern_audit` MCP tool so an agent
surfaces improvements natively. It is **advisory by default** (a completed audit
is `ok:true`); `--min-score <n>` flips it into an enforcement gate (`ok:false`,
exit 1 below the floor), and `--category <name>` focuses one area. It is
**feature-aware**: a category gated on a disabled feature is skipped entirely,
the same way a disabled feature's guidance section and verbs vanish.

The catalog (`src/engine/audit/rules.ts`) is **data, not control flow** — a
category list of rules, each a pure function of a once-gathered `AuditContext`.
Adding a best practice is adding a rule; nothing else changes.

## Consequences

- **Agents get a structured, actionable improvement list.** Each finding carries
  the exact fix and why it matters; each review carries the question and the
  material to weigh it against. `--json` / MCP make this a first-class agent
  workflow, not a wall of prose to parse.
- **The auditor is honest about certainty.** A confident pass/fail is only ever
  reported for something mechanically decidable; everything else is explicitly a
  judgement call handed to the agent. No heuristic masquerades as a verdict.
- **`doctor` and `audit` stay distinct and complementary.** doctor: _is the
  install valid?_ (a health check that gates). audit: _is the setup good?_ (a
  best-practice score that teaches). Folding them would conflate two questions
  and force doctor — a binary validity check — to carry soft, weighted opinions.
- **The catalog is cheap to grow.** New rules are pure, declarative entries; a
  catalog-integrity test pins the invariants (unique, category-namespaced ids;
  every rule carries its kind's fields) so an addition can't silently break
  them.
- **Audit holds no state.** It never persists subjective verdicts, so a re-run
  is deterministic and the binary stays stateless — the agent records its
  judgements as actual changes (edits, config), which the next audit then
  re-measures.

## Alternatives considered

- **Fold the checks into `doctor`.** Rejected: doctor is a pass/fail validity
  gate with a clear "healthy" bar; best-practice coverage is a weighted, ranked,
  advisory score. Mixing them muddies both — a thin guidance file isn't an
  _invalid_ install, and a low audit score shouldn't fail `doctor`.
- **Make the subjective rules deterministic heuristics** (guidance char counts,
  keyword presence). Rejected: false precision. The facts that _can_ be decided
  are already deterministic rules; the rest genuinely need a reader, and a
  heuristic that pretends otherwise would mislead.
- **Have discern call a model to judge the subjective rules.** Rejected: it
  would break the self-contained, offline, dependency-free binary and duplicate
  the agent that is already in the loop. The agent _is_ the model; discern's job
  is to gather and frame, not to judge.
- **Persist subjective verdicts** (so a judged review stops re-appearing).
  Rejected: it adds state to a stateless tool and an audit surface to maintain.
  The agent's judgement should land as a real change the next audit re-measures,
  not as a stored opinion that can drift from the tree.
