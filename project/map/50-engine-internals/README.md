---
aliases:
  - engine internals
  - engine architecture
  - dispatcher
  - built-in verbs
---

# Engine internals

_The dispatcher and the TypeScript modules every built-in verb is built on._

This subtree covers the shared substrate under the gate, the Worktree workflow, and guidance. [`dispatch.ts`](../../../src/engine/dispatch.ts) is the **dispatcher**: it finds the project root (the nearest ancestor with a `discern.toml`), routes a known `discern <verb>` to its built-in in-binary handler, and routes the explicit Project Script namespace. The root-aware core in [`project_scripts.ts`](../../../src/engine/project_scripts.ts) discovers the executable files under a checkout's `[scripts].dir`. `discern scripts <name>` executes one with its argument tail and the `DISCERN_*` environment, while the desk uses the same core against a selected worktree.

A word outside the closed root vocabulary reports `unknown command "<word>"` and teaches the next step. The dispatcher checks the cross-tool synonym table in [`shared/vocabulary.ts`](../../../src/shared/vocabulary.ts) first: "init" and "install" name `setup`, "check" names `prepare`, "sync" names `update`, and "land" and "merge" name `accept`. These are suggestions rather than dispatched aliases, under [ADR 0120](../_adr/0120-launch-verb-canon.md)'s forgiveness policy. The near-match suggester then checks built-ins and namespaced project script names. Every refusal points to `discern docs` for the manual and `discern --help` for the command list. Under `--json`, the refusal uses the uniform result envelope with error `unknown_command` and the advice in `hints`. It renders even outside a project or with an unreadable config, where a newcomer's first guess most often lands.

`KNOWN_VERBS`, defined in [`shared/verbs.ts`](../../../src/shared/verbs.ts), is the set of installer and engine names. It drives routing, grammatical normalization, help coverage, logbook begin-event enrollment, and the test that proves every built-in name remains legal inside the project script namespace. Every subsystem's verbs are registered because dispatch has no toggle layer ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A verb can be _hidden_ from the help listing yet keep dispatching, as `preset` is while no presets ship and `setup` is once bootstrapped. The router in [`main.ts`](../../../src/main.ts) resolves the verb as the first token that is not a global flag. This gives `discern --json <verb>` and `discern <verb> --json` the same route, including the pre-setup redirect ([ADR 0036](../_adr/0036-unify-setup.md)), welcome/help split, and Project Script dispatch. The root help renders in full and exits 0 even with a broken, missing, or schema-invalid `discern.toml`. Help matters most when the config is broken.

The Engine is **TypeScript compiled into the binary** under [`src/engine/`](../../../src/engine/) and shares [`src/shared/`](../../../src/shared/) with the Installer. No Deno or Node is installed into a project, which lets discern drop into any project. The built-in handlers are organized by area: the gate and job runner ([`gate/`](../../../src/engine/gate/), [`jobs/`](../../../src/engine/jobs/)), scope classification ([`scopes/`](../../../src/engine/scopes/)), worktree lifecycle and identity ([`worktree/`](../../../src/engine/worktree/)), and the guidance compiler ([`guidelines.ts`](../../../src/engine/guidelines.ts)). The compiler assembles discern's built-in guidance plus the project's sources and materializes the skills. Shared concerns live under [`src/shared/`](../../../src/shared/): config reading, the [paths registry](../../../src/shared/paths_registry.ts), known-job and stage constants, the POSIX-`cksum` port, and root discovery with `DISCERN_*`.

Color is resolved **once** at the CLI entry point from the inputs promised by the `--no-color` help text: the flag, the `NO_COLOR` environment variable, and whether stdout is a TTY. That decision reaches every color-emitting output path: the engine verbs' `colorEnabled()`, the installer and engine `Logger`s, and the grouped root help. No output path re-decides, so `--no-color`, `NO_COLOR`, and a non-TTY pipe all produce zero ANSI bytes. This includes Cliffy's own `getHelp()`; the help post-processor strips its escapes when the resolved decision is "no color" because that generator consults only `Deno.noColor`.

Terminal art is a decorative projection of the canonical text mark. Its pure renderers return ANSI-free strings without a trailing newline; the caller owns color, placement, and the terminal check. The fresh setup welcome uses the split variant only on its styled TTY path. Pipes, `--no-color`, JSON, errors, and help keep their plain output, and no parser or state cue depends on the drawing ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md), [ADR 0088](../_adr/0088-fresh-setup-welcome-decorates-only-on-tty.md)).

| Concern                             | Authority                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Name, Unicode mark, and text lockup | [`brand.ts`](../../../src/shared/brand.ts)                                                                           |
| Pure terminal-art renderers         | [`brand_art.ts`](../../../src/shared/brand_art.ts)                                                                   |
| Styled first-contact composition    | [`setup_welcome.ts`](../../../src/commands/setup_welcome.ts)                                                         |
| Maintainer gallery task             | [`art.ts`](../../../scripts/art.ts), [`deno.json`](../../../deno.json)                                               |
| Exact designs and shared contract   | [`brand_art_test.ts`](../../../tests/brand_art_test.ts), [`art_gallery_test.ts`](../../../tests/art_gallery_test.ts) |
| Styled-welcome contract             | [`engine_setup_welcome_test.ts`](../../../tests/engine_setup_welcome_test.ts)                                        |

Scope globs are matched in-memory by [`scopes/glob.ts`](../../../src/engine/scopes/glob.ts), so a glob in a config value does not expand against the filesystem the way an unquoted shell glob would. A project script is an executable with normal shell globbing. This is internal plumbing: the built-in verbs run it, and you rarely read it directly.

Every **effectful** verb follows a **plan/apply** shape ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)). It computes a pure, read-only plan by loading config, classifying changed scopes, and reading the resource ledger. A thin executor then applies the plan. This split gives `done`, `accept`, `worktree` setup/teardown/prune, and `standards` a `--dry-run` that renders the plan without touching anything. Their `--json` form serializes the `DiscernResult` returned by every verb instead of deriving it again ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

The plan vocabulary, diagnostic, envelope, and shared plan-to-human/JSON renderer live in [`shared/result.ts`](../../../src/shared/result.ts), the base layer both halves import. The `Out` and `Logger` sink adapters sit beside the writers they bridge, generalizing the installer's [`fs_plan.ts`](../../../src/lib/fs_plan.ts) and [`plan_view.ts`](../../../src/lib/plan_view.ts). The decision logic each verb plans from, including gate job derivation, scope-gate selection, and the prune-GC reclaim decision, is factored into pure functions and unit-tested without a subprocess.

This tree contains internals for people working on discern, so it is not bundled into `discern docs`. Read it here or on GitHub.

## In this section

- [config-access.md](config-access.md) — reading `discern.toml` via the typed schema, the paths registry and resolvers, and the `discern config` surface.
- [migrations.md](migrations.md) — the schema-1 baseline, migration contract, and runner coverage for the first public transition.
- [the-document-model.md](the-document-model.md) — the validated model behind every docs surface: discovery, the strict frontmatter schema, the `isPublicDoc` predicate, citation stripping, and the redirect registry.
- [the-logbook.md](the-logbook.md) — the local, metadata-only record of discern's own verb runs: schema, storage, config epochs, and the recording points.
- [the-result-envelope.md](the-result-envelope.md) — the shared result vocabulary, strict Zod schemas, generated consumer contracts, and MCP adapters.
- [the-templating-engine.md](the-templating-engine.md) — the strict config-only renderer for bundled guidance and bundled-skill Markdown.
- [experimental-behaviors.md](experimental-behaviors.md) — environment-only trials, their registry, activation rule, and current provider projections.

## See also

- [system-map.md](../00-orientation/system-map.md) — the run-time dispatch axis.
- [ADR 0019](../_adr/0019-single-binary-ts-engine.md) — collapsing into one binary with a TypeScript-native engine.
- [ADR 0027](../_adr/0027-plan-apply-engine-execution.md) — plan/apply as the engine's execution model (the `--dry-run` / serialized-`--json` seam).
