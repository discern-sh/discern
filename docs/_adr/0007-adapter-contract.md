# ADR 0007: The adapter contract — a file overlay plus config fills

**Status**: accepted

## Context

`icculus add-adapter <name>` shipped as mechanism-only: it scaffolds an
`adapters/<name>/` tree onto the project with the same token/merge/exec-bit
machinery as `init`, but nothing was bundled, the contract was undocumented, and
— critically — it could only overlay **files**. An adapter could add a project
recipe, a skill, a guideline fragment, or a doc, but it could **not** contribute
**slots, scopes, side-gates, or ratchets**, because those live in the single
`icculus.toml`, which is a seed (already present) that a file overlay leaves
untouched. So an "adapter" couldn't actually do the stack-specific half of what
an adapter is for.

ADR 0005 added a comment-preserving `TomlEditor` and the `applyAnswerFills`
routine that `init --config` uses to write slots/scopes/side-gates/ratchets into
the generated `icculus.toml`. That is exactly the missing capability — an
adapter should be able to carry the same fills.

The tension the task names: an adapter is inherently stack-specific, so a
"neutral reference adapter" is near-oxymoronic. Shipping a real ecosystem
adapter would violate stack-neutrality.

## Decision

Define the adapter contract as a **file overlay plus optional config fills**,
and prove it with a clearly-labelled fake example adapter used only in a test
(nothing real is bundled).

### An adapter is a directory `adapters/<name>/`

- **Everything in it is overlaid onto the project** with the same rules as
  `init`: seed files (recipes, guideline fragments, docs) are write-once;
  managed files (`.ai/skills/**`, `.icculus/engine/**`) follow the hash-aware
  overwrite/`.new` rule; `.claude/settings.json` deep-merges;
  `.gitignore.fragment` appends.
- **One file is special: `adapter.json`** at the adapter root. It is metadata,
  not scaffolded (it is filtered out of the overlay). It is an
  `init --config`-shaped document whose `slots` / `scopes` / `side_gates` /
  `ratchets` are applied to the project's existing `icculus.toml` via
  `TomlEditor` (comments preserved), reusing `applyAnswerFills`. An optional
  `description` is shown when listing adapters.

So an adapter overlays **slots, scopes, side-gates** (via `adapter.json` fills)
and **recipes, skills, guideline fragments, docs** (via the file tree) — the
full set the task calls for. `--json` and `--dry-run` report both the files and
the fills.

### Stack-neutrality is preserved

- **No adapter is bundled** in the distributed kit (`resolveAdaptersDir` finds
  none, so `add-adapter <x>` still reports "this build ships no adapters yet").
- The example adapter is a **test fixture**
  (`tests/fixtures/adapters/example/`), a toy "stack" that exists only to
  exercise the contract end-to-end. It is clearly labelled, is not a real
  ecosystem, and is not shipped.

## Consequences

- `add-adapter` is now a complete, documented extension point: a distributable
  bundle can overlay both files and config in one command, comments intact.
- Adapters and `icculus config` / `init --config` share one editor and one fills
  format — an adapter author writes the same JSON shape a CI scaffolder does.
- The kit stays stack-neutral: the contract is documented and tested, but no
  real adapter ships. A project that just wants to layer its own stack should
  usually reach for `init --config` / `config` directly (ADR 0005); adapters are
  for _packaging and redistributing_ such a layer.
- `adapter.json` is a reserved filename at an adapter root (it is metadata,
  never scaffolded). Documented.

## Alternatives considered

- **File-overlay only (no fills); document that adapters can't set slots.**
  Rejected: it leaves an adapter unable to do the stack-specific half it exists
  for, contradicting the contract the task describes.
- **Ship a real reference adapter (e.g. node).** Rejected: violates
  stack-neutrality. A fake example fixture exercises the contract without baking
  in an ecosystem.
- **A separate `icculus apply-fills` command instead of folding fills into
  `add-adapter`.** Rejected: an adapter should be one cohesive bundle applied by
  one command; `init --config` and `config` already cover standalone fills.
- **Put fills inside the overlaid `icculus.toml`.** Rejected: the project's
  `icculus.toml` is a seed (already present), so an overlaid one is skipped —
  and a full file can't _merge_ slots into the user's existing config the way an
  `adapter.json` fill can.
