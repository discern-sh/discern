# ADR 0005: Declarative config — a comment-preserving editor, `discern config`, and `setup --config`

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`; the decision and reasoning are unchanged. **Current-state note.** `setup --config` is retired — `setup` redirects to `discern setup` ([ADR 0036](0036-unify-setup.md)). The comment-preserving `TomlEditor`, the `discern config` surface, and the published JSON Schema all still ship; the schema is now generated from one Zod definition ([ADR 0026](0026-typed-config-schema.md)), and the `set-slot`/`set-side-gate` verbs first became `set-capability`/`set-check`/`set-scope` ([ADR 0017](0017-capabilities-model.md)); [ADR 0168](0168-the-gate-declares-jobs.md) later unified `set-capability`/`set-check` as `set-job`, while `set-scope` remains. **Job-model vocabulary amendment ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use `config set-capability` / `config set-check` → `config set-job`; the decision and reasoning are unchanged.

**Status**: accepted; **amended by the 1.0 redesign** — see _Update (1.0)_ below.

## Update (1.0)

The original decision below shipped the `setup --config` shape as a type called `InitAnswersFile` — an internal answers struct that `add-adapter` then quietly reused for `adapter.json`. Once two surfaces consumed it, it was a published API in all but name.

1.0 makes that explicit: it is now the **discern config document** (`DiscernConfigDoc`, in `src/lib/config_doc.ts`), with a deliberately neutral name, an optional **`version`** (a document declaring a major this build doesn't understand is refused, not misread), an accepted **`$schema`** pointer, and a **published JSON Schema** at `schema/discern-config.schema.json` for editor validation. `setup --config` and `adapter.json` (ADR 0007) are its two consumers. The `standards` field also drops the pre-1.0 `coverage_min` number shorthand (ADR 0003): every standard is a table.

## Context

discern exists to be driven by other tools: a wrapping scaffolder runs `discern setup` and then layers its own stack-specific pieces on top. Today that layering means **hand-editing `discern.toml`** — there is no supported way to set slots, scopes, side-gates, or standards programmatically. Non-interactive `setup` takes discrete flags (`--name`, `--slug`, `--source-globs`, `--brief @file`, …) that cover only the `[project]` identity and the `web` scope; everything else a real project needs is left to the scaffolder to write into TOML itself.

So every scaffolder/CI re-implements TOML editing — and doing it naively breaks things. `discern.toml` is **heavily commented** (every slot carries a `# e.g.` hint; every section a paragraph of guidance). A parse→stringify round-trip through a normal TOML library **strips all of that**, degrading the file the kit worked hard to make legible. So the editing has to be _surgical_ (preserve comments and layout), which is exactly the fiddly bit a scaffolder shouldn't have to own.

## Decision

Provide declarative config as a first-class capability, in three layers.

### 1. A comment-preserving surgical TOML editor (`src/lib/toml_edit.ts`)

A small `TomlEditor` operates on the raw text as lines, never round-tripping through a TOML AST:

- `setLiteral("slots.test.run", '"vitest run"')` finds the `[slots.test]` section and the `run = …` line and replaces **only the value** (preserving the key, the `=` alignment, and every comment elsewhere). A dropped inline `# e.g.` hint on the replaced line is the only loss, which is correct once the slot is filled.
- A missing key in a named record table is inserted in the field order declared by that family's schema; other missing keys go immediately after their section header. A missing section is created beside the last existing member of its dotted family when one exists (`[scopes.assets]` lands next to `[scopes.docs]`, not scattered away from it — see [ADR 0021](0021-migrations-insert-documented-sections.md) for the sibling problem this complements). When it is the first live member of a schema-declared record family, it lands after that family's managed banner and examples, before the next config region. Only an unrelated section with neither kind of anchor falls back to EOF. Commented-out hint lines (`# native = …`) never match, so a real key is added alongside them.
- Typed helpers — `setString`, `setNumber`, `setBool`, `setStringArray` — render values via the existing TOML renderers and call `setLiteral`.

This editor is the one place TOML editing lives. It targets the documented `discern.toml` subset (the same shape `toml.awk` reads): `[section]` / `[section.sub]` headers and single-line `key = scalar|array` lines.

### 2. A `discern config` subcommand (edit an existing install)

```
discern config set-slot <name> --phase <phase> --run <cmd>
discern config set-scope <name> <glob>...
discern config set-side-gate <scope> --run <cmd>
discern config set-standard <name> --limit <n> [--metric <m>] [--direction up|down] [--slot <s>]
discern config set <dotted.key> <value> [--number | --bool | --string]
```

Each finds `discern.toml` in the cwd, applies the edit through `TomlEditor`, and writes it back — comments intact. Light validation matches `doctor`'s expectations (slot `--phase` ∈ the known phases; standard `--direction` ∈ `up`/`down`; `--limit` numeric; names are TOML-bare-key shaped). `set` infers the value type (numeric → number, `true`/`false` → bool, else string), overridable with `--number`/`--bool`/`--string`.

Every subcommand honours `--json` (emitting `{ok, file, dry_run, edits:[…]}`) and `--dry-run` (report the edits, write nothing) — parity with `setup`/`doctor`.

### 3. `setup --config <file>` (drive a fresh install declaratively)

`setup --config answers.json` (or `--config -` for stdin) reads a JSON answers file and scaffolds non-interactively. Base fields mirror the flags (`name`, `slug`, `branch_prefix`, `source_globs`, `brief`, `agents`); the value-add is `slots`, `scopes`, `side_gates`, and `standards`, which are applied to the **generated** `discern.toml` via `TomlEditor` _as part of building the plan_ — so `--dry-run` and `--json` show the final file and `apply` writes it, with no separate edit step. Explicit flags override file values; the file overrides defaults.

```json
{
  "name": "My App",
  "slug": "my-app",
  "source_globs": ["src/**"],
  "slots": { "test": { "phase": "test", "run": "vitest run" } },
  "scopes": { "native": ["native/**"] },
  "side_gates": { "native": "make -C native check" },
  "standards": {
    "coverage_min": 80,
    "bundle": { "direction": "down", "limit": 500000, "slot": "bundlesize" }
  }
}
```

## Consequences

- A scaffolder or CI can drive discern end-to-end without owning any TOML editing: `setup --config` for a fresh, fully-specified install; `discern config …` to adjust an existing one. This is the central win for the "consumed by another project" use case.
- `discern.toml` stays legible: programmatic edits preserve its comments and layout, put named tables beside the banner that explains them, and keep their fields in schema order, so a file a scaffolder touched still reads like the hand-written one.
- The editor targets the documented config subset, not arbitrary TOML. That's a deliberate bound — it matches what `toml.awk` reads, so the editor and the engine agree on the file shape. Multi-line arrays / inline tables are out of scope (the kit doesn't use them).
- Surgical editing can't reflow alignment when a value grows; the result is valid TOML but may not be column-aligned. Acceptable for machine-written values.
- More installer surface to maintain (one lib + one command + an init path), all additive — nothing changes for users who don't use it.

## Alternatives considered

- **Round-trip through `@std/toml`.** Rejected: it strips every comment, gutting the carefully-annotated `discern.toml`. Comment preservation is the whole point.
- **A full comment-preserving TOML AST library.** Overkill and a heavy dependency for the tiny, fixed subset the kit uses. A few-dozen-line surgical editor is proportionate and has no new dependency.
- **Only `setup --config`, no `config` subcommand (or vice-versa).** Rejected: the two serve different moments — `setup --config` specifies a fresh install, `config` adjusts an existing one (the more common scaffolder need over time). They share the editor, so shipping both is cheap.
- **A TOML answers-file instead of JSON.** Rejected: JSON is the unambiguous machine-interchange format, pairs with the existing `--json` surface, and is trivial for any scaffolder to emit. (Stdin via `-` covers piping.)
