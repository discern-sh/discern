# ADR 0039: discern ships its own docs to every install via `discern help`

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md)):** at that point, pointers used `standards` (formerly `ratchets`) and `map` where `docs` named the command, config, or tree; the decision and reasoning still apply.
> - **[ADR 0142](0142-customer-binaries-carry-only-public-docs.md) — public-only binaries:** customer binaries carry the public manual without `_adr/`; source checkouts retain a local `--adr` mode, and installed binaries point readers to the public decisions archive and repository.
> - **[ADR 0218](0218-docs-owns-the-manual-help-owns-cli-reference.md) — command names:** the bundled manual now lives at `discern docs`, `discern_docs`, and `discern://docs`, while `help` gives CLI reference; the one bundled tree and shared browser decision stand.

**Status**: accepted

## Context

discern dogfoods itself: it compiles a project's agent-instruction files, runs the quality gate, and exposes a `discern map` command that browses **the host project's own `map/` tree** (resolved from the project root via `findProjectRoot`). In _this_ repo that tree happens to be discern's own documentation, so `discern map` here surfaces discern's docs — and that coincidence hid a real gap.

When a developer installs discern into _their own_ project (a Laravel app, say) and they — or their coding agent — want to read **discern's** documentation (the config reference before editing `discern.toml`, the concepts, the gate/worktree/standard pages), there is no way to do it. `discern map` reads _their_ project's docs, not discern's. discern's own docs live only in the GitHub repo and are never shipped to an install. The dogfooding masked the absence completely.

The two needs are genuinely different trees with the same presentation: an install must be able to browse discern's documentation regardless of which project it was dropped into, and that must never resolve to the host project's `map/`. The existing map code (`src/lib/docs.ts`, `src/commands/docs.ts`) was already parameterized by a docs directory — the only real differences are the directory-resolution strategy, the verb label, and whether the surface is feature-gated.

A complication: discern's `map/` tree contains internal subtrees that must not reach customers — the maintainer's positioning, marketing, and research notes, `_internal/` (the documenter brief), and the verbose `_adr/` history. The view already excludes every `_`-prefixed subtree by default, but a customer binary should ideally not even _embed_ the marketing/internal material.

## Decision

Add **`discern help`** — the same browse/read/`--list`/`--json`/`--raw`/`--export` experience as `discern map`, serving **discern's own bundled documentation**, available in every install.

- **One implementation, two verbs.** `map` and `help` share every line of `src/commands/docs.ts` through a `DocsVerb` descriptor. Only three things vary: the directory to read, the verb label carried in results/messages, and the wording when the tree is missing. The interactive browser, renderer, target resolution, `--list`/`--json`/`--raw`, and export are reused verbatim. `helpResult()` mirrors `mapResult()` — the one shape the `--json` path and the `discern_help` MCP tool both render.

- **Bundled, resolved module-relative.** `resolveBundledDocsDir()` is the twin of `resolveTemplatesDir()`: it finds discern's docs by walking up from the module, honouring a `DISCERN_DOCS_DIR` override (tests), so it works under `deno run` in a checkout and inside a `deno compile` binary. It NEVER resolves the host project's `map/` — that is exclusively `discern map`'s job. This is what closes the gap.

- **Curation is at the embed, with the view as a second line of defence.** `scripts/build.ts` stages the public docs subtrees (plus the opt-in ADR allowlist — see below) into a transient `.discern-help-docs/docs/` and `--include`s that, so `_internal` and the private maintainer tree are never embedded in a customer binary. The staged tree nests an inner `docs/` for the binary's internal bundle shape. On top of that, `help` discovers with `includeInternal: false` by default, so even the repo's full `map/` (the checkout fallback) shows only the public tree unless `--adr` opts in.

- **Always available; no `--dir`.** `help` is registered UNCONDITIONALLY in `main.ts` (not gated on the `map` feature) — it is discern's own help, useful even in a project that disabled the `map` feature. The doc set is fixed and bundled, so there is no `--dir` override and `--export` is public-only. Cliffy does not reserve `help`, so `discern --help` / `-h` (usage) and `discern help
  [topic]` (the docs surface) coexist.

- **`help` is the pre-setup documentation surface; `map` is gated.** The pre-setup redirect (ADR 0036) originally exempted `map`. With `help` now serving discern's own documentation, that exemption moves: `map` joins the gated set — its tree is the project's own, empty until setup fills it, so browsing it pre-setup shows nothing useful — while `help` stays open, because consulting discern's docs (the config reference, the concepts) is exactly what an agent does _while_ setting a project up. The gated-verb set lives once in `shared/setup_state.ts` and is applied identically by the CLI router and the MCP server, so the two surfaces never disagree on what is reachable pre-setup. The matching MCP tool `discern_help` mirrors `discern_map` and is likewise ungated.

- **The ADRs ship behind an opt-in flag.** The public subtrees (`00-orientation` … `80-development`, including `10-installer/config-reference.md`) are the default surface. The `_adr/` history is useful but verbose, so it is hidden by default and revealed only by `discern help --adr` — a nod to the project dogfooding itself, for the genuinely curious. It is **CLI-only**: the MCP `discern_help` tool never exposes it (an agent gets the curated public set). The build embeds the ADRs too (the `--adr` view needs them), but `_internal` and the private maintainer tree are never embedded. The set of internal subtrees that ship-and-are-revealable lives once in `BUNDLED_INTERNAL_DOC_DIRS` (`paths.ts`), behind the `isBundledDocEntry` predicate the build and a guard test (`tests/docs_curation_test.ts`) share, and is **default-deny**: the build stages public docs plus exactly that allowlist, and `--adr` reveals exactly that allowlist, so a new private subtree stays private until it is added on purpose.

## Consequences

- **The gap is closed.** Any install can read discern's documentation — `discern help config-reference`, `discern help concepts` — without leaving the terminal, and an agent grounding work in `discern.toml` has the reference on hand. It is the same well-tested surface as `discern map`, so it inherits the non-interactive `--json`/`--raw`/`--list` contract at no extra cost.

- **`map` and `help` cannot drift.** They are one code path. A change to the browser, the renderer, or the result shape lands in both at once; the only per-verb surface is the small descriptor.

- **Binary growth is negligible.** The public docs are a handful of Markdown files — trivial next to the bundled SDK ([ADR 0038](0038-official-mcp-sdk.md)).

- **The build has a staging step.** `deno task build` now stages and embeds the public docs and removes the stage afterwards; the stage is gitignored so an interrupted build cannot dirty the tree or shadow the live `map/` in a later `deno task dev help`.

- **MCP parity is automatic.** Because `helpResult` is the same result core, the `discern_help` MCP tool is a thin adapter mirroring `discern_map` — it serves the public set only (no `--adr`) and is ungated, exactly like the CLI.

## Alternatives considered

- **Embed the whole `map/` tree (`--include map`) and rely only on the view to hide internals.** Simpler — no staging — and was the sanctioned fallback. But it embeds private positioning and marketing material inside every customer binary, which we would rather not ship even if it is never surfaced. Staging keeps the embed itself clean; the view is then defence in depth, not the only guard.

- **Generate a separate help-docs artifact or fetch docs over the network.** Forfeits discern's "one self-contained binary, no network at runtime" property for no benefit over embedding a few Markdown files.

- **Overload `discern map --dir` to point at discern's docs.** Requires the user to know where discern's docs are (they are inside the binary — nowhere on disk), and conflates "the project's docs" with "discern's docs" on one verb. A distinct verb makes the audience and the source unambiguous.
