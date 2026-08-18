# ADR 0289: Production binaries embed only product-reachable npm packages

**Status**: accepted

## Context

discern's root Deno configuration uses a managed `node_modules` directory because source development spans the product, tests, the public site, and repo-internal tools. `deno compile` projected that physical directory into every release binary. A dependency could therefore enter the shipped artifact without being reachable from `src/main.ts`: adding ts-morph for Canon Editor carried its bundled TypeScript compiler into discern and exposed about 15 MB of accumulated binary growth at the next measurement. Other test and development packages crossed the same boundary, bringing the total non-product payload to about 40 MB.

The third-party notice generator already derives the product's npm dependency closure from the entrypoint graph. The release build must use that same boundary. Naming Canon Editor or ts-morph in an exclusion would remove today's instance while allowing the next internal npm tool to recreate it under a fresh name.

## Decision

Production compilation resolves npm packages with `--node-modules-dir=none` and passes `--exclude-unused-npm`. The release artifact therefore embeds only npm packages reachable from the product module graph, independently of the root workspace dependency tree and the packages its development surfaces use.

Development keeps the root `nodeModulesDir: "auto"` setting. Canon Editor consumes ts-morph from its official JSR package, but registry choice is not the production boundary: any future development-only npm package remains valid in the workspace and absent from the binary. A product dependency reached only through a non-statically-analyzable npm import must declare an explicit compile include rather than widening the build back to the workspace directory.

## Consequences

- Canon Editor, tests, and site tooling can choose dependencies for their own work without silently changing the release payload.
- The compiled npm set and third-party notices share the product graph as their authority.
- The representative Linux binary falls from roughly 183 MB to roughly 142 MB with the current source.
- Release builds require a Deno compiler that supports `--exclude-unused-npm`; an older compiler fails visibly rather than producing an over-broad artifact.
- A future dynamic npm load needs an explicit `--include npm:<package>` and a focused runtime test.

## Alternatives considered

**Exclude ts-morph's physical package directories.** Rejected because package-store paths are an implementation detail and a fresh internal npm dependency would bypass a name-specific rule.

**Move Canon Editor into a second repository or nested Deno workspace.** Rejected because the editor intentionally reads, edits, formats, and tests this repository's live registries. A separate dependency boundary would add operational complexity without protecting other internal tools.

**Disable `node_modules` for every development command.** Rejected because the defect is in the production projection, not the source workflow. The compile command can enforce the narrower boundary without perturbing tests, the site, or local tooling.
