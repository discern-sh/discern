# ADR 0009: 1.0 — drop backward compatibility, with a one-shot `upgrade`

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

discern 0.x grew several capabilities (ADRs 0001–0008) under a standing constraint: **existing `discern.toml` files keep working untouched**. That constraint earned its keep early, but it also forced compromises that ossified into the design:

- Coverage was a privileged _built-in_ standard — a bespoke `coverage_min` scalar, a reserved name, a `0`-disables rule, and a fragile last-`NN%` output-scraping fallback — sitting beside the general `[standards.<name>]` model it should have just been an instance of.
- `coverage` was overloaded as a slot _phase_, conflating "what gate stage runs it" with "run it on demand, not in the gate".
- The gate ran a whole _phase_ as one joined `&&` command, so `done --json` could only report per-phase, never per-slot.
- `fail_fast` defaulted off to preserve the old run-everything behaviour, even though an agent-driven gate almost always wants a fast abort.
- The `setup --config` shape leaked out as an internal `InitAnswersFile` struct with no version and no schema, reused by adapters as a de-facto public API.
- The worktree engine's runtime tokens shared the `{{…}}` delimiter with the installer's content tokens, forcing a `db` pass-through special-case.
- The managed-set was hardcoded in installer constants, invisible from the template tree and unextendable by adapters.

The project is **pre-1.0 and pre-adoption**. This is the cheapest the backward-compatibility tax will ever be: paying down all of it now, in one breaking release, is far better than carrying it once the config shape is in real use.

## Decision

Cut **1.0**, lift the backward-compatibility constraint, and make the clean changes the constraint had blocked. Each lands in its own commit and amends the ADR it touches (see the _Update (1.0)_ sections):

- **Unify standards** — coverage becomes `[standards.coverage]` like any other; the scalar, reserved name, `0`-disables rule, `%` fallback, the `coverage` phase, and the historical `finish:coverage`/`finish:ratchets` split are all removed. One current command, `discern standards`. (ADR 0003)
- **Per-slot execution** — each `[slots.<name>]` runs as its own tracked job (`fix` serial, the rest concurrent within their stage); `done --json` reports per-slot. (ADRs 0002, 0004)
- **`fail_fast` defaults on** — opt out, not in; it applies to side gates too. (ADR 0006)
- **A first-class config document** — the `setup --config` / `adapter.json` shape is named (`DiscernConfigDoc`), versioned, and backed by a published JSON Schema. (ADRs 0005, 0007)
- **Distinct runtime-token delimiter** — worktree tokens move to `@db@` …, so the installer's `{{…}}` content tokens need no special-case.
- **Declarative managed-set** — `templates/managed.json` declares it; adapters can extend it. (ADR 0008)

### `discern upgrade`

Ship a one-shot `discern upgrade` that rewrites a pre-1.0 `discern.toml` to the 1.0 shape in place (comment-preserving): `coverage_min` → a `[standards.coverage]` table, the `coverage` slot phase → a measurement slot, and `{{db}}` … → `@db@` …. It is idempotent (a clean 1.0 file reports nothing to do) and honours `--dry-run`/`--json`. It touches only `discern.toml`; the engine itself is refreshed by `discern upgrade`, as always.

To close the loop, **`upgrade` and `doctor` detect a pre-1.0 config** (reusing the migrator's own change-detection) and point the user at `upgrade`. That matters most for the _silent_ breakage — a `coverage_min` the 1.0 engine no longer reads — which would otherwise pass unnoticed at upgrade time; `upgrade` still succeeds (the nudge is advisory), while `doctor` reports it as a fixable finding.

> **Update ([ADR 0014](0014-versioned-migration-system.md)).** This one-shot, content-sniffing `upgrade` was retired in favour of a versioned migration chain anchored on a `schema_version`. `upgrade` now runs pending migrations automatically (no nudge), and `upgrade` became a read-only status command. The 0.x→1.0 rules above were not ported: the current shape is declared schema 1 and the chain starts clean. The rest of this ADR (the 1.0 shape itself) stands.

The kit version moves to **1.0.0**.

## Consequences

- The model is materially simpler: one standard shape, one execution unit (the slot), one fast-by-default gate, one versioned config document, one token delimiter per layer, one declared managed-set. Several special-cases and ~tens of lines of fallback logic are gone.
- It is a **breaking change** for any 0.x `discern.toml`. `upgrade` covers the silent breakages (a `coverage_min` that would otherwise just stop being read); the loud ones (an unknown `coverage` phase, an unexpanded `{{db}}`) surface through `doctor` and the gate anyway, and `upgrade` fixes them too.
- The earlier ADRs now carry _Update (1.0)_ notes rather than being rewritten, so the original 0.x reasoning stays on the record next to what 1.0 changed and why.
- The non-backward-compat invariants are untouched and were re-affirmed, not changed: stack-neutrality, no runtime in the target (POSIX sh + the `awk` reader), the seed/managed + `.new` upgrade model, the comment-preserving editor, and the out-of-scope list (no real adapters, no CI/cloud/editor assumptions).

## Alternatives considered

- **Keep backward compatibility; layer the new shapes beside the old.** This is exactly what produced the compromises above. Pre-adoption, the cost of carrying two shapes forever dwarfs the cost of one migration now.
- **Break the config but ship no `upgrade`.** Rejected: a `coverage_min` silently ceasing to gate is a real footgun. A tiny, idempotent migrator removes it for the cost of one command.
- **A bigger 1.0 (e.g. fold side-gates fully into the slot/scope model, or adapter-aware `upgrade`).** Deferred deliberately: those are larger designs. 1.0 pays down the _backward-compat_ debt specifically; per-slot execution leaves the door open (ADR 0002's _Update_) without committing to them now.
