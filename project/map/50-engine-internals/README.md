---
aliases:
  - engine internals
  - engine architecture
  - dispatcher
  - built-in verbs
---

# Engine internals

_The dispatcher and the TypeScript modules every built-in verb uses._

This subtree covers the shared substrate for the project's final quality check (the Gate), the worktree workflow, and shared guidance. [`dispatch.ts`](../../../src/engine/dispatch.ts) is the **dispatcher**: it finds the project root (the nearest ancestor with a `discern.toml`), routes a known `discern <verb>` to its built-in binary handler, and routes requests in the explicit Project Script namespace. The root-aware core in [`project_scripts.ts`](../../../src/engine/project_scripts.ts) discovers the executable files under a checkout's `[scripts].dir`. `discern scripts <name>` executes one with its argument tail and the `DISCERN_*` environment. The Desk uses the same core for a selected worktree.

A word outside the closed root vocabulary reports `unknown command "<word>"` and gives the next action. The dispatcher checks the cross-tool synonym table in [`shared/vocabulary.ts`](../../../src/shared/vocabulary.ts) first: "init" and "install" name `setup`, "check" names `prepare`, "sync" names `update`, and "land" and "merge" name `accept`. Under [ADR 0120](../_adr/0120-launch-verb-canon.md)'s forgiveness policy, the table supplies suggestions while dispatch remains on the canonical names. The near-match suggester then checks built-ins and namespaced project script names. Every refusal points to `discern docs` for the manual and `discern --help` for the command list. Under `--json`, the refusal uses the uniform result envelope with error `unknown_command` and puts the actions in `hints`. The refusal still renders outside a project or with an unreadable config, where a newcomer's first guess often lands.

`KNOWN_VERBS`, defined in [`shared/verbs.ts`](../../../src/shared/verbs.ts), is the set of installer and engine names. It drives routing, grammatical normalization, help coverage, Logbook begin-event enrollment, and the test that proves every built-in name remains legal inside the Project Script namespace. Every subsystem's verbs are registered because dispatch has no toggle layer ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A verb can stay out of the help listing and continue dispatching, as `preset` does while no presets ship and `setup` does once bootstrapped. The router in [`main.ts`](../../../src/main.ts) resolves the verb as the first token outside the global flags. This gives `discern --json <verb>` and `discern <verb> --json` the same route, including the pre-setup redirect ([ADR 0036](../_adr/0036-unify-setup.md)), welcome/help split, and Project Script dispatch. The root help renders in full and exits 0 with a broken, missing, or schema-invalid `discern.toml`, preserving the recovery route when config cannot load.

The stack-neutral logic behind the built-in verbs (the Engine) is TypeScript compiled into the binary under [`src/engine/`](../../../src/engine/). It shares [`src/shared/`](../../../src/shared/) with the installer verbs. A project needs neither Deno nor Node to run discern. Directories group the built-in handlers by area: the Gate and job runner ([`gate/`](../../../src/engine/gate/), [`jobs/`](../../../src/engine/jobs/)), scope classification ([`scopes/`](../../../src/engine/scopes/)), worktree lifecycle and identity ([`worktree/`](../../../src/engine/worktree/)), and the guidance compiler ([`guidelines.ts`](../../../src/engine/guidelines.ts)). The compiler assembles discern's built-in guidance with the project's sources and materializes the Skills. Shared concerns live under [`src/shared/`](../../../src/shared/): config reading, the [paths registry](../../../src/shared/paths_registry.ts), known-job and stage constants, the Portable Operating System Interface (POSIX) `cksum` port, and root discovery with `DISCERN_*`.

The command-line interface (CLI) entry point resolves color once from the inputs named by the `--no-color` help text: the flag, the `NO_COLOR` environment variable, and whether standard output is a terminal (TTY). That decision reaches every color-emitting output path: the engine verbs' `colorEnabled()`, the installer and engine `Logger`s, and the grouped root help. With `--no-color`, `NO_COLOR`, or a non-TTY pipe, every path produces zero American National Standards Institute (ANSI) escape bytes. This includes Cliffy's own `getHelp()`. The help post-processor strips its escapes when color is disabled because that generator consults only `Deno.noColor`.

Terminal art has 2 pure, registry-backed families: variants of the canonical text mark and reusable treatments built from discern's 4 half-filled triangles. The triangle vocabulary derives its weave and spinner orders once, then exposes frames for patterns, progress, section rules, workflow steps, and activity beacons. Each registered member supplies a static renderer and an ANSI-free animation timeline whose final frame equals that static output. The generic playback boundary validates every scene and terminal size before it emits cursor controls. It reserves a new output row, redraws sequentially without hiding the cursor, and finishes on the unchanged static gallery. Before each cursor-up redraw, playback rechecks the live dimensions. If a resize no longer fits, playback stops redrawing and emits the static frame below the live output. Motion is opt-in, and non-TTY or constrained terminals stay static. The fresh setup welcome uses the split variant only on its styled TTY path. Pipes, `--no-color`, JSON, errors, and help keep their plain output. No parser or state cue depends on the drawing ([ADR 0149](../_adr/0149-the-mark-is-the-unicode-glyph.md), [ADR 0088](../_adr/0088-fresh-setup-welcome-decorates-only-on-tty.md)).

| Concern                             | Authority                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, Unicode mark, and text lockup | [`brand.ts`](../../../src/shared/brand.ts)                                                                                                                                                  |
| Variant registry and static renders | [`brand_art.ts`](../../../src/shared/brand_art.ts)                                                                                                                                          |
| Triangle vocabulary and frame APIs  | [`triangle_art.ts`](../../../src/lib/triangle_art.ts)                                                                                                                                       |
| Pure animation timelines            | [`brand_animation.ts`](../../../src/shared/brand_animation.ts)                                                                                                                              |
| Generic terminal playback           | [`terminal_playback.ts`](../../../src/lib/terminal_playback.ts)                                                                                                                             |
| Styled first-contact composition    | [`setup_welcome.ts`](../../../src/commands/setup_welcome.ts)                                                                                                                                |
| Maintainer gallery task             | [`art.ts`](../../../scripts/art.ts), [`deno.json`](../../../deno.json)                                                                                                                      |
| Static and motion contracts         | [`brand_art_test.ts`](../../../tests/brand_art_test.ts), [`brand_animation_test.ts`](../../../tests/brand_animation_test.ts), [`triangle_art_test.ts`](../../../tests/triangle_art_test.ts) |
| Playback and gallery contracts      | [`terminal_playback_test.ts`](../../../tests/terminal_playback_test.ts), [`art_gallery_test.ts`](../../../tests/art_gallery_test.ts)                                                        |
| Styled-welcome contract             | [`engine_setup_welcome_test.ts`](../../../tests/engine_setup_welcome_test.ts)                                                                                                               |

[`scopes/glob.ts`](../../../src/engine/scopes/glob.ts) matches scope globs in memory, so a glob in a config value does not expand against the filesystem the way an unquoted shell glob would. A Project Script is an executable with normal shell globbing. Built-in verbs are the normal consumers of this internal boundary.

Every **effectful** verb follows a **plan/apply** shape ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)). It computes a pure, read-only plan by loading config, classifying changed scopes, and reading the resource ledger. A thin executor then applies the plan. This split gives `done`, `accept`, `worktree` setup/teardown/prune, and `standards` a `--dry-run` that renders the plan without touching anything. Their `--json` form serializes the `DiscernResult` returned by every verb instead of deriving it again ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

The plan vocabulary, diagnostic, envelope, and shared plan-to-human/JSON renderer live in [`shared/result.ts`](../../../src/shared/result.ts), the base layer both halves import. The `Out` and `Logger` sink adapters sit beside the writers they bridge, generalizing the installer's [`fs_plan.ts`](../../../src/lib/fs_plan.ts) and [`plan_view.ts`](../../../src/lib/plan_view.ts). Pure functions hold the decision logic each verb plans from, including Gate job derivation, scope-gate selection, and the prune garbage-collection reclaim decision. Unit tests exercise those functions without a subprocess.

discern omits this contributor-only tree from the bundled `discern docs` manual. Read it in the source checkout or on GitHub.

## In this section

- [config-access.md](config-access.md) — reading `discern.toml` via the typed schema, the paths registry and resolvers, and the `discern config` surface.
- [migrations.md](migrations.md) — the schema-1 baseline, migration contract, and runner coverage for the first public transition.
- [the-document-model.md](the-document-model.md) — the validated model behind every docs surface: discovery, the strict frontmatter schema, the `isPublicDoc` predicate, citation stripping, and the redirect registry.
- [the-logbook.md](the-logbook.md) — the local, metadata-only record of discern's own verb runs: schema, storage, config epochs, and the recording points.
- [the-result-envelope.md](the-result-envelope.md) — the shared result vocabulary, strict Zod schemas, generated consumer contracts, and Model Context Protocol (MCP) adapters.
- [the-templating-engine.md](the-templating-engine.md) — the strict config-only renderer for bundled guidance and bundled Skill Markdown.
- [experimental-behaviors.md](experimental-behaviors.md) — environment-only trials, their registry, activation rule, and current provider projections.

## See also

- [system-map.md](../00-orientation/system-map.md) — the run-time dispatch axis.
- [ADR 0019](../_adr/0019-single-binary-ts-engine.md) — collapsing into one binary with a TypeScript-native engine.
- [ADR 0027](../_adr/0027-plan-apply-engine-execution.md) — plan/apply as the engine's execution model (the `--dry-run` / serialized-`--json` seam).
