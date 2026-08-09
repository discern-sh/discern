# ADR 0266: Operational agent copy declares typed contracts

**Status**: accepted. Extends the canonical-set forcing function in [ADR 0051](0051-canonical-set-parity.md), the Skill materialization model in [ADR 0087](0087-prefix-and-expand-bundled-skills.md), and the operating-policy registry in [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md). Applies the typed-registry idiom from [ADR 0257](0257-cross-agent-reference-compiles-from-a-canonical-registry.md) to operational agent copy.

## Context

discern gives coding agents effectful instructions through bundled and project-authored Skills and through the staged setup brief. Those sources described useful procedures, but their safety-critical structure lived only in prose. A new Skill could omit its working root, finish without verification, offer no stopping boundary, imply authority, or ask an agent to summarize exact facts without providing a complete relay shape. The ordinary Skill validator could still pass because its portable contract concerns discovery frontmatter.

The agent-voice review also proposed checks for Skill stop conditions, authority declarations, cross-worktree paths, and relay completeness. Vale can catch a small lexical subset, but the Map is its normal corpus and these instructions live elsewhere. More importantly, missing fields and conditional obligations are structural facts. Keyword rules cannot distinguish a legitimate read-only procedure from an effectful procedure that forgot its authority boundary.

One guard needs to cover current authored sources and future members without copying the Skill materialization list. It also needs a deliberate boundary around payload Markdown: a Skill's `skeleton/` files are copied into a project, not followed as instructions in place.

## Decision

discern's operational agent-copy sources declare a fenced TOML block immediately below an `Operational contract` heading. Five booleans classify whether the surface is effectful, cross-worktree, authority-sensitive, relay-bearing, and recoverable. Every surface declares stable targets, an ordered sequence containing an action and ending in verification, and stop conditions. Recoverable, authority-sensitive, and relay-bearing surfaces also declare their corresponding recovery bindings, authority plus re-verification command, or ready-to-send relay template plus named facts. Relay templates use `<fact_name>` placeholders; unlike `{{path_name}}`, that form does not enter discern's bundled-template substitution. Fields that do not apply remain absent rather than carrying invented ceremony.

One repository module derives the enrolled universe. It asks `resolveEffectiveSkills` for the same bundled, authored, override, and exclusion result Skill materialization uses. Each Skill's `SKILL.md` owns one contract, while every other operational Markdown file in that directory inherits it for lexical review. A walk of the resolved setup template directory enrolls every Markdown brief. A segment registry excludes `skeleton/` payloads from both walks with the reason.

The structural parser reports the authored file and line, the missing or invalid field, and its accepted form. Tests demonstrate malformed targets, sequencing, stops, recovery, authority, and relay facts; a read-only classification that omits conditional fields; and unrelated future Skill and setup-brief members that fail without changing the guard.

The derived Markdown corpus is staged with frontmatter blanked and checked by the tracked Vale executable. Every alert whose check name starts with `DiscernAgent.` is blocking. The prefix is the enrollment boundary, so future generated agent lexical rules join without a copied pattern or rule list. Generated and materialized Skill copies remain outputs: authors edit `templates/skills`, `project/skills`, or the voice registry and run `discern refresh`.

Semantic review remains in the agent-voice rubric. The guard does not infer whether a classification tells the truth, whether a pronoun has a clear referent, whether a declared target is the right one, or whether a relay captures facts the author failed to declare.

## Consequences

- Every current effective Skill and setup brief exposes enough structure for a fresh agent to locate the work, act in order, verify completion, stop, and recover when the classification promises recovery.
- Authority-sensitive procedures name both the authority boundary and the command that re-verifies it. Relay-bearing procedures provide a message whose placeholders exactly match their declared fact set.
- A new effective Skill, supporting instruction, setup brief, or generated `DiscernAgent` lexical rule enters through an existing authority. The contract guard has no satellite filename or pattern list to update.
- Installed projects retain the existing portable Skill-frontmatter contract. This repository's test suite enforces the richer block on the operational copy discern itself ships or authors.
- Contract blocks add visible machine-oriented metadata to agent instructions. The cost buys source-located diagnostics and makes applicability explicit; read-only surfaces do not inherit authority or relay fields by default.
- Semantic ambiguity and substantive relay quality remain editorial responsibilities for the agent-voice review rather than brittle token rules.

## Alternatives considered

- **Extend Vale with keywords for every proposed check.** Rejected because missing fields, path scope, authority, and relay completeness depend on structure and applicability rather than isolated phrases.
- **Maintain a test list of Skill and setup filenames.** Rejected because the Skill resolver and setup directory already own membership; a second list would omit future members.
- **Require every conditional field on every surface.** Rejected because explanatory and read-only procedures would gain false authority and relay ceremony that obscures the real boundary.
- **Validate materialized agent directories.** Rejected because they are generated or linked outputs. The authored sources must receive the correction, and refresh owns materialization.
- **Move the richer schema into the installed-project Skill validator.** Rejected because this decision guards discern's own operational copy; changing the portable user-authored Skill contract would be a separate product decision.
