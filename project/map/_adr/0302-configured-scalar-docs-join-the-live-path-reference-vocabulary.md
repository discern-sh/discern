# ADR 0302: Configured scalar docs join the live path-reference vocabulary

**Status**: accepted; builds on the paths registry in [ADR 0102](0102-paths-registry-and-rendered-artifacts.md) and serves the built-in checkpoint set required by the checkpoint decision in [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md).

## Context

The shipped `gotchas-playbook` checkpoint must trigger on **the configured gotchas doc** — `[project].gotchas_doc` — in whatever project enables it. The trigger menu already expresses this shape (`paths` with a live `${<config-key>}` reference, expanded against the governing config), but the reference vocabulary did not include the gotchas doc: membership derived solely from the paths registry's `configured` entries.

Adding the gotchas doc to the paths registry itself is the wrong shape. Registry entries are authored surfaces with a **prescriptive non-empty default**, and its satellites act on that: setup seeding, the fresh-install scope fills, ownership declarations, and the leakage sentinels all assume a real location. `gotchas_doc` defaults to the empty string — the feature is off until the owner names a doc — so a registry entry would either lie about a default or force behaviour (seeding, scope membership) the key never had.

## Decision

**The live reference vocabulary has two enumerated sources: the registry's configured members, and a table of configured scalar doc paths.**

- `SCALAR_CONFIG_PATH_REFERENCES` (in `src/shared/source_path_references.ts`) lists each scalar member: its dotted config key, its `${<config-key>}` spelling (registry convention), and a typed resolver. The first and only current member is `${project.gotchas_doc}`.
- Expansion treats both sources identically, in every surface that accepts the scope-glob dialect — commands, scope paths and gates, generated paths and runs, checkpoint selectors, standards globs.
- **An empty configured value expands to the empty pattern, and the glob dialect defines the empty pattern as matching nothing.** A consumer keyed on an unset value therefore goes quiet instead of matching everything — the property that lets a shipped checkpoint reference the gotchas doc safely in projects that never configured one.
- One combined spelling list (`LIVE_PATH_REFERENCE_SPELLINGS`) feeds the schema descriptions, so the generated config reference documents a new member the moment its table row exists.

## Consequences

- `gotchas-playbook` can ship with `paths = ["${project.gotchas_doc}"]`: it tracks the config automatically, activates when the owner names a doc, and never fires while the key is empty.
- The paths registry keeps its meaning — authored surfaces with prescriptive defaults and a seeding story — and its satellites never see scalar members.
- The scalar table is the sanctioned home for future config-pointed docs that need referencing without registry semantics; each addition is one row, guarded by the reference tests and self-documented through the shared spelling list.

## Alternatives considered

- **A paths-registry entry with an empty default.** Rejected: every registry satellite treats the default as a real location; an empty default would need per-satellite exemptions, spreading the special case instead of containing it.
- **Copying the configured doc path into the template entry at setup.** Rejected: it duplicates a configured fact, so repointing `[project].gotchas_doc` would silently strand the checkpoint.
