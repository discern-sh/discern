# ADR 0008: The managed-set is declared in `managed.json`, not hardcoded

> **Retired — made moot by [ADR 0019](../0019-single-binary-ts-engine.md).** The
> managed-file set and `managed.json` no longer exist. Kept for history; not
> current architecture.

**Status**: accepted; **made moot by
[ADR 0019](../0019-single-binary-ts-engine.md)** — see _Update (single-binary
cutover)_ below.

## Update (single-binary cutover)

The single-binary cutover ([ADR 0019](../0019-single-binary-ts-engine.md))
removes managed files entirely: with no committed engine to sync,
`managed.json`, the managed-set classifier, and `src/lib/manifest.ts` are
deleted. The "managed vs seed" contract this ADR refined no longer exists —
ownership is now _yours_ (committed seeds) vs _the binary's_ (gitignored,
re-published artifacts).

## Context

"Managed vs seed" is the contract that makes `upgrade` safe: a **managed** file
(`bin/agent`, `.discern/engine/**`, `.ai/skills/**`) is hash-tracked and
refreshed by `upgrade` (preserved as `.new` when the user edited it), while a
**seed** file (everything else) is write-once. Until now that classification was
**hardcoded in the installer** — `MANAGED_EXACT` / `MANAGED_PREFIXES` constants
in `src/lib/manifest.ts`.

Two problems with hardcoding it:

- **The contract is invisible from the template tree.** What the kit owns is a
  property _of the templates_, but you had to read installer source to learn it.
- **An adapter can't own a managed file.** `add-adapter` overlays files through
  the same plan builder, so an adapter file is managed only if it happens to
  fall under a hardcoded prefix (`.ai/skills/**`). An adapter that wants to own
  a managed file anywhere else had no way to say so.

## Decision

Move the managed-set into a **declaration the template ships**, and let the
installer read it.

- **`templates/managed.json`** declares the set:
  `{ "exact": ["bin/agent"], "prefixes": [".discern/engine/", ".ai/skills/"] }`.
  It is **installer metadata, never scaffolded** (the plan walker skips it, the
  same way `add-adapter` skips `adapter.json`).
- **`manifest.ts`** exposes a `ManagedSpec` (`{ exact, prefixes }`),
  `isManagedBy(path, spec)`, a `DEFAULT_MANAGED_SPEC` that mirrors the shipped
  file (the fallback when no declaration is present, so behaviour is identical
  either way), and `loadManagedSpec(dir)` / `parseManagedSpec` /
  `mergeManagedSpecs`. `isManaged(path)` remains as a thin wrapper over the
  default for callers without a spec.
- **`buildPlan` takes an optional `managedSpec`.** `init` and `upgrade` load it
  from the templates tree; `add-adapter` classifies an adapter's overlay files
  by `DEFAULT_MANAGED_SPEC` **merged with the adapter's own `managed.json`** (if
  it ships one), so an adapter can mark overlay files it owns.

## Consequences

- The managed/seed contract is now **data in the template tree**, not buried in
  installer code. A kit maintainer adjusts it by editing `managed.json`.
- An adapter can declare managed overlay files. They are hash-tracked in the
  project manifest and preserved-as-`.new` if edited, so re-running
  `add-adapter` won't clobber local edits — the same safety the kit's own
  managed files get.
- **Honest limitation:** `upgrade` refreshes only the **kit's** templates, not
  adapter files (adapters aren't part of the kit tree). So an adapter-managed
  file is tracked and edit-preserved, but re-applied via `add-adapter`, not
  `upgrade`. Full adapter-aware upgrade would be a separate, larger feature;
  this ADR does not promise it.
- Behaviour is unchanged for every existing install: the shipped `managed.json`
  equals the old hardcoded set, and the default applies when it is absent.
- One new metadata file at the templates root, filtered from the scaffold like
  `adapter.json`.

## Alternatives considered

- **Keep the set hardcoded.** Rejected: it hides the contract and blocks
  adapter-owned managed files — the two problems above.
- **Record the rule in the project manifest instead of the template.** The
  manifest already lists the managed _files_ (paths + hashes), but `init` must
  classify _new_ files from the template walk before any manifest exists for
  them, so the rule has to come from the template. The template declaration is
  the right source of truth; the manifest stays a record of what was written.
- **A glob engine for the spec.** Overkill: the managed set is a handful of
  exact paths and directory prefixes. Prefix/exact matching is enough and keeps
  the classification trivial to reason about (it mirrors what the old constants
  did).
- **Let an adapter's `managed.json` fully replace the base spec.** Rejected:
  merging keeps the kit's defaults (so an adapter's skills stay managed) while
  letting the adapter _add_ its own — replacing would surprise an adapter author
  by un-managing the standard trees.
