# Historical install fixtures

Each `schema-XX/` directory contains the user-owned bytes from a real
`discern setup --yes --slug demo --name Demo` run at an older schema bump commit:

- `schema-06`: `142a898`
- `schema-07`: `5443267`
- `schema-08`: `48481a2`
- `schema-09`: `60c2ba2`
- `schema-10`: `d271356`
- `schema-11`: `33d3c85`
- `schema-12`: `458ddcf`

The fixtures keep only `discern.toml`, `.gitignore`, and
`.claude/settings.json`: the convergence test asserts those user-facing files
upgrade to a schema-valid current install, then stay byte-identical on a second
upgrade. Generated agent files and materialized skills are deliberately omitted;
current `upgrade` re-publishes them from the live binary.
