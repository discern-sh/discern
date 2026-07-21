# ADR 0018: Consolidate discern vocabulary into four layers

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`, `docs` → `map` where it names the command, config, or tree, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Current-state note.** Lands together with its sibling [ADR 0017](0017-capabilities-model.md) (declare capabilities, derive the gate) — one 3→4 schema migration, best read as a pair. **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The older Recipe layer below describes the then-current command implementation. Project-owned executables are now Project Scripts under `discern script`; the decision and reasoning are unchanged. **Job-model vocabulary amendment ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use `[capabilities]` / `[checks.<name>]` → `[jobs]` / `[jobs.<name>]`, gate `capability` / custom `check` → known/custom `job`; the decision and reasoning are unchanged. **Glossary vocabulary amendment ([ADR 0169](0169-the-launch-glossary-canon.md)):** Current pointers use `Co-managed seed` / co-managed file → `Shared file`, the product category `Your files` / `Yours` → `Project-owned file`, `The binary's files` → `Generated file`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

[ADR 0017](0017-capabilities-model.md) replaced slots + phases with capabilities, but slot/phase was only the largest of several parallel concepts a newcomer had to hold at once. Counting the nouns the docs introduced as peers: slots, phases, scopes, side gates, standards, evidence, adapters, recipes, skills, guidelines, managed, seed — **twelve**, presented as a flat list. Each is individually defensible; together they bury the product's actual shape under vocabulary.

Several of them had accreted as _parallel_ mechanisms for ideas that already had a home:

- **Side gates lived in their own table.** A `[scopes.side_gates]` map keyed a command by a scope name that the `[scopes]` table already defined — so the same region was named in two places, and "side gate" was a separate noun for what is really just "a scope that has a gate."
- **Standards referenced a separate measurement slot.** A `[standards.<name>]` pointed at a phase-less `[slots.<name>]` whose only job was to emit the metric. That indirection — and the "measurement slot" concept it forced — bought nothing; the command could live on the standard.
- **`[evidence]` was a lightly-used gate** (require a per-branch work artifact before `done`), off by default, that most installs never touched but every reader still had to learn.
- **"Adapter" was overloaded.** It named both the installable overlay (`add-adapter`, `adapter.json`) _and_ the worktree database/dev-server seams — two unrelated things. [ADR 0007](0007-adapter-contract.md) already had to disambiguate which "adapter" its `adapter.json` meant.
- **"Seed" was kit jargon** for "the files that are yours" — a word a reader has to look up to learn it means the opposite of "managed."

Pre-launch is the moment to consolidate (the [ADR 0016](_superseded/0016-consolidate-install-surface.md) window), and doing it alongside [ADR 0017](0017-capabilities-model.md) means one coherent vocabulary lands at once rather than in drips.

## Decision

Consolidate the parallel concepts, and present what remains as **four layers** instead of a flat list:

1. **The gate — your definition of done:** jobs, scopes, standards.
2. **The workspace — isolated worktrees:** worktrees and their settings.
3. **The agent surface — what agents read and run:** guidelines (always-on), skills (on-demand), recipes (your `agent` verbs).
4. **The ownership model — who owns what:** Project-owned files, Shared files, and Generated files, with **presets** layering reusable stacks on top.

The concrete moves:

- **A scope is a named region with attributes; the side gate folds in.** A scope becomes a `[scopes.<name>]` table: `paths` (required globs), optional `neutral` / `previewable` booleans, and an optional **`gate`** command — the former side gate. `[scopes.side_gates]` is gone. The reserved scope _names_ (`neutral`, `web`, `previewable`) are gone too: `neutral`/`previewable` are now per-scope flags, and a path matching no scope is real, gated code by default (fail-open, unchanged), surfaced internally as the synthetic marker `code` (replacing the reserved `web`).

  ```toml
  [scopes.docs]
  paths   = ["map/", ".discern/"]
  neutral = true

  [scopes.native]
  paths = ["native/**"]
  gate  = "make -C native check"   # ← the former "side gate"
  ```

- **A standard inlines its measurement command.** `[standards.<name>]` gains a required **`run`** (which emits `DISCERN_METRIC <metric> <n>`); the `slot` reference and the "measurement slot" concept are gone.

  ```toml
  [standards.coverage]
  direction = "up"
  limit     = 80
  run       = "deno task coverage"
  ```

- **`[evidence]` is cut.** The config section, the `agent evidence` recipe, the `done` pre-check, the `.discern/evidence/` store, and its `.gitignore` line all go. A project that wants a pre-`done` artifact gate writes a `[check]`.

- **"Adapter" splits.** The installable overlay becomes a **preset**: `add-adapter` → `preset`, `adapters/` → `presets/`, `adapter.json` → `preset.json`, `DISCERN_ADAPTERS_DIR` → `DISCERN_PRESETS_DIR`. The worktree database/dev-server seams stop being called "adapters" — they are **worktree settings** (the `[worktree.db]` / `[worktree.dev_server]` config keys are unchanged; only the prose is).

- **"Seed" becomes "yours."** The managed-vs-seed model is unchanged in mechanics (managed files are kit-owned and refreshed; the rest are written once and never touched); the _word_ "seed" is replaced by "yours" / "your files" everywhere it faces a reader.

The explicit **no**s: side gates are not a separate table; standards do not reference a slot; "adapter" no longer names two things; evidence is not a first-class gate.

## Consequences

- **Five fewer parallel concepts.** Side-gate, measurement-slot, evidence, the adapter overload, and the "seed" coinage all stop being things to learn. With capabilities/phases from [ADR 0017](0017-capabilities-model.md), the flat twelve becomes a layered handful.
- **The config reads as four coherent layers** rather than a pile of tables, and a scope now has one home (its `[scopes.<name>]` table) for its paths, its neutrality, and its gate.
- **Cutting evidence removes a capability with no drop-in replacement.** A project that relied on `[evidence]` must re-express it as a `[check]` (or a recipe). Given how lightly it was used pre-launch, the conceptual saving is worth it; the loss is recorded honestly here.
- **The preset rename touches a published contract.** The command, the directory, the manifest filename, the env var, the JSON Schema, and the fixture all move. In exchange "adapter" becomes unambiguous. The rename needs **no** migration step — presets are never written into an install, so there is no installed file to move.
- **A migration is owed and the convergence test is the guard.** The schema 3→4 step (paired with [ADR 0017](0017-capabilities-model.md)) transforms `[scopes]`/`[scopes.side_gates]` into scope tables, inlines standard runs, and deletes `[evidence]`; the "upgrade ≡ fresh init" test and an idempotent re-run keep it honest.
- **Amends earlier records.** Supersedes [ADR 0002](_superseded/0002-first-class-side-gates.md) (side-gate execution is unchanged; its config _home_ moves onto the scope) and [ADR 0007](0007-adapter-contract.md) (the overlay contract is unchanged; the name is now preset / `preset.json`); amends [ADR 0003](0003-named-metric-standards.md) (inline `run`), [ADR 0004](_superseded/0004-structured-finish-json.md) (gate results are per-scope, labelled `scope:<name>`), and [ADR 0005](0005-declarative-config.md) (the `config` sub-verbs and config-document fields rename). It does not change the managed-vs-yours model of [ADR 0008](_superseded/0008-declarative-managed-set.md) — only the word "seed."

## Alternatives considered

- **Keep side gates as their own table.** Rejected: the side gate is logically an attribute of the scope it guards. A separate table forced the scope name to be written twice and made "side gate" a noun the docs had to introduce; the `gate` key on the scope says the same thing with one fewer concept.
- **Keep the measurement-slot indirection.** Rejected: it existed only because the old model had nowhere else to put the command. With standards able to carry their own `run`, the indirection — and the "a slot with no phase is secretly a different thing" footgun — is pure overhead.
- **Keep "adapter" for both meanings.** Rejected: the overload was a documented source of confusion ([ADR 0007](0007-adapter-contract.md) had to spell out which one `adapter.json` meant). "Preset" for the overlay and "worktree settings" for the seams cost a rename but end the ambiguity permanently.
- **Keep "seed."** Rejected: it is the one term in the pair a reader cannot guess. "Yours" needs no glossary lookup, and the mechanics it names are unchanged, so the cost is a find-and-replace, not a redesign.
