# ADR 0039: discern ships its own docs to every install via `discern help`

**Status**: accepted

## Context

discern dogfoods itself: it compiles a project's agent-instruction files, runs
the quality gate, and exposes a `discern docs` command that browses **the host
project's own `docs/` tree** (resolved from the project root via
`findProjectRoot`). In _this_ repo that tree happens to be discern's own
documentation, so `discern docs` here surfaces discern's docs — and that
coincidence hid a real gap.

When a developer installs discern into _their own_ project (a Laravel app, say)
and they — or their coding agent — want to read **discern's** documentation (the
config reference before editing `discern.toml`, the concepts, the
gate/worktree/ratchet pages), there is no way to do it. `discern docs` reads
_their_ project's docs, not discern's. discern's own docs live only in the
GitHub repo and are never shipped to an install. The dogfooding masked the
absence completely.

The two needs are genuinely different trees with the same presentation: an
install must be able to browse discern's documentation regardless of which
project it was dropped into, and that must never resolve to the host project's
`docs/`. The existing docs code (`src/lib/docs.ts`, `src/commands/docs.ts`) was
already parameterized by a docs directory — the only real differences are the
directory-resolution strategy, the verb label, and whether the surface is
feature-gated.

A complication: discern's `docs/` tree contains internal subtrees that must not
reach customers — `_maintainer/` (positioning, marketing, maintainer notes),
`_internal/` (the documenter brief), and the verbose `_adr/` history. The view
already excludes every `_`-prefixed subtree by default, but a customer binary
should ideally not even _embed_ the marketing/internal material.

## Decision

Add **`discern help`** — the same
browse/read/`--list`/`--json`/`--raw`/`--export` experience as `discern docs`,
serving **discern's own bundled documentation**, available in every install.

- **One implementation, two verbs.** `docs` and `help` share every line of
  `src/commands/docs.ts` through a `DocsVerb` descriptor. Only three things
  vary: the directory to read, the verb label carried in results/messages, and
  the wording when the tree is missing. The interactive browser, renderer,
  target resolution, `--list`/`--json`/`--raw`, and export are reused verbatim.
  `helpResult()` mirrors `docsResult()` — the one shape a future `discern_help`
  MCP tool and the `--json` path both render (no MCP tool is registered yet).

- **Bundled, resolved module-relative.** `resolveBundledDocsDir()` is the twin
  of `resolveTemplatesDir()`: it finds discern's docs by walking up from the
  module, honouring a `DISCERN_DOCS_DIR` override (tests), so it works under
  `deno run` in a checkout and inside a `deno compile` binary. It NEVER resolves
  the host project's `docs/` — that is exclusively `discern docs`'s job. This is
  what closes the gap.

- **Curation is at the embed, with the view as a second line of defence.**
  `scripts/build.ts` stages only the PUBLIC docs subtrees into a transient
  `.discern-help-docs/docs/` (excluding every `_`-prefixed tree) and
  `--include`s that, so `_maintainer`/`_internal`/`_adr` are never embedded in a
  customer binary. The staged tree nests an inner `docs/` so embedded paths read
  `docs/…`, identical to a checkout. On top of that, `help` always discovers
  with `includeInternal: false`, so even the repo's full `docs/` (the checkout
  fallback) shows only the public tree.

- **Always available; no `--dir`.** `help` is registered UNCONDITIONALLY in
  `main.ts` (not gated on the `docs` feature) — it is discern's own help, useful
  even in a project that disabled the `docs` feature. The doc set is fixed and
  bundled, so there is no `--dir` override and `--export` is public-only. Cliffy
  does not reserve `help`, so `discern --help` / `-h` (usage) and
  `discern help
  [topic]` (the docs surface) coexist.

- **ADRs are out of scope for v1.** The public subtrees (`00-orientation` …
  `80-development`, including `10-installer/config-reference.md`) are what
  ships. The `_adr/` history is useful but verbose; it can be added later behind
  an opt-in if there is demand.

## Consequences

- **The gap is closed.** Any install can read discern's documentation —
  `discern help config-reference`, `discern help concepts` — without leaving the
  terminal, and an agent grounding work in `discern.toml` has the reference on
  hand. It is the same well-tested surface as `discern docs`, so it inherits the
  non-interactive `--json`/`--raw`/`--list` contract for free.

- **`docs` and `help` cannot drift.** They are one code path. A change to the
  browser, the renderer, or the result shape lands in both at once; the only
  per-verb surface is the small descriptor.

- **Binary growth is negligible.** The public docs are a handful of Markdown
  files — trivial next to the bundled SDK
  ([ADR 0038](0038-official-mcp-sdk.md)).

- **The build has a staging step.** `deno task build` now stages and embeds the
  public docs and removes the stage afterwards; the stage is gitignored so an
  interrupted build cannot dirty the tree or shadow the live `docs/` in a later
  `deno task dev help`.

- **MCP parity is structured but not wired.** `helpResult` is factored and
  MCP-ready; registering `discern_help` / `discern://help` is a separate
  tranche.

## Alternatives considered

- **Embed the whole `docs/` tree (`--include docs`) and rely only on the view to
  hide internals.** Simpler — no staging — and was the sanctioned fallback. But
  it embeds `_maintainer` positioning/marketing inside every customer binary,
  which we would rather not ship even if it is never surfaced. Staging keeps the
  embed itself clean; the view is then defence in depth, not the only guard.

- **Generate a separate help-docs artifact or fetch docs over the network.**
  Forfeits discern's "one self-contained binary, no network at runtime" property
  for no benefit over embedding a few Markdown files.

- **Overload `discern docs --dir` to point at discern's docs.** Requires the
  user to know where discern's docs are (they are inside the binary — nowhere on
  disk), and conflates "the project's docs" with "discern's docs" on one verb. A
  distinct verb makes the audience and the source unambiguous.
