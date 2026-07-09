# Historical install fixtures

Each `schema-XX/` directory contains the user-owned bytes from a real
`discern setup --yes --slug demo --name Demo` run at an older schema bump commit,
or from applying the real migration step to the prior captured fixture when a
setup-era capture was not available:

- `schema-06`: `142a898`
- `schema-07`: `5443267`
- `schema-08`: `48481a2`
- `schema-09`: `60c2ba2`
- `schema-10`: `d271356`
- `schema-11`: `33d3c85`
- `schema-12`: `458ddcf`
- `schema-13`: derived from `schema-12` by applying 12→13 and stamping schema 13
- `schema-14`: the schema-14 template rendered with the demo tokens, plus the
  default-layout authored surface (`guidance.md`, `docs/`, `TODO.md`,
  `brief.md`, `skills/`, `recipes/`) so the 14→15 namespace move is exercised
  on real files
- `schema-15`: derived from `schema-14` by applying the real 14→15 step with a
  schema-15 engine — the config carries `[features]` and `[worktree].enabled`
  and the authored surface sits under `discern/`, so the 15→16 toggle
  retirement (ADR 0101) is exercised on real bytes
- `schema-16`: derived from `schema-15` by applying the real 15→16 step — the
  config still carries `[worktree].graduate_to` (with its doc comment), so the
  16→17 drop of the graduate destination (ADR 0110) is exercised on real bytes

The fixtures keep only `discern.toml`, `.gitignore`, and
`.claude/settings.json` (plus, from `schema-14`, the movable authored surface):
the convergence test asserts those user-facing files upgrade to a schema-valid
current install, then stay byte-identical on a second upgrade. Generated agent
files and materialized skills are deliberately omitted; current `upgrade`
re-publishes them from the live binary.
