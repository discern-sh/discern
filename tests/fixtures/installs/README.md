# Install corpus

One captured fresh installation per past install schema, frozen as the starting
point every migration must carry forward (ADR 0014). `schema-<N>/` holds
`manifest.json`, the plaintext record of the capture, and `snapshot.json.gz`,
the exact files Git carries after `discern setup begin` ran at schema N from the
recorded source commit. The installation stays archived so repository searches
find the live templates and sources rather than the copy; the manifest lists
every captured file with its hash.

The captured tree is the Git-carried installation: every tracked or untracked
file the installation's own ignore rules admit. Materialized skills and
machine-local provider state stay outside it because discern's ignore block
excludes them; every clone lacks them, `discern upgrade` regenerates them, and
the convergence test compares them on disk. The manifest records the setup
invocation, the project directory name provider files derive relative paths
from, and the seed project content, so a fresh comparison installation starts
from the same inputs.

To inspect a capture, decompress and parse the JSON:

```sh
gunzip -c tests/fixtures/installs/schema-1/snapshot.json.gz | jq -r '."discern.toml"'
```

## Reproduce a capture

Check out `source.commit`, then run the manifest's `reproduce` command from the
repository root. `source.trees` records the `src` and `templates` tree ids, so
the capture stays identifiable after a history rewrite changes commit ids. The
script refuses an uncommitted setup surface and an existing fixture directory:
a captured schema is frozen, and [`install_corpus_test.ts`](../../install_corpus_test.ts)
fails when the archive or any member drifts from its manifest hash.

## Enroll the next schema

Before raising `SCHEMA_VERSION` from N to N+1, capture schema N with the same
command. The convergence test then upgrades every fixture through the current
migration chain and compares the result with a fresh installation by file
ownership: Generated and Shared artifacts byte for byte, `discern.toml` in its
managed projection, and project-owned seeds by presence. `SCHEMA_VERSION` may
not exceed the newest captured schema plus one.

## Released-binary parity

On 2026-09-21, the published `v1.0.0` Apple-silicon binary produced the same
33 Git-carried files as `schema-1/snapshot.json.gz`, byte for byte, using the
manifest's setup arguments, seed, and project directory name. The released
commit is `649bc2ce9be8e46d32c05cc24d7a80da2a5d36fa`. The existing frozen
fixture therefore represents those released installation bytes; no second
copy is needed.
