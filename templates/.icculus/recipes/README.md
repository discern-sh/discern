# Project recipes

This directory holds **your project's own `agent` commands** — first-class verbs
the task runner dispatches alongside the built-in engine recipes (`agent finish`,
`agent worktree:exit`, …), but owned entirely by you.

Unlike `.icculus/engine/` (kit-managed, refreshed by `icculus upgrade`), this
directory is **unmanaged**: `icculus` never writes, refreshes, or `.new`-preserves
anything here. Add, edit, and delete recipes freely.

## Add a recipe

Create an executable script whose **second line** is a `# desc:` summary:

```sh
#!/usr/bin/env sh
# desc: reset local fixtures to a known state
. "$ICCULUS_LIB/bootstrap.sh"   # optional: config_get, info/ok/die, run_parallel

heading "Resetting fixtures…"
# ... your commands ...
ok "Fixtures reset."
```

Then:

```sh
chmod +x .icculus/recipes/reset-fixtures
agent reset-fixtures      # runs it
agent --help              # lists it under "Project recipes"
```

The filename is the verb. As with engine recipes, `agent some:verb` maps to a
file named `some-verb` (`:` → `-`).

## Rules

- **Make it executable.** A non-executable recipe is reported, not run.
- **The engine always wins.** A recipe whose name collides with a built-in
  (e.g. `finish`) is **ignored with a warning** — rename it. The core gate can
  never be redefined by a project file.
- **Library access.** A recipe invoked via `agent <name>` inherits the harness
  paths, so `. "$ICCULUS_LIB/bootstrap.sh"` gives you `config_get`, the
  `info`/`ok`/`warn`/`die` helpers, `run_parallel`, and the `[slots]` accessors.
- **Relocate if you like.** Set `[recipes].dir` in `icculus.toml` to point
  somewhere other than `.icculus/recipes`.
