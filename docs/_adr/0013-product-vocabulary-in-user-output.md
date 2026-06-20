# ADR 0013: User-facing output speaks the product's command vocabulary

**Status**: accepted; **retired by [ADR 0019](0019-single-binary-ts-engine.md)**
— see _Update (single-binary cutover)_ below.

## Update (single-binary cutover)

The single-binary cutover ([ADR 0019](0019-single-binary-ts-engine.md)) deletes
the committed shell engine, so there is no `selfsync`/`selfcheck` and no second
copy to keep in sync. The dual-audience command-name problem this ADR solved
evaporates; `selfCmd` and its gate guard are deleted.

## Context

icculus is self-hosted (ADR 0010): the same `upgrade` logic that refreshes an
external install also keeps this repo's managed files in sync with `templates/`.
The repo drives it through Deno tasks — `deno task selfsync` (≡
`icculus
upgrade`) and `deno task selfcheck` (≡ `icculus upgrade --check`) —
wired as a gate slot in `icculus.toml`. Those task names are an engine-developer
convenience; they exist only in this repo's `deno.json`.

The two audiences run the **same** `runUpgrade` code path: an engine dev via
`deno task selfcheck`, an end user via the compiled `icculus upgrade --check`.
So a remediation hint hardcoded for one audience leaks to the other. It did: the
drift message read `` Heal it: run `deno task selfsync` `` in every external
project — pointing users at a task that does not exist there (and a tool,
`deno`, they may not have). The inverse hardcoding is no better:
`icculus
upgrade` is a footgun in this repo, because the compiled binary carries
a frozen `templates/` snapshot and would heal against the wrong source
(AGENTS.md forbids running `dist/` while developing). The right command
genuinely differs by context, and nothing made that choice once or kept it
honest.

This is the sibling of ADR 0012's refinement: there, engine-internal shell
_policy_ leaked downstream through a shared file; here, engine-internal command
_vocabulary_ leaks downstream through shared output.

## Decision

User-facing output names commands in the vocabulary of the context it runs in,
decided in one place and enforced by the gate.

- **One renderer.** `src/lib/invocation.ts` exposes `selfCmd("sync" | "check")`
  and is the _only_ source file allowed to contain the strings `selfsync` /
  `selfcheck`. Commands render self-references through it; they never hardcode a
  command name.
- **Ground-truth marker.** `selfCmd` returns the Deno-task form when (and only
  when) the project's `deno.json` declares a `selfsync` task — i.e. the command
  it prints actually exists where the user stands. Everything else gets the
  product form (`icculus upgrade`). A missing/unreadable/malformed `deno.json`
  fails safe to the product form.
- **Enforced, not remembered.** `tests/dev_vocab_guard_test.ts` fails the gate
  if `selfsync`/`selfcheck` appear under `src/` outside the renderer, or if
  `deno task`/`selfsync`/`selfcheck` appear anywhere under shipped `templates/`.

Explicit *no*s:

- **Not** detection via `Deno.execPath()` (compiled binary vs `deno run`). It
  breaks under `deno test`, and it answers the wrong question — a source
  checkout upgrading someone else's external project must still say
  `icculus
  upgrade`. The honest signal is "does this command exist here," not
  "how was I launched."
- **Not** "always print `icculus upgrade`." Simplest, but reintroduces the repo
  footgun above.
- **Not** a documentation-only house rule. That is the discipline ADR 0012
  already rejected: it relies on every future author remembering an invisible
  convention.

## Consequences

- The leak class is structurally closed. A future command that hardcodes a
  self-host command turns `agent finish` red with a message naming `selfCmd()` —
  the author does not need to know the convention in advance; the gate teaches
  it on violation. That is the property the bespoke fix lacked.
- Mild action-at-a-distance: the alias strings live in the renderer, not at the
  call site, and composing a drift hint now reads one `deno.json`. The same
  trade ADR 0012 accepted for its sourced shell policy.
- `selfCmd` models exactly the one command pair that carries a self-host alias
  (`sync`/`check`). A new dual-vocabulary command extends the `SelfVerb` union
  in the renderer rather than re-deriving the fork — keeping the decision in one
  place by construction.
- The guard targets the _known_ dev-only tokens, not arbitrary wrong commands.
  That is a deliberate scope: it is a deterministic static check with near-zero
  false positives, not a general "is this command right here" oracle.
