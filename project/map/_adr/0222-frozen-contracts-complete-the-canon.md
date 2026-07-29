# ADR 0222: The frozen contract surface completes the vocabulary canon before the first tag

**Status**: accepted

## Context

The first public tag freezes names that no rename can cheaply reach afterwards. Error slugs match by string. Documented environment variables are a Project Script contract. Result-contract ids seed generated schema `$defs` and TypeScript type names. Provider hook invocations live in settings files discern writes into other people's repositories. The scaffolded `discern.toml` trains every new project's habits. [ADR 0120](0120-launch-verb-canon.md) set the naming rule and banned dual spellings, but its sweep worked the verb surface, and stragglers survived in these deeper positions. [ADR 0219](0219-public-install-schema-starts-at-one.md) established the fact that makes fixing them cheap: no public install exists, the migration registry is empty, and the append-only compatibility baseline arms at the first release tag. This is the last moment the fixes are renames rather than migrations.

## Decision

Every contract that freezes at the tag speaks the canon, renamed cleanly with no aliases and no migrations:

- The setup error slug `not_on_integration_branch` becomes **`not_on_trunk`**. It keeps the preposition its siblings drop because `not_trunk` reads as "no trunk exists" — a real adjacent condition with its own hints — and a slug mistakable for a different failure is worse than a pattern break.
- The per-invocation trunk override becomes **`DISCERN_TRUNK`**, matching `[repository].trunk`. The internal hint id `missing-integration-branch` becomes `missing-trunk-branch` in the same stroke.
- The scaffolded documentation scope becomes **`[scopes.map]`**, named after the tree it guards. This repository's own scope and its `[acceptance]` standing grant rename in one change, so the recorded grant keeps meaning the same tree.
- The `script` verb becomes **`scripts`**, matching its `[scripts]` config table the way `skills` and `standards` match theirs. The retired singular joins the redirect table, which the dispatcher checks before trailing-s forgiveness — so `discern script` refuses and names `discern scripts` instead of silently forwarding as a grammatical variant.
- The sweep **deletes** the dead `[project].agents` key — schema key, resolver fallback, raw-projection and preset readers, and reference row. No `DEAD_CONFIG_POSITIONS` row: those messages exist to steer installs off keys they actually hold, and no install ever held this one. Both `agents` arrays now validate against `AGENT_NAMES`, so a typo'd provider name is a load-time rejection instead of a silently ignored provider.
- The provider hook verbs move to **`worktree hook create`** / **`worktree hook remove`**. The namespace boundary is exact: a verb lives under `hook` when its stdin and stdout belong to the provider hook protocol. `worktree ensure` stays put because it is visible, idempotent, human-runnable, and reads no payload. The typo suggester drops the namespaced pair — the CLI never suggests a machine verb to a human.
- The predicate contract ids become **`configHas`** and **`impactHas`**, the id namespace's lowerCamelCase shape; a registry test now holds every current and future contract and predicate id to it. The bare `discern` contract stays contracted rather than excluded, with the reason recorded beside it: bare `discern --json` emits a real result envelope, so the one-result protocol owns that stdout.

Each retirement leaves a permanent guard in the layer that owns it: command spellings in the redirect table (which the refusal suite and the development vocabulary guard both derive from), prose and identifier spellings in the term registry (`DISCERN_MAIN_BRANCH`, `not_on_integration_branch`, `scopes.docs`), and id shape in the contracts registry test.

## Consequences

- A consumer reading `discern.toml`, an error result, the CLI help, a hook settings file, or a generated type meets one spelling per concept — trunk, map, scripts — and never a retired synonym.
- The renames break private checkouts only: rendered provider settings still invoking the old hook paths need a regenerate, the same bounded pre-tag coordination ADR 0219 accepted for the schema reset.
- The retired spellings cannot return silently; each guard fails the gate on reintroduction. Dated records keep the old names searchable — ADR bodies stay as written, and the drift guard exempts them by design.
- After the tag, this class of change costs a major version. The sweep spends the last cheap moment on purpose.

## Alternatives considered

- **A dated amendment on ADR 0120 instead of a new record.** Rejected: the batch contains decisions 0120 never made — the hook namespace boundary, the id casing convention, the no-epitaph policy for never-shipped keys. 0120 remains the naming authority; this record documents the completion and the new calls, citing it.
- **A `DEAD_CONFIG_POSITIONS` epitaph for `[project].agents`.** Rejected on ADR 0219's reasoning: dead-position guidance serves installs that hold the key, and none can. Strict unknown-key rejection is the whole contract.
- **Moving `worktree ensure` under the hook namespace.** Rejected: the namespace would then mean "things providers invoke" — a fuzzier boundary than "payload-protocol entry points", and ensure is safe and meaningful for a human to run.
- **Excluding the bare `discern` contract like `help`.** Rejected: exclusions mark stdout owned by another protocol; the root refusal is a genuine `DiscernResult` a tool consumer receives and the generated type should describe.
