# Project recipes

This directory holds **your project's own `icculus` commands** — first-class verbs
the task runner dispatches alongside the built-in engine recipes (`icculus finish`,
`icculus worktree:exit`, …), but owned entirely by you.

The built-in engine lives inside the `icculus` binary; this directory is **yours**:
`icculus` never writes or refreshes anything here. Add, edit, and delete recipes
freely.

## Add a recipe

Create an executable script whose **second line** is a `# desc:` summary:

```sh
#!/usr/bin/env sh
# desc: reset local fixtures to a known state
set -eu

# Read config by calling the binary (no shell library to source):
target="$(icculus config get some.key)"

echo "Resetting fixtures…"
# ... your commands ...
echo "Fixtures reset."
```

Then:

```sh
chmod +x .icculus/recipes/reset-fixtures
icculus reset-fixtures    # runs it
icculus --help            # lists it under "Project recipes"
```

The filename is the verb. As with engine recipes, `icculus some:verb` maps to a
file named `some-verb` (`:` → `-`).

## Rules

- **Make it executable.** A non-executable recipe is reported, not run.
- **The engine always wins.** A recipe whose name collides with a built-in
  (e.g. `finish`) is **ignored with a warning** — rename it. The core gate can
  never be redefined by a project file.
- **No shell library to source.** A recipe is a standalone executable in any
  language. `icculus` exec's it with the `ICCULUS_*` environment exported
  (notably `ICCULUS_ROOT`, `ICCULUS_RECIPES`, and `MAIN_BRANCH`) and your args
  forwarded. Read config by calling the binary — `icculus config get <key>` (and
  `icculus config array|has|subsections|keys <…>`) — and worktree identity with
  `icculus worktree-name --db|--site|--port`.
- **Relocate if you like.** Set `[recipes].dir` in `.icculus/config.toml` to point
  somewhere other than `.icculus/recipes`.
