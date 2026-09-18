# Install corpus

One captured fresh installation per past install schema, frozen as the starting
point every migration must carry forward (ADR 0014). `schema-<N>/` holds
`fixture.json`, the manifest, and `project/`, the exact files Git carries after
`discern setup begin` ran at schema N from the recorded source commit.

The captured tree is the Git-carried installation: every tracked or untracked
file the installation's own ignore rules admit. Materialized skills and
machine-local provider state stay outside it because discern's ignore block
excludes them; `discern upgrade` regenerates them, and the convergence test
compares them on disk. The manifest records the setup invocation, the project
directory name provider files derive relative paths from, and the seed project
content, so a fresh comparison installation starts from the same inputs.

## Reproduce a capture

Check out `source.commit`, then run the manifest's `reproduce` command from the
repository root. `source.trees` records the `src` and `templates` tree ids, so
the capture stays identifiable after a history rewrite changes commit ids. The
script refuses an uncommitted setup surface and an existing fixture directory:
a captured schema is frozen, and [`install_corpus_test.ts`](../../install_corpus_test.ts)
fails when any byte drifts from its manifest hash.

## Enroll the next schema

Before raising `SCHEMA_VERSION` from N to N+1, capture schema N with the same
command. The convergence test then upgrades every fixture through the current
migration chain and requires the result to equal a fresh installation, allowing
only the differences its registry names and checks. `SCHEMA_VERSION` may not
exceed the newest captured schema plus one.
