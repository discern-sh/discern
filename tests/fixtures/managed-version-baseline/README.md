# First-public adoption compatibility slice

This immutable snapshot preserves the schema-1 reader and its templates from
before publication. It tests how captured code reads a newer project, checks
managed files, and decides whether it can issue Proof. Relabelling the current
engine as an older version cannot establish those behaviors.

`snapshot.json.gz` holds a JSON object mapping relative file paths to their
captured UTF-8 contents: the self-contained reader bundle, config template, and
instruction templates. Tests verify the archive and member hashes in
`manifest.json`, unpack it once into a temporary directory, and execute the reader
in fresh processes. Keep the snapshot compressed so repository searches find the
live template sources. To inspect it, decompress and parse the JSON or use the
test's `readSnapshot` helper; each member is ordinary source text.

The reader was bundled from
[`managed_version_baseline_entry.ts`](../managed_version_baseline_entry.ts) with
`deno bundle --platform=deno --minify`. Its code includes the strict config parser,
SemVer implementation, compiled numeric version, instruction-currency checker,
and Gate planner, with no runtime imports or machine-specific paths. Packing
preserves every captured byte; gzip uses level 9 and a zero modification time.
The snapshot is retained evidence, not a codegen output to refresh after edits.
Changing its contents requires an explicit compatibility decision.

No discern release was published when this snapshot was captured on September
15, 2026. It is a compatibility slice, not a released binary or lock-down 7A's
final install corpus. It excludes installer files, skills, and setup machinery.
7A retains this reader/key/template contract in its final corpus; supported
released engines become the historical test source when available.

The captured first-party code uses the repository [license](../../../LICENSE);
bundled dependencies retain the [third-party notices](../../../THIRD_PARTY_NOTICES).
Dependency versions are pinned by the capture revision's `deno.lock`.
