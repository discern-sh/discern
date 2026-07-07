# Design principles

The handful of rules the discern codebase keeps coming back to. Each one shows
up in dozens of decisions; together they explain why the system is shaped the
way it is.

These are **hard requirements**. They apply to **every** change, in every area
of the codebase — not just the part you happen to be touching. Read them once in
full; the one-line forms exist for quick recall once you have.

If a change you are about to make violates one of these, treat that as a signal
to **question the change, not the principle**. There is one escape hatch, and it
is deliberate: to override a principle on purpose, **write an Architecture
Decision Record** (see [`../_adr/`](../_adr/)) that states what you are
overriding and why. A principle bent silently is a bug; a principle bent on the
record is a decision.

---

## 1. Stay stack-neutral; push every stack fact behind a named capability

The engine never hardcodes a language, test runner, build tool, or framework. It
runs "the test capability," "the fix-stage capabilities," "the `gate` for this
scope" — names it discovers, not commands it knows. Everything specific to a
project's stack lives in `discern.toml` (`[capabilities]`, `[scopes]`,
`[worktree]`), and a fresh install wires no capabilities at all — an omitted
capability is knowably absent, so the gate is green before any of them is filled
([ADR 0017](../_adr/0017-capabilities-model.md)).

**Why it matters.** The moment the engine knows what "a test" _is_, it stops
being portable — it can only serve the stack it learned. Stack-neutrality is the
whole product: one harness that drops into any repository, in any language, for
any agent.

**How it shows up.** `finish` builds its stages by iterating over whatever
`[capabilities]` and `[checks]` declare
([finish.ts](../../src/engine/gate/finish.ts) via
[stages.ts](../../src/engine/gate/stages.ts)), deriving each known capability's
stage from its name; the engine reads commands through the config reader
([config_read.ts](../../src/shared/config_read.ts)), never by name. The
per-worktree resources are empty config until a project declares them. The one
place concrete ecosystems are named on purpose is the stack-detection table in
`discern setup` — whose job is to _propose_ capability fills, never to bake them
into the engine.

---

## 2. One source of truth — author once, generate the rest

Every fact lives in exactly one authoritative place. The engine is one
TypeScript implementation compiled into the binary, not a copy installed per
project; the seed, skill, and built-in-guidance files an install starts from are
authored once under `templates/` and bundled into the binary; agent guidance is
authored once (discern's built-ins plus your `[guidance].sources`) and compiled
to each agent's file; a metric, a version are each declared once and read
everywhere. Where a second copy must exist it is _generated_, marked as
generated, and never hand-edited.

**Why it matters.** Duplicated facts drift, and drift is silent until something
breaks — a reader follows a stale doc, two copies of one behaviour diverge with
every fix that lands in only one of them. With one source per fact, consistency
is a property of the system, not of human vigilance.

**How it shows up.** The engine has one home in
[`src/engine/`](../../src/engine/) — there is no second committed copy to drift
from ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)); `discern refresh`
compiles the agent files (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`) from one guidance
source set; [`version.ts`](../../src/lib/version.ts) is the only home for the
binary and schema versions; the [Generated file](glossary.md#generated-file) and
[The binary's files](glossary.md#the-binarys-files) dispositions in the
[glossary](glossary.md) carry the rule that a re-published copy is reproduced,
never edited. And where a closed vocabulary must be re-used (the CLI verbs, the
capabilities, the source paths, the result kinds, the agent providers, …), every
satellite is **mechanically tied** to its one source — a compile-time total or a
forcing-function test, so a new member auto-enrolls or fails the gate rather
than drifting silently ([ADR 0051](../_adr/0051-canonical-set-parity.md),
generalizing the agent-registry parity of
[ADR 0043](../_adr/0043-registry-derived-agent-parity.md)). The configurable
source paths are one such vocabulary: the
[paths registry](../../src/shared/paths_registry.ts) is the single home of every
default, and a path literal anywhere else in `src/**` fails the gate
([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)).

---

## 3. Re-running is always safe — your files written once, the binary's always re-publishable

`discern` scaffolds into a repository you care about, so every command must be
safe to run again. The ownership split makes this structural: _your_ files (the
committed `discern.toml`, the merged `settings.json`/`.gitignore`, and the
`discern/` namespace content — the guidance source, authored skills, recipes,
the map, the ledger, the brief, each config-pointable elsewhere) are written
once by `setup` (or by you) and never touched again, so `upgrade` cannot clobber
an edit. _The binary's_ files (the gitignored, re-published artifacts — the
materialized skills, the compiled agent files
`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`) are always safe to overwrite precisely
because they are not yours to edit; they are rewritten on every recompile
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)). Migrations are
idempotent and the tree must be clean (or `--allow-dirty`) so an upgrade stays
revertible with `git checkout`.

**Why it matters.** A tool that can lose your work on a re-run is a tool you
stop running — and an un-runnable `upgrade` means installs rot. Safety is what
makes the harness _upgradable_ rather than a one-shot scaffold.

**How it shows up.** [upgrade.ts](../../src/commands/upgrade.ts) never rewrites
a committed seed: it runs pending config-schema migrations, re-materializes the
bundled skills, recompiles guidance, and re-stamps `[meta].schema_version` only
after the migrated config validates
([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)) —
nothing else. There are no content hashes, no `.new` files, and no orphan
reconciliation, because nothing the binary publishes is committed
([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The clean-tree guard
refuses a dirty tree without `--allow-dirty`
([ADR 0014](../_adr/0014-versioned-migration-system.md)); every
[migration](../../src/lib/migrations.ts) step is written to no-op on a second
run.

---

## 4. An installed project carries no runtime dependency

The `discern` binary is self-contained — V8 is baked in — so a target project
needs no Deno, no Node, nothing but the one binary on `PATH` plus `git`. The
engine ships _inside_ the binary as compiled TypeScript; it is never installed
into the project as files that would drag a runtime along. What lands in a
project is config, gitignored artifacts, and generated guidance — data, not a
second program.

**Why it matters.** A harness that imposes a runtime cannot honestly claim to
drop into "any project." Portability dies the moment running the gate needs
something the host doesn't already have. A single self-contained binary is the
one thing a target can always run.

**How it shows up.** The engine lives in [`src/engine/`](../../src/engine/) and
compiles into the binary; project [recipes](glossary.md#recipe) stay
language-agnostic executables that read config through
`discern config get|array|has|subsections|keys` rather than sourcing any
library. Config is parsed with strict `@std/toml` inside the binary
([config_read.ts](../../src/shared/config_read.ts)). Deno appears only in
`deno task` build/test tooling, never as a dependency of an install
([ADR 0019](../_adr/0019-single-binary-ts-engine.md)).

---

## 5. Fail open when classifying, fail fast when executing

The two halves of "what should run" lean opposite ways on purpose. _Classifying_
a change errs toward doing more: a path that matches no scope counts as a real
code change, so an unknown path runs **more** gates, never fewer. _Executing_
the gate errs toward stopping early: by default the first failing job cancels
its siblings, and the `--json` report names the exact capability or check that
failed.

**Why it matters.** A misclassified path that silently _skipped_ a gate would
let broken work through — the expensive failure. But once something has already
failed, burning wall-clock on doomed siblings just slows the agent's loop. Safe
when unsure, fast when certain.

**How it shows up.** [`scopes.ts`](../../src/engine/scopes/scopes.ts) classifies
unknown paths as gated code; a scope's `gate` fires only when that scope
actually changed ([ADR 0018](../_adr/0018-vocabulary-consolidation.md));
`[gate].fail_fast` defaults on — the first failing job tree-kills its running
siblings via Deno's process-group kill
([command.ts](../../src/engine/jobs/command.ts)) — and the structured report
attributes failure to a single capability or check
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

---

## 6. Self-host the harness — the repo runs on the engine it ships

discern runs on itself. This repo's gate _is_ the binary's own engine, invoked
straight from source via `discern finish` (where `discern` runs the engine of
the checkout you are in). Because the engine lives in one place — compiled into
the binary, never copied into a project — there is no second committed copy that
could drift, and so nothing to keep in sync. The gate that ships is the gate the
maintainer runs; there is no separate "dev" path that could diverge from what
users get.

**Why it matters.** The strongest test of a portable harness is that it holds
its own author to the same discipline. Self-hosting collapses the gap between
"what we ship" and "what we use" to zero — a regression in the shipped engine
breaks our own build the same day, not a user's repo months later. Collapsing
the engine to a single home goes one better: a whole class of drift becomes
impossible by construction, rather than something a gate must _detect_.

**How it shows up.** The `deno.json` `gate` task runs `discern finish`, so the
repo gates itself with the same engine it ships; there is no `selfcheck` or
`shellcheck` Check, because there is no installed copy to compare against
([ADR 0019](../_adr/0019-single-binary-ts-engine.md), superseding
[ADR 0010](../_adr/_superseded/0010-self-host-the-harness.md)). The
`tests/engine_*` suites scaffold a project into temp dirs and run the engine
against them; CI runs the same gate. The repo also self-hosts on a
**non-default** layout — its map at root `docs/`, its ledger at root `TODO.md` —
so a hard-coded path default diverges from the tree agents can see and leaks
become loud ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)).

---

## 7. Sovereign inside, deferential outside

discern is maximally prescriptive within the surface it owns and writes nothing
beyond it. Inside its namespace it dictates structure, format, and upkeep;
outside, it writes only the enumerated integration surface — the root
`discern.toml`, the delimited `.gitignore` block, the provider files at
vendor-fixed paths, a worktree's `.env`.

**Why it matters.** Containment is what licenses the prescription: a strong
opinion about your own house is a design; a strong opinion about someone else's
is an intrusion. A tool that writes anywhere it likes cannot be trusted in a
brownfield repository.

**How it shows up.** The write-surface contract
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md))
is an architectural test
([`paths_write_surface_test.ts`](../../tests/paths_write_surface_test.ts)):
every project-tree write in `src/**` targets a registry or provider-registry
path or an enumerated shim, and a write anywhere else fails the gate. The
namespace stays 100% the user's — no generated artifact is ever written inside
`discern/`.

---

## 8. Placement is consent

A file at its namespace default carries an implicit write-license: agents
maintain it freely, and staleness is a defect. A config key pointed at a path
outside the namespace is an explicit write-license: the user typed the path, and
that typing is the consent. A path that is neither is untouchable.

**Why it matters.** The failure mode this kills is an agent "helpfully"
restructuring a team's published documentation. Untouchable-by-construction is a
property; a warning is a hope.

**How it shows up.** Every source path has a prescriptive default in the
[paths registry](../../src/shared/paths_registry.ts) and a config key that
points it anywhere; setup asks the docs question as consent
([ADR 0100](../_adr/0100-doctree-is-the-agents-map.md)) instead of silently
adopting an existing `docs/`; the write-surface test holds the boundary.

---

## 9. A subsystem that costs nothing when unused needs no switch

Worktrees you never start, ratchets you never define, an advisory you never
invoke — the escape is behavioral, not configurational. A configuration toggle
exists only where an unused feature still imposes a real cost.

**Why it matters.** Every toggle is a promise to test both states forever,
multiplied together — and the off-states of a self-hosting repo are the
permanently untested half of the matrix. Removing a toggle later is a breaking
change while adding one later is not, so the burden of proof sits on the toggle.

**How it shows up.** The `[features]` table is gone and every subsystem is core
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). The one knob that
survived is `[skills].exclude`, because materialized skills occupy agent context
even when unused — the single subsystem that passes the test.

---

## 10. Structure over advice

Everything structurally enforced happens reliably; everything merely advised
degrades ([ADR 0077](../_adr/0077-setup-agent-is-the-configuration-engine.md)
proved this across vendors). When a behaviour matters, encode it as a gate
stage, a check, a ratchet, a parity test, or a refusal with a teaching payload —
never as a sentence hoping to be obeyed.

**Why it matters.** discern's users are agents. An agent under context pressure
drops advice first; it cannot drop a red gate.

**How it shows up.** Setup's mutating step refuses without a `--confirmed`
consent attestation and re-serves the script
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md));
path discipline is a sentinel-render test and a literal ban, not a style note
([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)); a doc's
claim is only as good as the check that fails when it stops being true.

---

## 11. The map, not the manual

The documentation tree discern maintains is the agent's map of the codebase:
inferred by agents, written by agents, read by agents first and by humans as an
audit of what their agents actually understand. It is deliberately not the
project's human-authored documentation, which discern never touches (see
principle 8).

**Why it matters.** A current map is a working instrument; a stale map is a
defect the gate catches; a wrong map is a finding about the agent's
understanding — which is exactly what makes it worth a human's read.

**How it shows up.** The map defaults to its own `discern/docs/` and is
scaffolded eagerly at `setup begin`
([ADR 0100](../_adr/0100-doctree-is-the-agents-map.md)); pointing `[docs].dir`
at real documentation is the user's explicit act (this repo does exactly that);
the docs scope's prose check and currency discipline treat drift as a failure.

---

## 12. Exit honesty

Uninstalling discern leaves a healthy repository: the user's assets are plain
markdown at paths they chose or accepted, readable and valuable without the tool
that helped grow them.

**Why it matters.** A tool confident it will be kept has no need to make leaving
expensive — and nothing discern removes on the way out was ever the user's.

**How it shows up.** The namespace holds only plain-markdown content the user
owns; the generated artifacts are gitignored, so deleting them leaves no tracked
litter; assets a user wants unbranded are one `git mv` plus one config key away,
before or after uninstall
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

---

## 13. A provable footprint

The footprint claim is a checkable predicate, not a slogan: one committed root
file, one visible namespace, the vendor-required agent files, and the enumerated
shims — held by a test that fails the moment any verb writes anywhere else.

**Why it matters.** A claim with an enforcing check stays true; a claim without
one decays into marketing. Public copy quotes the sentence only while the test
exists to keep it honest.

**How it shows up.**
[`paths_write_surface_test.ts`](../../tests/paths_write_surface_test.ts)
enforces the contract from the registries; the
[install surface](../80-development/install-surface.md) states the sentence in
its provable form.

---

## What these add up to

The first two principles set the contract: a generic engine that knows nothing
stack-specific (1), fed from single authoritative sources (2). The next two make
that contract _livable_ — the install must be safe to re-run (3) and must not
drag a runtime along (4) — which together are what let the harness be
**installable and upgradable** rather than copied-and-forked per project. The
next two are how the engine behaves under uncertainty (5) and how we keep
ourselves honest that it works (6): self-hosting (6) is only credible _because_
the engine is stack-neutral (1) and sourced from one truth (2), so the engine
that gates this repo is the same one users receive.

The remaining principles govern discern's conduct inside someone else's
repository. Containment (7) is what licenses the prescription, and consent (8)
is how the boundary is drawn; the toggle test (9) keeps the config surface
honest about cost; structure over advice (10) is the enforcement doctrine that
turns 7–9 (and everything else here) into tests rather than requests; the map
(11) and exit honesty (12) define what discern maintains for a project and what
it leaves behind; and the provable footprint (13) is the whole conduct story
compressed into one checkable sentence.

When you propose a change that violates one of these principles, that is a
signal to question the change — not the principle. If you have a genuinely good
reason to override one, write an ADR (see [`../_adr/`](../_adr/)).
