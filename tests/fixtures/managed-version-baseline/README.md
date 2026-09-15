# First-public adoption compatibility slice

This immutable fixture freezes the schema-1 reader and adoption boundary before
publication. No discern release was published when 3A captured it on September
15, 2026. It is not a released binary or lock-down 7A's final install corpus.
7A must retain this reader/key/template contract when freezing that corpus.

`reader.js.gz` archives the production entrypoint in
`../managed_version_baseline_entry.ts`, including its strict config parser,
SemVer implementation, compiled numeric version, instruction-currency checker,
and Gate planner. It contains no runtime imports or machine-specific paths.
The instruction templates and config template are frozen alongside it. Tests
execute the bundle with this template root in a fresh process; they do not
inject a version into the current parser.

The hash manifest pins every executable and template input, including the unpacked reader. Tests unpack the captured JavaScript into a temporary directory and run it unchanged. The archive is retained engine evidence, separate from the authored test code. This fixture covers
reader acceptance, older-template currency, and the Proof boundary. Broader
version matrices use the current pure comparison core. It deliberately excludes
installer files, skill materialization, setup machinery, and the final install
footprint; those retain their own authorities.

Capture command:

```sh
deno bundle --platform=deno --minify tests/fixtures/managed_version_baseline_entry.ts --output tests/fixtures/managed-version-baseline/reader.js.fixture
```

The deterministic gzip archive and manifest are frozen evidence, not ordinary codegen outputs.
Changing the capture requires an explicit compatibility decision. Future
released readers supersede this prepublication slice as the historical-engine
test source without deleting its optional-key contract.
