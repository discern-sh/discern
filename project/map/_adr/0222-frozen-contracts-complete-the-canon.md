# ADR 0222: The frozen contract surface completes the vocabulary canon before the first tag

**Status**: accepted

## Context

The first public tag freezes names that no rename can cheaply reach afterwards. Error slugs match by string. Documented environment variables are a Project Script contract. Result-contract ids and envelope field names seed generated schema `$defs` and TypeScript type names. Provider hook invocations live in settings files discern writes into other people's repositories. The scaffolded `discern.toml` trains every new project's habits. [ADR 0120](0120-launch-verb-canon.md) set the naming rule and banned dual spellings, but its sweep worked the verb surface, and stragglers survived in these deeper positions. [ADR 0219](0219-public-install-schema-starts-at-one.md) established the fact that makes fixing them cheap: no public install exists, the migration registry is empty, and the append-only compatibility baseline arms at the first release tag. This is the last moment the fixes are renames rather than migrations.

## Decision

Every contract that freezes at the tag speaks the canon, renamed cleanly with no aliases and no migrations:

- The setup error slug `not_on_integration_branch` becomes **`not_on_trunk`**. It keeps the preposition its siblings drop because `not_trunk` reads as "no trunk exists" — a real adjacent condition with its own hints — and a slug mistakable for a different failure is worse than a pattern break.
- The per-invocation trunk override becomes **`DISCERN_TRUNK`**, matching `[repository].trunk`. The internal hint id `missing-integration-branch` becomes `missing-trunk-branch` in the same stroke.
- The status envelope's git fields become **`trunk`**, **`ahead_trunk`**, and **`behind_trunk`**. `trunk` mirrors the config key and the fields other envelopes already carry under that name; the ahead/behind pair keeps the retired names' direction-reference morphology, so consumers map one to one.
- The scaffolded documentation scope becomes **`[scopes.map]`**, named after the tree it guards. This repository's own scope and its `[acceptance]` standing grant rename in one change, so the recorded grant keeps meaning the same tree.
- The `script` verb becomes **`scripts`**, matching its `[scripts]` config table the way `skills` and `standards` match theirs. The singular is an accepted input variant, not a retired command: typed `discern script <x>` folds to the canonical dispatch through trailing-s forgiveness, silently — a user typing it wants to run one script, and a refusal there is friction without a lesson. The one-spelling rule binds what discern **writes**: help, docs, examples, and generated surfaces spell `scripts` exclusively, held by the term registry's ban on the singular invocation and by verb parity on the registration.
- The `agents` key's canonical home is **`[project].agents`** — agents operate at the project level, so project identity owns which integrations are enabled. The `[guidance].agents` position goes — schema key, resolver read, projection, preset capture, and seeded location — with no epitaph: no public install ever wrote it, so strict unknown-key rejection is the whole contract. The key validates against `AGENT_NAMES`, sharing one provider-name authority with the setup document, so a typo'd provider is a load-time rejection instead of a silently ignored provider.
- The provider hook verbs move to **`worktree hook create`** / **`worktree hook remove`**. The namespace boundary is exact: a verb lives under `hook` when its stdin and stdout belong to the provider hook protocol. `worktree ensure` stays put because it is visible, idempotent, human-runnable, and reads no payload. The typo suggester drops the namespaced pair — the CLI never suggests a machine verb to a human.
- The predicate contract ids become **`configHas`** and **`impactHas`**, the id namespace's lowerCamelCase shape; a registry test now holds every current and future contract and predicate id to it. The bare `discern` contract stays contracted rather than excluded, with the reason recorded beside it: bare `discern --json` emits a real result envelope, so the one-result protocol owns that stdout.
- The **`DEAD_CONFIG_POSITIONS` table empties**. Its prerelease rows pointed at a migration chain the baseline reset deleted — guidance for installs that cannot exist. The mechanism stays armed for the first post-release retirement, mirroring how the reset kept the migration runner with an empty registry.

Each retirement leaves a permanent guard in the layer that owns it: retired command spellings in the redirect table (which the refusal suite and the development vocabulary guard both derive from), prose and identifier spellings in the term registry (`DISCERN_MAIN_BRANCH`, `not_on_integration_branch`, `scopes.docs`, the singular `scripts` invocation), and id shape in the contracts registry test.

## Consequences

- A consumer reading `discern.toml`, an error result, a status envelope, the CLI help, a hook settings file, or a generated type meets one spelling per concept — trunk, map, scripts — and never a retired synonym. Typed input stays forgiving where forgiveness is safe: grammatical variants fold silently; different words still refuse or suggest.
- The renames break private checkouts only: rendered provider settings still invoking the old hook paths need a regenerate, the same bounded pre-tag coordination ADR 0219 accepted for the schema reset.
- The retired spellings cannot return silently on a written surface; each guard fails the gate on reintroduction. Dated records keep the old names searchable — ADR bodies stay as written, and the drift guard exempts them by design.
- After the tag, this class of change costs a major version. The sweep spends the last cheap moment on purpose.

## Alternatives considered

- **A dated amendment on ADR 0120 instead of a new record.** Rejected: the batch contains decisions 0120 never made — the hook namespace boundary, the id casing convention, the input-variant call for `script`, the no-epitaph policy for never-shipped keys. 0120 remains the naming authority; this record documents the completion and the new calls, citing it.
- **Hard-erroring the singular `script` as a retired spelling.** Tried first, reversed: the redirect table is for retired _commands_, and `script` is the same job under the same stem — exactly the grammatical-variant class ADR 0120 reserves silent forwarding for. The refusal punished the likeliest correct guess a user can type.
- **`[guidance].agents` as the canonical agents home.** Tried first, reversed: the compile pipeline consumes the list, but agents operate at the project level, and which integrations a project enables is project identity, not a guidance setting.
- **Epitaph rows for the deleted config positions.** Rejected on ADR 0219's reasoning: dead-position guidance serves installs that hold the key, and none can. Strict unknown-key rejection is the whole contract.
- **Moving `worktree ensure` under the hook namespace.** Rejected: the namespace would then mean "things providers invoke" — a fuzzier boundary than "payload-protocol entry points", and ensure is safe and meaningful for a human to run.
- **Excluding the bare `discern` contract like `help`.** Rejected: exclusions mark stdout owned by another protocol; the root refusal is a genuine `DiscernResult` a tool consumer receives and the generated type should describe.
