# Migration prompt — discern's config is now validated against one typed schema

You are working in a project that has **discern** installed (it has a root
`discern.toml`). discern's binary has just been upgraded to a build where the
config is read through **one typed schema** instead of a lenient stringly
reader. Your job: get this project's install clean under the new, stricter
validation, and verify nothing in the project's own tooling relied on the old
leniency.

This is a self-contained task. Do not assume anything about the project beyond
"it has a `discern.toml`". Work through the steps; report what you changed.

## What changed (and what did NOT)

- **No on-disk shape change.** discern did not rename, move, or re-default any
  config key. `discern init` and `discern upgrade` write the same bytes as
  before, the config schema version is unchanged (still **8**), and there is
  **no new migration step**. A config that was already correct stays correct,
  untouched.
- **What changed is validation.** Every command that reads `discern.toml`
  (`finish`, `prepare`, `test`, `ratchets`, `doctor`, `worktree`/`worktree:*`,
  `refresh`, `graduate`, `bootstrap`, …) now parses the **whole** config against
  a strict schema and **fails at load** if anything is wrong, with a clear,
  path-qualified message (e.g. `ratchets.coverage.run: …`). The old reader
  silently ignored typos and returned defaults; the new one refuses them.
- **`discern doctor` now reports a `config schema` check** that lists every
  problem at once. Its `capabilities` check is now purely informational ("wired:
  …"); the unknown-capability error moved into the schema check.
- **`--json` callers:** a schema-invalid config now exits non-zero with
  `{ "ok": false, "error": "invalid_config", "message": "…", "issues": [ { "path":
  "…", "message": "…" } ] }`.
  A TOML _syntax_ error still reports `"error": "invalid_toml"`. If any project
  automation parses discern's `--json`, it should tolerate these.

## What a previously-tolerated config might now trip on

The old reader accepted anything that was valid TOML. These are now **rejected
at load** (each was either a silent no-op or a silently-wrong default before):

1. **An unknown section or a typo'd key.** e.g. `[scopes]` written the pre-2024
   array way (`neutral = ["docs/"]`) instead of `[scopes.docs]` tables; a
   misspelled `[capabilites]`; `branch_prefex` under `[project]`.
2. **A capability outside the closed set** (`format`, `build`, `lint`,
   `typecheck`, `test`). Any other name under `[capabilities]` must move to a
   `[checks.<name>]` table with an explicit `stage`.
3. **A leftover `[worktree.db]` or `[worktree.dev_server]` table.** These were
   replaced by `[worktree.resources.<name>]` (schema 7→8). `discern upgrade`
   removes them; a config that skipped the upgrade, or had them re-added by
   hand, now fails.
4. **A malformed `[ratchets.<name>]`** — no `run`, a `limit` that isn't a
   number, or a `direction` other than `up`/`down`.
5. **A malformed `[checks.<name>]`** — no `stage`, a `stage` outside
   `fix|build|check|test`, or no `run`.
6. **A malformed `[scopes.<name>]`** — no `paths`, or `paths` not an array.
7. **A non-boolean `[features]` value, or an unknown feature.** e.g.
   `docs = "yes"` (must be `docs = true`), or a misspelled `worktree = false`
   (the feature is `worktrees`). A quoted boolean like `fail_fast = "false"`
   under `[gate]` now fails too — it must be a bare `fail_fast = false`.
8. **`discern config set <unknown.key> <value>`** now writes a key the schema
   doesn't know, so the _next_ config read fails. Only set keys that exist in
   the config reference.

## Steps to bring this install into compliance

1. **Make sure you're on the new binary.** If the project runs an installed
   `discern`, reinstall/rebuild it from the upgraded source. If it self-hosts
   from a checkout, use `deno task dev <verb>`. Sanity check:
   `discern --version` runs, and `discern doctor` produces a `config schema`
   check line.

2. **Run `discern upgrade`.** It brings the install to the current schema and
   removes the known legacy tables (`[worktree.db]`/`[worktree.dev_server]`).
   This alone fixes breakage #3 for any not-yet-upgraded install.

3. **Run `discern doctor`** (add `--json` if you want the machine-readable issue
   list). Read the `config schema` check: it names each offending key with a
   path. For every issue, edit `discern.toml`:
   - **Unknown section/key** → fix the spelling, or delete the stray line.
   - **Unknown capability** (e.g. `[capabilities].e2e`) → move it:
     ```toml
     # before
     [capabilities]
     e2e = "playwright test"
     # after
     [checks.e2e]
     stage = "test"
     run   = "playwright test"
     ```
   - **Legacy `[scopes]` array** → rewrite as a named table:
     ```toml
     # before
     [scopes]
     neutral = ["docs/"]
     # after
     [scopes.docs]
     paths   = ["docs/"]
     neutral = true
     ```
   - **Dead `[worktree.db]`/`[worktree.dev_server]`** → already removed by
     `discern upgrade`; if any remain, delete them (or move `clone`/`drop` →
     `[worktree.resources.db].create`/`destroy` and `link`/`unlink` →
     `[worktree.resources.dev_server].create`/`destroy`).
   - **Malformed ratchet/check/scope** → add the required key (`run`, `stage`,
     `paths`), make `limit` a number, make `direction` `up`/`down`.
   - **Bad `[features]` / `[gate]` value** → use bare booleans (`true`/`false`),
     and only the known feature names (`worktrees`, `ratchets`, `guidance`,
     `skills`, `docs`).

   The authoritative list of every valid section, key, type, and default is the
   generated config reference shipped with discern's own source/docs
   (`docs/10-installer/config-reference.md` in the discern repository) — not in
   this project's `docs/` tree. The same shape is published as the editor JSON
   Schema at `schema/discern-config.schema.json`. When in doubt, the error
   messages from `discern doctor` already name the exact offending path.

4. **Re-run `discern doctor` until it is green**, then run `discern finish` to
   confirm the gate loads and runs against the validated config.

5. **Check the project's own recipes/automation.** If any recipe parses
   `discern <verb> --json`, confirm it tolerates the `invalid_config` error
   shape. The `discern config get/array/has/subsections/keys` passthrough is
   **unchanged** (it still reads arbitrary keys raw), so recipes using it need
   no edits.

## Done when

- `discern doctor` reports no failing checks (advisories are fine).
- `discern finish` loads the config and runs the gate.
- You've reported every `discern.toml` edit you made and why.
