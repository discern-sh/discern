# ADR 0107: `upgrade` reconciles the record-table doc banners

> **Superseded by [ADR 0138](../0138-all-ruled-config-banners-are-managed.md).**
> Record-family banners remain managed; the successor makes every ruled fixed-
> section banner part of the same ownership model.

> **Vocabulary amendment ([ADR 0120](../0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`; the decision and reasoning are
> unchanged.

**Status**: accepted

## Context

ADR 0092 gave `discern upgrade` a config-scaffold reconciliation pass: it
inserts a missing fixed section or fixed key from the current template, with its
documentation, so a current-schema config stops drifting from what a fresh setup
would show. That pass deliberately stops short of the record tables —
`[checks.<name>]`, `[scopes.<name>]`, `[standards.<name>]`,
`[worktree.resources.<name>]` — because their named entries are project-owned
population, not scaffold. It also is "not a full formatter": stale comments
beside an already-present key are left as the project wrote them.

Those two exclusions leave a gap. A record table's knobs — the fields a
`[standards.<name>]` accepts, say — are documented once, in the `# ───`-ruled
**banner** that introduces the family, not on any single key the reconciler
could backfill. When a new knob is added (a standard's `margin`), the shipped
template's banner gains a line for it and the schema-generated config reference
gains an entry, but an existing install's banner never changes: it is neither a
missing section nor a missing fixed key, and its family is a skipped record
table. So `upgrade --check` reports the install current while its own
`discern.toml` silently documents fewer options than the binary now offers. The
banner is the only channel by which that knob's documentation could reach the
install, and nothing kept it current.

The constraints are the same two-sided pressure ADR 0092 named. The banner is
not decoration — it is the visible contract of what the current schema accepts,
and a banner missing a current knob is stale documentation in the user's own
repository. But `discern.toml` is hand-editable, and a refresh must not
overwrite the project's own values or the comments it wrote on its own tables.

## Decision

The record-table shape banners are **discern-owned managed regions**, in the
same sense as the delimited `.gitignore` block (ADR 0093). `discern upgrade`
reconciles each one against the current template, alongside the section/key pass
and before the schema stamp.

A managed banner is identified structurally, not by a hand-kept list:
`scanManagedBanners` treats a `# ───` rule whose immediately following line is a
`# [<record>…]` identity — naming one of the record families — as a banner that
opens there and closes at the next `# ───` rule, with only comment lines
between. That family's banner is refreshed to the current template's version
wholesale when it differs. Everything a project owns — the `[standards.<name>]`
tables themselves, their values, and the comments a user wrote above them —
lives _outside_ the rule pair, so it is never touched. A banner that does not
close cleanly (a blank or live line intervenes, or the rule never recurs) is
left exactly as found rather than half-matched, so the pass can never reach past
a banner into a project's tables.

The pass is idempotent — a second `upgrade` is byte-stable — and reports each
refresh as a `banner` reconcile operation in `--check`, `--dry-run`, and the
apply summary, so an install now converges on current _documentation_, not only
current structure. A forcing-function guard (`config_banner_parity_test`) closes
the loop from the other side: driven off `RECORD_ENTRY_SCHEMAS` and the
record-path registry, it fails the gate if a record entry's Zod schema carries a
knob the family's banner does not document — so the next `margin` cannot ship
where no upgrade would surface it.

## Consequences

`discern upgrade` now carries a record table's newly-documented knobs to every
existing install, not just to fresh setups and the config reference. discern's
own root config and downstream pre-launch test projects get the same repair path
users receive; the repo's own `[standards]` banner, which had lagged behind
`per`, `scale`, and `margin`, is brought current by the same code.

The ownership model narrows once more, and the narrowing is explicit: the prose
_inside_ a record-table banner's `# ───` rules is co-managed by the binary and
is refreshed on upgrade. To change what a banner says, edit the template (and
the schema it documents), not the generated line in a project — a hand-edit
there is overwritten on the next upgrade, exactly as inside the `.gitignore`
block. A project's tables, values, and its own comments outside the rules remain
the project's bytes.

This is still not a full formatter. Only the record-table banners are managed —
the families whose knobs the key pass cannot reach. A fixed section's banner is
left to ride along with its keys (a new fixed key is inserted with its comment,
so its documentation already travels), and behaviour-changing default shifts
still belong in versioned migrations, where an old value can be recognized and
preserved.

## Alternatives considered

- **A schema bump and migration for each new knob's prose.** ADR 0092 already
  rejected this for template prose: a migration cannot repair a current-schema
  file whose migration ran before the prose improved. Reconciliation repairs the
  file every upgrade, whatever schema it is at, which is the property the banner
  gap needs.
- **Manage every section banner, not only the record tables.** That would
  refresh cosmetic prose on fixed sections too, but those sections' keys are
  already reconciled with their comments, so the added blast radius —
  overwriting prose a user may have edited beside their own values — buys
  nothing the key pass does not already deliver. The managed set is exactly the
  families whose banner is load-bearing because their keys are unreachable.
- **Point agents at the schema-generated config reference and stop there.** The
  reference (served by `discern help`) is the machine-readable source of truth
  and is already current, and agents should use it. But it does not keep the
  user's own `discern.toml` — which humans and agents both read — from
  documenting fewer options than they have. Convergence of the actual file is
  the bar ADR 0092 set.
- **Leave it to `doctor` as an advisory.** Same answer as ADR 0092: the bar for
  `upgrade` is convergence, not a nudge that leaves the user to hand-copy a
  banner.
