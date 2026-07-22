# ADR 0178: `discern tidy` is the embedded convention for discern-owned surfaces

**Status**: accepted

## Context

The map, guidance sources, and deferred-work ledger are Markdown maintained by coding agents. Their formatting drifted with each agent's habits, inflating diffs and creating avoidable conflicts. The root `discern.toml` had the same problem from two directions: agents edit it frequently, while setup, migrations, presets, `standards --pin`, and other engine paths rewrite parts of it programmatically. A writer whose output disagrees with the next formatter leaves a permanent churn loop.

Installed projects cannot rely on a JavaScript runtime or on a Markdown or TOML formatter from their own stack. The compiled binary cannot invoke `deno fmt`: `deno compile` embeds the program in `denort`, which omits Deno's tooling commands. The feature must therefore remain inside the single offline binary ([ADR 0019](0019-single-binary-ts-engine.md)).

The delivery shape is also an ownership decision. The map, guidance, and ledger are project-owned files, and `discern.toml` is shared. Making formatting an intrinsic gate step would let the engine overwrite them whenever the gate runs, outside the jobs table that defines the project's mutating work. Placement is consent to maintain the content ([ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md)); it is not consent to an undisclosed fixer. The format job already carries that consent and already has strand detection when it changes committed-clean files ([ADR 0047](0047-fix-stage-strand-detection.md)).

Generated map pages exposed a second fixed-point problem. Their renderers and `deno fmt` had disagreed before, so four pages were excluded from formatting. Once one canonical formatter owns the map, code generation must emit its fixed point rather than ask the next gate run to repair it.

## Decision

**`discern tidy` is a CLI-only engine verb that canonically formats the Markdown and TOML surfaces whose conventions discern owns. Fresh installs invoke it through the format job; it is not an intrinsic gate step.**

The verb follows the engine's plan/apply and result-envelope contracts ([ADR 0027](0027-plan-apply-engine-execution.md), [ADR 0028](0028-result-envelope-and-diagnostics.md)). Bare `discern tidy` selects both types; `discern tidy md` and `discern tidy toml` select one. `--dry-run` exposes the complete plan and writes nothing. The planner reads and formats every selected file before the executor writes any, so a parse failure aborts the whole run. Missing configured paths are successful no-ops, only changed files are written, and a settled tree is idempotent.

The scope is closed:

- Markdown includes `.md` files beneath `[map].dir`, the `[project].todo` file, and files matched by `[guidance].sources`. It excludes the fixed project brief, authored skills, generated agent files, and every other Markdown path. Fenced code is preserved byte-for-byte; no language plugin is loaded.
- TOML includes only the root `discern.toml`. Provider settings and any TOML belonging to the project's stack are outside the boundary.

The binary vendors two dprint WASM plugins and drives them with `@dprint/formatter` `0.5.1`: `dprint-plugin-markdown` `0.22.1` and `dprint-plugin-toml` `0.7.0`, all credited in the generated third-party notices. The shared settings are `indentWidth: 2`, `lineWidth: 80`, `newLineKind: "lf"`, and `useTabs: false`. Markdown additionally sets `textWrap: "never"`, preserving the unwrapped storage decision ([ADR 0150](0150-markdown-prose-is-stored-unwrapped.md)); TOML uses the pinned plugin's defaults beyond the shared settings. The WASMs are compile-time assets, loaded and instantiated only when formatting runs. Build and runtime stay offline.

The template seeds `format = "discern tidy"`. When setup finds a project formatter, its instructions keep that command first and `discern tidy` last. Removing the line is the opt-out; no config key or feature toggle shadows that choice. Before `[meta].bootstrapped` is recorded, doctor treats the missing invocation as a setup failure because the setup agent probably replaced the seed. Afterwards it reports a non-failing informational row and does not nag an owner who opted out.

Every engine path that writes `discern.toml` passes its final bytes through the embedded TOML formatter. The rule covers the setup scaffold and metadata, config edits, preset fills, upgrade reconciliation and migrations, standards pinning, and skill ejection. Code generation likewise passes every generated Markdown artifact through the embedded formatter at its single write chokepoint. The canonical-set guard now requires generated map pages to be tidy-canonical instead of excluded from `deno fmt` or separately proven compatible ([ADR 0176](0176-the-closed-sets-are-a-closed-set.md)).

Plugin upgrades are rare convention changes: pin changes are deliberate, release-noted, and followed by an owner-run whole-surface sweep committed separately. The project does not chase byte parity with a moving Deno release.

The earlier shorthand that discern “bundles none of your tools” is narrowed. discern still bundles no formatter, linter, test runner, or other command from the project's stack; it does bundle this formatter for its own Markdown and TOML conventions.

Explicit noes: no MCP tool; no formatter configuration; no stack sniffing; no diff-scoped mode; no formatting of skills, the project brief, fenced code, or non-root TOML; no call from `refresh`; and no separate sweep command.

## Consequences

- A fresh project with no Deno and no stack formatter still gets stable map, guidance, ledger, and config formatting through its ordinary gate.
- Programmatic config edits and generated map pages are canonical by construction. The next gate run no longer manufactures a follow-up formatting diff.
- The first opt-in run is a whole-surface sweep. It belongs in a mechanical commit; later runs touch only newly non-canonical files.
- The two WASMs increase the release binary by about 3 MiB. Status and unrelated verbs do not instantiate them; the cost is paid by formatting paths.
- A formatter plugin bug or convention change is now discern's responsibility. Pins and vendored assets trade automatic upstream movement for reproducible output and deliberate upgrades.
- The ownership boundary stays visible in config: removing or narrowing the job command changes what the gate formats without another policy surface.

## Alternatives considered

- **Invoke `deno fmt`.** Rejected because compiled installs have no Deno tooling command and many projects have no Deno at all.
- **Use or detect the project's formatter.** Rejected because many stacks have no Markdown or TOML formatter, detection would be policy, and different projects would no longer share one discern convention.
- **Run formatting as an intrinsic fix-stage step.** Rejected because it bypasses jobs-table consent and creates an ownership exception for project-owned files.
- **Require a formatter dependency in each project.** Rejected because it adds a runtime, network installation, and stack-specific configuration to a tool whose install is one offline binary.
- **Keep generated pages excluded.** Rejected because it preserves two conventions and leaves the next generated page to rediscover the rewrite loop.
