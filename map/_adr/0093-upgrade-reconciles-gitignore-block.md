# ADR 0093: `upgrade` reconciles the discern `.gitignore` block

**Status**: accepted

## Context

The shipped `.gitignore` fragment protects discern's generated artifacts:
compiled agent files, materialized skills, and provider-local machine state.
Fresh setup appended that fragment once, guarded only by
`# --- discern harness ---`. Existing installs then moved forward through a mix
of schema migrations and the registry-derived `ensureAgentArtifactsIgnored`
helper, each adding only the one rule it knew was missing.

That split ownership model did not converge. A project upgraded across several
releases could accumulate multiple `# discern:` sections, stale comments, and
scattered discern-owned rules, while still missing a newly shipped rule from the
current fragment. The underlying defect was not one missed path; it was that
there was no single current discern-owned `.gitignore` block for `upgrade` to
reconcile.

The constraints are tight:

- `.gitignore` is still the project's file outside discern's ownership region.
- Generated agent artifacts must remain registry-derived, so a provider added
  later cannot depend on a second hand-copied path list.
- A project that deliberately tracks a generated guidance file is making a git
  index choice. Adding `/AGENTS.md` to `.gitignore` does not remove an already
  committed file from tracking, so the canonical block can stay complete without
  undoing that choice.

## Decision

discern owns exactly one delimited block in `.gitignore`:

```gitignore
# --- discern harness ---
...
# --- /discern harness ---
```

Fresh setup writes the canonical block. `discern upgrade` reconciles the same
block before the schema stamp: it preserves project-owned lines outside the
block, removes or absorbs known legacy discern-owned sections and rules wherever
they appear, and writes the current canonical block from
`templates/.gitignore.fragment`.

The canonical block is still anchored in the authored fragment, but it is
validated and widened from the provider registry for generated agent artifacts.
The parity guard asserts that the shipped fragment and the upgrade reconciler
write the same block, and that the block covers every provider's compiled
guidance file and materialized skills directory.

`upgrade --check` and `upgrade --dry-run` report pending `.gitignore`
reconciliation alongside config scaffold reconciliation. If the fragment cannot
be resolved, mutating upgrade refuses before stamping the schema, because it
cannot prove the install surface is current.

The explicit no: `.gitignore` is not a wholly generated file. Only the discern
block is co-managed; project-specific ignore rules before or after it remain the
project's bytes. A project-owned negation such as `!/AGENTS.md` outside the
block is preserved.

## Consequences

Users who have upgraded across many discern releases can run `discern upgrade`
once and end up with one readable, current harness block instead of a pile of
historical fragments. Future ignore-rule changes converge through the same path
rather than through one-off migrations.

The ownership model is more precise. `.gitignore` joins `discern.toml` as a
co-managed seed, but only for a delimited region. The old "append once and leave
it alone" description is no longer true.

The registry-derived agent guarantee survives. A new provider auto-enrolls in
the block reconciler and the parity guard, while the authored fragment remains
the place for explanatory prose and non-provider rules.

Projects that keep a generated guidance file tracked continue to do so through
git's index. The canonical ignore line does not remove the tracked file; it only
sets the shipped default for untracked generated artifacts.

## Alternatives considered

- **Keep the additive helper and add one more migration.** Rejected: that would
  fix the latest missing path but leave the same append-only defect class.
- **Generate the whole `.gitignore`.** Rejected: projects own their ignore
  rules. discern needs one co-managed block, not the entire file.
- **Omit canonical guidance-file rules when the file is already tracked.**
  Rejected: `.gitignore` does not remove committed files from tracking, and a
  block that varies by local index state is not a stable shipped surface.
  Preserve project-owned overrides outside the block instead.
