# ADR 0092: `upgrade` reconciles the fixed `discern.toml` scaffold

> **Banner ownership amendment ([ADR 0138](0138-all-ruled-config-banners-are-managed.md)):** ruled fixed-section banners now refresh wholesale; comments attached to keys and comments outside those regions remain project-owned. **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** The fixed config section is now `[scripts]`; the decision and reasoning are unchanged. **Job-model vocabulary amendment ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use `[capabilities]` / `[checks.<name>]` → `[jobs]` / `[jobs.<name>]`, gate `capability` / custom `check` → known/custom `job`; the decision and reasoning are unchanged. **Glossary vocabulary amendment ([ADR 0169](0169-the-launch-glossary-canon.md)):** Current pointers use `Co-managed seed` / co-managed file → `Shared file`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

`discern.toml` is both the project's config and the reference implementation a user reads to understand discern. A fresh `discern setup` writes the current template: documented sections, keys in deliberate order, and default values that teach the shape. Existing installs, however, only advanced through versioned migrations. Once an install recorded the current `[meta].schema_version`, `discern upgrade --check` treated it as current even if the file was missing a fixed section such as `[scripts]` or a fixed key such as `[gate].fail_fast`.

The engine hid that drift because the typed schema supplies defaults at read time. Operationally, a missing key could still validate and run; socially, the config had stopped being a like-for-like example of what the current template ships. ADR 0021 fixed one slice of this by making migrations insert newly-added sections with template comments, but only while that migration was pending. A current-schema project could still drift, and downstream test projects would not be repaired by any future `upgrade`.

The pressure is two-sided:

- `discern.toml` is intentionally hand-editable and must never have customized values overwritten by a template refresh.
- The fixed scaffold is not merely decoration. It is the visible contract of the current schema, and the absence of a current key/comment is stale documentation in the user's own repository.

## Decision

`discern upgrade` now runs a config-scaffold reconciliation pass after pending migrations and before the final schema stamp. The pass renders the current `templates/discern.toml.tmpl` using the project's current/default config values, then compares that rendered template with the raw `discern.toml`.

It repairs only the fixed scaffold:

- a missing active non-record section is inserted from the template, with its documentation block and canonical placement;
- a missing fixed key inside an existing section is inserted from the template, with its attached comments and canonical key order;
- existing values are never rewritten;
- named record tables (`[jobs.<name>]`, `[scopes.<name>]`, `[standards.<name>]`, `[worktree.resources.<name>]`) are treated as project-owned population and are not recreated merely because the template seeded an example/default entry.

`upgrade --check` reports pending reconciliation alongside pending migrations and exits non-zero when either exists. `upgrade --dry-run` previews the same operations. A second `upgrade` is byte-stable once the scaffold is current.

If the bundled config template cannot be resolved, the mutating upgrade refuses before stamping the schema. Guideline compilation remains best-effort, but config scaffold reconciliation is part of upgrade's correctness guarantee.

## Consequences

`discern upgrade` again has one honest meaning: this project is brought into line with the installed binary, including the visible config scaffold, not only the schema integer. discern's own root config and downstream pre-launch test projects get the same repair path users will receive.

The ownership model becomes more precise. `discern.toml` is no longer described as an entirely untouched seed. Its fixed scaffold is shared with discern; its values, jobs, scopes, standards, resources, guidance sources, and project comments remain the project's. That is a deliberate narrowing of the old "seed files are never touched" phrasing.

This is not a full formatter. Stale comments beside already-present keys are not rewritten, sections are not reordered wholesale, and removed named record tables are treated as customization. Behaviour-changing default shifts still belong in explicit versioned migrations, where an old default can be recognized and a customized value preserved.

## Alternatives considered

- **Bump the schema for every template prose/key addition.** That would force every cosmetic or explanatory config change through the migration chain, but it still would not repair a current-schema file whose migration already ran before the prose improved.
- **Generate `discern.toml` completely from the schema.** ADR 0026 already rejects this for now: the template is curated prose, while the schema is the typed contract. Reconciliation keeps the template as the prose source without turning every project config into a full re-render.
- **Rewrite the whole config into template order.** That would catch stale comments and arbitrary reordering, but preserving every user comment and custom table through a full normalization pass is a larger, riskier operation. The chosen pass is additive and only-if-absent.
- **Keep `doctor` as an advisory only.** That would still leave users to hand-copy template blocks. The bar for `upgrade` is convergence, not a nudge.
