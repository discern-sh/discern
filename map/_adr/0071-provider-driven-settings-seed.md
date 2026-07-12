# ADR 0071: The settings seed/merge seam is provider-driven, not a Claude special-case

**Status**: accepted; extends [ADR 0031](0031-typed-provider-integration.md)
(the provider registry as the single source for agent-specific behaviour) and
[ADR 0040](0040-worktree-hooks-in-the-binary.md) (the worktree-hook surface)

## Context

discern seeds one agent's settings file — `.claude/settings.json` — by
deep-merging a bundled template into whatever the project already has (the
user's keys are never clobbered; ADR 0031's hook-stripping rides on the same
file). That seed/merge path was hardcoded to Claude in three places:

- `template.ts`'s `isSettingsTemplate` matched the literal
  `.claude/settings.json.tmpl`;
- `fs_plan.ts`'s `planSettingsMerge` hardcoded the target
  `.claude/settings.json`;
- the merge itself (`settings_merge.ts`) assumed JSON.

The next five agents change two of those assumptions. Four (Gemini, Cursor,
Copilot, Antigravity) keep settings/hooks in their own JSON file at their own
path (`.gemini/settings.json`, `.cursor/…`, …); Codex keeps them in **TOML**. So
"settings live in JSON at `.claude/settings.json`" is Claude's fact, not a
universal one — and a later plan that wires any of those agents would have to
re-touch the core seed/merge plumbing, or copy-paste it.

## Decision

**The scaffolder routes settings templates by the registry, and the merge
strategy is per-provider — so a new hooks provider seeds purely from its
registry declaration plus a dropped template.**

- `HooksIntegration` gains `mergeSeed?: SettingsSeedMerge` — a **text-level**
  strategy `(existingText | undefined, incomingText) => string`. Text-level, not
  JSON-object-level, so a non-JSON settings file (Codex's TOML) supplies its own
  strategy without the core assuming a format. Absent ⇒ the default JSON
  deep-merge (`mergeJsonSettingsText`, which lifts the existing `mergeSettings`
  to text and is byte-for-byte what Claude produced before).
- `settingsSeeds()` derives, from every hooks provider, a `SettingsSeed`
  `{ targetRel: settingsFile, merge: mergeSeed ?? default }`. This is the single
  registry-driven source the scaffolder routes by.
- `buildPlan` builds a `target → strategy` map from `settingsSeeds()`
  (injectable for tests) and routes a template to a settings-merge when its
  **target path** is a provider's settings file — no `.claude/settings.json`
  literal in the core. `isSettingsTemplate` is deleted (the registry decides
  now; one source, no dead predicate). `template.ts` can't import the registry
  without a cycle, so the routing lives in `fs_plan` (which already reads both).

The explicit *no*s:

- **Claude's seeded output stays byte-identical.** Its `HooksIntegration`
  declares no `mergeSeed`, so it gets the default JSON strategy, which is the
  old code path lifted to text.
- **No per-vendor hook _format_ is implemented here.** Codex's TOML strategy,
  Gemini's `hooks.enabled`, Cursor's and Copilot's shapes are later plans. This
  generalizes the _seam_ and keeps Claude working.
- **`SessionStart-only` providers are supported.** A non-Claude agent with no
  worktree create/remove events declares `worktreeEventKeys = []` and just a
  `sessionHookNeedle`; the hook-stripper and the parity guard both iterate the
  list, so empty is handled with no special case.

## Consequences

- **Adding a hooks provider is a declaration + a template.** Declare a
  `HooksIntegration` (optionally with a `mergeSeed`) and drop a
  `templates/<settingsFile>.tmpl` — `settingsSeeds()` routes it and merges it.
  No edit to `buildPlan`, `planSettingsMerge`, or `template.ts`. The parity test
  already asserts each hooks provider has a seed template, so a missing one
  red-lights the gate.
- **The merge engine is format-pluggable.** JSON stays the default for the four
  JSON-settings agents; Codex's TOML slots in as a strategy later, with the core
  none the wiser.
- **One less hardcoded agent path.** `isSettingsTemplate`'s
  `.claude/settings.json` literal is gone; routing now flows from the registry
  like every other agent-specific path (ADR 0043).
- **The routing decision moved layers.** It now lives in `fs_plan` rather than
  `template.ts`, because the token layer cannot import the registry without an
  import cycle. A small, deliberate placement cost for the registry coupling.

## Alternatives considered

- **Keep `isSettingsTemplate` and add a parallel per-provider path.** Rejected:
  two sources for "what is a settings template" is the drift ADR 0043 exists to
  prevent; the registry is the one source.
- **A JSON-object-level merge strategy on the provider.** Rejected: it bakes in
  the JSON assumption the Codex TOML case breaks. A text-level strategy is the
  smallest seam that holds every future format.
- **Generate settings templates from the registry instead of seeding files.**
  Rejected for the same reason ADR 0043 kept the `.gitignore` fragment authored:
  a settings template carries load-bearing, hand-tuned content (hook commands,
  permission denials); a dropped template guarded by the parity test is lighter
  and equally regression-proof.
