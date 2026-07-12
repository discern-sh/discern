# ADR 0066: `discern --help` groups commands by post-processing Cliffy's help

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `finish` → `done`, `graduate` → `accept`, `integrate` → `update`;
> the decision and reasoning are unchanged.

**Status**: accepted. Restructures the root `--help` from a flat,
registration-ordered command dump into named, ordered groups read from a
`COMMAND_GROUPS` map ([`src/cli_help.ts`](../../src/cli_help.ts)), applied by
rewriting Cliffy's rendered help rather than by a framework grouping primitive,
and pinned by a forcing-function guard in the spirit of
[ADR 0051](0051-canonical-set-parity.md).

## Context

In an already-installed project `discern --help` lists ~22 top-level verbs in
one flat block, in command-registration order. That order is installer-first
(`upgrade`/`doctor` and the doc browsers register before the engine verbs), so
the verbs a person touches every loop — `status`, `prepare`, `done` — scatter
below the ones they touch monthly, and the headline pitched _scaffolding_
(`setup`) even though `setup` is hidden once the project is bootstrapped. The
list reads as a dump, not an operator's map.

The obvious fix — group the commands under headings — runs into the framework.
discern's CLI is Cliffy, and Cliffy (1.2.x) does not group **commands**:

- **`.group(name)` groups OPTIONS, not commands.** Its documented effect is "all
  _options_ added after `.group()` are grouped in the help output"; it sets a
  builder field consumed only by the options renderer. Calling it before a batch
  of `.command()`s compiles and runs, but changes nothing in the command list.
- **The default `HelpGenerator` renders commands flat** under one `Commands:`
  label, in `getCommands()` order, and it is **not exported** from
  `@cliffy/command` — its constructor is private and it lives in an internal
  `_`-prefixed module. It cannot be extended to teach it command groups, and
  importing the internal module directly would be a version-pinned reach into a
  private file, against this repo's `no-external-import` rule.
- **Registration spans two files** — installer verbs in
  [`src/main.ts`](../../src/main.ts), engine verbs in
  [`src/engine/dispatch.ts`](../../src/engine/dispatch.ts) via
  `attachEngineCommands` — so even a registration-order trick would entangle the
  two and still produce no headings.

A decision was needed: how to get grouped, operator-first command help out of a
framework whose help model has no notion of command groups.

## Decision

**Let Cliffy render its canonical help, then post-process the string to rewrite
just the command list into named groups.** The grouping lives in a
`COMMAND_GROUPS` map (the SSOT); `operatorHelp(root)` calls the framework's own
`getHelp()` (no custom handler is installed, so there is no recursion), locates
the flat `Commands:` block, and replaces it with sub-sections rendered from the
map and the _live_ command objects (`getName()` + `getShortDescription()`), then
appends a "`discern <command> --help` for detail" footer.

The explicit *no*s:

- **Not `.group()`.** Wrong granularity — it groups options. Using it for
  commands would be a silent no-op.
- **Not a custom `HelpHandler` over the internal generator.** Reaching into
  Cliffy's internal `_help_generator.ts` (or reimplementing it) would couple us
  to a private, versioned surface and risk the root help drifting stylistically
  from every subcommand's `--help`.
- **Not a registration reorder.** It cannot produce headings, and it would force
  the two registration sites to coordinate ordering.
- **The header/options/examples stay 100% Cliffy.** We only touch the command
  list. The usage shape (`.usage("<command> [options]")`), the golden-path
  example (`.example()`), and the description are set through Cliffy's
  first-class APIs; the redundant `Version:` header row is dropped in the same
  post-process (`--version` still reports it).

The post-processor leans on two stable facts about the rendered help, both
documented at the call site: the section headings are column-0 lines carrying
`Commands:` / `Examples:`, and an example is always registered (so `Examples:`
reliably bounds the command block). A visible command with no group still
renders, under a defensive `Other` heading, so a missing assignment is loud
rather than vanished.

## Consequences

- **The help reads as an operator's map.** The agentic-loop verbs lead; the
  worktree lifecycle reads start → update → accept; setup/maintenance and
  inspect/explore sink. A first-time reader sees the 3–4 commands that matter
  without parsing all 22, and the group notes signal that the loop and worktree
  verbs are the agent's to run, not the human's.
- **No stylistic drift.** Because the surrounding help is the framework's own
  output untouched, the root help's header, options, and examples stay
  byte-identical to every subcommand's `--help`. Only the command block is ours.
- **The grouping cannot silently rot.** `COMMAND_GROUPS` is a hand-maintained
  satellite of the command registry, so a forcing-function test
  ([`tests/engine_help_groups_test.ts`](../../tests/engine_help_groups_test.ts))
  asserts the visible top-level commands are EXACTLY the grouped set — a new
  verb with no home, or a stale entry, fails the gate.
- **We own a thin coupling to Cliffy's rendered output.** The splice depends on
  the `Commands:`/`Examples:` labels and the always-present example. A future
  Cliffy that renamed those labels would break the splice — caught by the guard
  test, which renders `operatorHelp` and checks the headings — and the fallback
  is graceful (no `Commands:` line ⇒ the help passes through unchanged).
- **If Cliffy gains native command groups, revisit.** This post-processor is the
  smallest honest path _today_; first-class command grouping in the framework
  would let us delete it and keep `COMMAND_GROUPS` as the data.
