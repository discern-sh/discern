# Design principles

The handful of rules the icculus codebase keeps coming back to. Each one shows
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

## 1. Stay stack-neutral; push every stack fact behind a named slot

The engine never hardcodes a language, test runner, build tool, or framework. It
runs "the test slot," "the fix slots," "the side gate for this scope" — names it
discovers, not commands it knows. Everything specific to a project's stack lives
in `.icculus/config.toml` (`[slots]`, `[scopes]`, `[worktree]`), and a fresh
install's slots default to the `:` no-op so the gate is green before any of them
is filled.

**Why it matters.** The moment the engine knows what "a test" _is_, it stops
being portable — it can only serve the stack it learned. Stack-neutrality is the
whole product: one harness that drops into any repository, in any language, for
any agent.

**How it shows up.** `finish` builds its phases by iterating `slots_in_phase`
over whatever `[slots]` declares
([finish](../../templates/.icculus/engine/finish)); the engine reads commands
through `config_get`, never by name. The worktree database and dev-server seams
are empty config until a project wires them. The one place concrete ecosystems
are named on purpose is the stack-detection table in the
[`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md) skill — whose
job is to _propose_ slot fills, never to bake them into the engine.

---

## 2. One source of truth — author once, generate the rest

Every fact lives in exactly one authoritative place. `templates/` is the source
of truth for everything an install receives; agent guidance is authored once in
`.icculus/guidelines/` and compiled to each agent's file; a metric, a
managed-file list, a version are each declared once and read everywhere. Where a
second copy must exist it is _generated_, marked as generated, and never
hand-edited.

**Why it matters.** Duplicated facts drift, and drift is silent until something
breaks — a reader follows a stale doc, two copies of one behaviour diverge with
every fix that lands in only one of them. With one source per fact, consistency
is a property of the system, not of human vigilance.

**How it shows up.** [`managed.json`](../../templates/managed.json) declares the
managed set once ([ADR 0008](../_adr/0008-declarative-managed-set.md));
`agent guidelines` compiles `CLAUDE.md`/`AGENTS.md` from a single guidance
source; [`version.ts`](../../src/lib/version.ts) is the only home for the kit
and schema versions; the `Generated file` and `Managed file` dispositions in the
[glossary](glossary.md) carry the rule that a generated copy is reproduced,
never edited.

---

## 3. Re-running is always safe — refresh managed, preserve edits, never clobber

`icculus` scaffolds into a repository you care about, so every command must be
safe to run again. `upgrade` overwrites a managed file only when it is pristine;
a local edit is preserved untouched and the new version written alongside as
`<file>.new`. Seed files are never refreshed. A managed file the kit no longer
ships is _reported_, not deleted, when your copy differs. Migrations are
idempotent and the tree must be clean (or `--allow-dirty`) so an upgrade stays
revertible with `git checkout`.

**Why it matters.** A tool that can lose your work on a re-run is a tool you
stop running — and an un-runnable `upgrade` means installs rot. Safety is what
makes the harness _upgradable_ rather than a one-shot scaffold.

**How it shows up.** The hash-aware plan in
[upgrade.ts](../../src/commands/upgrade.ts) maps each managed file to overwrite
/ `.new` / skip against the manifest hash; `planOrphanRemovals` keeps edited
orphans; the clean-tree guard refuses a dirty tree without `--allow-dirty`
([ADR 0014](../_adr/0014-versioned-migration-system.md)); every
[migration](../../src/lib/migrations.ts) step is written to no-op on a second
run.

---

## 4. The installed harness is dependency-free POSIX shell

What lands in a target project is pure `sh` plus a TOML config — no Deno, no
Node, no runtime to install. The Deno/TypeScript half is the _installer_; it
builds and ships the harness but never becomes a runtime dependency of the
projects that use it.

**Why it matters.** A harness that imposes a runtime cannot honestly claim to
drop into "any project." Portability dies the moment the engine needs something
the host doesn't already have. POSIX `sh` is the one interpreter every target
already runs.

**How it shows up.** Every recipe under
[`.icculus/engine/`](../../templates/.icculus/engine/) is `#!/usr/bin/env sh`
sourcing the dependency-free library in `lib/`; config is read by an awk TOML
parser, not a language runtime; the gate runs `shellcheck` and a dash/bash CI
matrix to keep the shell portable
([ADR 0012](../_adr/0012-engine-noglob-default.md)). Deno appears only in
`deno task` build/test tooling, never in an install.

---

## 5. Fail open when classifying, fail fast when executing

The two halves of "what should run" lean opposite ways on purpose. _Classifying_
a change errs toward doing more: a path that matches no scope counts as a real
code change, so an unknown path runs **more** gates, never fewer. _Executing_
the gate errs toward stopping early: by default the first failing job cancels
its siblings, and the `--json` report names the exact slot that failed.

**Why it matters.** A misclassified path that silently _skipped_ a gate would
let broken work through — the expensive failure. But once something has already
failed, burning wall-clock on doomed siblings just slows the agent's loop. Safe
when unsure, fast when certain.

**How it shows up.**
[`changed-scopes`](../../templates/.icculus/engine/changed-scopes) classifies
unknown paths as gated code; side gates fire only for a scope that actually
changed ([ADR 0002](../_adr/0002-first-class-side-gates.md)); `[gate].fail_fast`
defaults on and the structured report attributes failure to a single slot
([ADR 0004](../_adr/0004-structured-finish-json.md)).

---

## 6. Self-host the harness — the repo runs on the gate it ships

icculus installs into itself. The `agent` dispatcher, engine, and skills at the
repo root are a real install of `templates/`, and `selfcheck` proves they stay
byte-identical to it. The gate that ships is the gate the maintainer runs; there
is no separate "dev" path that could diverge from what users get.

**Why it matters.** The strongest test of a portable harness is that it holds
its own author to the same discipline. Self-hosting collapses the gap between
"what we ship" and "what we use" to zero — a regression in the shipped harness
breaks our own build the same day, not a user's repo months later.

**How it shows up.** `deno task selfcheck` (≡ `upgrade --check`) is a `check`
slot, so drift between the root install and `templates/` fails `agent finish`
([ADR 0010](../_adr/0010-self-host-the-harness.md)); the `tests/engine_*` suites
scaffold the real `templates/` into temp dirs and run `agent` against them; CI
runs `agent finish`.

---

## What these add up to

The first two principles set the contract: a generic engine that knows nothing
stack-specific (1), fed from single authoritative sources (2). The next two make
that contract _livable_ — the install must be safe to re-run (3) and must not
drag a runtime along (4) — which together are what let the harness be
**installable and upgradable** rather than copied-and-forked per project. The
last two are how the engine behaves under uncertainty (5) and how we keep
ourselves honest that it works (6): self-hosting (6) is only credible _because_
the engine is stack-neutral (1) and sourced from one truth (2), so the install
that gates this very repo is the same one users receive.

When you propose a change that violates one of these principles, that is a
signal to question the change — not the principle. If you have a genuinely good
reason to override one, write an ADR (see [`../_adr/`](../_adr/)).
