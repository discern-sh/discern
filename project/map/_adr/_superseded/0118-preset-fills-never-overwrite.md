# ADR 0118: Preset config fills never overwrite a present value

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](../0120-launch-verb-canon.md), [ADR 0168](../0168-the-gate-declares-jobs.md)):** current spellings are `standards` (formerly `ratchets`), `[jobs]` / `[jobs.<name>]` (formerly `[capabilities]` / `[checks.<name>]`), and known/custom `job` (formerly gate `capability` / custom `check`); the decision and reasoning are unchanged.
> - **[ADR 0365](../0365-the-v1-cli-has-one-command-model-and-one-spelling.md) — preset withdrawal:** the command and its config-fill result fields were removed before the first public tag. The fill-if-absent implementation remains only where a live caller owns it.

**Status**: superseded by [ADR 0365](../0365-the-v1-cli-has-one-command-model-and-one-spelling.md)

## Context

A preset is a file overlay plus config fills (ADR 0007/0018). The file half has always been create-or-skip: a present file is the user's and is never overwritten. The config half was not — `applyConfigDoc` wrote every fill through the comment-preserving editor's replace-existing path, so a preset whose `preset.json` carried `capabilities.test` silently replaced a user-authored `test` command in `discern.toml`. Nothing disclosed which keys would change: dry-run reported only a boolean, the confirm review one summary line. A user who had tuned their gate (`cargo test --workspace --all-features`) and applied a preset ended up with the weaker preset command and a silently narrower quality gate — with no per-key trail to notice it by.

The replace-existing path was never needed by the legitimate flows: `setup
--config` applies fills to a freshly generated template (whose known-job entries ship commented out), and a fresh overlay writes into empty slots. The path only ever fired against values a user had authored.

## Decision

Preset config fills are **fill-if-absent, never overwrite** — the same rule as the file half. A fill whose target already carries a real value (a set key, or a present `[jobs.*]` / `[scopes.*]` / `[standards.*]` table) is skipped; a commented-out template hint does not count as a value. `applyConfigDoc` gains a `skipExisting` mode and returns a per-path report (`filled` / `skipped`), which `preset` surfaces everywhere the user decides or reviews: the dry-run (JSON arrays `config_fills_applied` / `config_fills_skipped` and per-key human lines), the confirm review, and the apply result.

Explicit *no*s:

- `setup --config` keeps the default overwrite mode — it fills a just-generated template where the document is the user's declared intent, and nothing user-authored exists yet.
- No clean-tree guard was added to `preset` (unlike `upgrade`, ADR 0014): with overwrite gone, the verb no longer destroys anything uncommitted — both halves only add.
- No `--force` overwrite flag: a user who wants the preset value for a key they already set changes it with `discern config set`, keeping one mental model (present value = yours, always).

## Consequences

- Applying a preset is now idempotent and safe over a tuned config: re-applying fills nothing and leaves `discern.toml` byte-identical.
- A preset can no longer "upgrade" a project's existing commands even when the author intends it to; that is deliberate — config changes to values the user set are theirs to make, with the skipped keys disclosed so they know which to consider.
- The `preset` result schema grew two disclosure arrays; `config_fills` stays a boolean meaning "`discern.toml` was (or would be) written".
- A class-level guard (`tests/config_doc_test.ts`) derives the fill sections from the config-doc schema, so a new fill section cannot ship without enrolling in the never-overwrite test.
