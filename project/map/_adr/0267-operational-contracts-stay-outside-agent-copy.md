# ADR 0267: Operational contracts stay outside agent copy

**Status**: accepted. Extends the canonical-set forcing function in [ADR 0051](0051-canonical-set-parity.md), the Skill materialization model in [ADR 0087](0087-prefix-and-expand-bundled-skills.md), and the operating-policy registry in [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md). Applies the typed-registry idiom from [ADR 0257](0257-cross-agent-reference-compiles-from-a-canonical-registry.md) to operational agent copy.

## Context

discern gives coding agents effectful instructions through bundled and project-authored Skills and through the staged setup brief. A new procedure could omit its working root, finish without verification, offer no stopping boundary, imply authority, or lose required facts during relay. The portable Skill validator would still pass because its public contract concerns discovery frontmatter.

These obligations need structural checks. Vale can cover a small lexical subset, while target scope, applicability, authority, and relay fields depend on the procedure. The check must enroll future Skills and setup briefs without maintaining another membership list.

An initial implementation stored the structural contract as fenced TOML inside every agent-facing Markdown source. Bundled Skill materialization copied that schema into end-user agent directories, and voice Skill generation inserted it into project-authored Skills. The schema consumed context, exposed repository enforcement vocabulary, and asked an agent to reconcile metadata with the procedure it was meant to follow. Passing the schema checks did not establish that the instruction remained usable.

## Decision

Operational contract metadata stays in a repository-only registry. `AGENT_SURFACE_CONTRACTS` classifies each surface as effectful, cross-worktree, authority-sensitive, relay-bearing, and recoverable. Each applicable field binds to an exact excerpt in the authored prose that agents receive. Targets bind a root, path, or stable identifier; sequence entries bind ordered actions ending in verification; stop and recovery entries bind their direct instructions; authority binds a boundary and a code-spanned reverification command; relay binds a ready-to-send message whose placeholders equal its declared facts.

Membership remains derived. `resolveEffectiveSkills` supplies the bundled, authored, override, and exclusion result used by materialization. A walk of the resolved setup directory supplies each Markdown brief. Supporting Skill Markdown joins evidence and lexical review. The named `skeleton/` exclusion covers payload files copied into a project rather than instructions followed in place. The guard checks registry coverage in both directions, so a future member fails at its authored source and a stale registry row also fails.

No generator or materialization path reads the contract registry. A separate output guard scans the authored corpus and a real temporary Skill materialization. It rejects the retired heading and the classification-TOML structure, including the same schema under a renamed heading. The derived Markdown corpus also passes through every generated `DiscernAgent` Vale rule.

The structural diagnostics name the authored file, missing field, and accepted registry form. Tests demonstrate malformed targets, sequencing, stops, recovery, authority, and relay facts; missing and reordered prose evidence; a read-only classification that omits conditional fields; future Skill and setup-brief enrollment; and the absence of internal metadata from materialized Skills.

Semantic review remains in the agent-voice rubric. The guard does not infer whether a classification tells the truth, whether a pronoun has one referent, whether a target is the right target, or whether the declared relay contains every fact the situation requires.

## Consequences

- End-user agents receive direct operational prose without discern's enforcement schema or classification vocabulary.
- Exact prose evidence makes a safety-relevant wording change fail until the registry binding is reviewed. Ordinary prose elsewhere remains free to change.
- A new effective Skill, supporting instruction, setup brief, or generated `DiscernAgent` lexical rule enters through an existing membership authority.
- Read-only and explanatory procedures omit inapplicable recovery, authority, or relay ceremony.
- Installed projects retain the existing portable Skill-frontmatter contract. The richer registry governs only the operational copy discern ships or authors in this repository.

## Alternatives considered

- **Render contract TOML into each Skill.** Rejected because the internal schema becomes part of the end-user agent prompt.
- **Place the schema in frontmatter or comments.** Rejected because agent runtimes still load those bytes and may expose or interpret them.
- **Infer every field from headings or keywords.** Rejected because surface wording is curated and semantic applicability cannot be recovered safely from tokens.
- **Maintain a test-owned filename list.** Rejected because the Skill resolver and setup directory already own membership.
- **Require every conditional field everywhere.** Rejected because read-only procedures would gain false authority and relay instructions.
